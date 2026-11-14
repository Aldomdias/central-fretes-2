import test from 'node:test';
import assert from 'node:assert/strict';
import { escolherGrupoTransportadora } from '../src/utils/saidaTransportadoraHandoff.js';

const grupos = [
  { nome: 'RODOCAP CARGAS LTDA', variantes: ['RODOCAP CARGAS LTDA'], nomesTabela: ['RODOCAP'] },
  { nome: 'ATS TRANSPORTES LTDA', variantes: [], nomesTabela: [] },
];

test('escolhe a transportadora pelo nome exato, pela variante ou pelo prefixo', () => {
  assert.equal(escolherGrupoTransportadora(grupos, ['RODOCAP CARGAS LTDA']).nome, 'RODOCAP CARGAS LTDA');
  assert.equal(escolherGrupoTransportadora(grupos, ['RODOCAP']).nome, 'RODOCAP CARGAS LTDA');
  assert.equal(escolherGrupoTransportadora(grupos, ['ats transportes ltda'.toUpperCase()]).nome, 'ATS TRANSPORTES LTDA');
});

test('nao escolhe nada para nome curto ou desconhecido', () => {
  assert.equal(escolherGrupoTransportadora(grupos, ['XY']), null);
  assert.equal(escolherGrupoTransportadora(grupos, ['TRANSLOVATO']), null);
  assert.equal(escolherGrupoTransportadora(grupos, []), null);
});
