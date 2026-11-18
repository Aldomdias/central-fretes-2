import test from 'node:test';
import assert from 'node:assert/strict';
import { conciliarPagamentosSap } from '../src/utils/auditoriaFretesDomain.js';

const fatura = (extra = {}) => ({
  id: 'f1', numero_fatura: '1672373', transportadora: 'ATUAL CARGAS', cnpj_transportadora: '11222333000144',
  valor_fatura: 1500, data_vencimento: '2026-11-20', status: 'LIBERADA', ...extra,
});
const linhaSap = (extra = {}) => ({
  'Referência': '16723732026', 'Nome do fornecedor': 'ATUAL CARGAS', 'Nº ID fiscal 1': '11222333000144',
  'Montante (ME)': 1500, 'Status comp.': '1', 'Lançto.compensação': '2000123456', 'Lançamento contábil': '1900880705',
  'Data de compensação': '2026-11-19', 'Vencimento': '2026-11-20', ...extra,
});

test('conciliação SAP: referência com sufixo de ano vincula e guarda a evidência dos campos', () => {
  const [r] = conciliarPagamentosSap([fatura()], [linhaSap()]);
  assert.equal(r.fatura_id, 'f1');
  assert.equal(r.resultado, 'PAGO');
  assert.equal(r.campos_vinculo.referencia, true);
  assert.equal(r.campos_vinculo.transportadora, true);
  assert.equal(r.campos_vinculo.valor, true);
  assert.equal(r.campos_vinculo.vencimento, true);
});

test('conciliação SAP: valor divergente não vincula quando a referência não é exata', () => {
  const [r] = conciliarPagamentosSap([fatura({ valor_fatura: 1400 })], [linhaSap()]);
  assert.equal(r.fatura_id, undefined);
  assert.equal(r.resultado, 'DADOS_DIVERGENTES');
});

test('conciliação SAP: relatório grande (40 mil linhas x 3 mil faturas) conclui rápido e ainda vincula o par certo', () => {
  const faturas = [];
  for (let i = 0; i < 3000; i += 1) {
    faturas.push({ id: `f${i}`, numero_fatura: String(100000 + i), transportadora: `T${i % 200}`, cnpj_transportadora: String(10000000 + (i % 200)).padStart(8, '0') + '000144', valor_fatura: 100 + i, data_vencimento: '2026-11-20', status: 'LIBERADA' });
  }
  const linhas = [];
  for (let i = 0; i < 40000; i += 1) {
    linhas.push({ 'Referência': `9${String(i).padStart(7, '0')}`, 'Nome do fornecedor': 'OUTRO', 'Nº ID fiscal 1': '99999999000199', 'Montante (ME)': 10, 'Status comp.': '1', 'Lançto.compensação': '2000000001', 'Lançamento contábil': `19${i}` });
  }
  linhas.push({ 'Referência': '1000052026', 'Nome do fornecedor': 'T5', 'Nº ID fiscal 1': '10000005000144', 'Montante (ME)': 105, 'Status comp.': '1', 'Lançto.compensação': '2000999999', 'Lançamento contábil': '1900000001', 'Data de compensação': '2026-11-19', Vencimento: '2026-11-20' });
  const t0 = Date.now();
  const r = conciliarPagamentosSap(faturas, linhas);
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `conciliação levou ${ms} ms`);
  assert.equal(r.filter((x) => x.fatura_id).length, 1);
  assert.equal(r.find((x) => x.fatura_id).fatura_id, 'f5');
});
