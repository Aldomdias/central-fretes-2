import test from 'node:test';
import assert from 'node:assert/strict';
import {
  criarMapaVinculosTransportadoras,
  expandirTermosBuscaTransportadora,
} from '../src/services/vinculosTransportadorasPuro.js';

const mapa = criarMapaVinculosTransportadoras([
  { nome_cte: 'MVT CAMPINAS - COMERCIO, LOGISTICA E SOLUCOES EM TRANSPORTES', nome_tabela: 'MOVIMENTE' },
  { nome_cte: 'MVT', nome_tabela: 'MOVIMENTE' },
  { nome_cte: 'TEX COURIER S.A', nome_tabela: 'TEX' },
]);

test('nome vinculado inclui os nomes originais do CT-e', () => {
  const termos = expandirTermosBuscaTransportadora('movimente', mapa);
  assert.equal(termos[0], 'movimente');
  assert.ok(termos.includes('MVT'));
  // "MVT CAMPINAS..." já é coberto por "MVT" (busca por contém)
  assert.ok(!termos.some((t) => t.startsWith('MVT CAMPINAS')));
});

test('busca parcial pelo nome vinculado também expande', () => {
  assert.ok(expandirTermosBuscaTransportadora('Movim', mapa).includes('MVT'));
});

test('nome sem vínculo correspondente fica só com o termo', () => {
  assert.deepEqual(expandirTermosBuscaTransportadora('JADLOG', mapa), ['JADLOG']);
  assert.deepEqual(expandirTermosBuscaTransportadora('', mapa), []);
  assert.deepEqual(expandirTermosBuscaTransportadora('MVT', new Map()), ['MVT']);
});
