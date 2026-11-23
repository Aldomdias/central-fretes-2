/**
 * Cliente da integracao AMD Log -> Verum OMS (faturas de frete / DOCCOB -> SAP).
 * Contrato: integracao-amd-verum-oms-faturas.md (v1, VLOG-3813).
 *
 * Roda SO no servidor (api/oms-faturas.js): o client secret nunca vai ao navegador.
 * Sem dependencias; fetch/relogio/sleep injetaveis para teste.
 * Decide sempre pelo `code` do erro, nunca pelo texto da mensagem.
 */
import { randomUUID } from 'node:crypto';

export const LIMITES = Object.freeze({
  FATURAS_POR_LOTE: 1000,
  CTES_POR_FATURA: 5000,
  CTES_POR_LOTE: 50000,
  NOTE_MAX: 500,
  REQUEST_ID_MAX: 64,
  PERFORMED_BY_ID_MAX: 64,
  PERFORMED_BY_NAME_MAX: 120,
  FORCE_REASON_MIN: 20,
  FORCE_REASON_MAX: 500,
});

// Esperas (minutos) entre reenvios do MESMO corpo com o MESMO requestId (secao 6.4).
export const ESPERAS_RETENTATIVA_MIN = Object.freeze([1, 2, 4, 8, 16]);
export const MARGEM_TOKEN_S = 60;
export const TIMEOUT_ENVIO_MS = 60000;
export const TIMEOUT_CONSULTA_MS = 30000;

const CODES_CORRIGIR_E_REENVIAR = new Set([
  'INVALID_REQUEST', 'TOO_MANY_INVOICES', 'TOO_MANY_CTE_INSTRUCTIONS', 'DUPLICATED_INVOICE',
  'DUPLICATED_CTE', 'REASON_NOT_FOUND', 'CTE_NOT_IN_INVOICE', 'FORCE_REASON_REQUIRED', 'INVOICE_NOT_FOUND',
]);

export class OmsError extends Error {
  constructor({ status = 0, code = 'UNEXPECTED_ERROR', message = '', details = null, retryAfter = null, correlationId = null, network = false }) {
    super(message || code);
    this.name = 'OmsError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
    this.correlationId = correlationId;
    this.network = network;
  }

  /** Reenviar o mesmo corpo com o mesmo requestId (timeout, rede, 500, 503). */
  get retryable() {
    return this.network || this.status === 500 || this.status === 503 || this.status === 429;
  }

  /** Acao recomendada ao chamador, derivada do status/code. */
  get acao() {
    if (this.retryable) return 'reenviar_mesmo_requestId';
    if (this.status === 401) return 'alertar_credencial';
    if (this.status === 403) return 'avisar_verum';
    if (this.code === 'CAPTURE_MODE_UNSUPPORTED') return 'avisar_verum';
    if (this.code === 'ALREADY_PROCESSED') return 'nada_a_fazer';
    if (this.code === 'INVOICE_BUSY') return 'aguardar_outro_lote';
    if (this.code === 'REQUEST_ID_REUSED') return 'gerar_novo_requestId';
    if (CODES_CORRIGIR_E_REENVIAR.has(this.code) || this.status === 400 || this.status === 404) return 'corrigir_e_reenviar_novo_requestId';
    return 'alertar';
  }

  toJSON() {
    return { status: this.status, code: this.code, message: this.message, details: this.details, retryAfter: this.retryAfter, correlationId: this.correlationId, retryable: this.retryable, acao: this.acao };
  }
}

export function lerConfigOms(env = process.env) {
  const baseUrl = String(env.OMS_BASE_URL || '').trim().replace(/\/+$/, '');
  const clientId = String(env.OMS_CLIENT_ID || 'amd-log').trim();
  const clientSecret = String(env.OMS_CLIENT_SECRET || '');
  if (!baseUrl || !clientSecret) {
    throw new Error('Integracao OMS indisponivel: configure OMS_BASE_URL e OMS_CLIENT_SECRET (OMS_CLIENT_ID opcional, padrao amd-log).');
  }
  return { baseUrl, clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// Validacao local (espelha a secao 5.1) — evita gastar uma chamada com erro certo.
// ---------------------------------------------------------------------------
const soTexto = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function validarTratativa(t, caminho, erros) {
  if (t == null) return;
  if (typeof t !== 'object') { erros.push(`${caminho}: deve ser objeto`); return; }
  if (!soTexto(t.reasonCode).trim()) erros.push(`${caminho}.reasonCode: obrigatorio`);
  if (t.note != null && soTexto(t.note).length > LIMITES.NOTE_MAX) erros.push(`${caminho}.note: maximo ${LIMITES.NOTE_MAX} caracteres`);
}

/** Devolve a lista de erros (vazia = ok). Nao altera o payload. */
export function validarLote(payload) {
  const erros = [];
  if (!payload || typeof payload !== 'object') return ['corpo invalido'];
  const rid = soTexto(payload.requestId);
  if (!rid || rid.length > LIMITES.REQUEST_ID_MAX) erros.push(`requestId: obrigatorio, ate ${LIMITES.REQUEST_ID_MAX} caracteres`);
  const p = payload.performedBy || {};
  if (!soTexto(p.id).trim() || soTexto(p.id).length > LIMITES.PERFORMED_BY_ID_MAX) erros.push(`performedBy.id: obrigatorio, ate ${LIMITES.PERFORMED_BY_ID_MAX} caracteres`);
  else if (/@/.test(p.id) || /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(String(p.id).trim())) erros.push('performedBy.id: nao use e-mail nem CPF');
  if (!soTexto(p.name).trim() || soTexto(p.name).length > LIMITES.PERFORMED_BY_NAME_MAX) erros.push(`performedBy.name: obrigatorio, ate ${LIMITES.PERFORMED_BY_NAME_MAX} caracteres`);

  const faturas = payload.invoices;
  if (!Array.isArray(faturas) || !faturas.length) { erros.push('invoices: de 1 a 1000 faturas'); return erros; }
  if (faturas.length > LIMITES.FATURAS_POR_LOTE) erros.push(`invoices: maximo ${LIMITES.FATURAS_POR_LOTE} por lote (TOO_MANY_INVOICES)`);

  const vistas = new Set();
  let totalCtes = 0;
  faturas.forEach((f, i) => {
    const c = `invoices[${i}]`;
    const id = soTexto(f?.invoiceId).trim();
    if (!id) erros.push(`${c}.invoiceId: obrigatorio`);
    else if (vistas.has(id)) erros.push(`${c}.invoiceId: fatura repetida no lote (DUPLICATED_INVOICE)`);
    vistas.add(id);

    const ctes = Array.isArray(f?.ctes) ? f.ctes : [];
    totalCtes += ctes.length;
    if (ctes.length > LIMITES.CTES_POR_FATURA) erros.push(`${c}.ctes: maximo ${LIMITES.CTES_POR_FATURA} por fatura (TOO_MANY_CTE_INSTRUCTIONS)`);
    const chaves = new Set();
    ctes.forEach((cte, j) => {
      const cc = `${c}.ctes[${j}]`;
      const chave = soTexto(cte?.cteKey).trim();
      if (!/^\d{44}$/.test(chave)) erros.push(`${cc}.cteKey: 44 digitos`);
      else if (chaves.has(chave)) erros.push(`${cc}.cteKey: CT-e repetido na fatura (DUPLICATED_CTE)`);
      chaves.add(chave);
      if (!cte?.valueTreatment && !cte?.deliveryTreatment) erros.push(`${cc}: informe valueTreatment ou deliveryTreatment`);
      validarTratativa(cte?.valueTreatment, `${cc}.valueTreatment`, erros);
      validarTratativa(cte?.deliveryTreatment, `${cc}.deliveryTreatment`, erros);
    });

    validarTratativa(f?.valueTreatment, `${c}.valueTreatment`, erros);
    validarTratativa(f?.deliveryTreatment, `${c}.deliveryTreatment`, erros);

    const release = f?.release === true;
    if (!f?.valueTreatment && !f?.deliveryTreatment && !ctes.length && !release) erros.push(`${c}: informe tratativa, ctes ou release: true`);
    if (release) {
      const v = f?.approvedChargeValue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) erros.push(`${c}.approvedChargeValue: obrigatorio (numero em reais) quando release: true`);
    }
    if (f?.force === true) {
      if (!release) erros.push(`${c}.force: so com release: true`);
      const motivo = soTexto(f?.forceReason).trim();
      if (motivo.length < LIMITES.FORCE_REASON_MIN || motivo.length > LIMITES.FORCE_REASON_MAX) {
        erros.push(`${c}.forceReason: de ${LIMITES.FORCE_REASON_MIN} a ${LIMITES.FORCE_REASON_MAX} caracteres (FORCE_REASON_REQUIRED)`);
      }
    }
  });
  if (totalCtes > LIMITES.CTES_POR_LOTE) erros.push(`ctes: maximo ${LIMITES.CTES_POR_LOTE} por lote (TOO_MANY_CTE_INSTRUCTIONS)`);
  return erros;
}

// ---------------------------------------------------------------------------
// Envio de XML de CT-e (contrato AMD-Log-envio-de-XML-de-CTe-ao-OMS)
// ---------------------------------------------------------------------------
export const LIMITES_XML = Object.freeze({ XMLS_POR_CHAMADA: 50, BYTES_POR_XML: 1024 * 1024, BYTES_CORPO: 20 * 1024 * 1024 });
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Bytes aproximados de um Base64 (sem decodificar). */
export function bytesDeBase64(b64) {
  const s = soTexto(b64);
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

export function validarEnvioCtes(payload) {
  const erros = [];
  if (!payload || typeof payload !== 'object') return ['corpo invalido'];
  const rid = soTexto(payload.requestId);
  if (!rid || rid.length > LIMITES.REQUEST_ID_MAX) erros.push(`requestId: obrigatorio, ate ${LIMITES.REQUEST_ID_MAX} caracteres`);
  if (!/^[0-9a-fA-F]{24}$/.test(soTexto(payload.invoiceId).trim())) erros.push('invoiceId: 24 caracteres hexadecimais');
  const ctes = payload.ctes;
  if (!Array.isArray(ctes) || !ctes.length) { erros.push('ctes: de 1 a 50 itens'); return erros; }
  if (ctes.length > LIMITES_XML.XMLS_POR_CHAMADA) erros.push(`ctes: maximo ${LIMITES_XML.XMLS_POR_CHAMADA} por chamada`);
  let total = 0;
  ctes.forEach((c, i) => {
    const x = soTexto(c?.xml);
    if (!x || !BASE64_RE.test(x)) { erros.push(`ctes[${i}].xml: Base64 obrigatorio`); return; }
    const n = bytesDeBase64(x);
    total += x.length;
    if (n > LIMITES_XML.BYTES_POR_XML) erros.push(`ctes[${i}].xml: acima de 1 MB (TOO_LARGE)`);
  });
  if (total > LIMITES_XML.BYTES_CORPO) erros.push('ctes: corpo acima de 20 MB; divida em mais chamadas');
  return erros;
}

/** Divide XMLs (Base64) em chamadas de ate 50 itens e `maxCorpoBytes` (padrao 3 MB: limite de corpo da Vercel e menor que o da Verum). */
export function dividirXmls(xmls, { maxCorpoBytes = 3 * 1024 * 1024 } = {}) {
  const grupos = [];
  let atual = []; let bytes = 0;
  for (const xml of xmls) {
    const n = soTexto(xml).length;
    if (atual.length && (atual.length >= LIMITES_XML.XMLS_POR_CHAMADA || bytes + n > maxCorpoBytes)) { grupos.push(atual); atual = []; bytes = 0; }
    atual.push(xml); bytes += n;
  }
  if (atual.length) grupos.push(atual);
  return grupos;
}

// ---------------------------------------------------------------------------
// Paginacao (6.1): ate 1.000 faturas / 50.000 instrucoes de CT-e por lote,
// cada lote com o seu requestId, uma fatura em um lote so.
// ---------------------------------------------------------------------------
export function montarLotes(faturas, { performedBy, gerarRequestId = randomUUID } = {}) {
  const lista = Array.isArray(faturas) ? faturas : [];
  const ids = new Set();
  for (const f of lista) {
    const id = soTexto(f?.invoiceId).trim();
    if (id && ids.has(id)) throw new OmsError({ status: 400, code: 'DUPLICATED_INVOICE', message: 'A mesma fatura aparece duas vezes na carga.', details: { invoiceId: id } });
    ids.add(id);
  }
  const lotes = [];
  let atual = [];
  let ctesAtual = 0;
  const fechar = () => {
    if (!atual.length) return;
    lotes.push({ requestId: gerarRequestId(), performedBy, invoices: atual });
    atual = []; ctesAtual = 0;
  };
  for (const f of lista) {
    const n = Array.isArray(f?.ctes) ? f.ctes.length : 0;
    if (atual.length >= LIMITES.FATURAS_POR_LOTE || (atual.length && ctesAtual + n > LIMITES.CTES_POR_LOTE)) fechar();
    atual.push(f);
    ctesAtual += n;
  }
  fechar();
  return lotes;
}

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------
async function lerJson(resp) {
  const texto = await resp.text();
  if (!texto) return null;
  try { return JSON.parse(texto); } catch { return { raw: texto.slice(0, 500) }; }
}

export function criarClienteOms({ baseUrl, clientId, clientSecret, fetchImpl = globalThis.fetch, agora = () => Date.now() } = {}) {
  if (!baseUrl || !clientSecret) throw new Error('baseUrl e clientSecret sao obrigatorios.');
  const base = String(baseUrl).replace(/\/+$/, '');
  let token = null;
  let tokenValidoAte = 0;
  let emissaoEmAndamento = null;

  async function chamar(url, init, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: ctl.signal });
    } catch (e) {
      throw new OmsError({ network: true, code: 'NETWORK_ERROR', message: e?.name === 'AbortError' ? 'Tempo limite excedido.' : 'Falha de rede ao chamar o OMS.' });
    } finally {
      clearTimeout(timer);
    }
  }

  async function erroDeResposta(resp) {
    const corpo = await lerJson(resp);
    const ra = Number(resp.headers?.get?.('retry-after'));
    return new OmsError({
      status: resp.status,
      // OAuth usa `error`; a API usa `code`.
      code: corpo?.code || corpo?.error || (resp.status === 401 ? 'UNAUTHORIZED' : 'UNEXPECTED_ERROR'),
      message: corpo?.message || corpo?.error_description || '',
      details: corpo?.details ?? null,
      correlationId: corpo?.correlationId || corpo?.details?.correlationId || null,
      retryAfter: Number.isFinite(ra) ? ra : null,
    });
  }

  async function emitirToken() {
    // Secret so no corpo (form-urlencoded), nunca na URL.
    const corpo = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId || 'amd-log', client_secret: clientSecret });
    const resp = await chamar(`${base}/verumoms/api/v1/authentication/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: corpo.toString(),
    }, TIMEOUT_CONSULTA_MS);
    if (!resp.ok) throw await erroDeResposta(resp);
    const json = await lerJson(resp);
    if (!json?.access_token) throw new OmsError({ status: 500, code: 'server_error', message: 'Resposta de token sem access_token.' });
    token = json.access_token;
    tokenValidoAte = agora() + Math.max(0, Number(json.expires_in || 0) - MARGEM_TOKEN_S) * 1000;
    return token;
  }

  async function obterToken(forcar = false) {
    if (!forcar && token && agora() < tokenValidoAte) return token;
    // Uma emissao por vez: ha limite de emissoes por minuto.
    if (!emissaoEmAndamento) emissaoEmAndamento = emitirToken().finally(() => { emissaoEmAndamento = null; });
    return emissaoEmAndamento;
  }

  /** 401 com token "valido": token novo e repete UMA vez (3.2). */
  async function api(metodo, caminho, { corpo, timeoutMs = TIMEOUT_CONSULTA_MS, aceitar = [] } = {}) {
    const url = `${base}${caminho}`;
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      const t = await obterToken(tentativa === 1);
      const resp = await chamar(url, {
        method: metodo,
        headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined,
      }, timeoutMs);
      if (resp.status === 401 && tentativa === 0) { token = null; continue; }
      if (resp.ok || aceitar.includes(resp.status)) return { status: resp.status, corpo: await lerJson(resp) };
      throw await erroDeResposta(resp);
    }
    throw new OmsError({ status: 401, code: 'UNAUTHORIZED', message: 'OMS recusou o token novo.' });
  }

  return {
    obterToken,

    /** 202 = aceito; 200 = mesmo requestId/corpo ja aceito (idempotente). Nada e aplicado duas vezes. */
    async enviarLote(payload) {
      const erros = validarLote(payload);
      if (erros.length) throw new OmsError({ status: 400, code: 'INVALID_REQUEST', message: 'Lote invalido antes do envio.', details: { erros } });
      const r = await api('POST', '/verumoms/api/v1/logistic/freight-audit/batches', { corpo: payload, timeoutMs: TIMEOUT_ENVIO_MS });
      return { aceitoAgora: r.status === 202, reenvioIdempotente: r.status === 200, ...(r.corpo || {}) };
    },

    /**
     * Envio de XML de CT-e / cancelamento (contrato AMD-Log-envio-de-XML-de-CTe-ao-OMS, v1).
     * 202 = aceito; 200 = mesmo requestId/corpo (replayed). O resultado vale POR XML (`ctes[].status/code`).
     * Nunca loga nem devolve o conteudo do XML.
     */
    async enviarCtes(payload) {
      const erros = validarEnvioCtes(payload);
      if (erros.length) throw new OmsError({ status: 400, code: 'INVALID_REQUEST', message: 'Envio de XML invalido antes da chamada.', details: { erros } });
      const r = await api('POST', '/verumoms/api/v1/logistic/freight-audit/ctes', {
        corpo: { requestId: payload.requestId, invoiceId: payload.invoiceId, ctes: payload.ctes.map((c) => ({ xml: c.xml })) },
        timeoutMs: TIMEOUT_ENVIO_MS,
      });
      return { aceitoAgora: r.status === 202, reenvioIdempotente: r.status === 200, ...(r.corpo || {}) };
    },

    consultarLote(batchId) {
      return api('GET', `/verumoms/api/v1/logistic/freight-audit/batches/${encodeURIComponent(batchId)}`).then((r) => r.corpo);
    },

    /** 200 e 409 trazem o mesmo corpo; `state` diz se ha pendencia (409) ou nao (200). */
    async consultarFatura(invoiceId) {
      const r = await api('GET', `/verumoms/api/v1/logistic/freight-audit/invoices/${encodeURIComponent(invoiceId)}/status`, { aceitar: [409] });
      return { httpStatus: r.status, pendencia: r.status === 409, ...(r.corpo || {}) };
    },

    async listarMotivos() {
      const [valor, entrega] = await Promise.all([
        api('GET', '/verumoms/api/v1/VerumLog/get-doccob-treaties'),
        api('GET', '/verumoms/api/v1/VerumLog/get-doccob-delivery-treaties'),
      ]);
      const norm = (l) => (Array.isArray(l) ? l : []).map((m) => ({ code: String(m.Code), descricao: m.Value }));
      return { valor: norm(valor.corpo), entrega: norm(entrega.corpo) };
    },
  };
}

/** Quanto esperar antes do reenvio n (0-based); null = esgotou, alertar. */
export function esperaRetentativaMs(tentativa) {
  const min = ESPERAS_RETENTATIVA_MIN[tentativa];
  return min == null ? null : min * 60000;
}
