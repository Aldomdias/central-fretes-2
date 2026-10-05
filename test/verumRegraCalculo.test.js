import test from 'node:test';
import assert from 'node:assert/strict';
import { regraCalculoVerum } from '../src/utils/verumTaxas.js';

test('taxa fixa > 0 => Sem regra, mesmo com texto guardado diferente', () => {
  assert.equal(regraCalculoVerum({ valorFixo: 150, regraCalculo: 'Maior valor' }), 'Sem regra');
  assert.equal(regraCalculoVerum({ valorFixo: '12,50' }), 'Sem regra');
});

test('taxa fixa = 0 ou vazia => Maior valor, mesmo com texto guardado diferente', () => {
  assert.equal(regraCalculoVerum({ valorFixo: 0, percentual: 3, regraCalculo: 'Sem regra' }), 'Maior valor');
  assert.equal(regraCalculoVerum({ percentual: 3, freteMinimo: 40 }), 'Maior valor');
  assert.equal(regraCalculoVerum({}), 'Maior valor');
});
