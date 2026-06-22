import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularFreteFaixaPeso,
  calcularFretePercentual,
  resolverTaxas,
} from '../src/services/freteCalcEngine.js';
import {
  agregarCubagemLinhasTracking,
  resolverCubagemTracking,
} from '../src/utils/trackingCubagem.js';

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

test('faixa aplica o minimo da rota como piso quando a faixa vale zero', () => {
  // Caso real: tabela só com ad valorem / import incompleto deixa a faixa em 0,
  // mas a rota tem mínimo de R$ 246,19. O mínimo deve virar a base.
  const resultado = calcularFreteFaixaPeso({
    rota: { valorMinimoFrete: 246.19 },
    cotacao: { valorFixo: 0, fretePercentual: 0, rsKg: 0, pesoMin: 0, pesoMax: 999999 },
    pesoKg: 61.67,
    valorNf: 2484.34,
  });

  assert.equal(resultado.componentesBase.valorFaixaComExcedente, 0);
  assert.equal(resultado.componentesBase.minimoAplicavel, 246.19);
  assert.equal(resultado.valorBase, 246.19);
  assert.equal(resultado.componenteBase, 'freteMinimo');
});

test('faixa maior que o minimo prevalece sobre o minimo', () => {
  const resultado = calcularFreteFaixaPeso({
    rota: { valorMinimoFrete: 50 },
    cotacao: { valorFixo: 100, fretePercentual: 2, pesoMin: 0, pesoMax: 100 },
    pesoKg: 80,
    valorNf: 1000,
  });

  assert.equal(resultado.valorBase, 120);
  assert.equal(resultado.componenteBase, 'valorFaixaComExcedente');
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

test('cubagem de CT-e com varias NFs soma as cubagens originais de cada linha', () => {
  const linhas = [
    {
      cubagem_unitaria: 0.121,
      cubagem_total: 3.63,
      qtd_volumes: 30,
      peso: 224.639,
    },
    {
      cubagem_unitaria: 0.246,
      cubagem_total: 9.348,
      qtd_volumes: 38,
      peso: 284.2,
    },
  ];

  const agregado = agregarCubagemLinhasTracking(linhas);

  assert.equal(agregado.corrigiuMultiplicacao, true);
  assert.ok(Math.abs(agregado.cubagemTotalArmazenada - 12.978) < 0.000001);
  assert.ok(Math.abs(agregado.cubagemAplicada - 0.367) < 0.000001);
  assert.ok(Math.abs(agregado.pesoCubado - 110.1) < 0.000001);
  assert.ok(Math.abs(agregado.pesoFisico - 508.839) < 0.000001);
});
