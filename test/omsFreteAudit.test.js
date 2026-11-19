import test from 'node:test';
import assert from 'node:assert/strict';
import { criarClienteOms, montarLotes, validarLote, OmsError, lerConfigOms, esperaRetentativaMs } from '../api/_omsFreteAudit.mjs';

const operador = { id: 'aud-0042', name: 'Auditor Teste' };
const fatura = (n, extra = {}) => ({ invoiceId: String(n).padStart(24, '0'), valueTreatment: { reasonCode: '3' }, ...extra });
const loteOk = (extra = {}) => ({ requestId: 'r-1', performedBy: operador, invoices: [fatura(1)], ...extra });

function resp(status, corpo, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)) };
}
function fakeFetch(roteiro) {
  const chamadas = [];
  const fn = async (url, init) => {
    chamadas.push({ url, init });
    const prox = roteiro.shift();
    if (prox instanceof Error) throw prox;
    return typeof prox === 'function' ? prox(url, init) : prox;
  };
  fn.chamadas = chamadas;
  return fn;
}
const tokenResp = (n = 1800) => resp(200, { access_token: `tok${n}`, token_type: 'Bearer', expires_in: n });
const cliente = (f, extra = {}) => criarClienteOms({ baseUrl: 'https://oms.teste/', clientId: 'amd-log', clientSecret: 'segredo', fetchImpl: f, ...extra });

test('paginacao: 3.000 faturas viram 3 lotes de 1.000, cada um com requestId proprio', () => {
  const faturas = Array.from({ length: 3000 }, (_, i) => fatura(i + 1));
  let n = 0;
  const lotes = montarLotes(faturas, { performedBy: operador, gerarRequestId: () => `uuid-${++n}` });
  assert.deepEqual(lotes.map((l) => l.invoices.length), [1000, 1000, 1000]);
  assert.deepEqual(lotes.map((l) => l.requestId), ['uuid-1', 'uuid-2', 'uuid-3']);
});

test('paginacao: fatura repetida na carga e recusada; limite de 50.000 CT-es abre novo lote', () => {
  assert.throws(() => montarLotes([fatura(1), fatura(1)], { performedBy: operador }), (e) => e.code === 'DUPLICATED_INVOICE');
  const ctes = (n) => Array.from({ length: n }, (_, i) => ({ cteKey: String(i).padStart(44, '0'), deliveryTreatment: { reasonCode: '1' } }));
  const lotes = montarLotes([fatura(1, { ctes: ctes(4000) }), fatura(2, { ctes: ctes(4000) })], { performedBy: operador });
  assert.equal(lotes.length, 1);
  const grandes = Array.from({ length: 11 }, (_, i) => fatura(i + 1, { ctes: ctes(5000) }));
  assert.deepEqual(montarLotes(grandes, { performedBy: operador }).map((l) => l.invoices.length), [10, 1]);
});

test('validacao local espelha o contrato', () => {
  assert.deepEqual(validarLote(loteOk()), []);
  assert.ok(validarLote(loteOk({ invoices: [] })).length);
  assert.ok(validarLote(loteOk({ invoices: [fatura(1), fatura(1)] })).some((e) => e.includes('DUPLICATED_INVOICE')));
  assert.ok(validarLote(loteOk({ invoices: [{ invoiceId: 'a' }] })).some((e) => e.includes('informe tratativa')));
  assert.ok(validarLote(loteOk({ invoices: [{ invoiceId: 'a', release: true }] })).some((e) => e.includes('approvedChargeValue')));
  assert.ok(validarLote(loteOk({ invoices: [fatura(1, { release: true, approvedChargeValue: 10, force: true, forceReason: 'curto' })] })).some((e) => e.includes('FORCE_REASON_REQUIRED')));
  assert.deepEqual(validarLote(loteOk({ invoices: [fatura(1, { release: true, approvedChargeValue: 10, force: true, forceReason: 'Emergencia: SAP fora do ar ontem' })] })), []);
  assert.ok(validarLote(loteOk({ performedBy: { id: 'a@b.com', name: 'x' } })).some((e) => e.includes('e-mail nem CPF')));
  assert.ok(validarLote(loteOk({ performedBy: { id: '123.456.789-09', name: 'x' } })).some((e) => e.includes('e-mail nem CPF')));
  assert.ok(validarLote(loteOk({ invoices: [fatura(1, { ctes: [{ cteKey: '123', valueTreatment: { reasonCode: '1' } }] })] })).some((e) => e.includes('44 digitos')));
  assert.ok(validarLote(loteOk({ invoices: [fatura(1, { valueTreatment: { reasonCode: '3', note: 'x'.repeat(501) } })] })).some((e) => e.includes('note')));
});

test('token: form-urlencoded, secret fora da URL, reaproveitado ate 60 s antes de vencer', async () => {
  let t = 0;
  const f = fakeFetch([tokenResp(1800), tokenResp(1800)]);
  const c = cliente(f, { agora: () => t });
  assert.equal(await c.obterToken(), 'tok1800');
  assert.equal(await c.obterToken(), 'tok1800');
  assert.equal(f.chamadas.length, 1);
  const { url, init } = f.chamadas[0];
  assert.equal(url, 'https://oms.teste/verumoms/api/v1/authentication/oauth/token');
  assert.ok(!url.includes('segredo'));
  assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.match(init.body, /grant_type=client_credentials/);
  t = (1800 - 61) * 1000;
  await c.obterToken();
  assert.equal(f.chamadas.length, 1, 'faltando 61 s restantes ainda reaproveita');
  t = (1800 - 60) * 1000 + 1;
  await c.obterToken();
  assert.equal(f.chamadas.length, 2);
});

test('401 numa chamada: token novo e UMA repeticao', async () => {
  const f = fakeFetch([tokenResp(), resp(401, { error: 'x' }), tokenResp(), resp(200, { batchId: 'b1', status: 'done', invoices: [] })]);
  const lote = await cliente(f).consultarLote('b1');
  assert.equal(lote.batchId, 'b1');
  assert.equal(f.chamadas.length, 4);
  const f2 = fakeFetch([tokenResp(), resp(401, {}), tokenResp(), resp(401, {})]);
  await assert.rejects(cliente(f2).consultarLote('b1'), (e) => e.status === 401);
  assert.equal(f2.chamadas.length, 4, 'nao entra em laco');
});

test('enviarLote: 202 aceito, 200 idempotente, e 409 decide pelo code', async () => {
  const f = fakeFetch([tokenResp(), resp(202, { batchId: 'b1' }), resp(200, { batchId: 'b1' }), resp(409, { code: 'ALREADY_PROCESSED', message: 'qualquer texto', details: { batchId: 'b0' } })]);
  const c = cliente(f);
  const a = await c.enviarLote(loteOk());
  assert.equal(a.aceitoAgora, true);
  assert.equal(f.chamadas[1].init.headers.Authorization, 'Bearer tok1800');
  const b = await c.enviarLote(loteOk());
  assert.equal(b.reenvioIdempotente, true);
  assert.equal(b.batchId, 'b1');
  await assert.rejects(c.enviarLote(loteOk({ requestId: 'r-2' })), (e) => e instanceof OmsError && e.code === 'ALREADY_PROCESSED' && e.acao === 'nada_a_fazer' && !e.retryable);
});

test('classificacao de erros segue a secao 6.4', async () => {
  const caso = async (r, extra) => {
    const f = fakeFetch([tokenResp(), r]);
    try { await cliente(f).enviarLote(loteOk()); } catch (e) { return e; }
    return extra;
  };
  const e503 = await caso(resp(503, { code: 'QUEUE_UNAVAILABLE' }));
  assert.equal(e503.retryable, true);
  assert.equal(e503.acao, 'reenviar_mesmo_requestId');
  assert.equal((await caso(resp(500, { code: 'UNEXPECTED_ERROR', correlationId: 'c-9' }))).correlationId, 'c-9');
  assert.equal((await caso(resp(409, { code: 'INVOICE_BUSY' }))).acao, 'aguardar_outro_lote');
  assert.equal((await caso(resp(409, { code: 'REQUEST_ID_REUSED' }))).acao, 'gerar_novo_requestId');
  assert.equal((await caso(resp(403, { code: 'INVOICE_OUT_OF_SCOPE' }))).acao, 'avisar_verum');
  assert.equal((await caso(resp(404, { code: 'INVOICE_NOT_FOUND' }))).acao, 'corrigir_e_reenviar_novo_requestId');
  const rede = await caso(new Error('ECONNRESET'));
  assert.equal(rede.network, true);
  assert.equal(rede.retryable, true);
});

test('lote invalido nem chega ao OMS', async () => {
  const f = fakeFetch([]);
  await assert.rejects(cliente(f).enviarLote(loteOk({ invoices: [] })), (e) => e.code === 'INVALID_REQUEST');
  assert.equal(f.chamadas.length, 0);
});

test('situacao da fatura: 409 vira pendencia sem lancar erro; 200 nao', async () => {
  const f = fakeFetch([tokenResp(), resp(409, { state: 'processing', ready: false, processing: { batchId: 'b1' } }), resp(200, { state: 'readyForErp', ready: true })]);
  const c = cliente(f);
  const a = await c.consultarFatura('i1');
  assert.deepEqual([a.pendencia, a.state, a.processing.batchId], [true, 'processing', 'b1']);
  const b = await c.consultarFatura('i1');
  assert.deepEqual([b.pendencia, b.state], [false, 'readyForErp']);
});

test('motivos: PascalCase do OMS vira code/descricao', async () => {
  const f = fakeFetch([tokenResp(), resp(200, [{ Code: '3', Value: 'Aprovado', Map: null }]), resp(200, [{ Code: '1', Value: 'Entregue' }])]);
  assert.deepEqual(await cliente(f).listarMotivos(), { valor: [{ code: '3', descricao: 'Aprovado' }], entrega: [{ code: '1', descricao: 'Entregue' }] });
});

test('config exige URL e secret; esperas de reenvio 1/2/4/8/16 min', () => {
  assert.throws(() => lerConfigOms({}), /OMS_BASE_URL/);
  assert.deepEqual(lerConfigOms({ OMS_BASE_URL: 'https://x/', OMS_CLIENT_SECRET: 's' }), { baseUrl: 'https://x', clientId: 'amd-log', clientSecret: 's' });
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(esperaRetentativaMs), [60000, 120000, 240000, 480000, 960000, null]);
});
