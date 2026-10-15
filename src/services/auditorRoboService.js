import { getSupabaseClient } from '../lib/supabaseClient';

export const DECISAO = {
  ENVIAR_LAUDO: 'ENVIAR_LAUDO',
  ENVIAR_APROVACAO: 'ENVIAR_APROVACAO',
  REVISAO_AUDITOR: 'REVISAO_AUDITOR',
};

// O robo so olha faturas que entraram no sistema a partir desta data (as anteriores ficam com o auditor).
export const ROBO_DATA_INICIO = '2026-10-13';

// Faturas que ainda estao na etapa de auditoria (o robo so olha para elas).
export const STATUS_ROBO_AUDITA = ['RECEBIDA', 'PRE_AUDITADA_VERUM', 'REAUDITADA_CENTRAL', 'COM_DIVERGENCIA'];

export const normNome = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

// Decide o que o robo faria a partir do resumo EXATO da fatura (mesmo calculo da tela da
// fatura / Aprovacao da Gestao: CT-es + tolerancia + saldo autorizado + entrega).
// `resumo` vem de resumirFaturasExato. Na duvida nunca envia: cai na fila do auditor.
export function classificarFatura(resumo, considerarMenor = false) {
  if (!resumo || !resumo.total) return { decisao: DECISAO.REVISAO_AUDITOR, motivo: 'Fatura sem CT-es vinculados.', descontar: 0 };
  const maior = Number(resumo.maior || 0);
  const menor = Number(resumo.menor || 0);
  const descontar = Number((considerarMenor ? Math.max(0, maior - menor) : maior).toFixed(2));
  if (resumo.calculados < resumo.total || Number(resumo.semCalculo || 0) > 0) {
    return { decisao: DECISAO.REVISAO_AUDITOR, motivo: `Auditoria incompleta: ${resumo.semCalculo || resumo.total - resumo.calculados} de ${resumo.total} CT-e(s) sem calculo${resumo.motivoSemCalculo ? ` (${resumo.motivoSemCalculo})` : ''}.`, descontar };
  }
  if (descontar > 0) {
    const brl = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
    const partes = [
      `${resumo.divergentes} de ${resumo.total} CT-e(s) divergente(s)`,
      `cobranca acima ${brl(maior)}`,
      menor > 0 ? `abaixo ${brl(menor)}` : '',
      resumo.pendentes > 0 ? `${resumo.pendentes} sem entrega comprovada` : '',
      `a descontar ${brl(descontar)}`,
    ].filter(Boolean);
    return { decisao: DECISAO.ENVIAR_LAUDO, motivo: `Laudo com desconto: ${partes.join(' · ')}.`, descontar };
  }
  if (resumo.pendentes == null) return { decisao: DECISAO.REVISAO_AUDITOR, motivo: 'Entrega nao verificada.', descontar: 0 };
  if (resumo.pendentes > 0) return { decisao: DECISAO.REVISAO_AUDITOR, motivo: `${resumo.pendentes} de ${resumo.total} CT-e(s) sem entrega comprovada.`, descontar: 0 };
  return { decisao: DECISAO.ENVIAR_APROVACAO, motivo: 'Auditoria completa, sem desconto e todos entregues.', descontar: 0 };
}

const tabelaAusente = (error) => ['42P01', 'PGRST205'].includes(error?.code) || /does not exist|schema cache/i.test(error?.message || '');

export async function listarRoboTransportadoras() {
  const { data, error } = await getSupabaseClient().from('auditor_robo_transportadoras').select('*').order('transportadora');
  if (error) {
    if (tabelaAusente(error)) return { lista: [], semTabela: true };
    throw new Error(`Erro ao carregar lista do robo: ${error.message}`);
  }
  return { lista: data || [], semTabela: false };
}

export async function salvarRoboTransportadora(registro) {
  const payload = { ...registro, updated_at: new Date().toISOString() };
  const { error } = await getSupabaseClient().from('auditor_robo_transportadoras').upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(`Erro ao salvar transportadora do robo: ${error.message}`);
}

export async function removerRoboTransportadora(id) {
  const { error } = await getSupabaseClient().from('auditor_robo_transportadoras').delete().eq('id', id);
  if (error) throw new Error(`Erro ao remover: ${error.message}`);
}

export async function listarExecucoesRobo(limite = 500) {
  const { data, error } = await getSupabaseClient().from('auditor_robo_execucoes').select('*').order('executado_em', { ascending: false }).limit(limite);
  if (error) {
    if (tabelaAusente(error)) return [];
    throw new Error(`Erro ao carregar execucoes do robo: ${error.message}`);
  }
  return data || [];
}

export async function gravarExecucoesRobo(registros) {
  for (let i = 0; i < registros.length; i += 200) {
    const { error } = await getSupabaseClient().from('auditor_robo_execucoes').upsert(registros.slice(i, i + 200), { onConflict: 'fatura_id' });
    if (error) throw new Error(`Erro ao gravar execucoes do robo: ${error.message}`);
  }
}

// Faturas ainda em auditoria (candidatas ao robo) e nomes de transportadora existentes.
export async function listarFaturasEmAuditoria() {
  const { data, error } = await getSupabaseClient().from('faturas').select('*')
    .in('status', STATUS_ROBO_AUDITA).order('created_at', { ascending: false }).limit(3000);
  if (error) throw new Error(`Erro ao carregar faturas: ${error.message}`);
  return (data || []).filter((f) => String(f.importado_em || f.created_at || '').slice(0, 10) >= ROBO_DATA_INICIO);
}

// Apaga so as simulacoes (nada enviado) para o robo reanalisar as faturas.
export async function limparSimulacoesRobo() {
  const { error } = await getSupabaseClient().from('auditor_robo_execucoes').delete().eq('acao_executada', false);
  if (error) throw new Error(`Erro ao limpar simulacoes: ${error.message}`);
}

// Fila do auditor: laudos esperando OK e casos para revisar (ainda nao resolvidos pelo robo).
export async function listarFilaAuditorRobo() {
  const { data, error } = await getSupabaseClient().from('auditor_robo_execucoes').select('*')
    .eq('acao_executada', false).in('decisao', [DECISAO.ENVIAR_LAUDO, DECISAO.REVISAO_AUDITOR])
    .order('executado_em', { ascending: true }).limit(3000);
  if (error) {
    if (tabelaAusente(error)) return [];
    throw new Error(`Erro ao carregar a fila do robo: ${error.message}`);
  }
  return data || [];
}

export async function aprovarLaudosRobo(faturaIds, usuario) {
  const agora = new Date().toISOString();
  for (let i = 0; i < faturaIds.length; i += 100) {
    const { error } = await getSupabaseClient().from('auditor_robo_execucoes')
      .update({ aprovado_auditor_por: usuario, aprovado_auditor_em: agora })
      .in('fatura_id', faturaIds.slice(i, i + 100).map(String)).eq('decisao', DECISAO.ENVIAR_LAUDO);
    if (error) throw new Error(`Erro ao aprovar laudo: ${error.message}`);
  }
}

export async function desfazerAprovacaoLaudoRobo(faturaId) {
  const { error } = await getSupabaseClient().from('auditor_robo_execucoes')
    .update({ aprovado_auditor_por: null, aprovado_auditor_em: null }).eq('fatura_id', String(faturaId));
  if (error) throw new Error(`Erro ao desfazer aprovacao: ${error.message}`);
}

// Reavalia UMA fatura agora (botao "Reavaliar agora"): calcula o que faltar, decide e, se ficou
// correta, envia para a gestao. Grava o resultado e devolve o registro.
export async function reavaliarFaturaRobo(fatura, anterior, { usuario = 'auditor', aoProgredir = () => {} } = {}) {
  const core = await import('../utils/auditoriaRoboCore');
  const db = getSupabaseClient();
  const { data: cfgs } = await db.from('auditor_robo_transportadoras').select('*');
  const cfg = (cfgs || []).find((r) => normNome(r.transportadora) === normNome(fatura.transportadora)) || {};
  const emailsAuditores = await core.carregarEmailsAuditores(db);
  const registro = await core.analisarFaturaRobo(db, fatura, {
    cfg, emailsAuditores, usuario, origem: `reavaliacao manual - ${usuario}`, anterior, aoProgredir,
  });
  const { error } = await db.from('auditor_robo_execucoes').upsert(registro, { onConflict: 'fatura_id' });
  if (error) throw new Error(`Erro ao gravar a reavaliacao: ${error.message}`);
  return registro;
}

// Fecha o ciclo do laudo aprovado enquanto o envio automatico nao existe: o auditor manda pelo
// fluxo atual da fatura (laudo + e-mail) e marca aqui. Sai das filas e entra em "aguardando transportadora".
export async function marcarLaudoEnviadoRobo(faturaIds, usuario) {
  const ids = (Array.isArray(faturaIds) ? faturaIds : [faturaIds]).map(String);
  const { error } = await getSupabaseClient().from('auditor_robo_execucoes')
    .update({ acao_executada: true, modo: 'LAUDO_ENVIADO', executado_por: usuario, executado_em: new Date().toISOString() })
    .in('fatura_id', ids).eq('decisao', DECISAO.ENVIAR_LAUDO);
  if (error) throw new Error(`Erro ao marcar laudo como enviado: ${error.message}`);
}

// Todas as transportadoras do cadastro (para escolher na lista do robo), sem depender de ter
// fatura em auditoria agora. Pagina para nao parar no limite de 1000 linhas.
export async function listarNomesTransportadoras() {
  const client = getSupabaseClient();
  const nomes = new Set();
  for (let inicio = 0; inicio < 20000; inicio += 1000) {
    const { data, error } = await client.from('transportadoras').select('nome').order('nome').range(inicio, inicio + 999);
    if (error || !data?.length) break;
    data.forEach((r) => { if (r.nome) nomes.add(String(r.nome).trim()); });
    if (data.length < 1000) break;
  }
  try {
    const { data } = await client.from('auditoria_carteiras').select('transportadora').limit(5000);
    (data || []).forEach((r) => { if (r.transportadora) nomes.add(String(r.transportadora).trim()); });
  } catch { /* sem carteiras */ }
  return [...nomes];
}
