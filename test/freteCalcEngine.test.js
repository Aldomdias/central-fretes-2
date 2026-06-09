import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularFreteFaixaPeso,
  calcularFretePercentual,
  resolverTaxas,
} from '../src/services/freteCalcEngine.js';
import { resolverCubagemTracking } from '../src/utils/trackingCubagem.js';

test('percentual usa o maior entre kg garantia, frete percentual e minimo', () => {
  const resultado = calcularFretePercentual({
    cotacao: { rsKg: 0.5, fretePercentual: 2, freteMinimo: 55 },
    pesoKg: 1043.18,
    valorNf: 31000,
  });

  assert.equal(resultado.componentesBase.valorKg, 521.59);
  assert.equal(resultado.componentesBase.valorPercentual, 620);
  assert.equal(resultado.valorBase, 620);
  assert.equal(resultado.componenteBase, 'fretePercentual');
});

test('faixa soma valor da faixa, percentual e excedente', () => {
  const resultado = calcularFreteFaixaPeso({
    cotacao: {
      valorFixo: 100,
      fretePercentual: 2,
      pesoMin: 0,
      pesoMax: 100,
      excessoPeso: 100,
      valorExcedente: 1,
    },
    pesoKg: 130,
    valorNf: 1000,
  });

  assert.equal(resultado.componentesBase.valorFaixa, 100);
  assert.equal(resultado.componentesBase.valorPercentual, 20);
  assert.equal(resultado.valorExcedente, 30);
  assert.equal(resultado.valorBase, 150);
});

test('taxas por destino prevalecem para GRIS e Ad Valorem e somam taxas fixas', () => {
  const taxas = resolverTaxas({
    generalidades: { gris: 0.3, adValorem: 0.2 },
    taxaDestino: {
      gris: 0.5,
      adVal: 0.4,
      tda: 150,
      tdr: 20,
      trt: 10,
      suframa: 5,
      outras: 3,
    },
    valorNf: 10000,
    pesoKg: 100,
  });

  assert.equal(taxas.gris, 50);
  assert.equal(taxas.adValorem, 40);
  assert.equal(taxas.tda, 150);
  assert.equal(taxas.tdr, 20);
  assert.equal(taxas.trt, 10);
  assert.equal(taxas.suframa, 5);
  assert.equal(taxas.outras, 3);
});

test('cubagem do Tracking nao multiplica novamente pelo total de volumes', () => {
  const resultado = resolverCubagemTracking({
    cubagemUnitaria: 0.265,
    cubagemTotal: 2.65,
    volumes: 10,
    pesoFisico: 95.42,
    fatorCubagem: 300,
  });

  assert.equal(resultado.totalFoiMultiplicadoPorVolumes, true);
  assert.equal(resultado.cubagemAplicada, 0.265);
  assert.equal(resultado.pesoCubado, 79.5);
  assert.equal(resultado.pesoConsiderado, 95.42);
});
