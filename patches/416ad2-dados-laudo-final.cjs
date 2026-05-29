const fs = require('fs');
const path = require('path');
let changed = false;

function save(file, src, old, label) {
  if (src !== old) {
    fs.writeFileSync(file, src, 'utf8');
    changed = true;
    console.log('OK ' + label);
  } else console.log('SKIP ' + label);
}
function rep(src, from, to, label) {
  if (src.includes(from)) {
    changed = true;
    console.log('OK ' + label);
    return src.replace(from, to);
  }
  if (src.includes(to)) {
    console.log('SKIP ' + label);
    return src;
  }
  console.warn('WARN ' + label);
  return src;
}
function addBefore(src, marker, block, label) {
  if (src.includes(block.trim().split('\n')[0])) {
    console.log('SKIP ' + label);
    return src;
  }
  const idx = src.indexOf(marker);
  if (idx < 0) {
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, idx) + block + '\n' + src.slice(idx);
}

const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let src = fs.readFileSync(utilPath, 'utf8');
const old = src;

// Padronização comercial: maiúsculo sem acento.
if (!src.includes('function padraoComercialLaudo')) {
  src = addBefore(src, 'function dataBR', `function padraoComercialLaudo(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

`, 'helper padrao comercial');
}

const metricasFn = `function calcularMetricasNfRodada(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  let valorNfTotal = 0;
  let freteRealizadoTotal = 0;
  let freteSelecionadaTotal = 0;
  detalhes.forEach((item) => {
    const nf = n(item.valorNF || item.valorNf || item.valor_nf || item.valorNota || item.nf);
    valorNfTotal += nf;
    freteRealizadoTotal += n(item.freteRealizado || item.valorCte || item.valorCTe);
    freteSelecionadaTotal += n(item.freteSelecionada || item.freteTabelaSelecionada || item.valorFreteSelecionada);
  });
  const percentualFreteReal = valorNfTotal ? (freteRealizadoTotal / valorNfTotal) * 100 : n(resumo.percentualFreteRealizado);
  const percentualFreteTabela = valorNfTotal ? (freteSelecionadaTotal / valorNfTotal) * 100 : n(resumo.percentualFreteTabelaGanharia || resumo.percentualFreteSelecionada);
  return {
    valorNfTotal,
    freteRealizadoTotal,
    freteSelecionadaTotal,
    percentualFreteReal,
    percentualFreteTabela,
    reducaoPpFreteNf: percentualFreteTabela - percentualFreteReal,
  };
}

`;
src = addBefore(src, 'function montarComparativo', metricasFn, 'metricas NF rodada');

// Corrige contagem de ganhos/perdas para não duplicar quando existem campos agregados e status individual.
src = rep(src,
  "return item.statusSelecionada === 'Ganharia' || item.ganhouRealizado === true || n(item.savingSelecionada) > 0 || n(item.qtdGanhasSelecionada) > 0;",
  "if (n(item.qtdGanhasSelecionada) > 0 || n(item.ctesGanhos) > 0) return true;\n  if (n(item.ctesPerdidos) > 0 || n(item.qtdPerdidasSelecionada) > 0) return false;\n  return item.statusSelecionada === 'Ganharia' || item.ganhouRealizado === true || n(item.savingSelecionada) > 0;",
  'isGanha sem duplicar'
);
src = rep(src,
  "return item.statusSelecionada === 'Perderia' || item.perdeuRealizado === true || n(item.diferencaParaVencedor) > 0 || n(item.qtdPerdidasSelecionada) > 0;",
  "if (n(item.qtdPerdidasSelecionada) > 0 || n(item.ctesPerdidos) > 0) return true;\n  if (n(item.ctesGanhos) > 0 || n(item.qtdGanhasSelecionada) > 0) return false;\n  return item.statusSelecionada === 'Perderia' || item.perdeuRealizado === true || n(item.diferencaParaVencedor) > 0;",
  'isPerdida sem duplicar'
);

// Padroniza origem/destino nos agrupamentos principais.
src = rep(src,
  "const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || 'Origem');\n  const ufOrigem = upper(item.ufOrigem || item.uf_origem || item.ufOrigemCte || item.estadoOrigem || '');\n  return origem + (ufOrigem ? '/' + ufOrigem : '');",
  "const origem = padraoComercialLaudo(item.origem || item.cidadeOrigem || item.cidade_origem || 'ORIGEM');\n  const ufOrigem = upper(item.ufOrigem || item.uf_origem || item.ufOrigemCte || item.estadoOrigem || '');\n  return origem + (ufOrigem ? '/' + ufOrigem : '');",
  'origem label padronizado'
);
src = rep(src,
  "const cidade = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.municipioDestino || item.municipio_destino);",
  "const cidade = padraoComercialLaudo(item.destino || item.cidadeDestino || item.cidade_destino || item.municipioDestino || item.municipio_destino);",
  'cidade pareto padronizada'
);
src = rep(src,
  "const cidade = texto(item.destino || item.cidadeDestino || item.cidade_destino || 'Destino');",
  "const cidade = padraoComercialLaudo(item.destino || item.cidadeDestino || item.cidade_destino || 'DESTINO');",
  'cidade destino faixa padronizada'
);

// Estado/UF por origem: corrige a origem na rota e evita visão só UF.
src = rep(src,
  "rota: origem + ' → ' + ufDestino,",
  "rota: origem + ' → ' + ufDestino,\n      destino: ufDestino,",
  'rota origem uf destino'
);

// Com uma rodada, textos deixam de ser evolução e passam a diagnóstico inicial.
src = rep(src,
  "function fraseEvolucao(comparativo) {",
  "function fraseEvolucao(comparativo, quantidadeRodadas = 0) {",
  'assinatura frase evolucao'
);
src = rep(src,
  "  const partes = [];\n  if (comparativo.evolucaoAderencia >= 0)",
  "  if (quantidadeRodadas < 2) {\n    return `Esta é a primeira rodada salva da análise. A proposta apresenta aderência atual de ${percentual(comparativo.atual?.aderencia)}, com ${numero(comparativo.atual?.ctesGanhos)} CT-es competitivos, ${numero(comparativo.atual?.volumesGanhos)} volumes competitivos e faturamento potencial capturado de ${dinheiro(comparativo.atual?.faturamentoMes)} por mês.`;\n  }\n  const partes = [];\n  if (comparativo.evolucaoAderencia >= 0)",
  'diagnostico primeira rodada'
);
src = rep(src,
  "fraseEvolucao(comparativo),",
  "fraseEvolucao(comparativo, evolucaoRodadas.length),",
  'relatorio executivo usa quantidade'
);

// Adiciona métricas NF no base do laudo.
if (!src.includes('const metricasNfAtual = ultima ? calcularMetricasNfRodada(ultima) : {};')) {
  src = rep(src,
    "  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);",
    "  const metricasNfAtual = ultima ? calcularMetricasNfRodada(ultima) : {};\n  comparativo.atual = { ...(comparativo.atual || {}), ...metricasNfAtual, percentualFreteReal: metricasNfAtual.percentualFreteReal || comparativo.atual?.percentualFreteReal || 0, percentualFreteTabela: metricasNfAtual.percentualFreteTabela || comparativo.atual?.percentualFreteTabela || 0 };\n\n  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);",
    'metricas NF no comparativo'
  );
}

save(utilPath, src, old, 'utils laudo AD');
console.log(changed ? '4.16AD2 aplicado.' : '4.16AD2 sem alterações.');
