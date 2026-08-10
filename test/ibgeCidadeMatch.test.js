import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compactarCidadeIbge,
  normalizarCidadeIbge,
  resolverIbgeComRegras,
} from '../src/utils/ibgeCidadeMatch.js';

test('normaliza corretamente nomes de municípios com acentos', () => {
  assert.equal(normalizarCidadeIbge('AÇU'), 'acu');
  assert.equal(normalizarCidadeIbge("Espigão D'Oeste"), 'espigao do oeste');
  assert.equal(compactarCidadeIbge('Mucugê'), 'mucuge');
  assert.equal(compactarCidadeIbge('Eldorado dos Carajás'), compactarCidadeIbge('Eldorado do Carajás'));
  assert.equal(compactarCidadeIbge('Lagoa do Itaenga'), compactarCidadeIbge('Lagoa de Itaenga'));
});

test('resolve cidade do realizado sem acento contra cadastro IBGE acentuado', () => {
  const porChave = new Map([
    [normalizarCidadeIbge('Assú/RN'), '2400208'],
    [normalizarCidadeIbge("Espigão D'Oeste/RO"), '1100098'],
    [normalizarCidadeIbge('São Valério/TO'), '1720499'],
  ]);
  const porCompacto = new Map([
    [compactarCidadeIbge('Assú/RN'), '2400208'],
    [compactarCidadeIbge("Espigão D'Oeste/RO"), '1100098'],
    [compactarCidadeIbge('São Valério/TO'), '1720499'],
  ]);

  const resolver = (cidade, uf) => resolverIbgeComRegras(
    cidade,
    uf,
    (chave) => porChave.get(chave) || '',
    (chave) => porCompacto.get(chave) || '',
  );

  assert.equal(resolver('ACU', 'RN'), '2400208');
  assert.equal(resolver('ESPIGAO DO OESTE', 'RO'), '1100098');
  assert.equal(resolver('SAO VALERIO DA NATIVIDADE', 'TO'), '1720499');
});
