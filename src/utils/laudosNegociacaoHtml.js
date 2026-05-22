function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function numero(valor, casas = 0) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function percentual(valor) {
  return `${Number(valor || 0).toFixed(2)}%`;
}

function periodo(resultado = {}) {
  const inicio = resultado.filtros?.inicio || '';
  const fim = resultado.filtros?.fim || '';
  if (inicio || fim) return `${inicio || 'inicio'} a ${fim || 'fim'}`;
  return 'periodo selecionado';
}

function resumoTexto(linhas = []) {
  return linhas.filter(Boolean).join('\n');
}

function rotasGanhas(resultado = {}) {
  return (resultado.rotasGanhasDestaque || resultado.rotas || [])
    .filter((item) => Number(item.qtdGanhasSelecionada || 0) > 0)
    .slice(0, 8);
}

function rotasPerdidas(resultado = {}) {
  return (resultado.rotasPerdidasDestaque || resultado.rotas || [])
    .filter((item) => Number(item.qtdPerdidasSelecionada || 0) > 0 || Number(item.diferencaParaVencedor || 0) > 0)
    .sort((a, b) => Number(b.diferencaParaVencedor || 0) - Number(a.diferencaParaVencedor || 0))
    .slice(0, 8);
}

export function montarLaudosNegociacao(resultado = {}, contexto = {}) {
  const transportadora = contexto.transportadora || resultado.filtros?.transportadora || 'Transportadora';
  const canal = contexto.canal || resultado.filtros?.canal || '';
  const origem = contexto.origem || resultado.filtros?.origem || '';
  const geradoEm = new Date().toISOString();
  const periodoAnalise = periodo(resultado);
  const ganhas = rotasGanhas(resultado);
  const perdidas = rotasPerdidas(resultado);
  const estados = (resultado.resumoPorEstado || resultado.estadosGanhadoresDestaque || []).slice(0, 8);
  const cubagemOutliers = Number(resultado.filtros?.trackingCubagemOutliers || 0);
  const coberturaMes = Number(resultado.faturamentoSelecionadaMes || 0);
  const ganhoMes = Number(resultado.faturamentoSelecionadaGanhadoraMes || 0);
  const naoCapturadoMes = Math.max(coberturaMes - ganhoMes, 0);

  const assuntoExecutivo = `Analise de competitividade - ${transportadora} - Simulacao de frete realizado`;
  const corpoExecutivo = resumoTexto([
    'Prezados,',
    '',
    `Segue analise de competitividade da transportadora ${transportadora}, considerando a base de CT-es realizados no ${periodoAnalise} e a comparacao da tabela simulada contra as demais tabelas disponiveis no sistema.`,
    '',
    `A transportadora participou da simulacao em ${numero(resultado.ctesComTabelaSelecionada)} CT-es de ${numero(resultado.ctesAnalisados)} analisados, apresentando ganho em ${numero(resultado.ctesGanhariaSelecionada)} CT-es (${percentual(resultado.aderenciaSelecionada)}) e perda em ${numero(resultado.ctesPerdidosSelecionada)} CT-es para concorrentes mais competitivos.`,
    '',
    'Resumo executivo',
    `- Cobertura/carteira cotada pela tabela: ${dinheiro(coberturaMes)} por mes.`,
    `- Faturamento efetivamente ganho: ${dinheiro(ganhoMes)} por mes e ${dinheiro(resultado.faturamentoSelecionadaGanhadoraAno)} em 12 meses.`,
    `- Volume nao capturado ou perdido para outras tabelas: ${dinheiro(naoCapturadoMes)} por mes.`,
    `- Saving potencial nas rotas ganhas: ${dinheiro(resultado.savingSelecionadaVsRealMes)} por mes e ${dinheiro(resultado.savingSelecionadaVsRealAno)} em 12 meses.`,
    `- Reducao media necessaria nas rotas perdidas: ${percentual(resultado.reducaoMediaNecessaria)}.`,
    '',
    'Principais rotas ganhas',
    ...(ganhas.length ? ganhas.map((item) => `- ${item.rota}: ${numero(item.qtdGanhasSelecionada)} CT-es, faturamento ganho ${dinheiro(item.freteSelecionadaGanhadora || 0)}.`) : ['- Nao disponivel no recorte atual.']),
    '',
    'Principais rotas perdidas',
    ...(perdidas.length ? perdidas.map((item) => `- ${item.rota}: reducao media necessaria de ${percentual(item.reducaoMediaNecessaria)}, referencia ${item.principalVencedor || '-'}.`) : ['- Nao foram identificadas rotas perdidas criticas no recorte atual.']),
    '',
    'Recomendacao final',
    'Diante dos resultados, a recomendacao e seguir com negociacao direcionada nas rotas de maior perda, priorizando aquelas com maior volume e maior diferenca percentual. Caso a transportadora ajuste os pontos criticos identificados, ha potencial de aumento de competitividade e captura de saving no periodo analisado.',
    cubagemOutliers ? `\nObservacao tecnica: ${numero(cubagemOutliers)} CT-e(s) apresentaram cubagem fora do padrao e foram tratados para evitar distorcao na analise.` : '',
  ]);

  const assuntoTransportador = `Devolutiva de competitividade - ${transportadora} - Oportunidades de ajuste`;
  const corpoTransportador = resumoTexto([
    'Prezados,',
    '',
    `Realizamos uma analise de competitividade da tabela da ${transportadora} considerando as rotas e CT-es movimentados no ${periodoAnalise}. O objetivo e compartilhar uma visao pratica dos pontos em que a tabela apresenta boa aderencia e tambem das oportunidades de ajuste para ampliar a competitividade da operacao.`,
    '',
    'Visao geral da participacao na simulacao',
    `- Foram analisados ${numero(resultado.ctesAnalisados)} CT-es, dos quais ${numero(resultado.ctesComTabelaSelecionada)} possuiam cobertura da tabela simulada.`,
    `- A tabela ficou competitiva em ${numero(resultado.ctesGanhariaSelecionada)} CT-es, com aderencia de ${percentual(resultado.aderenciaSelecionada)}.`,
    `- Foram identificados ${numero(resultado.ctesPerdidosSelecionada)} CT-es com oportunidade de melhoria frente as referencias mais competitivas da base analisada.`,
    '',
    'Rotas com boa competitividade',
    ...(ganhas.length ? ganhas.map((item) => `- ${item.rota}: ${numero(item.qtdGanhasSelecionada)} CT-es com boa competitividade no recorte.`) : ['- Nao disponivel no recorte atual.']),
    '',
    'Rotas com perda de competitividade',
    ...(perdidas.length ? perdidas.map((item) => `- ${item.rota}: reducao media aproximada de ${percentual(item.reducaoMediaNecessaria)} para aproximacao das referencias mais competitivas.`) : ['- Nao foram identificadas rotas criticas no recorte atual.']),
    '',
    'Direcional comercial',
    `Nas rotas em que a tabela nao ficou em primeiro lugar, foi identificada uma necessidade media de reducao de aproximadamente ${percentual(resultado.reducaoMediaNecessaria)} para que a transportadora se aproxime dos valores mais competitivos do mercado analisado. Recomendamos priorizar a revisao das rotas com maior volume de CT-es e maior diferenca percentual.`,
    cubagemOutliers ? 'Alguns registros apresentaram inconsistencia de cubagem e foram tratados para evitar distorcoes na analise.' : '',
    '',
    'Proximos passos sugeridos',
    'Ficamos a disposicao para avaliar uma contraproposta direcionada, principalmente nas rotas destacadas como criticas. O ajuste nesses pontos pode aumentar a competitividade da transportadora e ampliar sua participacao nas proximas movimentacoes.',
  ]);

  const indicadoresExecutivo = {
    ctesAnalisados: resultado.ctesAnalisados || 0,
    ctesComTabela: resultado.ctesComTabelaSelecionada || 0,
    ctesGanhas: resultado.ctesGanhariaSelecionada || 0,
    ctesPerdidas: resultado.ctesPerdidosSelecionada || 0,
    aderencia: resultado.aderenciaSelecionada || 0,
    reducaoMedia: resultado.reducaoMediaNecessaria || 0,
    faturamentoGanhoMes: ganhoMes,
    faturamentoGanhoAno: resultado.faturamentoSelecionadaGanhadoraAno || 0,
    savingMes: resultado.savingSelecionadaVsRealMes || 0,
    savingAno: resultado.savingSelecionadaVsRealAno || 0,
  };

  const indicadoresTransportador = {
    ctesAnalisados: resultado.ctesAnalisados || 0,
    ctesComTabela: resultado.ctesComTabelaSelecionada || 0,
    ctesGanhas: resultado.ctesGanhariaSelecionada || 0,
    ctesPerdidas: resultado.ctesPerdidosSelecionada || 0,
    aderencia: resultado.aderenciaSelecionada || 0,
    reducaoMedia: resultado.reducaoMediaNecessaria || 0,
  };

  const baseComum = {
    transportadora,
    canal,
    origem,
    periodo: periodoAnalise,
    geradoEm,
    estados,
    observacaoCubagem: cubagemOutliers ? `${numero(cubagemOutliers)} CT-e(s) apresentaram cubagem fora do padrao e foram tratados para evitar distorcao.` : '',
  };

  return {
    executivo: {
      ...baseComum,
      usoInterno: true,
      indicadores: indicadoresExecutivo,
      rotasGanhas: ganhas,
      rotasPerdidas: perdidas,
      assunto: assuntoExecutivo,
      corpoEmail: corpoExecutivo,
      laudoCompleto: `Assunto: ${assuntoExecutivo}\n\n${corpoExecutivo}`,
    },
    transportador: {
      ...baseComum,
      usoInterno: false,
      indicadores: indicadoresTransportador,
      rotasGanhas: ganhas.map((item) => ({
        rota: item.rota,
        qtdGanhasSelecionada: item.qtdGanhasSelecionada || item.ctes || 0,
      })),
      rotasPerdidas: perdidas.map((item) => ({
        rota: item.rota,
        qtdPerdidasSelecionada: item.qtdPerdidasSelecionada || item.ctes || 0,
        reducaoMediaNecessaria: item.reducaoMediaNecessaria || 0,
      })),
      assunto: assuntoTransportador,
      corpoEmail: corpoTransportador,
      laudoCompleto: `Assunto: ${assuntoTransportador}\n\n${corpoTransportador}`,
    },
  };
}
