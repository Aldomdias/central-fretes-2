/**
 * Front da integracao AMD Log -> Verum OMS (faturas de frete -> SAP). Contrato: VLOG-3813 v1.
 * Fala so com /api/oms-faturas (o secret do OMS nunca chega aqui). Quem aprovou e definido pelo servidor
 * a partir da sessao; aqui so se manda o nome de exibicao.
 *
 * Fluxo (secao 6): prepararCarga -> GRAVAR os lotes (requestId) -> enviarLoteComRetentativa por lote ->
 * acompanharLote a cada 1 min -> consultarFatura a cada 15 min ate sentToErp (ate 72 h).
 */
import { getSupabaseClient } from '../lib/supabaseClient';

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
    body: JSON.stringify(corpo),
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

export function enviarLote(lote, performedByName) {
  return chamar({ acao: 'enviar', lote, performedByName });
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
