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
