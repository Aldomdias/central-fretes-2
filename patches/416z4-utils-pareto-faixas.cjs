const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let src = fs.readFileSync(file, 'utf8');
const old = src;
function rep(a,b){ if(src.includes(a)){ src=src.replace(a,b); return true; } return false; }

rep(
  "  const rota = texto(item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome);",
  "  const rota = texto(item.nomeRota || item.nomeRotaCotacao || item.cotacaoComercial || item.rotaCotacao || item.rota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome);"
);
rep(
  "      rota: texto(item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome) || chave,",
  "      rota: texto(item.nomeRota || item.nomeRotaCotacao || item.cotacaoComercial || item.rotaCotacao || item.rota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome) || chave,"
);

if (!src.includes('function calcularParetoCidadesSalvos')) {
  const fn = `function calcularParetoCidadesSalvos(simulacao) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = Array.isArray(resumo.ctesDetalhes) ? resumo.ctesDetalhes : [];
  if (!detalhes.length) return [];
  const mapa = new Map();
  detalhes.forEach((item) => {
    const cidade = texto(item.destino || item.cidadeDestino || '');
    const uf = upper(item.ufDestino || '');
    if (!cidade && !uf) return;
    const chave = cidade + '|' + uf;
    if (!mapa.has(chave)) mapa.set(chave, { cidade, ufDestino: uf, ctes: 0, volumes: 0, freteRealizado: 0, ctesGanhos: 0, ctesPerdidos: 0, faturamentoNaoCapturado: 0 });
    const acc = mapa.get(chave);
    acc.ctes += 1;
    acc.volumes += n(item.volumes);
    acc.freteRealizado += n(item.freteRealizado);
    if (item.statusSelecionada === 'Ganharia' || item.ganhouRealizado === true) acc.ctesGanhos += 1;
    if (item.statusSelecionada === 'Perderia' || item.perdeuRealizado === true) {
      acc.ctesPerdidos += 1;
      acc.faturamentoNaoCapturado += n(item.diferencaParaVencedor || item.freteRealizado);
    }
  });
  const lista = Array.from(mapa.values());
  const totalVolume = lista.reduce((acc, item) => acc + (item.volumes || item.ctes), 0);
  if (!totalVolume) return [];
  const ordenada = lista.map((item) => ({ ...item, volumePareto: item.volumes || item.ctes })).sort((a, b) => b.volumePareto - a.volumePareto);
  let acumulado = 0;
  const resultado = [];
  for (const item of ordenada) {
    acumulado += item.volumePareto;
    const pctVolume = totalVolume ? (item.volumePareto / totalVolume) * 100 : 0;
    const pctAcumulado = totalVolume ? (acumulado / totalVolume) * 100 : 0;
    const base = item.ctesGanhos + item.ctesPerdidos;
    resultado.push({ ...item, pctVolume, pctAcumulado, aderencia: base ? (item.ctesGanhos / base) * 100 : 0 });
    if (pctAcumulado >= 80) break;
  }
  return resultado;
}

`;
  src = src.replace('function classificarRecomendacao', fn + 'function classificarRecomendacao');
}

if (!src.includes('const paretoCidades = ultima ? calcularParetoCidadesSalvos(ultima) : [];')) {
  src = src.replace(
    '  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);',
    `  const paretoCidades = ultima ? calcularParetoCidadesSalvos(ultima) : [];
  const faixasDetalhadas = ultima ? agruparDetalhes(ultima, chaveRota)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 30) : [];

  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);`
  );
}
rep(
  "    faixasCriticas,\n  };",
  "    faixasCriticas,\n    paretoCidades,\n    faixasDetalhadas,\n  };"
);
if (src !== old) fs.writeFileSync(file, src, 'utf8');
console.log(src !== old ? '4.16Z4 utils aplicado.' : '4.16Z4 utils sem alterações.');
