export function numeroLaudo(value = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoneyLaudo(value = 0) {
  return numeroLaudo(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

export function formatMoneyDetalhadoLaudo(value = 0) {
  return numeroLaudo(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatNumberLaudo(value = 0, casas = 0) {
  return numeroLaudo(value).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function formatPercentLaudo(value = 0) {
  return `${numeroLaudo(value).toFixed(2)}%`;
}

export function periodoLaudo(resultado = {}) {
  const filtros = resultado?.filtros || {};
  const inicio = filtros.inicio || filtros.periodoInicio || '';
  const fim = filtros.fim || filtros.periodoFim || '';
  if (inicio && fim) return `${inicio} a ${fim}`;
  if (inicio) return `A partir de ${inicio}`;
  if (fim) return `Até ${fim}`;
  return 'Período filtrado na simulação';
}

export function classificarRotaDevolutiva(rota = {}) {
  const freteRealizado = numeroLaudo(rota.freteRealizado);
  const freteTabela = numeroLaudo(rota.freteSelecionada || rota.freteTabela);
  const diferenca = freteTabela - freteRealizado;
  const gapPct = freteRealizado ? (diferenca / freteRealizado) * 100 : 0;

  if (freteTabela > 0 && freteRealizado > 0 && freteTabela <= freteRealizado) {
    return { status: 'Competitiva', tone: 'good', gapPct, diferenca };
  }
  if (gapPct > 40) return { status: 'Crítico', tone: 'danger', gapPct, diferenca };
  if (gapPct > 20) return { status: 'Revisar', tone: 'danger', gapPct, diferenca };
  if (gapPct > 5) return { status: 'Atenção', tone: 'warning', gapPct, diferenca };
  return { status: 'Atenção', tone: 'warning', gapPct, diferenca };
}

export function montarDadosLaudoNegociacao(resultado = {}, opcoes = {}) {
  const filtros = resultado?.filtros || {};
  const transportadora = opcoes.transportadora || filtros.transportadora || filtros.transportadoraTabelaUsada || 'Transportadora';
  const canal = opcoes.canal || filtros.canal || 'ATACADO';
  const origem = opcoes.origem || filtros.origem || (Array.isArray(filtros.origensPadraoTabela) && filtros.origensPadraoTabela.length ? filtros.origensPadraoTabela.join(', ') : 'Todas');
  const periodo = opcoes.periodo || periodoLaudo(resultado);
  const geradoEm = opcoes.geradoEm || new Date().toLocaleDateString('pt-BR');

  const rotas = Array.isArray(resultado.rotas) ? resultado.rotas : [];
  const rotasComClassificacao = rotas.map((rota) => ({
    ...rota,
    ...classificarRotaDevolutiva(rota),
  }));

  const rotasCriticas = rotasComClassificacao
    .filter((rota) => rota.tone === 'danger' || numeroLaudo(rota.diferencaParaVencedor) > 0 || numeroLaudo(rota.qtdPerdidasSelecionada) > 0)
    .sort((a, b) => Math.abs(numeroLaudo(b.diferenca)) - Math.abs(numeroLaudo(a.diferenca)) || numeroLaudo(b.ctes) - numeroLaudo(a.ctes))
    .slice(0, 15);

  const rotasCompetitivas = rotasComClassificacao
    .filter((rota) => rota.status === 'Competitiva' || numeroLaudo(rota.qtdGanhasSelecionada) > 0)
    .sort((a, b) => numeroLaudo(b.qtdGanhasSelecionada) - numeroLaudo(a.qtdGanhasSelecionada) || numeroLaudo(b.ctes) - numeroLaudo(a.ctes))
    .slice(0, 10);

  const freteRealizado = numeroLaudo(resultado.freteRealizado);
  const freteTabela = numeroLaudo(resultado.freteSelecionada || resultado.freteSelecionadaGanhadora);
  const diferencaTotal = freteTabela - freteRealizado;
  const diferencaPercentual = freteRealizado ? (diferencaTotal / freteRealizado) * 100 : 0;
  const aderencia = numeroLaudo(resultado.aderenciaSelecionada);
  const meses = Math.max(1, numeroLaudo(resultado.meses || 1));
  const impactoMensal = diferencaTotal / meses;
  const impactoAnual = impactoMensal * 12;

  const textoTransportador = [
    `Prezados, boa tarde.`,
    ``,
    `Conforme análise realizada para ${transportadora}, identificamos que a tabela apresenta aderência competitiva de ${formatPercentLaudo(aderencia)} no recorte avaliado.`,
    `As principais oportunidades de revisão estão concentradas nas rotas com maior volume e maior diferença frente aos valores praticados no período.`,
    ``,
    `Recomendamos priorizar os destinos destacados como críticos/revisar, mantendo as condições competitivas nas rotas onde a tabela já apresenta bom posicionamento.`,
    ``,
    `Fico à disposição para seguirmos com a revisão comercial e nova rodada de análise após o envio da contraproposta.`,
  ].join('\n');

  const textoExecutivo = [
    `Resumo executivo — ${transportadora}`,
    ``,
    `A simulação avaliou ${formatNumberLaudo(resultado.ctesAnalisados)} CT-es no período ${periodo}.`,
    `A tabela apresenta aderência de ${formatPercentLaudo(aderencia)}, com ${formatNumberLaudo(resultado.ctesGanhariaSelecionada)} CT-es em condição vencedora e ${formatNumberLaudo(resultado.ctesPerdidosSelecionada)} CT-es fora de competitividade.`,
    ``,
    `Frete realizado no recorte: ${formatMoneyDetalhadoLaudo(freteRealizado)}. Frete simulado pela tabela: ${formatMoneyDetalhadoLaudo(freteTabela)}.`,
    `Impacto mensal estimado: ${formatMoneyDetalhadoLaudo(impactoMensal)}. Impacto anual estimado: ${formatMoneyDetalhadoLaudo(impactoAnual)}.`,
    ``,
    `Recomendação: avançar com negociação nas rotas críticas e validar nova rodada antes de promover a tabela para oficial.`,
  ].join('\n');

  return {
    geradoEm,
    transportadora,
    canal,
    origem,
    periodo,
    ctesAnalisados: numeroLaudo(resultado.ctesAnalisados),
    ctesComTabela: numeroLaudo(resultado.ctesComTabelaSelecionada),
    ctesGanharia: numeroLaudo(resultado.ctesGanhariaSelecionada),
    ctesPerderia: numeroLaudo(resultado.ctesPerdidosSelecionada),
    freteRealizado,
    freteTabela,
    freteVencedor: numeroLaudo(resultado.freteVencedor),
    faturamentoMensal: numeroLaudo(resultado.faturamentoSelecionadaGanhadoraMes || resultado.faturamentoSelecionadaMes),
    faturamentoAnual: numeroLaudo(resultado.faturamentoSelecionadaGanhadoraAno || resultado.faturamentoSelecionadaAno),
    savingMensal: numeroLaudo(resultado.savingSelecionadaVsRealMes),
    savingAnual: numeroLaudo(resultado.savingSelecionadaVsRealAno),
    diferencaTotal,
    diferencaPercentual,
    impactoMensal,
    impactoAnual,
    aderencia,
    reducaoMediaNecessaria: numeroLaudo(resultado.reducaoMediaNecessaria),
    rotasCriticas,
    rotasCompetitivas,
    resumoRotas: rotasComClassificacao.slice(0, 80),
    textoTransportador,
    textoExecutivo,
    fonte: 'Central Fretes / Simulador de Fretes',
  };
}
