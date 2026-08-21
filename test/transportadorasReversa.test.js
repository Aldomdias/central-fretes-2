import test from 'node:test';
import assert from 'node:assert/strict';

import {
  criarSetTransportadorasReversa,
  elegivelParaReversa,
  mesmaTransportadoraReversa,
} from '../src/utils/transportadorasReversa.js';

const marcadas = criarSetTransportadorasReversa([
  { transportadora: 'FL' },
  { transportadora: 'Recoli' },
  { transportadora: 'Outra Transportadora' },
]);

test('Recoli pode fazer reversa independentemente de quem fez a ida', () => {
  assert.equal(elegivelParaReversa('Recoli', 'FL TRANSPORTES', marcadas), true);
});

test('transportadora marcada so participa quando fez a ida', () => {
  assert.equal(elegivelParaReversa('Outra Transportadora', 'FL TRANSPORTES', marcadas), false);
  assert.equal(elegivelParaReversa('Outra Transportadora', 'Outra Transportadora', marcadas), true);
});

test('sigla cadastrada casa por palavra inteira com o nome do Tracking', () => {
  assert.equal(mesmaTransportadoraReversa('FL', 'FL TRANSPORTES LTDA'), true);
  assert.equal(mesmaTransportadoraReversa('FL', 'FLEX TRANSPORTES'), false);
});

test('sem NF identificada somente a Recoli marcada participa', () => {
  assert.equal(elegivelParaReversa('FL', '', marcadas), false);
  assert.equal(elegivelParaReversa('Recoli', '', marcadas), true);
});
