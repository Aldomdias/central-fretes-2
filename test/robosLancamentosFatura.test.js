import test from 'node:test';
import assert from 'node:assert/strict';
import { lancamentoDaFatura, normalizarNumeroFatura, resumirLancamentosFatura } from '../src/utils/robos/historicoLancamentos.js';

test('numero da fatura ignora zeros a esquerda e pontuacao', () => {
  assert.equal(normalizarNumeroFatura('005.508'), '5508');
  assert.equal(normalizarNumeroFatura(' 5508 '), '5508');
  assert.equal(normalizarNumeroFatura('0'), '0');
});

test('lancamento casa com a fatura pelo numero e raiz do CNPJ', () => {
  const fatura = { numero_fatura: '0005508', cnpj_transportadora: '16.615.755/0002-11', transportadora: 'ROCHA E MIURA' };
  assert.equal(lancamentoDaFatura({ fatura: '5508', cnpj_transp: '16615755000130' }, fatura), true);
  assert.equal(lancamentoDaFatura({ fatura: '5508', cnpj_transp: '99999999000100' }, fatura), false);
  assert.equal(lancamentoDaFatura({ fatura: '5509', cnpj_transp: '16615755000130' }, fatura), false);
  assert.equal(lancamentoDaFatura({ fatura: '5508', transportadora: 'Rocha e Miura Transportes Ltda' }, { numero_fatura: '5508', transportadora: 'ROCHA E MIURA' }), true);
});

test('resumo da fatura: etapa e a menos avancada das notas', () => {
  const r = resumirLancamentosFatura([
    { tipo: 'NFSE', documento: '1', miro: '51', valor: 10, lancamento_contabil: '19', situacao_pagamento: 'pago' },
    { tipo: 'NFSE', documento: '2', miro: '', pedido: '45', valor: 5 },
    { tipo: 'NFSE', documento: '2', miro: '52', valor: 5, lancamento_contabil: '20', situacao_pagamento: 'aberto' },
  ]);
  assert.equal(r.total, 2);
  assert.equal(r.valor, 15);
  assert.deepEqual(r.etapas, { pedido: 0, miro: 0, partida: 1, pago: 1 });
  assert.equal(r.etapa, 'partida');
});
