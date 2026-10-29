import test from 'node:test';
import assert from 'node:assert/strict';
import { fornecedorParaSap } from '../src/utils/robos/fornecedoresSap.js';

test('fornecedor com dois cadastros usa o codigo do SAP', () => {
  assert.equal(fornecedorParaSap('11048206000299'), '2557609');
  assert.equal(fornecedorParaSap('11.048.206/0002-99'), '2557609');
});

test('sem regra, o robo continua digitando o CNPJ', () => {
  assert.equal(fornecedorParaSap('06.349.754/0002-19'), '06349754000219');
  assert.equal(fornecedorParaSap(''), '');
});
