import test from 'node:test';

import assert from 'node:assert/strict';

import {

  normalizarRotaExecutiva,

  consolidarRotasPrioritarias,

  consolidarRotasPrioritariasComMeta,

  extrairFaturamentoEmRiscoItem,

  extrairFreteConcorrentesOrigem,

  extrairFreteGanhoPropostaOrigem,

  extrairFreteTotalComTabelaOrigem,

  calcularFreteConcorrentesPorOrigem,

  extrairMesesPeriodoSimulacao,

  classificarStatusRotaExecutiva,

  montarResumoRotasPrioritarias,

  montarLaudoTransportadoraConsolidado,

  laudoConsolidadoPorAudience,

  laudoConsolidadoExterno,

  remontarTextosLaudoConsolidado,

  reconciliarRotasPrioritariasMensal,

  montarLegendaPeriodoMensal,

  montarNotaBasesLaudoConsolidado,

  LAUDO_AUDIENCE,

  origemRelevanteParaLaudoConsolidado,

  origemNegociacaoInformada,

  negociacaoTemSimulacaoSalvaLaudo,

  negociacaoTemCoberturaMalha,

  filtrarTabelasLaudoConsolidado,

  rotuloCoberturaFreteConcorrentesRotas,

  extrairVolumetriaGanhosOrigem,

  extrairDiasPeriodoSimulacao,

} from '../src/utils/laudoTransportadoraConsolidado.js';



test('normalizarRotaExecutiva remove faixas de peso e mantém origem/destino', () => {

  const rotaA = normalizarRotaExecutiva({

    rota: 'CONTAGEM/MG → BELO HORIZONTE/MG',

  }, 'Contagem/MG');



  const rotaB = normalizarRotaExecutiva({

    rota: 'CONTAGEM > BELO HORIZONTE > 0 até 999999999',

    ufDestino: 'MG',

  }, 'Contagem/MG');



  assert.equal(rotaA.chave, rotaB.chave);

  assert.match(rotaA.origem, /Contagem\/MG/i);

  assert.match(rotaA.destino, /Belo Horizonte\/MG/i);

  assert.doesNotMatch(JSON.stringify(rotaA), /999999999/);

  assert.doesNotMatch(JSON.stringify(rotaB), /999999999/);

});



test('consolidarRotasPrioritarias agrega rotas duplicadas e ordena por risco', () => {

  const rotas = consolidarRotasPrioritarias([

    {

      origemNegociacao: 'Contagem/MG',

      rota: 'CONTAGEM/MG → BELO HORIZONTE/MG',

      ajusteMedio: 10,

      faturamentoNaoCapturado: 5000,

      ctesAnalisados: 20,

      ctesGanhos: 0,

      ctesPerdidos: 20,

    },

    {

      origemNegociacao: 'Contagem/MG',

      rota: 'CONTAGEM > BELO HORIZONTE > 0 até 999999999',

      ufDestino: 'MG',

      ajusteMedio: 14,

      faturamentoNaoCapturado: 7000,

      ctesAnalisados: 30,

      ctesGanhos: 5,

      ctesPerdidos: 25,

    },

    {

      origemNegociacao: 'Extrema/MG',

      origem: 'Extrema',

      destino: 'São Paulo',

      ufDestino: 'SP',

      ajusteMedio: 20,

      faturamentoNaoCapturado: 20000,

      ctesAnalisados: 10,

      ctesGanhos: 0,

      ctesPerdidos: 10,

    },

  ]);



  assert.equal(rotas.length, 2);

  assert.equal(rotas[0].prioridade, 1);

  assert.match(rotas[0].destino, /São Paulo\/SP/i);

  assert.equal(rotas[0].faturamentoMensalEmRisco, 20000);



  const contagem = rotas.find((r) => /Contagem/i.test(r.origem));

  assert.ok(contagem);

  assert.equal(contagem.quantidadeCtes, 50);

  assert.equal(contagem.faturamentoMensalEmRisco, 12000);

  assert.equal(contagem.percentualReducaoNecessaria.toFixed(2), '12.22');

  assert.equal(contagem.status, 'Parcial');

});



test('extrairFaturamentoEmRiscoItem usa frete de concorrentes nos CT-es perdidos', () => {
  assert.equal(extrairFaturamentoEmRiscoItem({
    freteConcorrente: 42000,
    freteSelecionada: 50000,
    freteSelecionadaGanhadora: 20000,
    ctesPerdidos: 10,
  }), 42000);

  assert.equal(extrairFaturamentoEmRiscoItem({
    freteVencedor: 85000,
    ctesGanhos: 0,
    ctesPerdidos: 30,
  }), 85000);

  assert.equal(extrairFaturamentoEmRiscoItem({
    freteRealizado: 120000,
    freteRealizadoGanharia: 30000,
    freteVencedor: 85000,
    ctesGanhos: 10,
    ctesPerdidos: 30,
  }), 90000);

  assert.equal(extrairFaturamentoEmRiscoItem({
    freteRealizado: 90000,
    freteRealizadoGanharia: 30000,
    ctesGanhos: 10,
    ctesPerdidos: 30,
  }), 60000);

  assert.equal(extrairFaturamentoEmRiscoItem({
    freteRealizadoPerdido: 45000,
    freteVencedor: 85000,
    ctesGanhos: 10,
    ctesPerdidos: 30,
  }), 45000);

  assert.equal(extrairFaturamentoEmRiscoItem({
    freteSelecionada: 50000,
    freteSelecionadaGanhadora: 20000,
    faturamentoNaoCapturado: 329000,
    freteRealizado: 400000,
    freteRealizadoGanharia: 71000,
    ctesGanhos: 10,
    ctesPerdidos: 30,
  }), 329000);
});



test('consolidarRotasPrioritariasComMeta aplica Pareto 80% por origem', () => {

  const { rotas, meta } = consolidarRotasPrioritariasComMeta([

    { origemNegociacao: 'Contagem/MG', origem: 'Contagem/MG', destino: 'BH/MG', faturamentoNaoCapturado: 10000, ctesAnalisados: 10, ctesPerdidos: 10 },

    { origemNegociacao: 'Contagem/MG', origem: 'Contagem/MG', destino: 'RJ/RJ', faturamentoNaoCapturado: 5000, ctesAnalisados: 5, ctesPerdidos: 5 },

    { origemNegociacao: 'Contagem/MG', origem: 'Contagem/MG', destino: 'SP/SP', faturamentoNaoCapturado: 3000, ctesAnalisados: 3, ctesPerdidos: 3 },

    { origemNegociacao: 'Contagem/MG', origem: 'Contagem/MG', destino: 'Curitiba/PR', faturamentoNaoCapturado: 2000, ctesAnalisados: 2, ctesPerdidos: 2 },

    { origemNegociacao: 'Extrema/MG', origem: 'Extrema/MG', destino: 'BH/MG', faturamentoNaoCapturado: 8000, ctesAnalisados: 8, ctesPerdidos: 8 },

    { origemNegociacao: 'Extrema/MG', origem: 'Extrema/MG', destino: 'SP/SP', faturamentoNaoCapturado: 1000, ctesAnalisados: 1, ctesPerdidos: 1 },

  ]);



  assert.equal(meta.criterioPareto, 'por_origem');

  assert.equal(meta.qtdOrigens, 2);

  assert.equal(meta.qtdRotasCandidatas, 6);

  assert.equal(rotas.length, 6);

  assert.ok(rotas.every((r) => r.prioridade > 0));

  const contagem = rotas.filter((r) => /Contagem/i.test(r.origem));

  assert.equal(contagem.length, 4);

  const extrema = rotas.filter((r) => /Extrema/i.test(r.origem));

  assert.equal(extrema.length, 2);

  assert.equal(rotas[0].prioridade, 1);

  assert.ok(Number(rotas[0].faturamentoMensalEmRisco) >= Number(rotas[1].faturamentoMensalEmRisco));

  const resumo = montarResumoRotasPrioritarias(rotas, meta);

  assert.ok(resumo.pctEmRiscoCoberto >= 80);

  assert.match(String(resumo.criterioPareto), /origem/i);

});



test('classificarStatusRotaExecutiva retorna Aderente, Parcial e Revisar', () => {

  assert.equal(classificarStatusRotaExecutiva({ ctesGanhos: 10, ctesPerdidos: 0 }), 'Aderente');

  assert.equal(classificarStatusRotaExecutiva({ ctesGanhos: 6, ctesPerdidos: 4 }), 'Parcial');

  assert.equal(classificarStatusRotaExecutiva({ ctesGanhos: 0, ctesPerdidos: 8, faturamentoMensalEmRisco: 1000 }), 'Revisar');

});



test('montarResumoRotasPrioritarias calcula totais e origem mais crítica', () => {

  const resumo = montarResumoRotasPrioritarias([

    { origem: 'Contagem/MG', faturamentoMensalEmRisco: 1000, percentualReducaoNecessaria: 10, quantidadeCtes: 10 },

    { origem: 'Contagem/MG', faturamentoMensalEmRisco: 4000, percentualReducaoNecessaria: 20, quantidadeCtes: 20 },

    { origem: 'Extrema/MG', faturamentoMensalEmRisco: 2000, percentualReducaoNecessaria: 5, quantidadeCtes: 5 },

  ]);



  assert.equal(resumo.qtdRotas, 3);

  assert.equal(resumo.faturamentoMensalEmRiscoTotal, 7000);

  assert.match(resumo.origemMaisCritica, /Contagem/i);

});



function tabelaLaudoBase(overrides = {}) {

  return {

    id: 1,

    transportadora: 'Transp Teste',

    origem: 'Contagem',

    uf_origem: 'MG',

    canal: 'B2C',

    status: 'Em negociação',

    saving_estimado: 12000,

    resumo_simulacao: {

      ultima_simulacao: { indicadores: { ctes_analisados: 10, ctes_com_tabela: 8, aderencia: 70, saving_mes: 12000 } },

      ctesGanhariaSelecionada: 55,

      ctesComTabelaSelecionada: 237,

      cargasDia: 12,

      volumesDia: 480,

      freteRealizado: 85000,

      faturamentoSelecionadaMes: 92000,

    },

    ...overrides,

  };

}



test('montarLaudoTransportadoraConsolidado expõe versoes e rotasPrioritarias sem faixas no texto', () => {

  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase()], 'Transp Teste');



  assert.ok(Array.isArray(laudo.rotasPrioritarias));

  assert.ok(laudo.rotasPrioritariasResumo);

  assert.ok(laudo.versoes?.diretoria);

  assert.ok(laudo.versoes?.transportadora);

  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /999999999/);

  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /0 até 999999999/);

});



test('versao diretoria inclui saving e versao transportadora oculta saving', () => {

  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase()], 'Transp Teste');

  const diretoria = laudo.versoes.diretoria.relatorioTexto;

  const transportadora = laudo.versoes.transportadora.relatorioTexto;



  assert.match(diretoria, /Saving mensal estimado/i);

  assert.match(diretoria, /USO INTERNO \/ DIRETORIA/i);

  assert.doesNotMatch(transportadora, /Saving mensal estimado/i);

  assert.doesNotMatch(transportadora, /Saving \d/i);

  assert.match(transportadora, /DEVOLUTIVA CONSOLIDADA/i);

  assert.match(transportadora, /Aderência \(por CT-e\)/i);

});



test('laudoConsolidadoPorAudience seleciona campos por audiencia', () => {
  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase()], 'Transp Teste');
  const dir = laudoConsolidadoPorAudience(laudo, LAUDO_AUDIENCE.DIRETORIA);
  const transp = laudoConsolidadoPorAudience(laudo, LAUDO_AUDIENCE.TRANSPORTADORA);

  assert.equal(dir.audience, LAUDO_AUDIENCE.DIRETORIA);
  assert.equal(transp.audience, LAUDO_AUDIENCE.TRANSPORTADORA);
  assert.match(dir.titulo, /uso interno/i);
  assert.match(transp.titulo, /Devolutiva consolidada/i);
  assert.equal(laudoConsolidadoExterno(LAUDO_AUDIENCE.TRANSPORTADORA), true);
  assert.equal(laudoConsolidadoExterno(LAUDO_AUDIENCE.DIRETORIA), false);
});

test('extrairFaturamentoEmRiscoItem mensaliza totais do período quando mesesPeriodo > 1', () => {
  assert.equal(extrairFaturamentoEmRiscoItem({
    faturamentoNaoCapturado: 90000,
    ctesPerdidos: 10,
    mesesPeriodo: 3,
  }), 30000);

  assert.equal(extrairFaturamentoEmRiscoItem({
    freteMensalConcorrente: 25000,
    faturamentoNaoCapturado: 90000,
    ctesPerdidos: 10,
    mesesPeriodo: 3,
  }), 25000);
});

test('extrairMesesPeriodoSimulacao usa datas da negociação e campos mensais do resumo', () => {
  assert.equal(extrairMesesPeriodoSimulacao({
    periodo_realizado_inicio: '2026-01-15',
    periodo_realizado_fim: '2026-03-10',
  }), 3);

  assert.equal(extrairMesesPeriodoSimulacao({
    resumo_simulacao: {
      freteSelecionada: 300000,
      faturamentoSelecionadaMes: 100000,
    },
  }), 3);
});

test('montarLaudoTransportadoraConsolidado mensaliza faturamento atual pelo período', () => {
  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase({
    periodo_realizado_inicio: '2026-01-01',
    periodo_realizado_fim: '2026-03-31',
    resumo_simulacao: {
      ultima_simulacao: { indicadores: { ctes_analisados: 30, aderencia: 70, saving_mes: 4000 } },
      ctesGanhariaSelecionada: 55,
      ctesComTabelaSelecionada: 237,
      cargasDia: 12,
      volumesDia: 480,
      freteRealizado: 90000,
      faturamentoSelecionadaMes: 92000,
    },
  })], 'Transp Teste');

  assert.equal(laudo.origens[0].faturamentoAtual, 30000);
  assert.equal(laudo.origens[0].mesesPeriodo, 3);
  assert.equal(laudo.totais.faturamentoAtual, 30000);
});

test('montarLaudoTransportadoraConsolidado enriquece metricas operacionais por origem', () => {
  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase()], 'Transp Teste');
  const origem = laudo.origens[0];

  assert.equal(origem.ctesGanharia, 55);
  assert.equal(origem.ctesComTabela, 237);
  assert.equal(origem.pedidosMes, 55);
  assert.ok(origem.pedidosDia > 0 && origem.pedidosDia < origem.pedidosMes);
  assert.ok(origem.volumesMes > 0 && origem.volumesMes < 10560);

  assert.equal(laudo.totais.ctesGanharia, 55);
  assert.equal(laudo.totais.faturamentoAtual, 85000);
  assert.equal(laudo.totais.faturamentoProposta, 92000);

  assert.match(laudo.versoes.transportadora.relatorioTexto, /CT-es ganharia \/ com tabela: 55 \/ 237/);
  assert.match(laudo.versoes.transportadora.relatorioTexto, /SIMULAÇÃO C\/ TABELA/i);
  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /REALIZADO HOJE/i);
  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /Faturamento atual:/i);
  assert.match(laudo.versoes.diretoria.relatorioTexto, /Pedidos ganhos: /);
  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /Volume mensal em risco/i);
  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /55\/237.*analisados/i);
});

test('texto de rotas prioritárias usa frete c/ concorrentes e pareto por origem', () => {
  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase()], 'Transp Teste');
  laudo.rotasPrioritarias = [{
    prioridade: 1,
    origem: 'Contagem/MG',
    destino: 'Belo Horizonte/MG',
    faturamentoMensalEmRisco: 15000,
    percentualReducaoNecessaria: 8,
    quantidadeCtes: 12,
    status: 'Revisar',
  }];
  laudo.rotasPrioritariasResumo = montarResumoRotasPrioritarias(laudo.rotasPrioritarias, {
    criterioPareto: 'por_origem',
    emRiscoTotalCandidatos: 20000,
    qtdRotasCandidatas: 3,
  });

  const textos = remontarTextosLaudoConsolidado(laudo, LAUDO_AUDIENCE.TRANSPORTADORA, { exibirFaturamentoGanho: false });
  assert.match(textos.relatorioTexto, /Cobertura do frete c\/ concorrentes/);
  assert.match(textos.relatorioTexto, /Pareto 80% por origem/i);
  assert.doesNotMatch(textos.relatorioTexto, /Top 20/i);
  assert.doesNotMatch(textos.relatorioTexto, /Volume mensal em risco/i);
});

test('laudoConsolidadoPorAudience oculta faturamento ganho quando toggle desligado', () => {
  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase()], 'Transp Teste');
  const comGanho = laudoConsolidadoPorAudience(laudo, LAUDO_AUDIENCE.TRANSPORTADORA, { exibirFaturamentoGanho: true });
  const semGanho = laudoConsolidadoPorAudience(laudo, LAUDO_AUDIENCE.TRANSPORTADORA, { exibirFaturamentoGanho: false });

  assert.equal(comGanho.exibirFaturamentoGanho, true);
  assert.ok(comGanho.totais.faturamentoProposta > 0);
  assert.ok(comGanho.origens[0].faturamentoProposta > 0);
  assert.match(comGanho.relatorioTexto, /Frete ganho c\/ proposta/);

  assert.equal(semGanho.exibirFaturamentoGanho, false);
  assert.equal(semGanho.totais.faturamentoProposta, undefined);
  assert.equal(semGanho.origens[0].faturamentoProposta, undefined);
  assert.doesNotMatch(semGanho.relatorioTexto, /Frete ganho c\/ proposta/);
  assert.doesNotMatch(semGanho.relatorioTexto, /REALIZADO HOJE/i);
  assert.doesNotMatch(semGanho.relatorioTexto, /Faturamento atual:/i);
  assert.doesNotMatch(semGanho.relatorioTexto, /Realizado hoje:/i);
  assert.match(semGanho.relatorioTexto, /Aderência \(por CT-e\)/);
});

test('remontarTextosLaudoConsolidado oculta faturamento ganho quando solicitado', () => {
  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase()], 'Transp Teste');
  const comGanho = remontarTextosLaudoConsolidado(laudo, LAUDO_AUDIENCE.TRANSPORTADORA, { exibirFaturamentoGanho: true });
  const semGanho = remontarTextosLaudoConsolidado(laudo, LAUDO_AUDIENCE.TRANSPORTADORA, { exibirFaturamentoGanho: false });

  assert.match(comGanho.relatorioTexto, /Frete ganho c\/ proposta/);
  assert.doesNotMatch(semGanho.relatorioTexto, /Frete ganho c\/ proposta/);
  assert.doesNotMatch(semGanho.relatorioTexto, /REALIZADO HOJE/i);
});

test('KPIs simulados: frete ganho + frete concorrentes ≈ total c/ tabela', () => {
  const tabela = tabelaLaudoBase({
    resumo_simulacao: {
      ultima_simulacao: { indicadores: { ctes_analisados: 100, ctes_com_tabela: 80, aderencia: 25, saving_mes: 5000 } },
      ctesGanhariaSelecionada: 20,
      ctesComTabelaSelecionada: 80,
      cargasDia: 12,
      volumesDia: 480,
      freteRealizado: 345000,
      freteRealizadoComTabelaSelecionada: 345000,
      freteRealizadoGanhariaSelecionada: 75000,
      freteSelecionada: 672000,
      freteSelecionadaGanhadora: 123000,
      faturamentoSelecionadaMes: 224000,
      faturamentoSelecionadaGanhadoraMes: 41000,
    },
  });

  const ganho = extrairFreteGanhoPropostaOrigem(tabela);
  const concorrentes = extrairFreteConcorrentesOrigem(tabela);
  const total = extrairFreteTotalComTabelaOrigem(tabela, { freteGanhoProposta: ganho, freteConcorrentes: concorrentes });

  assert.equal(ganho, 41000);
  assert.equal(concorrentes, 90000);
  assert.ok(Math.abs(total - (ganho + concorrentes)) < 1);

  const laudo = montarLaudoTransportadoraConsolidado([tabela], 'Transp Teste');
  assert.equal(laudo.totais.freteGanhoProposta, 41000);
  assert.equal(laudo.totais.freteConcorrentes, 90000);
  assert.equal(laudo.totais.freteTotalComTabela, 131000);
  assert.ok(laudo.totais.pctPerdidoSimulacao > 0);
});

test('frete c/ concorrentes agregado dentro do faturamento atual expoe pct comparavel', () => {
  const mesesPeriodo = 1;
  const rotas = consolidarRotasPrioritarias([
    {
      origemNegociacao: 'Contagem/MG',
      origem: 'Contagem/MG',
      destino: 'Belo Horizonte/MG',
      chave: 'contagem|bh',
      freteRealizado: 200000,
      freteRealizadoGanharia: 120000,
      freteRealizadoPerdido: 80000,
      faturamentoNaoCapturado: 80000,
      ctesAnalisados: 100,
      ctesGanhos: 60,
      ctesPerdidos: 40,
      ajusteMedio: 12,
      mesesPeriodo,
    },
    {
      origemNegociacao: 'Extrema/MG',
      origem: 'Extrema/MG',
      destino: 'São Paulo/SP',
      chave: 'extrema|sp',
      freteRealizado: 150000,
      freteRealizadoGanharia: 100000,
      freteRealizadoPerdido: 50000,
      faturamentoNaoCapturado: 50000,
      ctesAnalisados: 50,
      ctesGanhos: 30,
      ctesPerdidos: 20,
      ajusteMedio: 15,
      mesesPeriodo,
    },
  ]);

  const freteConcorrentesTotal = rotas.reduce(
    (acc, row) => acc + row.faturamentoMensalEmRisco,
    0,
  );
  const faturamentoAtual = 347388;
  const freteConcorrentesReferencia = calcularFreteConcorrentesPorOrigem([
    {
      origemNegociacao: 'Contagem/MG',
      chave: 'contagem|bh',
      freteRealizadoPerdido: 80000,
      ctesPerdidos: 40,
      mesesPeriodo,
    },
    {
      origemNegociacao: 'Extrema/MG',
      chave: 'extrema|sp',
      freteRealizadoPerdido: 50000,
      ctesPerdidos: 20,
      mesesPeriodo,
    },
  ], { meses: mesesPeriodo });
  const resumo = montarResumoRotasPrioritarias(rotas, {
    criterioPareto: 'por_origem',
    faturamentoAtual,
    freteConcorrentesTotal: freteConcorrentesReferencia,
    freteTotalComTabela: 224000,
  });

  assert.ok(freteConcorrentesTotal <= faturamentoAtual);
  assert.equal(freteConcorrentesTotal, 130000);
  assert.equal(freteConcorrentesReferencia, 130000);
  assert.ok(resumo.pctDoFaturamentoAtual <= 100);
  assert.ok(resumo.pctDoFaturamentoAtual > 0);
});

test('frete c/ concorrentes acima do faturamento atual nao exibe pct enganoso', () => {
  const resumo = montarResumoRotasPrioritarias([
    { origem: 'Contagem/MG', faturamentoMensalEmRisco: 183979, percentualReducaoNecessaria: 10, quantidadeCtes: 10 },
  ], {
    faturamentoAtual: 115796,
    freteConcorrentesTotal: 183979,
    freteTotalComTabela: 224000,
  });

  assert.equal(resumo.pctDoFaturamentoAtual, null);
  assert.ok(resumo.pctDoFreteConcorrentesTotal > 0);
  assert.ok(resumo.pctDoFreteConcorrentesTotal <= 100);
});

test('pct do faturamento omitido quando frete mensal excede faturamento', () => {
  const resumo = montarResumoRotasPrioritarias([
    { origem: 'Contagem/MG', faturamentoMensalEmRisco: 150000, percentualReducaoNecessaria: 10, quantidadeCtes: 10 },
  ], { faturamentoAtual: 115796.04 });

  assert.equal(resumo.pctDoFaturamentoAtual, null);
});

test('frete c/ concorrentes mensaliza totais do periodo como faturamento atual', () => {
  const mesesPeriodo = 3;
  const faturamentoAtualMensal = 115796.04;
  const fretePeriodo = 183979.19;
  const rotas = consolidarRotasPrioritarias([
    {
      origemNegociacao: 'Origem A/MG',
      chave: 'origem-a|destino-x',
      origem: 'Origem A/MG',
      destino: 'Destino X/SP',
      freteRealizadoPerdido: fretePeriodo,
      faturamentoNaoCapturado: fretePeriodo,
      ctesPerdidos: 120,
      ctesAnalisados: 120,
      ajusteMedio: 10,
      mesesPeriodo,
    },
  ]);
  const freteMensal = rotas.reduce((acc, row) => acc + row.faturamentoMensalEmRisco, 0);
  const resumo = montarResumoRotasPrioritarias(rotas, {
    faturamentoAtual: faturamentoAtualMensal,
    freteConcorrentesTotal: calcularFreteConcorrentesPorOrigem([{
      origemNegociacao: 'Origem A/MG',
      chave: 'origem-a|destino-x',
      freteRealizadoPerdido: fretePeriodo,
      ctesPerdidos: 120,
      mesesPeriodo,
    }], { meses: mesesPeriodo }),
    freteTotalComTabela: 224000,
  });

  assert.ok(Math.abs(freteMensal - fretePeriodo / mesesPeriodo) < 0.02);
  assert.ok(freteMensal < faturamentoAtualMensal);
  assert.ok(resumo.pctDoFaturamentoAtual > 0);
  assert.ok(resumo.pctDoFaturamentoAtual <= 100);
});

test('calcularFreteConcorrentesPorOrigem deduplica rotas repetidas', () => {
  const mesesPeriodo = 1;
  const itens = [
    { chave: 'a|b', freteRealizadoPerdido: 40000, ctesPerdidos: 10, mesesPeriodo },
    { chave: 'a|b', freteRealizadoPerdido: 40000, ctesPerdidos: 10, mesesPeriodo },
    { chave: 'a|c', freteRealizadoPerdido: 25000, ctesPerdidos: 5, mesesPeriodo },
  ];
  assert.equal(calcularFreteConcorrentesPorOrigem(itens, { meses: mesesPeriodo }), 65000);
});

test('montarResumoRotasPrioritarias expoe pct do faturamento atual', () => {
  const resumo = montarResumoRotasPrioritarias([
    { origem: 'Contagem/MG', faturamentoMensalEmRisco: 50000, percentualReducaoNecessaria: 10, quantidadeCtes: 10 },
  ], { faturamentoAtual: 200000 });

  assert.equal(resumo.faturamentoMensalEmRiscoTotal, 50000);
  assert.equal(resumo.pctDoFaturamentoAtual, 25);
  assert.equal(resumo.faturamentoAtualReferencia, 200000);
});

test('reconciliarRotasPrioritariasMensal alinha soma das rotas ao frete concorrentes mensal', () => {
  const rotas = [
    { chave: 'a|b', faturamentoMensalEmRisco: 117150.82 },
    { chave: 'a|c', faturamentoMensalEmRisco: 66828.37 },
  ];
  const ajustadas = reconciliarRotasPrioritariasMensal(rotas, {
    freteConcorrentesTotal: 45716.18,
    meses: 4,
  });
  const soma = ajustadas.reduce((acc, r) => acc + r.faturamentoMensalEmRisco, 0);
  assert.ok(Math.abs(soma - 45716.18) < 1);
});

test('montarLaudoTransportadoraConsolidado expõe aderencia por CT-e e por frete', () => {
  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase({
    resumo_simulacao: {
      ultima_simulacao: { indicadores: { ctes_analisados: 100, aderencia: 25, saving_mes: 5000 } },
      ctesGanhariaSelecionada: 55,
      ctesComTabelaSelecionada: 237,
      freteSelecionadaGanhadora: 41000,
      faturamentoSelecionadaGanhadoraMes: 41000,
      freteRealizadoComTabelaSelecionada: 131000,
      freteRealizadoGanhariaSelecionada: 41000,
    },
  })], 'Transp Teste');

  assert.ok(Math.abs(laudo.totais.aderenciaPorCte - (55 / 237) * 100) < 0.01);
  assert.ok(laudo.totais.pctFreteGanhoDoFaturamentoAtual > 0);
  assert.match(laudo.versoes.transportadora.relatorioTexto, /do total simulado/i);
  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /do faturamento atual/i);
  assert.ok(laudo.legendaPeriodo.includes('/mês'));
});

test('montarLegendaPeriodoMensal inclui meses e datas', () => {
  const legenda = montarLegendaPeriodoMensal({
    meses: 3,
    inicio: '2026-01-01',
    fim: '2026-03-31',
  });
  assert.match(legenda, /3 meses/i);
  assert.match(legenda, /\/mês/i);
});

test('recomendacao transportadora referencia rotas acima do direcionamento', () => {
  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase()], 'Transp Teste');
  if (!laudo.rotasPrioritarias.length) return;
  assert.match(laudo.versoes.transportadora.recomendacao, /listadas acima/i);
  assert.doesNotMatch(laudo.versoes.transportadora.recomendacao, /\babixo\b/i);
  assert.match(laudo.versoes.transportadora.relatorioTexto, /listadas acima/i);
  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /\babixo\b/i);
});

test('origemRelevanteParaLaudoConsolidado exclui origem não informada sem simulação/malha', () => {
  assert.equal(origemRelevanteParaLaudoConsolidado({
    transportadora: 'Camilo',
    origem: '',
    uf_origem: '',
    resumo_simulacao: {},
  }), false);

  assert.equal(origemRelevanteParaLaudoConsolidado({
    transportadora: 'Camilo',
    origem: '',
    uf_origem: 'MG',
    ctes_analisados: 500,
    resumo_simulacao: { ctesAnalisados: 500 },
  }), false);
});

test('origemRelevanteParaLaudoConsolidado mantém origem simulada ou com malha', () => {
  assert.equal(origemRelevanteParaLaudoConsolidado(tabelaLaudoBase()), true);

  assert.equal(origemRelevanteParaLaudoConsolidado({
    transportadora: 'Transp',
    origem: 'Contagem',
    uf_origem: 'MG',
    ctes_atendidos: 40,
    resumo_simulacao: { ctesComTabelaSelecionada: 40 },
  }), false);

  assert.equal(origemRelevanteParaLaudoConsolidado({
    transportadora: 'Transp',
    origem: 'Contagem',
    uf_origem: 'MG',
    resumo_simulacao: {
      ultima_simulacao: { indicadores: { ctes_analisados: 10 } },
    },
  }), false);
});

test('montarLaudoTransportadoraConsolidado exclui origem irrelevante dos KPIs', () => {
  const valida = tabelaLaudoBase({ id: 1, origem: 'Contagem', uf_origem: 'MG' });
  const irrelevante = {
    id: 2,
    transportadora: 'Transp Teste',
    origem: '',
    uf_origem: '',
    resumo_simulacao: {
      ultima_simulacao: { indicadores: { ctes_analisados: 200, aderencia: 0 } },
      freteRealizado: 120000,
      ctesAnalisados: 200,
    },
  };
  const laudo = montarLaudoTransportadoraConsolidado([valida, irrelevante], 'Transp Teste');

  assert.equal(laudo.origens.length, 1);
  assert.match(laudo.origens[0].origem, /Contagem/i);
  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /Origem não informada/i);
  assert.equal(laudo.totais.faturamentoAtual, 85000);
});

test('rotuloCoberturaFreteConcorrentesRotas evita repetir valor quando cobre 100%', () => {
  const cobreTudo = rotuloCoberturaFreteConcorrentesRotas({
    pctDoFreteConcorrentesTotal: 100,
    faturamentoMensalEmRiscoTotal: 45716.18,
    freteConcorrentesTotalReferencia: 45716.18,
  });
  assert.equal(cobreTudo.cobreTudo, true);
  assert.match(cobreTudo.valorPrincipal, /100/);
  assert.match(cobreTudo.legenda, /cobrem o frete c\/ concorrentes/i);

  const parcial = rotuloCoberturaFreteConcorrentesRotas({
    pctDoFreteConcorrentesTotal: 82.5,
    faturamentoMensalEmRiscoTotal: 38000,
    freteConcorrentesTotalReferencia: 45716.18,
  });
  assert.equal(parcial.cobreTudo, false);
  assert.match(parcial.valorPrincipal, /82/);
});

test('texto rotas prioritarias usa cobertura percentual sem repetir referencia total', () => {
  const laudo = montarLaudoTransportadoraConsolidado([tabelaLaudoBase()], 'Transp Teste');
  laudo.rotasPrioritariasResumo = {
    qtdRotas: 5,
    pctDoFreteConcorrentesTotal: 100,
    faturamentoMensalEmRiscoTotal: 45716.18,
    freteConcorrentesTotalReferencia: 45716.18,
    reducaoMediaNecessaria: 12,
    origemMaisCritica: 'Contagem/MG',
    criterioPareto: 'por_origem',
    minRotas: 20,
  };
  laudo.rotasPrioritarias = [{
    prioridade: 1,
    origem: 'Contagem/MG',
    destino: 'BH/MG',
    faturamentoMensalEmRisco: 45716.18,
    percentualReducaoNecessaria: 8,
    quantidadeCtes: 12,
    status: 'Revisar',
  }];

  const textos = remontarTextosLaudoConsolidado(laudo, LAUDO_AUDIENCE.TRANSPORTADORA, { exibirFaturamentoGanho: false });
  assert.match(textos.relatorioTexto, /Cobertura do frete c\/ concorrentes: 100[,.]00%/i);
  assert.match(textos.relatorioTexto, /rotas prioritárias cobrem o total/i);
  assert.doesNotMatch(textos.relatorioTexto, /Frete c\/ concorrentes \(referência\)/i);
});

test('extrairVolumetriaGanhosOrigem usa CT-es ganharia, nao total analisado', () => {
  const vol = extrairVolumetriaGanhosOrigem(tabelaLaudoBase());
  assert.equal(vol.ctesGanharia, 55);
  assert.equal(vol.pedidosMes, 55);
  assert.ok(vol.pedidosDia > 0);
  assert.ok(vol.volumesMes > 0);
  assert.ok(vol.volumesMes < 480 * 22);
  assert.equal(vol.escopo, 'ganhos');
});

test('extrairVolumetriaGanhosOrigem nao estima volumes pela base total sem cobertura', () => {
  const vol = extrairVolumetriaGanhosOrigem({
    resumo_simulacao: {
      ultima_simulacao: {
        indicadores: {
          ctes_analisados: 7303,
          ctes_ganhos: 656,
        },
      },
      ctesAnalisados: 7303,
      volumes: 30000,
    },
    ctes_analisados: 7303,
  });

  assert.equal(vol.ctesGanharia, 656);
  assert.equal(vol.pedidosMes, 656);
  assert.equal(vol.volumesMes, 0);
  assert.equal(vol.volumesDia, 0);
});

test('montarNotaBasesLaudoConsolidado explica base da simulacao c/ tabela', () => {
  const nota = montarNotaBasesLaudoConsolidado({
    faturamentoAtual: 560743.46,
    freteTotalComTabela: 87164.29,
    freteGanhoProposta: 41448.10,
    freteConcorrentes: 45716.18,
    ctesAnalisados: 7303,
    ctesComTabela: 1528,
  });
  assert.match(nota, /Simulação c\/ tabela/i);
  assert.match(nota, /1\.528.*CT-es com cobertura/i);
  assert.match(nota, /compete\/simula/i);
  assert.doesNotMatch(nota, /Dois recortes distintos/i);
  assert.doesNotMatch(nota, /Realizado hoje/i);
  assert.doesNotMatch(nota, /contexto operacional/i);
  assert.doesNotMatch(nota, /7\.303/i);
  assert.doesNotMatch(nota, /CT-es analisados/i);
});

test('texto export agrupa simulacao c/ tabela', () => {
  const tabela = tabelaLaudoBase({
    resumo_simulacao: {
      ultima_simulacao: { indicadores: { ctes_analisados: 7303, ctes_com_tabela: 1528, aderencia: 43 } },
      ctesGanhariaSelecionada: 660,
      ctesComTabelaSelecionada: 1528,
      ctesAnalisados: 7303,
      freteRealizado: 560743.46,
      freteRealizadoComTabelaSelecionada: 87164.29,
      freteRealizadoGanhariaSelecionada: 41448.10,
      freteSelecionadaGanhadora: 41448.10,
      faturamentoSelecionadaGanhadoraMes: 41448.10,
      freteSelecionada: 87164.29,
      faturamentoSelecionadaMes: 87164.29,
    },
    ctes_analisados: 7303,
    ctes_atendidos: 1528,
  });
  const laudo = montarLaudoTransportadoraConsolidado([tabela], 'Transp Teste');
  const texto = laudo.versoes.transportadora.relatorioTexto;

  assert.doesNotMatch(texto, /REALIZADO HOJE/);
  assert.match(texto, /SIMULAÇÃO C\/ TABELA \(1\.528 CT-es com cobertura\)/);
  assert.match(texto, /do total simulado/);
  assert.doesNotMatch(texto, /do faturamento atual/);
  assert.doesNotMatch(texto, /7\.303/);
  assert.doesNotMatch(texto, /CT-es analisados/i);
  assert.match(texto, /Origens simuladas c\/ tabela: 1/i);
  assert.doesNotMatch(texto, /sem cobertura na malha/i);
  assert.ok(Math.abs(laudo.totais.aderenciaPorFrete - (41448.10 / 87164.29) * 100) < 0.1);
});

test('extrairDiasPeriodoSimulacao usa datas do periodo quando dias nao salvo', () => {
  assert.equal(extrairDiasPeriodoSimulacao({
    periodo_realizado_inicio: '2026-01-01',
    periodo_realizado_fim: '2026-01-31',
  }), 31);
});

test('consolidarRotasPrioritarias usa CT-es c/ tabela, nao total analisado', () => {
  const rotas = consolidarRotasPrioritarias([
    {
      origemNegociacao: 'Contagem/MG',
      origem: 'Contagem/MG',
      destino: 'Rio de Janeiro/RJ',
      ufDestino: 'RJ',
      ctesAnalisados: 1176,
      ctesGanhos: 310,
      ctesPerdidos: 1,
      ajusteMedio: 99.68,
      percentualReducaoNecessaria: 12.5,
      faturamentoNaoCapturado: 500,
    },
  ]);

  assert.equal(rotas.length, 1);
  assert.equal(rotas[0].quantidadeCtes, 311);
  assert.equal(rotas[0].percentualReducaoNecessaria, 12.5);
  assert.notEqual(rotas[0].percentualReducaoNecessaria, 99.68);
});

test('consolidarRotasPrioritarias nao mistura ajuste de ganhos na reducao media', () => {
  const rotas = consolidarRotasPrioritarias([
    {
      origemNegociacao: 'Contagem/MG',
      origem: 'Contagem/MG',
      destino: 'Rio de Janeiro/RJ',
      ctesAnalisados: 1176,
      ctesGanhos: 310,
      ctesPerdidos: 0,
      ajusteMedio: 99.68,
      faturamentoNaoCapturado: 0,
    },
    {
      origemNegociacao: 'Contagem/MG',
      origem: 'Contagem/MG',
      destino: 'Rio de Janeiro/RJ',
      ufDestino: 'RJ',
      ctesAnalisados: 50,
      ctesGanhos: 0,
      ctesPerdidos: 5,
      percentualReducaoNecessaria: 10,
      faturamentoNaoCapturado: 8000,
    },
  ]);

  assert.equal(rotas.length, 1);
  assert.equal(rotas[0].quantidadeCtes, 315);
  assert.equal(rotas[0].percentualReducaoNecessaria, 10);
  assert.notEqual(rotas[0].percentualReducaoNecessaria, 99.68);
});

test('montarResumoRotasPrioritarias pondera reducao media por CT-es perdidos', () => {
  const resumo = montarResumoRotasPrioritarias([
    {
      origem: 'Contagem/MG',
      faturamentoMensalEmRisco: 1000,
      percentualReducaoNecessaria: 10,
      quantidadeCtes: 311,
      ctesPerdidos: 1,
    },
    {
      origem: 'Contagem/MG',
      faturamentoMensalEmRisco: 4000,
      percentualReducaoNecessaria: 20,
      quantidadeCtes: 50,
      ctesPerdidos: 25,
    },
  ]);

  assert.ok(Math.abs(resumo.reducaoMediaNecessaria - 19.615384615384617) < 0.001);
});

