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

function n(valor) {
  const num = Number(valor || 0);
  return Number.isFinite(num) ? num : 0;
}

function texto(valor) {
  return String(valor || '').trim();
}

function upper(valor) {
  return texto(valor).toUpperCase();
}

function dataBR(valor) {
  if (!valor) return '-';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? String(valor) : d.toLocaleDateString('pt-BR');
}

function resumoTexto(linhas = []) {
  return linhas.filter(Boolean).join('\n');
}

function getResumo(tabelaOuResumo = {}) {
  if (tabelaOuResumo.resumo_simulacao && typeof tabelaOuResumo.resumo_simulacao === 'object' && !Array.isArray(tabelaOuResumo.resumo_simulacao)) {
    return tabelaOuResumo.resumo_simulacao;
  }
  return tabelaOuResumo || {};
}

function getHistorico(tabelaOuResumo = {}) {
  const resumo = getResumo(tabelaOuResumo);
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}

function getResumoRodada(rodada = {}) {
  if (rodada.resumo && typeof rodada.resumo === 'object' && !Array.isArray(rodada.resumo)) return rodada.resumo;
  if (rodada.resultado && typeof rodada.resultado === 'object' && !Array.isArray(rodada.resultado)) return rodada.resultado;
  return rodada || {};
}

function getIndicadoresRodada(rodada = {}) {
  const resumo = getResumoRodada(rodada);
  const ind = rodada.indicadores && typeof rodada.indicadores === 'object' && !Array.isArray(rodada.indicadores)
    ? rodada.indicadores
    : {};

  return {
    rodada: n(rodada.rodada || ind.rodada || resumo.rodada_atual || 1) || 1,
    id: rodada.id || rodada.criado_em || `${rodada.rodada || 'rodada'}-${Math.random()}`,
    criadoEm: rodada.criado_em || resumo.salvo_em || resumo.geradoEm || '',
    ctesAnalisados: n(ind.ctes_analisados || resumo.ctesAnalisados || resumo.ctes_analisados || rodada.base?.ctes_na_malha),
    ctesComTabela: n(ind.ctes_com_tabela || resumo.ctesComTabelaSelecionada || resumo.ctes_com_tabela),
    ctesGanhos: n(ind.ctes_capturados || ind.ctes_ganhos || resumo.ctesGanhariaSelecionada || resumo.ctesCapturadosDeOutras),
    ctesPerdidos: n(ind.ctes_perdidos || resumo.ctesPerdidosSelecionada),
    volumesGanhos: n(ind.volumes_capturados || resumo.volumesCapturados || ind.volumes_ganhos_mes || resumo.volumesDia),
    pedidosDia: n(ind.pedidos_ganhos_dia || ind.pedidos_dia || resumo.cargasDia),
    pedidosMes: n(ind.pedidos_ganhos_mes || ind.pedidos_mes || (ind.pedidos_dia ? ind.pedidos_dia * 22 : 0) || (resumo.cargasDia ? resumo.cargasDia * 22 : 0)),
    volumesDia: n(ind.volumes_ganhos_dia || ind.volumes_dia || resumo.volumesDia),
    volumesMes: n(ind.volumes_ganhos_mes || ind.volumes_mes || (ind.volumes_dia ? ind.volumes_dia * 22 : 0) || (resumo.volumesDia ? resumo.volumesDia * 22 : 0)),
    aderencia: n(ind.aderencia || resumo.aderenciaSelecionada),
    faturamentoMes: n(ind.faturamento_mes || resumo.faturamentoSelecionadaGanhadoraMes || resumo.faturamentoSelecionadaMes || resumo.freteSelecionada),
    faturamentoAno: n(ind.faturamento_ano || resumo.faturamentoSelecionadaGanhadoraAno || resumo.faturamentoSelecionadaAno),
    savingMes: n(ind.saving_mes || resumo.savingSelecionadaVsRealMes || resumo.savingSelecionadaVsReal),
    savingAno: n(ind.saving_ano || resumo.savingSelecionadaVsRealAno),
    percentualFreteReal: n(ind.percentual_frete_realizado || resumo.percentualFreteRealizado),
    percentualFreteTabela: n(ind.percentual_frete_simulado || resumo.percentualFreteTabelaGanharia || resumo.percentualFreteSelecionada),
    reducaoMedia: n(ind.reducao_media || resumo.reducaoMediaNecessaria),
    rotasComGanho: n(ind.rotas_com_ganho || resumo.qtdRotasComGanhoSelecionada),
    rotasGanhas: n(ind.rotas_ganhas || resumo.qtdRotasGanhasSelecionada),
    rotasParciais: n(ind.rotas_parciais || resumo.qtdRotasParciaisSelecionada),
    rotasSemCobertura: n(ind.rotas_sem_cobertura || resumo.ctesSemTabelaSelecionada),
  };
}

function ordenarSimulacoes(a, b) {
  const rodada = n(a.rodada) - n(b.rodada);
  if (rodada) return rodada;
  return new Date(a.criado_em || 0).getTime() - new Date(b.criado_em || 0).getTime();
}

export function obterSimulacoesRodadas(tabelaOuResumo = {}) {
  return getHistorico(tabelaOuResumo)
    .filter((item) => item && item.tipo_registro === 'SIMULACAO')
    .slice()
    .sort(ordenarSimulacoes);
}

export function consolidarUltimaSimulacaoPorRodada(simulacoes = []) {
  const mapa = new Map();
  simulacoes.forEach((sim) => {
    const rodada = n(sim.rodada || 1) || 1;
    const anterior = mapa.get(rodada);
    if (!anterior) {
      mapa.set(rodada, sim);
      return;
    }
    const atualTime = new Date(sim.criado_em || 0).getTime();
    const antTime = new Date(anterior.criado_em || 0).getTime();
    if (atualTime >= antTime) mapa.set(rodada, sim);
  });
  return Array.from(mapa.values()).sort(ordenarSimulacoes);
}

function chaveRota(item = {}) {
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem);
  const destino = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.ufDestino || item.uf_destino);
  const rota = texto(item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome);
  const faixa = texto(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa);
  return [origem || 'Origem', destino || 'Destino', rota || faixa || 'Rota/Cotacao'].filter(Boolean).join(' > ');
}

function getUfDestino(item = {}) {
  return upper(item.ufDestino || item.uf_destino || item.uf || item.destinoUf || item.destino_uf || item.estadoDestino || item.estado_destino) || '-';
}

function getFaixa(item = {}) {
  const direta = texto(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa || item.faixa_peso_padrao);
  if (direta) return direta;
  const ini = n(item.pesoInicial || item.peso_inicial);
  const fim = n(item.pesoFinal || item.peso_final);
  if (ini || fim) return `${numero(ini)} a ${fim ? numero(fim) : '+'} kg`;
  const peso = n(item.peso || item.pesoDeclarado || item.peso_final_calculado);
  if (!peso) return 'Sem faixa';
  if (peso <= 20) return '0 a 20 kg';
  if (peso <= 50) return '21 a 50 kg';
  if (peso <= 100) return '51 a 100 kg';
  if (peso <= 300) return '101 a 300 kg';
  if (peso <= 500) return '301 a 500 kg';
  return 'Acima de 500 kg';
}

function isGanha(item = {}) {
  return item.statusSelecionada === 'Ganharia' || item.ganhouRealizado === true || n(item.savingSelecionada) > 0 || n(item.qtdGanhasSelecionada) > 0;
}

function isPerdida(item = {}) {
  return item.statusSelecionada === 'Perderia' || item.perdeuRealizado === true || n(item.diferencaParaVencedor) > 0 || n(item.qtdPerdidasSelecionada) > 0;
}

function valorPotencial(item = {}) {
  return n(item.faturamentoPotencial || item.freteRealizado || item.valorCte || item.valorCTe || item.valorNF || item.valor_nf || item.freteSelecionada || item.freteTabelaSelecionada);
}

function valorCapturado(item = {}) {
  return n(item.faturamentoCapturado || item.freteSelecionadaGanhadora || item.freteCapturadoRealizado || item.freteSelecionada || item.valorFreteSelecionada);
}

function reducaoItem(item = {}) {
  return n(item.reducaoMediaNecessaria || item.reducaoNecessaria || item.percentualReducaoNecessaria || item.diferencaPercentual || item.gapPercentual);
}

function agregarRegistro(mapa, chave, item = {}, rodadaIndicadores = {}) {
  if (!mapa.has(chave)) {
    mapa.set(chave, {
      chave,
      origem: texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem),
      destino: texto(item.destino || item.cidadeDestino || item.cidade_destino || item.ufDestino || item.uf_destino),
      ufDestino: getUfDestino(item),
      rota: texto(item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome) || chave,
      faixa: getFaixa(item),
      ctesAnalisados: 0,
      ctesGanhos: 0,
      ctesPerdidos: 0,
      volumes: 0,
      faturamentoPotencial: 0,
      faturamentoCapturado: 0,
      faturamentoNaoCapturado: 0,
      reducaoSoma: 0,
      reducaoQtd: 0,
      aderencia: 0,
      prioridade: 'BAIXA',
    });
  }

  const acc = mapa.get(chave);
  const qtdAnalisada = n(item.ctes || item.qtd || item.qtdCtes || item.qtdAnalisados || 1) || 1;
  const qtdGanha = n(item.qtdGanhasSelecionada || item.ctesGanhos || item.ctesGanhas || (isGanha(item) ? qtdAnalisada : 0));
  const qtdPerdida = n(item.qtdPerdidasSelecionada || item.ctesPerdidos || item.ctesPerdidas || (isPerdida(item) ? qtdAnalisada : 0));
  const volumes = n(item.volumes || item.qtdVolumes || item.volumesCapturados || item.volumesGanhas);
  const potencial = valorPotencial(item);
  const capturado = valorCapturado(item);
  const reducao = reducaoItem(item);

  acc.ctesAnalisados += qtdAnalisada;
  acc.ctesGanhos += qtdGanha;
  acc.ctesPerdidos += qtdPerdida;
  acc.volumes += volumes;
  acc.faturamentoPotencial += potencial;
  acc.faturamentoCapturado += capturado;
  if (reducao) {
    acc.reducaoSoma += reducao * Math.max(qtdPerdida || qtdAnalisada, 1);
    acc.reducaoQtd += Math.max(qtdPerdida || qtdAnalisada, 1);
  }

  if (!acc.ufDestino || acc.ufDestino === '-') acc.ufDestino = getUfDestino(item);
  if (!acc.faixa || acc.faixa === 'Sem faixa') acc.faixa = getFaixa(item);
  if (!acc.origem) acc.origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || rodadaIndicadores.origem);
}

function finalizarAgrupados(lista = []) {
  return lista.map((item) => {
    const faturamentoNaoCapturado = Math.max(n(item.faturamentoPotencial) - n(item.faturamentoCapturado), 0);
    const base = n(item.ctesGanhos) + n(item.ctesPerdidos) || n(item.ctesAnalisados);
    const aderencia = base ? (n(item.ctesGanhos) / base) * 100 : 0;
    const ajuste = item.reducaoQtd ? item.reducaoSoma / item.reducaoQtd : 0;
    let prioridade = 'BAIXA';
    if (faturamentoNaoCapturado >= 50000 || item.ctesPerdidos >= 100 || ajuste >= 15) prioridade = 'ALTA';
    else if (faturamentoNaoCapturado >= 15000 || item.ctesPerdidos >= 30 || ajuste >= 8) prioridade = 'MÉDIA';
    let status = 'Boa competitividade';
    if (item.ctesPerdidos > 0 && item.ctesGanhos > 0) status = 'Melhorou, mas ainda perde';
    if (item.ctesPerdidos > item.ctesGanhos) status = 'Crítica';
    if (!item.ctesGanhos && item.ctesPerdidos) status = 'Sem competitividade';

    return {
      ...item,
      faturamentoNaoCapturado,
      aderencia,
      ajusteMedio: ajuste,
      prioridade,
      status,
    };
  });
}

function extrairDetalhesResumo(resumo = {}) {
  const candidatos = [
    resumo.ctesDetalhes,
    resumo.detalhes,
    resumo.linhasDetalhe,
    resumo.rotas,
    resumo.rotasPerdidasDestaque,
    resumo.rotasGanhasDestaque,
  ];
  return candidatos.reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, []);
}

function agruparDetalhes(simulacao, agrupador) {
  const resumo = getResumoRodada(simulacao);
  const ind = getIndicadoresRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  const mapa = new Map();

  detalhes.forEach((item) => {
    const chave = agrupador(item);
    agregarRegistro(mapa, chave, item, ind);
  });

  return finalizarAgrupados(Array.from(mapa.values()));
}

function agruparPorUf(simulacao) {
  const resumo = getResumoRodada(simulacao);
  const estados = Array.isArray(resumo.resumoPorEstado) ? resumo.resumoPorEstado : Array.isArray(resumo.estadosGanhadoresDestaque) ? resumo.estadosGanhadoresDestaque : [];
  if (estados.length) {
    return finalizarAgrupados(estados.map((item) => ({
      chave: getUfDestino(item),
      rota: getUfDestino(item),
      ufDestino: getUfDestino(item),
      faixa: 'Todas',
      ctesAnalisados: n(item.ctes || item.qtd || item.ctesAnalisados),
      ctesGanhos: n(item.ctesGanhos || item.qtdGanhasSelecionada || item.ganhas),
      ctesPerdidos: n(item.ctesPerdidos || item.qtdPerdidasSelecionada || item.perdidas),
      volumes: n(item.volumes || item.volumesCapturados),
      faturamentoPotencial: n(item.faturamentoPotencial || item.freteRealizado || item.valorNF),
      faturamentoCapturado: n(item.faturamentoCapturado || item.freteSelecionadaGanhadora || item.freteCapturado),
      reducaoSoma: n(item.reducaoMediaNecessaria || item.ajusteMedio) * Math.max(n(item.ctesPerdidos || item.qtdPerdidasSelecionada || 1), 1),
      reducaoQtd: Math.max(n(item.ctesPerdidos || item.qtdPerdidasSelecionada || 1), 1),
    })));
  }
  return agruparDetalhes(simulacao, getUfDestino);
}

function compararRotas(primeira, ultima) {
  const inicial = new Map(agruparDetalhes(primeira, chaveRota).map((item) => [item.chave, item]));
  const final = new Map(agruparDetalhes(ultima, chaveRota).map((item) => [item.chave, item]));
  const chaves = new Set([].concat(Array.from(inicial.keys()), Array.from(final.keys())));

  return Array.from(chaves).map((chave) => {
    const ini = inicial.get(chave) || {};
    const fim = final.get(chave) || {};
    return {
      ...fim,
      chave,
      rota: fim.rota || ini.rota || chave,
      origem: fim.origem || ini.origem || '',
      destino: fim.destino || ini.destino || '',
      ufDestino: fim.ufDestino || ini.ufDestino || '-',
      faixa: fim.faixa || ini.faixa || 'Todas',
      ctesGanhosInicial: n(ini.ctesGanhos),
      ctesGanhosFinal: n(fim.ctesGanhos),
      evolucaoCtes: n(fim.ctesGanhos) - n(ini.ctesGanhos),
      aderenciaInicial: n(ini.aderencia),
      aderenciaAtual: n(fim.aderencia),
    };
  });
}

function compararGenerico(primeira, ultima, agrupador) {
  const inicial = new Map(agrupador(primeira).map((item) => [item.chave, item]));
  const final = new Map(agrupador(ultima).map((item) => [item.chave, item]));
  const chaves = new Set([].concat(Array.from(inicial.keys()), Array.from(final.keys())));

  return Array.from(chaves).map((chave) => {
    const ini = inicial.get(chave) || {};
    const fim = final.get(chave) || {};
    return {
      ...fim,
      chave,
      rota: fim.rota || ini.rota || chave,
      ufDestino: fim.ufDestino || ini.ufDestino || chave,
      faixa: fim.faixa || ini.faixa || chave,
      ctesGanhosInicial: n(ini.ctesGanhos),
      ctesGanhosFinal: n(fim.ctesGanhos),
      evolucaoCtes: n(fim.ctesGanhos) - n(ini.ctesGanhos),
      aderenciaInicial: n(ini.aderencia),
      aderenciaAtual: n(fim.aderencia),
    };
  });
}

function classificarRecomendacao(comparativo, rotasCriticas = []) {
  const atual = comparativo.atual || {};
  const evolucao = comparativo.evolucaoAderencia;
  if (atual.aderencia >= 70 && atual.savingMes > 0) return 'Recomendação: avançar com aprovação ou aprovação parcial, mantendo monitoramento das rotas críticas residuais.';
  if (atual.aderencia >= 40) return 'Recomendação: solicitar contraproposta direcionada, priorizando as rotas/cotações com maior faturamento não capturado antes da aprovação final.';
  if (evolucao >= 10) return 'Recomendação: a transportadora demonstrou evolução relevante, mas ainda precisa de nova rodada focada nas rotas críticas antes de implantação.';
  if (rotasCriticas.length) return 'Recomendação: não aprovar neste momento. Solicitar nova rodada com ajuste objetivo nas rotas e faixas listadas como alta prioridade.';
  return 'Recomendação: manter em análise e validar cobertura, pois os dados atuais ainda não indicam aderência suficiente para aprovação.';
}

function recomendacaoTransportador(rotasCriticas = [], rotasMelhoraram = []) {
  const foco = rotasCriticas.slice(0, 3).map((item) => item.rota || item.chave).filter(Boolean).join('; ');
  const melhora = rotasMelhoraram.length ? 'Reconhecemos evolução em parte das rotas avaliadas. ' : '';
  if (foco) {
    return `${melhora}Para a próxima rodada, recomendamos concentrar a revisão nos pontos de maior impacto: ${foco}. Não é necessário alterar toda a tabela; o ganho de competitividade deve vir de ajustes direcionados nas rotas, cotações e faixas de peso destacadas.`;
  }
  return `${melhora}A proposta apresenta boa evolução geral. Para avançarmos, recomendamos validar os pontos remanescentes e manter as condições competitivas nas rotas onde a tabela já performa bem.`;
}

function montarComparativo(evolucaoRodadas = []) {
  const inicial = evolucaoRodadas[0] || {};
  const atual = evolucaoRodadas[evolucaoRodadas.length - 1] || inicial;
  return {
    inicial,
    atual,
    evolucaoAderencia: n(atual.aderencia) - n(inicial.aderencia),
    evolucaoSavingMes: n(atual.savingMes) - n(inicial.savingMes),
    evolucaoFaturamentoMes: n(atual.faturamentoMes) - n(inicial.faturamentoMes),
    evolucaoCtesGanhos: n(atual.ctesGanhos) - n(inicial.ctesGanhos),
    evolucaoVolumes: n(atual.volumesGanhos) - n(inicial.volumesGanhos),
    evolucaoReducaoMedia: n(atual.reducaoMedia) - n(inicial.reducaoMedia),
  };
}

function fraseEvolucao(comparativo) {
  const partes = [];
  if (comparativo.evolucaoAderencia >= 0) partes.push(`A aderência evoluiu ${percentual(comparativo.evolucaoAderencia)} p.p. entre a primeira e a última rodada.`);
  else partes.push(`A aderência caiu ${percentual(Math.abs(comparativo.evolucaoAderencia))} p.p. entre a primeira e a última rodada.`);
  if (comparativo.evolucaoFaturamentoMes > 0) partes.push(`O faturamento potencial capturado aumentou ${dinheiro(comparativo.evolucaoFaturamentoMes)} por mês.`);
  if (comparativo.evolucaoCtesGanhos > 0) partes.push(`A proposta passou a capturar mais ${numero(comparativo.evolucaoCtesGanhos)} CT-es no recorte analisado.`);
  if (comparativo.evolucaoReducaoMedia < 0) partes.push('A redução média necessária caiu, indicando aproximação da proposta em relação às referências de mercado.');
  if (comparativo.evolucaoReducaoMedia > 0) partes.push('A redução média necessária aumentou nas rotas críticas, exigindo atenção antes da aprovação.');
  return partes.join(' ');
}

function montarRelatorioExecutivo({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, faixasCriticas, recomendacao }) {
  const t = tabela || {};
  return resumoTexto([
    `LAUDO GERAL DAS RODADAS - ${t.transportadora || 'Transportadora'}`,
    `Canal: ${t.canal || '-'}`,
    `Origem: ${t.origem || '-'}`,
    `Rodadas simuladas: ${evolucaoRodadas.length}`,
    '',
    'RESUMO EXECUTIVO',
    fraseEvolucao(comparativo),
    `Aderência: ${percentual(comparativo.inicial.aderencia)} para ${percentual(comparativo.atual.aderencia)}.`,
    `Saving mensal: ${dinheiro(comparativo.inicial.savingMes)} para ${dinheiro(comparativo.atual.savingMes)}.`,
    `Faturamento capturado/mês: ${dinheiro(comparativo.inicial.faturamentoMes)} para ${dinheiro(comparativo.atual.faturamentoMes)}.`,
    '',
    'EVOLUÇÃO DAS RODADAS',
    ...evolucaoRodadas.map((r) => `- ${r.rodada}ª rodada (${dataBR(r.criadoEm)}): aderência ${percentual(r.aderencia)}, CT-es ganhos ${numero(r.ctesGanhos)}, volumes ${numero(r.volumesGanhos)}, faturamento ${dinheiro(r.faturamentoMes)}/mês, saving ${dinheiro(r.savingMes)}/mês.`),
    '',
    'ROTAS/COTAÇÕES CRÍTICAS',
    ...(rotasCriticas.length ? rotasCriticas.slice(0, 10).map((r) => `- ${r.rota}: ${numero(r.ctesPerdidos)} CT-es perdidos, ${dinheiro(r.faturamentoNaoCapturado)} não capturado, ajuste médio ${percentual(r.ajusteMedio)}, prioridade ${r.prioridade}.`) : ['- Não foram identificadas rotas críticas no recorte atual.']),
    '',
    'ROTAS QUE MELHORARAM',
    ...(rotasMelhoraram.length ? rotasMelhoraram.slice(0, 8).map((r) => `- ${r.rota}: evolução de ${numero(r.evolucaoCtes)} CT-es competitivos.`) : ['- Não houve evolução destacada por rota/cotação.']),
    '',
    'UFs PRIORITÁRIAS',
    ...(ufsCriticas.length ? ufsCriticas.slice(0, 8).map((u) => `- ${u.ufDestino || u.rota}: ${numero(u.ctesPerdidos)} CT-es perdidos, aderência ${percentual(u.aderencia)}, ajuste médio ${percentual(u.ajusteMedio)}.`) : ['- Sem leitura suficiente por UF.']),
    '',
    'FAIXAS DE PESO PRIORITÁRIAS',
    ...(faixasCriticas.length ? faixasCriticas.slice(0, 8).map((f) => `- ${f.faixa || f.rota}: ${numero(f.ctesPerdidos)} CT-es perdidos, ${dinheiro(f.faturamentoNaoCapturado)} não capturado, ajuste médio ${percentual(f.ajusteMedio)}.`) : ['- Sem leitura suficiente por faixa de peso.']),
    '',
    'RECOMENDAÇÃO',
    recomendacao,
  ]);
}

function montarRelatorioTransportador({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, faixasCriticas, recomendacao }) {
  const t = tabela || {};
  return resumoTexto([
    `DEVOLUTIVA GERAL DAS RODADAS - ${t.transportadora || 'Transportadora'}`,
    `Canal: ${t.canal || '-'}`,
    `Origem: ${t.origem || '-'}`,
    `Rodadas avaliadas: ${evolucaoRodadas.length}`,
    '',
    'RESUMO DA EVOLUÇÃO',
    `A proposta saiu de ${percentual(comparativo.inicial.aderencia)} para ${percentual(comparativo.atual.aderencia)} de aderência no recorte analisado.`,
    `Os CT-es competitivos passaram de ${numero(comparativo.inicial.ctesGanhos)} para ${numero(comparativo.atual.ctesGanhos)}.`,
    `O faturamento potencial capturado na última rodada foi de ${dinheiro(comparativo.atual.faturamentoMes)} por mês.`,
    '',
    'ONDE A PROPOSTA MELHOROU',
    ...(rotasMelhoraram.length ? rotasMelhoraram.slice(0, 8).map((r) => `- ${r.rota}: evolução de ${numero(r.evolucaoCtes)} CT-es competitivos.`) : ['- Ainda não há melhoria destacada por rota/cotação.']),
    '',
    'ONDE AINDA PRECISA MELHORAR',
    ...(rotasCriticas.length ? rotasCriticas.slice(0, 12).map((r) => `- ${r.rota}: ainda perde ${numero(r.ctesPerdidos)} CT-es, com aproximadamente ${dinheiro(r.faturamentoNaoCapturado)} por mês de faturamento potencial não capturado. Faixa principal: ${r.faixa || 'não identificada'}. Ajuste médio necessário: ${percentual(r.ajusteMedio)}. Prioridade: ${r.prioridade}.`) : ['- Não foram identificados pontos críticos relevantes no recorte atual.']),
    '',
    'UFs DESTINO PRIORITÁRIAS',
    ...(ufsCriticas.length ? ufsCriticas.slice(0, 6).map((u) => `- ${u.ufDestino || u.rota}: ${numero(u.ctesPerdidos)} CT-es a revisar, aderência atual ${percentual(u.aderencia)}.`) : ['- Sem leitura suficiente por UF.']),
    '',
    'FAIXAS DE PESO PRIORITÁRIAS',
    ...(faixasCriticas.length ? faixasCriticas.slice(0, 8).map((f) => `- ${f.faixa || f.rota}: ${numero(f.ctesPerdidos)} CT-es com oportunidade, ajuste médio ${percentual(f.ajusteMedio)}.`) : ['- Sem leitura suficiente por faixa de peso.']),
    '',
    'DIRECIONAL FINAL',
    recomendacao,
  ]);
}

export function montarLaudosRodadasNegociacao(tabela = {}) {
  const resumo = getResumo(tabela);
  const simulacoesTodas = obterSimulacoesRodadas(resumo);
  const simulacoes = consolidarUltimaSimulacaoPorRodada(simulacoesTodas);
  const evolucaoRodadas = simulacoes.map(getIndicadoresRodada);
  const comparativo = montarComparativo(evolucaoRodadas);
  const primeira = simulacoes[0] || null;
  const ultima = simulacoes[simulacoes.length - 1] || primeira;
  const rotasComparadas = primeira && ultima ? compararRotas(primeira, ultima) : [];
  const rotasCriticas = rotasComparadas
    .filter((r) => n(r.ctesPerdidos) > 0 || n(r.faturamentoNaoCapturado) > 0 || n(r.ajusteMedio) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos) || n(b.ajusteMedio) - n(a.ajusteMedio))
    .slice(0, 20);
  const rotasMelhoraram = rotasComparadas
    .filter((r) => n(r.evolucaoCtes) > 0)
    .sort((a, b) => n(b.evolucaoCtes) - n(a.evolucaoCtes))
    .slice(0, 12);
  const ufsCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorUf)
    .filter((u) => n(u.ctesPerdidos) > 0 || n(u.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];
  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, getFaixa))
    .filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];

  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);
  const recomendacaoTransp = recomendacaoTransportador(rotasCriticas, rotasMelhoraram);
  const geradoEm = new Date().toISOString();

  const base = {
    transportadora: tabela.transportadora || resumo.transportadora || 'Transportadora',
    canal: tabela.canal || resumo.canal || '',
    origem: tabela.origem || resumo.filtros?.origem || '',
    ufDestino: tabela.uf_destino || resumo.filtros?.ufDestino || '',
    periodo: resumo.filtros?.inicio || resumo.filtros?.fim ? `${resumo.filtros?.inicio || 'início'} a ${resumo.filtros?.fim || 'fim'}` : 'período analisado',
    geradoEm,
    quantidadeSimulacoes: simulacoes.length,
    quantidadeRegistrosSimulacao: simulacoesTodas.length,
    evolucaoRodadas,
    comparativo,
    rotasCriticas,
    rotasMelhoraram,
    ufsCriticas,
    faixasCriticas,
  };

  const relatorioExecutivo = montarRelatorioExecutivo({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, faixasCriticas, recomendacao: recomendacaoExecutivo });
  const relatorioTransportador = montarRelatorioTransportador({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, faixasCriticas, recomendacao: recomendacaoTransp });

  return {
    executivo: {
      ...base,
      tipo: 'executivo_rodadas',
      titulo: 'Laudo Geral das Rodadas — Análise Interna',
      assunto: `Laudo geral das rodadas - ${base.transportadora}`,
      corpoEmail: relatorioExecutivo,
      relatorio: relatorioExecutivo,
      relatorioTexto: relatorioExecutivo,
      indicadores: comparativo.atual || {},
      recomendacao: recomendacaoExecutivo,
    },
    transportador: {
      ...base,
      tipo: 'transportador_rodadas',
      titulo: 'Devolutiva Geral das Rodadas — Oportunidades de Ajuste',
      assunto: `Devolutiva de rodadas - ${base.transportadora}`,
      corpoEmail: relatorioTransportador,
      relatorio: relatorioTransportador,
      relatorioTexto: relatorioTransportador,
      indicadores: comparativo.atual || {},
      ondeMelhorou: rotasMelhoraram,
      ondeAjustar: rotasCriticas,
      recomendacao: recomendacaoTransp,
    },
  };
}

export const formatadoresLaudoRodadas = { dinheiro, numero, percentual, dataBR };
