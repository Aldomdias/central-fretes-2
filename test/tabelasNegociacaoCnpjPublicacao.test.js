import test from 'node:test';
import assert from 'node:assert/strict';

import { converterTabelaNegociacaoParaSimulador } from '../src/utils/tabelasNegociacaoSimuladorAdapter.js';

test('leva o CNPJ da negociacao para a transportadora e para a origem do cadastro oficial', () => {
  const resultado = converterTabelaNegociacaoParaSimulador({
    id: 'negociacao-cnpj',
    transportadora: 'Transportadora Teste',
    cnpj_transportadora: '12.345.678/0001-90',
    canal: 'ATACADO',
    origem: 'Itajai',
    uf_origem: 'SC',
    tabelas_negociacao_itens: [{
      id: 'item-1',
      ibge_destino: '2927408',
      frete_percentual: 3,
      frete_minimo: 60,
      peso_inicial: 0,
      peso_final: 0,
    }],
    tabelas_negociacao_taxas_destino: [],
  });

  assert.equal(resultado.cnpj, '12345678000190');
  assert.equal(resultado.cnpjRaiz, '12345678');
  assert.equal(resultado.origens[0].cnpj, '12345678000190');
  assert.equal(resultado.origens[0].cnpjRaiz, '12345678');
});
