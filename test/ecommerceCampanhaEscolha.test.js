import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularImpactoCampanhaNaEscolha } from '../src/utils/ecommerceAuditoriaPuro.js';

test('classifica campanha como decisiva quando o desconto vira o ranking', () => {
  const resultado = calcularImpactoCampanhaNaEscolha({
    possuiCampanha: true, mesmaTransportadora: false,
    freteTabela: 30, descontoCampanha: 7, valorIdeal: 26, valorPago: 29,
  });
  assert.equal(resultado.status, 'mudou');
  assert.equal(resultado.descontoMinimo, 4);
  assert.equal(resultado.selecionadaComDesconto, 23);
  assert.equal(resultado.custoLogisticoAdicional, 3);
});

test('nao atribui mudanca quando o desconto e insuficiente', () => {
  const resultado = calcularImpactoCampanhaNaEscolha({
    possuiCampanha: true, mesmaTransportadora: false,
    freteTabela: 30, descontoCampanha: 2, valorIdeal: 26, valorPago: 29,
  });
  assert.equal(resultado.status, 'nao_mudou');
  assert.equal(resultado.decisiva, false);
});

test('mantem indeterminado quando faltam valores comparaveis', () => {
  const resultado = calcularImpactoCampanhaNaEscolha({
    possuiCampanha: true, mesmaTransportadora: false,
    freteTabela: 0, descontoCampanha: 7, valorIdeal: 26,
  });
  assert.equal(resultado.status, 'indeterminado');
});
