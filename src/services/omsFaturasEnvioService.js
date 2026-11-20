/**
 * Liberacao da fatura ao SAP pelo OMS (VLOG-3813): o AMD aprova e o OMS coloca a fatura na fila do SAP
 * (so release:true, sem tratativas: as validacoes de negocio sao dispensadas e registradas no OMS).
 * Cada lote fica gravado em fatura_oms_envios ANTES do envio; reenvio usa o mesmo requestId e o mesmo corpo.
 * Falha aqui nunca desfaz a liberacao no AMD: o envio fica pendente e pode ser reenviado/atualizado.
 */
import { getSupabaseClient } from '../lib/supabaseClient';
import { acompanharLote, consultarFatura, enviarLote } from './omsFaturasService';
import { carregarSessao } from '../utils/authLocal';
import { carregarResumoCtesFaturas } from './diagnosticoFaturasService';
import { aptidaoEnvioSap } from '../utils/diagnosticoFaturas';
import { camposDoLote, montarPayloadLiberacao, omsInvoiceIdValido } from '../utils/omsEnvioPuro';

export { camposDoLote, montarPayloadLiberacao, omsInvoiceIdValido };

const TABELA = 'fatura_oms_envios';

export const ROTULO_ENVIO_OMS = {
  enviando: 'Enviando ao OMS',
  enviado: 'Aguardando OMS',
  queuedForErp: 'Na fila do SAP',
  alreadyReleased: 'Já liberada no OMS',
  sentToErp: 'Enviada ao SAP',
  blocked: 'Bloqueada no OMS',
  erro: 'Falha no envio ao OMS',
  recusado: 'Recusada pelo OMS',
};

/** Estado exibido ao auditor, a partir do registro gravado. */
export function estadoEnvioOms(envio) {
  if (!envio) return null;
  if (envio.sent_to_erp) return 'sentToErp';
  if (envio.outcome) return envio.outcome === 'treated' ? 'enviado' : envio.outcome;
  if (envio.oms_status === 'failed') return 'erro';
  return envio.status || 'enviando';
}

function db() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase nao configurado.');
  return supabase;
}

async function atualizar(id, campos) {
  const { data, error } = await db().from(TABELA).update({ ...campos, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw new Error(`Registro do envio ao OMS: ${error.message}`);
  return data;
}

export async function listarEnviosOms(faturaId) {
  const { data, error } = await db().from(TABELA).select('*').eq('fatura_id', faturaId).order('created_at', { ascending: false }).limit(10);
  if (error) throw new Error(`Envios ao OMS: ${error.message}`);
  return data || [];
}

async function transmitir(envio, nomeAuditor) {
  try {
    const r = await enviarLote(envio.payload, nomeAuditor, { reenvio: (envio.tentativas || 0) > 0 });
    return await atualizar(envio.id, { status: 'enviado', batch_id: r.batchId, erro: null, tentativas: (envio.tentativas || 0) + 1 });
  } catch (e) {
    const detalhe = { code: e.code || null, message: e.message, details: e.details || null, acao: e.acao || null };
    // Timeout/rede/500/503: segue "enviando" para reenviar o MESMO corpo. Demais: recusado (corrigir e mandar de novo).
    const semResposta = e.status == null || e.status === 0 || e.name === 'TypeError';
    const status = semResposta || e.retryable ? 'enviando' : 'recusado';
    return atualizar(envio.id, { status, erro: detalhe, tentativas: (envio.tentativas || 0) + 1 });
  }
}

/**
 * Libera a fatura no OMS. Retorna { resultado, envio?, mensagem }.
 * resultado: sem_id | sem_partida | ja_liberada | bloqueada | enviado | pendente | recusado
 */
export async function liberarFaturaNoOms({ fatura, nomeAuditor }) {
  if (!omsInvoiceIdValido(fatura?.oms_invoice_id)) {
    return { resultado: 'sem_id', mensagem: 'Fatura sem Id do OMS: reimporte a planilha de faturas da Verum (coluna "Id") para enviar ao SAP.' };
  }
  const omsInvoiceId = String(fatura.oms_invoice_id).toLowerCase();

  // Trava do AMD: so vai ao SAP com TODOS os CT-es com partida e nenhuma partida compensada (Fenix ou outra).
  // Sem conseguir conferir, nao envia (melhor reenviar depois do que mandar sem partida).
  let aptidao;
  try {
    const resumo = (await carregarResumoCtesFaturas([fatura.id])).get(String(fatura.id));
    aptidao = aptidaoEnvioSap(resumo);
  } catch (e) {
    return { resultado: 'sem_partida', pendentes: [], mensagem: `Não enviada ao OMS: não foi possível conferir as partidas dos CT-es (${e.message}). Use "Enviar ao OMS" depois.` };
  }
  if (!aptidao.apta) {
    return { resultado: 'sem_partida', pendentes: aptidao.pendentes, mensagem: `Não enviada ao OMS: ${aptidao.mensagem} Atualize no SAP e use "Enviar ao OMS" na fatura.` };
  }

  // Situacao antes de liberar (5.3). Falha na consulta nao impede o envio: o lote tem as mesmas travas.
  try {
    const s = await consultarFatura(omsInvoiceId);
    if (s.state === 'queuedForErp' || s.state === 'sentToErp') return { resultado: 'ja_liberada', mensagem: s.state === 'sentToErp' ? 'OMS: fatura já enviada ao SAP.' : 'OMS: fatura já está na fila do SAP.' };
    if (s.state === 'blocked') {
      const codes = (s.blockingChecks || []).map((c) => c.code).join(', ');
      return { resultado: 'bloqueada', mensagem: `OMS: liberação bloqueada (${codes || 'trava dura'}). Resolva no OMS e envie de novo.` };
    }
    if (s.state === 'processing') return { resultado: 'pendente', mensagem: 'OMS: fatura ainda em processamento em outro lote. Tente de novo em 1 minuto.' };
  } catch { /* segue */ }

  const requestId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  // performedBy gravado no corpo: reenvio (inclusive pelo cron) tem de ser identico, senao o OMS responde REQUEST_ID_REUSED.
  const { data: sessaoAuth } = await db().auth.getSession();
  const idAuditor = sessaoAuth?.session?.user?.id || carregarSessao()?.id;
  const payload = montarPayloadLiberacao({ requestId, omsInvoiceId, valorFatura: fatura.valor_fatura, performedBy: idAuditor ? { id: idAuditor, name: String(nomeAuditor || '').slice(0, 120) } : null });
  // requestId gravado ANTES de chamar o OMS.
  const { data: criado, error } = await db().from(TABELA).insert({
    fatura_id: fatura.id, oms_invoice_id: omsInvoiceId, request_id: requestId, payload,
    approved_charge_value: payload.invoices[0].approvedChargeValue, status: 'enviando', enviado_por: nomeAuditor || null,
  }).select('*').single();
  if (error) throw new Error(`Nao foi possivel registrar o envio ao OMS: ${error.message}`);

  const envio = await transmitir(criado, nomeAuditor);
  if (envio.status === 'recusado') return { resultado: 'recusado', envio, mensagem: `OMS recusou o envio: ${envio.erro?.message || envio.erro?.code || 'erro'}.` };
  if (envio.status === 'enviando') return { resultado: 'pendente', envio, mensagem: 'OMS indisponível agora. O envio ficou pendente: use "Reenviar" (mesmo requestId, nada é aplicado duas vezes).' };
  return { resultado: 'enviado', envio, mensagem: 'Enviada ao OMS: acompanhe o status (fila do SAP).' };
}

/** Reenvia (mesmo corpo/requestId) ou, se ja aceito, atualiza pelo lote e pela situacao da fatura. */
export async function atualizarEnvioOms(envio, nomeAuditor) {
  if (!envio.batch_id) return transmitir(envio, nomeAuditor);
  const lote = await acompanharLote(envio.batch_id);
  let campos = camposDoLote(lote, envio.oms_invoice_id);
  const fila = campos.outcome === 'queuedForErp' || campos.outcome === 'alreadyReleased';
  if (fila && !campos.sent_to_erp) {
    try {
      const s = await consultarFatura(envio.oms_invoice_id);
      if (s.state === 'sentToErp') campos = { ...campos, sent_to_erp: true, sent_to_erp_visto_em: new Date().toISOString() };
    } catch { /* tenta no proximo ciclo */ }
  } else if (campos.sent_to_erp && !envio.sent_to_erp_visto_em) {
    campos = { ...campos, sent_to_erp_visto_em: new Date().toISOString() };
  }
  return atualizar(envio.id, campos);
}

export const STATUS_LIBERADOS_AMD = new Set(['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO']);

/**
 * Chamado em TODO caminho que libera a fatura para pagamento (direta, em massa, aprovacao da gestao).
 * So envia se o status novo for de liberacao (ou seja, ja passou pelas regras de aprovacao do AMD).
 * O valor aprovado e o valor da fatura mesmo com desconto: o desconto e tratado a parte, nao muda o valor no OMS.
 * Nunca lanca: falha no OMS nao desfaz a liberacao no AMD. Retorna { resultado, mensagem, envio? } ou null se nao se aplica.
 */
export async function liberarNoOmsAposAprovacao({ fatura, statusNovo, nomeAuditor }) {
  if (!STATUS_LIBERADOS_AMD.has(statusNovo)) return null;
  try {
    return await liberarFaturaNoOms({ fatura, nomeAuditor });
  } catch (e) {
    return { resultado: 'erro', mensagem: `Envio ao OMS nao feito: ${e.message}` };
  }
}

/** Ultimo envio ao OMS de cada fatura: Map(faturaId -> envio). Usado pelo Diagnostico. */
export async function carregarEnviosOmsPorFatura(faturaIds = []) {
  const mapa = new Map();
  const ids = [...new Set(faturaIds.map(String))];
  if (!ids.length) return mapa;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db().from(TABELA)
      .select('fatura_id,status,oms_status,outcome,sent_to_erp,queued_for_erp_at,blocking_checks,erro,created_at')
      .in('fatura_id', ids.slice(i, i + 200)).order('created_at', { ascending: false });
    if (error) throw new Error(`Envios ao OMS: ${error.message}`);
    (data || []).forEach((e) => { if (!mapa.has(String(e.fatura_id))) mapa.set(String(e.fatura_id), e); });
  }
  return mapa;
}
