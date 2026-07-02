import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumeroPlanilha as numero } from '../src/utils/parseNumeroPlanilha.js';

// O XLSX com raw:false entrega o texto FORMATADO da celula, e a lib SheetJS
// usa convencao americana nos formatos de milhar: 1065 com "#,##0.00" vira a
// string "1,065.00". O parser precisa aceitar tanto esse formato quanto o
// brasileiro digitado ("1.234,56"), decidindo pelo ultimo separador.
test('formato americano do XLSX (virgula milhar, ponto decimal)', () => {
  assert.equal(numero('1,065.00'), 1065); // caso real: frete minimo TAM/G2M virava 1.065
  assert.equal(numero('1,065'), 1065);
  assert.equal(numero('12,345,678'), 12345678);
  assert.equal(numero('1,234,567.89'), 1234567.89);
  assert.equal(numero('177.50'), 177.5);
  assert.equal(numero('-1,065.00'), -1065);
});

test('formato brasileiro (ponto milhar, virgula decimal)', () => {
  assert.equal(numero('1.234,56'), 1234.56);
  assert.equal(numero('1.065'), 1065);
  assert.equal(numero('1.234.567'), 1234567);
  assert.equal(numero('177,50'), 177.5);
  assert.equal(numero('R$ 1.065,00'), 1065);
});

test('decimais nao sao confundidos com milhar', () => {
  assert.equal(numero('1,07'), 1.07);
  assert.equal(numero('0,125'), 0.125); // advalorem com 3 casas
  assert.equal(numero('0.125'), 0.125);
  assert.equal(numero('2.5'), 2.5);
  assert.equal(numero('0.5'), 0.5);
  assert.equal(numero('1,93 kg'), 1.93);
});

test('numeros puros e vazios', () => {
  assert.equal(numero('1065'), 1065);
  assert.equal(numero(1065), 1065);
  assert.equal(numero(1.065), 1.065); // numero JS entra como esta
  assert.equal(numero(''), '');
  assert.equal(numero(null), '');
  assert.equal(numero(undefined, 0), 0);
});
