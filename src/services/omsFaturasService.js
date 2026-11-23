/**
 * Front da integracao AMD Log -> Verum OMS (faturas de frete -> SAP). Contrato: VLOG-3813 v1.
 * Fala so com /api/oms-faturas (o secret do OMS nunca chega aqui). Quem aprovou e definido pelo servidor
 * a partir da sessao; aqui so se manda o nome de exibicao.
 *
 * Fluxo (secao 6): prepararCarga -> GRAVAR os lotes (requestId) -> enviarLoteComRetentativa por lote ->
 * acompanharLote a cada 1 min -> consultarFatura a cada 15 min ate sentToErp (ate 72 h).
 */
import { getSupabaseClient } from '../lib/supabaseClient';
import { carregarSessao } from '../utils/authLocal';

export const INTERVALO_LOTE_MS = 60 * 1000;
export const INTERVALO_SAP_MS = 15 * 60 * 1000;
export const LIMITE_ESPERA_SAP_MS = 72 * 60 * 60 * 1000;
const ESPERAS_MS = [1, 2, 4, 8, 16].map((m) => m * 60000);

async function chamar(corpo) {
  const supabase = getSupabaseClient();
  const { data } = supabase ? await supabase.auth.getSession() : { data: null };
  const token = data?.session?.access_token || '';
  const resp = await fetch('/api/oms-faturas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    // Login legado (sem sessao do Supabase): o servidor identifica pelo e-mail de um usuario ativo.
    body: JSON.stringify({ ...corpo, usuarioEmail: carregarSessao()?.email || '' }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.ok === false) {
    const erro = new Error(json.erro || json.message || `Falha ${resp.status} na integracao com o OMS.`);
    Object.assign(erro, { status: resp.status, code: json.code, details: json.details, retryable: !!json.retryable, acao: json.acao });
    throw erro;
  }
  return json;
}

/** Divide a carga em lotes de ate 1.000 faturas, cada um com requestId. Nao chama o OMS: grave o resultado antes de enviar. */
export async function prepararCarga(faturas, performedByName) {
  return (await chamar({ acao: 'preparar', faturas, performedByName })).lotes;
}

export function enviarLote(lote, performedByName, { reenvio = false } = {}) {
  return chamar({ acao: 'enviar', lote, performedByName, reenvio });
}

/** Reenvia o MESMO corpo com o MESMO requestId em 1, 2, 4, 8 e 16 min (timeout/rede/500/503). Outros erros sobem na hora. */
export async function enviarLoteComRetentativa(lote, performedByName, { dormir = (ms) => new Promise((r) => setTimeout(r, ms)), aoEsperar } = {}) {
  for (let i = 0; ; i += 1) {
    try {
      return await enviarLote(lote, performedByName);
    } catch (e) {
      const semResposta = e.status == null || e.status === 0 || e.name === 'TypeError';
      if (!(semResposta || e.retryable) || i >= ESPERAS_MS.length) throw e;
      aoEsperar?.({ tentativa: i + 1, esperaMs: ESPERAS_MS[i], erro: e });
      await dormir(ESPERAS_MS[i]);
    }
  }
}

export async function acompanharLote(batchId) {
  return (await chamar({ acao: 'lote', batchId })).lote;
}

/** Situacao antes do "Enviar ao SAP": state = processing | pendingTreatment | blocked | readyForErp | queuedForErp | sentToErp. */
export async function consultarFatura(invoiceId) {
  return (await chamar({ acao: 'fatura', invoiceId })).fatura;
}

/** Linhas sem CT-e da fatura (`missingCtes`, cada uma com `import`). Vem junto da consulta de situacao. */
export async function consultarCtesFaltantes(invoiceId) {
  const f = await consultarFatura(invoiceId);
  return { state: f?.state, missingCtes: Array.isArray(f?.missingCtes) ? f.missingCtes : [] };
}

function paraBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Le o arquivo como bytes e converte direto para Base64: sem parse, sem reformatar (a assinatura exige o original). */
export async function arquivoParaBase64(arquivo) {
  return paraBase64(new Uint8Array(await arquivo.arrayBuffer()));
}

/** Um envio (ate 50 XMLs). `requestId` novo por envio diferente; o mesmo ao repetir o mesmo corpo. */
export function enviarCtesXml({ invoiceId, xmls, requestId = crypto.randomUUID() }) {
  return chamar({ acao: 'ctes', requestId, invoiceId, ctes: xmls.map((xml) => ({ xml })) }).then((r) => ({ ...r, requestId }));
}

/**
 * Envia varios arquivos da mesma fatura, em chamadas de ate 50 XMLs / ~3 MB. Devolve o resultado POR arquivo:
 * { nome, status: queued|alreadyExists|rejected|erro, code, message, cteKey }. Erro de chamada marca so aquele grupo.
 */
export async function enviarArquivosCte(invoiceId, arquivos, { aoProgredir } = {}) {
  const itens = [];
  for (const a of arquivos) itens.push({ nome: a.name, xml: await arquivoParaBase64(a) });
  const grupos = [];
  let atual = []; let bytes = 0;
  for (const it of itens) {
    if (atual.length && (atual.length >= 50 || bytes + it.xml.length > 3 * 1024 * 1024)) { grupos.push(atual); atual = []; bytes = 0; }
    atual.push(it); bytes += it.xml.length;
  }
  if (atual.length) grupos.push(atual);

  const saida = [];
  for (const g of grupos) {
    try {
      const r = await enviarCtesXml({ invoiceId, xmls: g.map((x) => x.xml) });
      g.forEach((x, i) => {
        const c = (r.ctes || []).find((y) => y.index === i) || {};
        saida.push({ nome: x.nome, status: c.status || 'erro', code: c.code || null, message: c.message || null, cteKey: c.cteKey || null });
      });
    } catch (e) {
      g.forEach((x) => saida.push({ nome: x.nome, status: 'erro', code: e.code || null, message: e.message, cteKey: null }));
    }
    aoProgredir?.(saida.length, itens.length);
  }
  return saida;
}

const CHAVE_MOTIVOS = 'amd:oms:motivos';
/** Motivos de tratativa: lidos uma vez por dia e guardados em cache. */
export async function carregarMotivos({ forcar = false } = {}) {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_MOTIVOS) || 'null');
    if (!forcar && salvo && Date.now() - salvo.em < 24 * 3600 * 1000) return salvo.motivos;
  } catch { /* cache ilegivel: busca de novo */ }
  const { motivos } = await chamar({ acao: 'motivos' });
  try { localStorage.setItem(CHAVE_MOTIVOS, JSON.stringify({ em: Date.now(), motivos })); } catch { /* sem cache */ }
  return motivos;
}
