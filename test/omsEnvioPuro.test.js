import test from 'node:test';
import assert from 'node:assert/strict';
import { proximaAcao, camposDoLote } from '../src/utils/omsEnvioPuro.js';

const base = Date.parse('2026-11-19T12:00:00Z');
const min = (n) => new Date(base - n * 60000).toISOString();
const envio = (extra) => ({ sent_to_erp: false, status: 'enviado', tentativas: 1, created_at: min(0), updated_at: min(0), ...extra });

test('sem lote aceito: reenvia em 1, 2, 4, 8, 16 min e depois esgota', () => {
  const e = (tentativas, parado) => envio({ status: 'enviando', tentativas, updated_at: min(parado) });
  assert.equal(proximaAcao(e(1, 0.5), base), null);
  assert.equal(proximaAcao(e(1, 1), base), 'reenviar');
  assert.equal(proximaAcao(e(2, 1.5), base), null);
  assert.equal(proximaAcao(e(2, 2), base), 'reenviar');
  assert.equal(proximaAcao(e(5, 16), base), 'reenviar');
  assert.equal(proximaAcao(e(6, 99), base), 'esgotar');
});

test('lote em andamento: consulta a cada 1 min; failed reenvia ate 3 tentativas', () => {
  const e = (extra) => envio({ batch_id: 'b', ...extra });
  assert.equal(proximaAcao(e({ oms_status: 'processing', updated_at: min(0.5) }), base), null);
  assert.equal(proximaAcao(e({ oms_status: 'processing', updated_at: min(1) }), base), 'consultar_lote');
  assert.equal(proximaAcao(e({ oms_status: null, updated_at: min(2) }), base), 'consultar_lote');
  assert.equal(proximaAcao(e({ oms_status: 'failed', tentativas: 2, updated_at: min(2) }), base), 'reenviar');
  assert.equal(proximaAcao(e({ oms_status: 'failed', tentativas: 3, updated_at: min(2) }), base), null);
});

test('na fila do SAP: consulta a cada 15 min, expira em 72 h, e para em sentToErp/blocked/treated/recusado', () => {
  const e = (extra) => envio({ batch_id: 'b', oms_status: 'done', outcome: 'queuedForErp', ...extra });
  assert.equal(proximaAcao(e({ updated_at: min(14) }), base), null);
  assert.equal(proximaAcao(e({ updated_at: min(15) }), base), 'consultar_fatura');
  assert.equal(proximaAcao(e({ updated_at: min(15), created_at: min(72 * 60 + 1) }), base), 'expirar');
  assert.equal(proximaAcao(e({ sent_to_erp: true, updated_at: min(99) }), base), null);
  assert.equal(proximaAcao(e({ outcome: 'blocked', updated_at: min(99) }), base), null);
  assert.equal(proximaAcao(e({ outcome: 'treated', updated_at: min(99) }), base), null);
  assert.equal(proximaAcao(envio({ status: 'recusado', updated_at: min(99) }), base), null);
});

test('camposDoLote traduz a fatura do lote', () => {
  const c = camposDoLote({ status: 'done', invoices: [{ invoiceId: 'ABC', status: 'done', outcome: 'queuedForErp', sentToErp: false, attempts: 1, bypassedChecks: [{ code: 'X' }] }] }, 'abc');
  assert.deepEqual([c.oms_status, c.outcome, c.sent_to_erp, c.status, c.tentativas], ['done', 'queuedForErp', false, 'enviado', 1]);
  assert.equal(camposDoLote({ status: 'processing', invoices: [] }, 'abc').oms_status, 'processing');
});
