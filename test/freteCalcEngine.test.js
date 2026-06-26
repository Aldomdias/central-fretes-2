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
import { converterTabelaNegociacaoParaSimulador } from '../src/utils/tabelasNegociacaoSimuladorAdapter.js';
import { simularRealizadoLocalRapido } from '../src/utils/realizadoLocalEngine.js';

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

test('faixa interpreta valor excedente com ponto ou virgula como decimal', () => {
  const base = {
    valorFixo: '382.40',
    fretePercentual: '0.50',
    pesoMin: '200.01',
    pesoMax: '999999',
    excessoPeso: '200.01',
  };

  const comPonto = calcularFreteFaixaPeso({
    cotacao: { ...base, valorExcedente: '2.36' },
    pesoKg: '2527.20',
    valorNf: '7931.99',
  });

  const comVirgula = calcularFreteFaixaPeso({
    cotacao: { ...base, valorExcedente: '2,36' },
    pesoKg: '2527,20',
    valorNf: '7.931,99',
  });

  assert.ok(Math.abs(comPonto.valorBase - comVirgula.valorBase) < 0.001);
  assert.ok(comPonto.valorBase < 6000, '2.36 nao pode virar 236');
  assert.ok(Math.abs(comPonto.componentesBase.excessoPorKg - 2.36) < 0.000001);
});

test('negociacao com faixa e percentual nao usa limite de excedente como R$/kg', () => {
  const tabela = converterTabelaNegociacaoParaSimulador({
    id: 'av-test',
    transportadora: 'Avioes Transportes',
    origem: 'Itajai',
    uf_origem: 'SC',
    canal: 'ATACADO',
    incluir_simulacao: true,
    generalidades: { tipoCalculo: 'PERCENTUAL', cubagem: 300 },
    itens: [
      {
        id: 'rota-pb',
        item_tipo: 'ROTA',
        ibge_destino: '2501807',
        cidade_destino: 'Bayeux',
        uf_destino: 'PB',
        faixa_peso: 'PB CAPITAL',
        prazo: 9,
        dados_originais: { tipo_item: 'ROTA', cotacao: 'PB CAPITAL' },
      },
      {
        id: 'cot-pb-200',
        item_tipo: 'COTACAO',
        faixa_peso: 'PB CAPITAL | 200.01 a 999999',
        peso_inicial: 200.01,
        peso_final: 999999,
        taxa_aplicada: 382.4,
        frete_percentual: 0.5,
        excesso_kg: 200.01,
        valor_excedente: 2.36,
        dados_originais: { tipo_item: 'COTACAO', cotacao: 'PB CAPITAL' },
      },
    ],
  });

  const cotacao = tabela.origens[0].cotacoes[0];
  assert.equal(cotacao.tipoCalculo, 'FAIXA_DE_PESO');
  assert.equal(cotacao.rsKg, 0);
  assert.equal(cotacao.excessoPeso, 200.01);
  assert.equal(cotacao.excesso, 2.36);

  const resultado = calcularFreteFaixaPeso({
    cotacao,
    pesoKg: 2527.2,
    valorNf: 7931.99,
  });

  assert.ok(resultado.valorBase < 6000, 'nao deve explodir para centenas de milhares');
  assert.ok(Math.abs(resultado.componentesBase.excessoPorKg - 2.36) < 0.000001);
  assert.ok(Math.abs(resultado.componentesBase.valorPercentual - 39.65995) < 0.00001);
});

test('negociacao replica cotacao por nome para todas as rotas tecnicas', () => {
  const tabela = converterTabelaNegociacaoParaSimulador({
    id: 'avioes-pb',
    transportadora: 'Avioes Transportes',
    origem: 'Itajai',
    uf_origem: 'SC',
    canal: 'ATACADO',
    incluir_simulacao: true,
    generalidades: { tipoCalculo: 'PERCENTUAL', cubagem: 300 },
    itens: [
      {
        id: 'rota-bayeux',
        item_tipo: 'ROTA',
        ibge_destino: '2501807',
        uf_destino: 'PB',
        faixa_peso: 'ROTA',
        observacao: 'ITAJAI X PB - CAPITAL',
        dados_originais: { tipo_item: 'ROTA', cotacaoBase: 'ITAJAI X PB - CAPITAL' },
      },
      {
        id: 'rota-cabedelo',
        item_tipo: 'ROTA',
        ibge_destino: '2503209',
        uf_destino: 'PB',
        faixa_peso: 'ROTA',
        observacao: 'ITAJAI X PB - CAPITAL',
        dados_originais: { tipo_item: 'ROTA', cotacaoBase: 'ITAJAI X PB - CAPITAL' },
      },
      {
        id: 'cot-pb-capital',
        item_tipo: 'COTACAO',
        ibge_destino: '2501807',
        uf_destino: 'PB',
        faixa_peso: 'ITAJAI X PB - CAPITAL',
        peso_inicial: 200.01,
        peso_final: 999999,
        taxa_aplicada: 382.4,
        frete_percentual: 0.5,
        excesso_kg: 200.01,
        valor_excedente: 2.36,
        observacao: 'ITAJAI X PB - CAPITAL',
        dados_originais: { tipo_item: 'COTACAO', cotacaoBase: 'ITAJAI X PB - CAPITAL' },
      },
    ],
  });

  const origem = tabela.origens[0];
  assert.equal(origem.rotas.length, 2);
  assert.deepEqual(
    origem.rotas.map((rota) => rota.ibgeDestino).sort(),
    ['2501807', '2503209'],
  );
  assert.equal(origem.cotacoes.length, 2);
  assert.ok(origem.cotacoes.every((cotacao) => cotacao.valorFixo === 382.4));
});

test('simulador realizado ignora cubagem sem sinal de tracking', async () => {
  const transportadoras = [{
    nome: 'Tabela Teste',
    origens: [{
      cidade: 'Itajai',
      canal: 'ATACADO',
      generalidades: { tipoCalculo: 'FAIXA_DE_PESO', cubagem: 300 },
      taxasEspeciais: [],
      rotas: [{ nomeRota: 'Itajai -> Aracaju', ibgeOrigem: '4208203', ibgeDestino: '2800308', prazoEntregaDias: 5 }],
      cotacoes: [{
        rota: 'Itajai -> Aracaju',
        pesoMin: 200.01,
        pesoMax: 999999,
        pesoLimite: 999999,
        valorFixo: 382.4,
        percentual: 0.5,
        excessoPeso: 200.01,
        excesso: 2.36,
        tipoCalculo: 'FAIXA_DE_PESO',
      }],
    }],
  }];

  const baseCte = {
    chaveCte: 'cte-cubagem-antiga',
    numeroCte: '1',
    dataEmissao: '2026-05-01',
    transportadora: 'Outra',
    cidadeOrigem: 'ITAJAI',
    ufOrigem: 'SC',
    ibgeOrigem: '4208203',
    cidadeDestino: 'ARACAJU',
    ufDestino: 'SE',
    ibgeDestino: '2800308',
    chaveRotaIbge: '4208203-2800308',
    canal: 'ATACADO',
    peso: 352.8,
    pesoDeclarado: 352.8,
    pesoCubado: 352,
    cubagem: 352,
    qtdVolumes: 0,
    valorNF: 7874.5,
    valorCte: 504.71,
  };

  const semTracking = await simularRealizadoLocalRapido({
    realizados: [baseCte],
    transportadoras,
    nomeTransportadora: 'Tabela Teste',
  });

  assert.equal(semTracking.detalhes[0].detalhes.frete.origemCubagem, 'sem cubagem');
  assert.ok(Math.abs(semTracking.detalhes[0].detalhes.frete.pesoConsiderado - 352.8) < 0.001);

  const comTracking = await simularRealizadoLocalRapido({
    realizados: [{ ...baseCte, chaveCte: 'cte-cubagem-tracking', trackingMatch: true, origemCubagem: 'tracking', qtdVolumes: 10 }],
    transportadoras,
    nomeTransportadora: 'Tabela Teste',
  });

  assert.equal(comTracking.detalhes[0].detalhes.frete.origemCubagem, 'tracking');
  assert.ok(Math.abs(comTracking.detalhes[0].detalhes.frete.pesoConsiderado - 105600) < 0.001);
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

test('faixa aberta com R$/kg e sem limiar aplica o excedente desde o peso 0', () => {
  // Modelo "Maior valor" da Verum: R$/kg base em "Excesso de peso", faixa 0 a ~infinito.
  const resultado = calcularFreteFaixaPeso({
    rota: { valorMinimoFrete: 50 },
    cotacao: { valorFixo: 0, fretePercentual: 0, pesoMin: 0, pesoMax: 999999, excesso: 0.754 },
    pesoKg: 200,
    valorNf: 1000,
  });

  // 200 kg × 0,754 = 150,8 > mínimo 50 → vira a base
  assert.ok(Math.abs(resultado.componentesBase.excedenteKg - 200) < 0.001, 'excedente desde o peso 0');
  assert.ok(Math.abs(resultado.valorBase - 150.8) < 0.01);
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

test('cubagem do Tracking = unitaria x volumes (cubagem por volume)', () => {
  const resultado = resolverCubagemTracking({
    cubagemUnitaria: 0.265,
    cubagemTotal: 2.65,
    volumes: 10,
    pesoFisico: 95.42,
    fatorCubagem: 300,
  });

  // 0,265/volume x 10 volumes = 2,65 m3 -> peso cubado 795 kg.
  assert.ok(Math.abs(resultado.cubagemAplicada - 2.65) < 0.000001);
  assert.ok(Math.abs(resultado.pesoCubado - 795) < 0.0001);
  assert.ok(Math.abs(resultado.pesoConsiderado - 795) < 0.0001);
});

test('cubagem do Tracking prefere total informado', () => {
  const resultado = resolverCubagemTracking({
    cubagemUnitaria: 0.048,
    cubagemTotal: 0.048,
    volumes: 4,
    pesoFisico: 27.76,
    fatorCubagem: 300,
  });
  assert.ok(Math.abs(resultado.cubagemAplicada - 0.048) < 0.000001);
  assert.ok(Math.abs(resultado.pesoCubado - 14.4) < 0.000001);
});

test('cubagem do Tracking multiplica por volume quando total nao veio', () => {
  const resultado = resolverCubagemTracking({
    cubagemUnitaria: 0.048,
    cubagemTotal: 0,
    volumes: 4,
    pesoFisico: 27.76,
    fatorCubagem: 300,
  });

  assert.ok(Math.abs(resultado.cubagemAplicada - 0.192) < 0.000001);
  assert.ok(Math.abs(resultado.pesoCubado - 57.6) < 0.000001);
});

test('cubagem do Tracking nao multiplica quando peso_cubado repete a cubagem da NF', () => {
  // Caso real NF 2143690: Tracking trouxe cubagem_unitaria=0,351, cubagem_total=8,424
  // e peso_cubado=0,351. Nesse layout, o 0,351 e a cubagem da NF inteira, nao por volume.
  const resultado = resolverCubagemTracking({
    cubagemUnitaria: 0.351,
    cubagemTotal: 8.424,
    pesoCubadoOriginal: 0.351,
    volumes: 24,
    pesoFisico: 213.96,
    fatorCubagem: 300,
  });

  assert.ok(Math.abs(resultado.cubagemAplicada - 0.351) < 0.000001);
  assert.ok(Math.abs(resultado.pesoCubado - 105.3) < 0.000001);
  assert.ok(Math.abs(resultado.pesoConsiderado - 213.96) < 0.000001);
  assert.equal(resultado.totalPareceUnitarioMultiplicado, true);
});

test('cubagem de CT-e com varias NFs soma unitaria x volumes de cada linha', () => {
  const linhas = [
    { cubagem_unitaria: 0.121, cubagem_total: 3.63, qtd_volumes: 30, peso: 224.639 },
    { cubagem_unitaria: 0.246, cubagem_total: 9.348, qtd_volumes: 38, peso: 284.2 },
  ];

  const agregado = agregarCubagemLinhasTracking(linhas);

  // linha1: 0,121 x 30 = 3,63 ; linha2: 0,246 x 38 = 9,348 ; soma = 12,978.
  assert.ok(Math.abs(agregado.cubagemAplicada - 12.978) < 0.000001);
  assert.ok(Math.abs(agregado.pesoCubado - 3893.4) < 0.000001);
  assert.ok(Math.abs(agregado.pesoFisico - 508.839) < 0.000001);
});
