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

const helpers = `function origemLabelLaudo(item = {}) {
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || 'Origem');
  const ufOrigem = upper(item.ufOrigem || item.uf_origem || item.ufOrigemCte || item.estadoOrigem || '');
  return origem + (ufOrigem ? '/' + ufOrigem : '');
}

function agruparPorOrigemUf(simulacao) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const origem = origemLabelLaudo(item);
    const ufDestino = getUfDestino(item);
    const chave = [upper(origem), ufDestino].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, ufDestino, rota: origem + ' → ' + ufDestino, faixa: 'Todas', ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    const acc = mapa.get(chave);
    const qtd = n(item.ctes || item.qtd || item.qtdCtes || 1) || 1;
    const ganhou = isGanha(item);
    const perdeu = isPerdida(item);
    const reducao = reducaoItem(item);
    acc.ctesAnalisados += qtd;
    acc.ctesGanhos += ganhou ? qtd : n(item.ctesGanhos || 0);
    acc.ctesPerdidos += perdeu ? qtd : n(item.ctesPerdidos || 0);
    acc.volumes += n(item.volumes || item.qtdVolumes || qtd);
    acc.faturamentoPotencial += valorPotencial(item);
    acc.faturamentoCapturado += ganhou ? n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado) : 0;
    acc.faturamentoNaoCapturado += perdeu ? n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado) : 0;
    if (reducao) { acc.reducaoSoma += reducao * Math.max(qtd, 1); acc.reducaoQtd += Math.max(qtd, 1); }
  });
  return finalizarAgrupados(Array.from(mapa.values())).sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos));
}

function montarParetoDestinoFaixa(simulacao) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const origem = origemLabelLaudo(item);
    const cidade = texto(item.destino || item.cidadeDestino || item.cidade_destino || 'Destino');
    const ufDestino = getUfDestino(item);
    const faixa = getFaixa(item);
    const chave = [upper(origem), upper(cidade), ufDestino, upper(faixa)].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, destino: cidade, ufDestino, faixa, rotaDestino: origem + ' → ' + cidade + (ufDestino && ufDestino !== '-' ? '/' + ufDestino : ''), ctes: 0, volumes: 0, ctesGanhos: 0, ctesPerdidos: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    const acc = mapa.get(chave);
    const qtd = n(item.ctes || item.qtd || item.qtdCtes || 1) || 1;
    const ganhou = isGanha(item);
    const perdeu = isPerdida(item);
    const reducao = reducaoItem(item);
    acc.ctes += qtd;
    acc.volumes += n(item.volumes || item.qtdVolumes || qtd);
    if (ganhou) acc.ctesGanhos += qtd;
    if (perdeu) acc.ctesPerdidos += qtd;
    if (ganhou) acc.faturamentoCapturado += n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado);
    if (perdeu) acc.faturamentoNaoCapturado += n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado);
    if (reducao) { acc.reducaoSoma += reducao * Math.max(qtd, 1); acc.reducaoQtd += Math.max(qtd, 1); }
  });
  const totalVolumes = Array.from(mapa.values()).reduce((s, i) => s + n(i.volumes), 0);
  let acumulado = 0;
  const lista = Array.from(mapa.values()).sort((a, b) => n(b.volumes) - n(a.volumes) || n(b.ctes) - n(a.ctes)).map((item) => {
    const pctVolume = totalVolumes ? (n(item.volumes) / totalVolumes) * 100 : 0;
    const antes = acumulado;
    acumulado += pctVolume;
    const base = n(item.ctesGanhos) + n(item.ctesPerdidos) || n(item.ctes);
    return { ...item, pctVolume, pctAcumulado: acumulado, pareto80: antes < 80, aderencia: base ? (n(item.ctesGanhos) / base) * 100 : 0, ajusteMedio: item.reducaoQtd ? item.reducaoSoma / item.reducaoQtd : 0, prioridade: n(item.ctesPerdidos) || n(item.faturamentoNaoCapturado) ? 'ALTA' : 'BAIXA' };
  });
  return (lista.filter((item) => item.pareto80).length ? lista.filter((item) => item.pareto80) : lista.slice(0, 20));
}

`;
src = addBefore(src, 'function classificarRecomendacao', helpers, 'helpers finais origem uf e destino faixa');

src = rep(src,
  'compararGenerico(primeira, ultima, agruparPorUf)',
  'compararGenerico(primeira, ultima, agruparPorOrigemUf)',
  'visao estado por origem uf'
);

if (!src.includes('const destinoFaixaPareto = ultima ? montarParetoDestinoFaixa(ultima) : [];')) {
  src = rep(src,
    '  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);',
    '  const destinoFaixaPareto = ultima ? montarParetoDestinoFaixa(ultima) : [];\n\n  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);',
    'calcula destinoFaixaPareto'
  );
}
src = rep(src,
  '    mesorregiaoFaixas,',
  '    mesorregiaoFaixas,\n    destinoFaixaPareto,',
  'inclui destinoFaixaPareto no base'
);

src = rep(src,
  "return texto(item.mesorregiaoDestino || item.mesorregiao || item.mesoRegiaoDestino || item.mesoRegiao || item.meso_regiao || item.microrregiao || item.regiaoDestino || item.regiao || item.destino || item.cidadeDestino || 'Sem mesorregião');",
  "return texto(item.mesorregiaoDestino || item.mesorregiao || item.mesoRegiaoDestino || item.mesoRegiao || item.meso_regiao || item.microrregiao || item.regiaoDestino || item.regiao || 'Mesorregião não identificada');",
  'mesorregiao sem fallback cidade'
);

save(utilPath, src, old, 'utils laudo AC');
console.log(changed ? '4.16AC1 aplicado.' : '4.16AC1 sem alterações.');
