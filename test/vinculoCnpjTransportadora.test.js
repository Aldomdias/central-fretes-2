import test from 'node:test';
import assert from 'node:assert/strict';
import { conflitoDeRaiz, raizesDaTransportadora, transportadoraTemRaiz } from '../src/utils/vinculoCnpjTransportadora.js';

const ltsl = { id: 'a', nome: 'LTSL', cnpj: '15.053.254/0003-07', raizesAdicionais: ['30527869'] };
const outra = { id: 'b', nome: 'OUTRA', cnpj: '11222333000181', origens: [{ cnpj: '44.555.666/0001-00' }] };

test('raizes: principal, origens e adicionais, ignorando mascara', () => {
  assert.deepEqual(raizesDaTransportadora(ltsl).sort(), ['15053254', '30527869']);
  assert.deepEqual(raizesDaTransportadora(outra).sort(), ['11222333', '44555666']);
});

test('filial da mesma raiz vincula; raiz desconhecida nao', () => {
  assert.equal(transportadoraTemRaiz(ltsl, '30.527.869/0008-26'), true);
  assert.equal(transportadoraTemRaiz(ltsl, '15053254000999'), true);
  assert.equal(transportadoraTemRaiz(ltsl, '99999999000100'), false);
  assert.equal(transportadoraTemRaiz(ltsl, ''), false);
});

test('conflito: mesma raiz em outra transportadora', () => {
  assert.equal(conflitoDeRaiz([ltsl, outra], 'a', '11222333000500')?.id, 'b');
  assert.equal(conflitoDeRaiz([ltsl, outra], 'a', '30527869000826'), null);
});
