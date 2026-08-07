import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularSavingLotacaoPorFluxo } from '../src/utils/savingsPosAprovacaoNegociacao.js';

test('saving de lotação compara viagens carregadas com a média histórica do fluxo', () => {
  const base = [
    { origem: 'Itajaí', destino: 'Serra', tipoVeiculo: 'Carreta', valorComparacao: 1000 },
    { origem: 'Itajai', destino: 'Serra', tipoVeiculo: 'Carreta', freteTransp: 1200 },
    { origem: 'Itajaí', destino: 'Serra', tipoVeiculo: 'Truck', valorComparacao: 800 },
  ];
  const atual = [
    { origem: 'Itajaí', destino: 'Serra', tipoVeiculo: 'Carreta', valorComparacao: 900 },
    { origem: 'Itajaí', destino: 'Serra', tipoVeiculo: 'Carreta', valorComparacao: 950 },
  ];

  const resultado = calcularSavingLotacaoPorFluxo(base, atual);
  assert.equal(resultado.tipoCalculo, 'LOTACAO_FLUXO');
  assert.equal(resultado.linhas.length, 1);
  assert.equal(resultado.totais.pctBaseMedio, 1100);
  assert.equal(resultado.totais.pctAtualMedio, 925);
  assert.equal(resultado.totais.saving, 350);
  assert.equal(resultado.totais.viagensAtual, 2);
});

test('saving de lotação ignora fluxo atual sem histórico comparável', () => {
  const resultado = calcularSavingLotacaoPorFluxo(
    [{ origem: 'A', destino: 'B', tipoVeiculo: 'Truck', valorComparacao: 100 }],
    [{ origem: 'A', destino: 'C', tipoVeiculo: 'Truck', valorComparacao: 80 }],
  );
  assert.equal(resultado.linhas.length, 0);
  assert.equal(resultado.totais.saving, 0);
});
