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
function addBefore(src, marker, block, label) {
  if (src.includes(block.trim().split('\n')[0])) {
    console.log('SKIP ' + label);
    return src;
  }
  const i = src.indexOf(marker);
  if (i < 0) {
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, i) + block + '\n' + src.slice(i);
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

const file = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let src = fs.readFileSync(file, 'utf8');
const old = src;

const helpers = `function origemLabelLaudo(item = {}) {
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || 'Origem');
  const uf = upper(item.ufOrigem || item.uf_origem || '');
  return origem + (uf ? '/' + uf : '');
}

function detalhesIndividuaisLaudo(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const candidatos = [resumo.ctesDetalhesLaudo, resumo.ctesDetalhes, resumo.detalhes, resumo.linhasDetalhe];
  return candidatos.reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, []);
}

function montarParetoDestinoFaixa(simulacao = {}) {
  const detalhes = detalhesIndividuaisLaudo(simulacao);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const origem = origemLabelLaudo(item);
    const destino = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.municipioDestino || item.municipio_destino || 'Destino');
    const ufDestino = getUfDestino(item);
    const faixa = getFaixa(item);
    const chave = [upper(origem), upper(destino), ufDestino, upper(faixa)].join('|');
    if (!mapa.has(chave)) {
      mapa.set(chave, { chave, origem, destino, ufDestino, faixa, rota: destino, ctes: 0, volumes: 0, ctesGanhos: 0, ctesPerdidos: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, freteRealizado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    }
    const acc = mapa.get(chave);
    const qtd = n(item.ctes || item.qtd || item.qtdCtes || 1) || 1;
    const volumes = n(item.volumes || item.qtdVolumes || item.volumesTotal || item.volume) || qtd;
    const ganhou = isGanha(item);
    const perdeu = isPerdida(item);
    const frete = n(item.freteRealizado || item.valorCte || item.valorCTe || item.faturamentoPotencial);
    acc.ctes += qtd;
    acc.volumes += volumes;
    acc.freteRealizado += frete;
    if (ganhou) {
      acc.ctesGanhos += qtd;
      acc.faturamentoCapturado += n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado || frete);
    }
    if (perdeu) {
      acc.ctesPerdidos += qtd;
      acc.faturamentoNaoCapturado += n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado || frete);
    }
    const reducao = reducaoItem(item);
    if (reducao) {
      acc.reducaoSoma += reducao * Math.max(qtd, 1);
      acc.reducaoQtd += Math.max(qtd, 1);
    }
  });
  const totalVolumes = Array.from(mapa.values()).reduce((s, item) => s + n(item.volumes), 0);
  let acumulado = 0;
  const lista = Array.from(mapa.values()).sort((a, b) => n(b.volumes) - n(a.volumes) || n(b.ctes) - n(a.ctes)).map((item) => {
    const pctVolume = totalVolumes ? (n(item.volumes) / totalVolumes) * 100 : 0;
    const antes = acumulado;
    acumulado += pctVolume;
    const base = n(item.ctesGanhos) + n(item.ctesPerdidos) || n(item.ctes);
    let prioridade = 'BAIXA';
    const ajusteMedio = item.reducaoQtd ? item.reducaoSoma / item.reducaoQtd : 0;
    if (item.faturamentoNaoCapturado >= 5000 || item.ctesPerdidos >= 20 || ajusteMedio >= 15) prioridade = 'ALTA';
    else if (item.faturamentoNaoCapturado >= 1500 || item.ctesPerdidos >= 8 || ajusteMedio >= 8) prioridade = 'MÉDIA';
    return { ...item, pctVolume, pctAcumulado: acumulado, pareto80: antes < 80, aderencia: base ? (n(item.ctesGanhos) / base) * 100 : 0, ajusteMedio, prioridade };
  });
  const pareto = lista.filter((item) => item.pareto80);
  return pareto.length ? pareto : lista.slice(0, 20);
}

function agruparPorOrigemUfDestino(simulacao = {}) {
  const detalhes = detalhesIndividuaisLaudo(simulacao);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const origem = origemLabelLaudo(item);
    const ufDestino = getUfDestino(item);
    const chave = [upper(origem), ufDestino].join('|');
    if (!mapa.has(chave)) {
      mapa.set(chave, { chave, origem, ufDestino, rota: ufDestino, faixa: 'Todas', ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    }
    const acc = mapa.get(chave);
    const qtd = n(item.ctes || item.qtd || item.qtdCtes || 1) || 1;
    const ganhou = isGanha(item);
    const perdeu = isPerdida(item);
    acc.ctesAnalisados += qtd;
    acc.volumes += n(item.volumes || item.qtdVolumes || qtd);
    if (ganhou) {
      acc.ctesGanhos += qtd;
      acc.faturamentoCapturado += n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado);
    }
    if (perdeu) {
      acc.ctesPerdidos += qtd;
      acc.faturamentoNaoCapturado += n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado);
    }
    acc.faturamentoPotencial += valorPotencial(item);
    const reducao = reducaoItem(item);
    if (reducao) {
      acc.reducaoSoma += reducao * Math.max(qtd, 1);
      acc.reducaoQtd += Math.max(qtd, 1);
    }
  });
  return finalizarAgrupados(Array.from(mapa.values())).sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos));
}

`;
src = addBefore(src, 'function classificarRecomendacao', helpers, 'helpers pareto destino faixa e origem uf');

if (!src.includes('const destinoFaixaPareto = ultima ? montarParetoDestinoFaixa(ultima) : [];')) {
  src = rep(src,
    '  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);',
    '  const destinoFaixaPareto = ultima ? montarParetoDestinoFaixa(ultima) : [];\n  const ufsOrigemDestino = ultima ? agruparPorOrigemUfDestino(ultima).slice(0, 30) : ufsCriticas;\n\n  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);',
    'calcula novas visoes'
  );
}

src = rep(src,
  '    ufsCriticas,\n    faixasCriticas,',
  '    ufsCriticas,\n    ufsOrigemDestino,\n    destinoFaixaPareto,\n    faixasCriticas,',
  'inclui novas visoes no base'
);

save(file, src, old, 'utils refino laudo');
console.log(changed ? '4.16AC1 aplicado.' : '4.16AC1 sem alterações.');
