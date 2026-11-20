/**
 * Regras puras do acompanhamento dos envios ao OMS (VLOG-3813, secao 6.3/6.4). Sem rede nem banco:
 * usado pelo painel da fatura (src/services/omsFaturasEnvioService.js) e pelo cron (api/oms-acompanhar.js).
 */
export const ESPERAS_REENVIO_MIN = [1, 2, 4, 8, 16];
export const INTERVALO_LOTE_MIN = 1;
export const INTERVALO_SAP_MIN = 15;
export const LIMITE_SAP_HORAS = 72;
export const MAX_TENTATIVAS_OMS = 3;

const minutos = (de, ate) => (ate - de) / 60000;
const ts = (v) => (v ? new Date(v).getTime() : 0);

/** Traduz a fatura do lote (5.2) em colunas do registro. */
export function camposDoLote(lote, invoiceId) {
  const f = (lote?.invoices || []).find((i) => String(i.invoiceId).toLowerCase() === String(invoiceId).toLowerCase());
  if (!f) return { oms_status: lote?.status || null };
  return {
    oms_status: f.status || null,
    outcome: f.outcome || null,
    bypassed_checks: f.bypassedChecks || [],
    blocking_checks: f.blockingChecks || [],
    queued_for_erp_at: f.queuedForErpAt || null,
    sent_to_erp: f.sentToErp === true,
    oms_sent_by: f.sentBy || null,
    erro: f.error || null,
    tentativas: f.attempts ?? 0,
    status: f.status === 'failed' ? 'erro' : 'enviado',
  };
}

/**
 * Proxima acao para um registro de fatura_oms_envios:
 * 'reenviar' | 'consultar_lote' | 'consultar_fatura' | 'expirar' | 'esgotar' | null (nada a fazer agora ou fim).
 */
export function proximaAcao(envio, agora = Date.now()) {
  if (!envio || envio.sent_to_erp || envio.status === 'recusado') return null;
  const ultima = ts(envio.updated_at) || ts(envio.created_at);
  const parado = minutos(ultima, agora);

  // Sem lote aceito: reenvia o MESMO corpo com o mesmo requestId em 1, 2, 4, 8 e 16 min; depois, alertar.
  if (!envio.batch_id) {
    if (envio.status !== 'enviando') return null;
    const n = envio.tentativas || 0;
    if (n > ESPERAS_REENVIO_MIN.length) return 'esgotar';
    return parado >= ESPERAS_REENVIO_MIN[Math.max(n - 1, 0)] ? 'reenviar' : null;
  }

  // Fatura "failed" no OMS: reenviar o lote com o mesmo requestId, ate 3 tentativas.
  if (envio.oms_status === 'failed') {
    if ((envio.tentativas || 0) >= MAX_TENTATIVAS_OMS) return null;
    return parado >= ESPERAS_REENVIO_MIN[0] ? 'reenviar' : null;
  }

  // Lote ainda nao terminou: consulta a cada 1 min.
  if (envio.oms_status !== 'done') return parado >= INTERVALO_LOTE_MIN ? 'consultar_lote' : null;

  // Terminou e esta na fila do SAP: consulta a cada 15 min ate sentToErp, por ate 72 h.
  if (envio.outcome === 'queuedForErp' || envio.outcome === 'alreadyReleased') {
    if (minutos(ts(envio.created_at), agora) > LIMITE_SAP_HORAS * 60) return 'expirar';
    return parado >= INTERVALO_SAP_MIN ? 'consultar_fatura' : null;
  }
  return null; // treated, blocked: fim.
}

/**
 * Quando o OMS confirma que a fatura entrou na fila do SAP, o envio ao ERP fica registrado na propria fatura
 * (data_envio_erp, enviado_por, valor_enviado), sem depender de reimportar a planilha. null = ainda nao.
 */
export function camposEnvioErpDaFatura(envio = {}, campos = {}) {
  const outcome = campos.outcome ?? envio.outcome;
  const quando = campos.queued_for_erp_at ?? envio.queued_for_erp_at;
  if (!['queuedForErp', 'alreadyReleased'].includes(outcome) || !quando) return null;
  return {
    data_envio_erp: quando,
    enviado_por: campos.oms_sent_by || envio.oms_sent_by || envio.enviado_por || null,
    ...(envio.approved_charge_value != null ? { valor_enviado: Number(envio.approved_charge_value) } : {}),
  };
}

export const OPERADOR_ROBO_OMS = Object.freeze({ id: 'robo-auditor', name: 'Robo Auditor' });

export const omsInvoiceIdValido = (id) => /^[0-9a-f]{24}$/i.test(String(id || '').trim());

/** Corpo do lote de 1 fatura (so liberar). O valor aprovado e o valor da fatura, mesmo com desconto. */
export function montarPayloadLiberacao({ requestId, omsInvoiceId, valorFatura, performedBy }) {
  return {
    requestId,
    ...(performedBy ? { performedBy } : {}),
    invoices: [{ invoiceId: String(omsInvoiceId).toLowerCase(), approvedChargeValue: Number(Number(valorFatura || 0).toFixed(2)), release: true }],
  };
}
