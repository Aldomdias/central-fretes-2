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
function replaceFunctionBefore(src, functionName, endMarker, replacement, label) {
  const start = src.indexOf('function ' + functionName);
  const end = start >= 0 ? src.indexOf(endMarker, start) : -1;
  if (start >= 0 && end > start) {
    changed = true;
    console.log('OK ' + label);
    return src.slice(0, start) + replacement + '\n\n' + src.slice(end);
  }
  console.warn('WARN ' + label);
  return src;
}

// 1) Preserva campos de IBGE/mesorregião no detalhe individual do CT-e.
const simPath = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let sim = fs.readFileSync(simPath, 'utf8');
const simOld = sim;
if (!sim.includes('ibgeDestino: row.ibgeDestino')) {
  sim = rep(sim,
    "      ufDestino: row.ufDestino || vencedor?.ufDestino || '',",
    "      ufDestino: row.ufDestino || vencedor?.ufDestino || '',\n      ibgeDestino: row.ibgeDestino || row.codigoIbgeDestino || row.ibge_destino || row.codIbgeDestino || '',\n      mesorregiaoDestino: row.mesorregiaoDestino || row.mesorregiao || row.mesoRegiaoDestino || row.mesoRegiao || row.meso_regiao || row.microrregiao || row.regiaoDestino || '',",
    'campos ibge/meso no ctesDetalhes'
  );
}
save(simPath, sim, simOld, 'SimuladorPage ibge meso');

// 2) Salva IBGE/mesorregião na versão leve do resumo da rodada.
const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let service = fs.readFileSync(servicePath, 'utf8');
const serviceOld = service;
if (!service.includes('ibgeDestino: item.ibgeDestino')) {
  service = rep(service,
    "      ufDestino: item.ufDestino || '',",
    "      ufDestino: item.ufDestino || '',\n      ibgeDestino: item.ibgeDestino || item.codigoIbgeDestino || item.ibge_destino || item.codIbgeDestino || '',\n      mesorregiaoDestino: item.mesorregiaoDestino || item.mesorregiao || item.mesoRegiaoDestino || item.mesoRegiao || item.meso_regiao || item.microrregiao || item.regiaoDestino || '',",
    'salva ibge/meso em ctesDetalhes'
  );
}
save(servicePath, service, serviceOld, 'service ibge meso');

// 3) Laudo: Pareto completo + Mesorregião x Faixa.
const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
const utilOld = util;

const paretoCompleto = `function montarParetoCidadesVolume(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const candidatos = [resumo.ctesDetalhesLaudo, resumo.ctesDetalhes, resumo.detalhes, resumo.linhasDetalhe];
  const detalhes = candidatos.reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, []);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || 'Origem');
    const cidade = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.municipioDestino || item.municipio_destino);
    const uf = getUfDestino(item);
    if (!cidade && (!uf || uf === '-')) return;
    const chave = [upper(origem), upper(cidade || 'Destino'), uf || '-'].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, cidade: cidade || 'Destino', ufDestino: uf || '-', rotaDestino: [origem, cidade ? cidade + (uf && uf !== '-' ? '/' + uf : '') : uf].filter(Boolean).join(' → '), ctes: 0, volumes: 0, peso: 0, freteRealizado: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, ctesGanhos: 0, ctesPerdidos: 0, reducaoSoma: 0, reducaoQtd: 0 });
    const acc = mapa.get(chave);
    const qtd = n(item.ctes || item.qtd || item.qtdCtes || 1) || 1;
    const vols = n(item.volumes || item.qtdVolumes || item.volumesTotal || item.volume) || qtd;
    const ganhou = isGanha(item);
    const perdeu = isPerdida(item);
    const frete = n(item.freteRealizado || item.valorCte || item.valorCTe || item.faturamentoPotencial);
    const capturado = ganhou ? n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado || frete) : 0;
    const naoCapturado = perdeu ? n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado || frete) : 0;
    acc.ctes += qtd;
    acc.volumes += vols;
    acc.peso += n(item.peso || item.pesoRealizado || item.pesoDeclarado || item.pesoCubado);
    acc.freteRealizado += frete;
    acc.faturamentoCapturado += capturado;
    acc.faturamentoNaoCapturado += naoCapturado;
    if (ganhou) acc.ctesGanhos += qtd;
    if (perdeu) acc.ctesPerdidos += qtd;
    const reducao = reducaoItem(item);
    if (reducao) { acc.reducaoSoma += reducao * Math.max(qtd, 1); acc.reducaoQtd += Math.max(qtd, 1); }
  });
  const totalVolumes = Array.from(mapa.values()).reduce((s, i) => s + n(i.volumes), 0);
  let acumulado = 0;
  const lista = Array.from(mapa.values()).sort((a, b) => n(b.volumes) - n(a.volumes) || n(b.ctes) - n(a.ctes)).map((item) => {
    const pctVolume = totalVolumes ? (n(item.volumes) / totalVolumes) * 100 : 0;
    const antes = acumulado;
    acumulado += pctVolume;
    const base = n(item.ctesGanhos) + n(item.ctesPerdidos) || n(item.ctes);
    return { ...item, pctVolume, pctAcumulado: acumulado, pareto80: antes < 80, aderencia: base ? (n(item.ctesGanhos) / base) * 100 : 0, ajusteMedio: item.reducaoQtd ? item.reducaoSoma / item.reducaoQtd : 0 };
  });
  const pareto = lista.filter((item) => item.pareto80);
  return pareto.length ? pareto : lista.slice(0, 10);
}`;
if (util.includes('function montarParetoCidadesVolume')) {
  const endMarker = util.includes('function calcularParetoCidadesSalvos') ? 'function calcularParetoCidadesSalvos' : 'function classificarRecomendacao';
  util = replaceFunctionBefore(util, 'montarParetoCidadesVolume', endMarker, paretoCompleto, 'pareto completo');
}

const mesoHelpers = `function getMesorregiaoLaudo(item = {}) {
  return texto(item.mesorregiaoDestino || item.mesorregiao || item.mesoRegiaoDestino || item.mesoRegiao || item.meso_regiao || item.microrregiao || item.regiaoDestino || item.regiao || item.destino || item.cidadeDestino || 'Sem mesorregião');
}

function agruparMesorregiaoFaixa(simulacao) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || 'Origem');
    const ufDestino = getUfDestino(item);
    const mesorregiao = getMesorregiaoLaudo(item);
    const faixa = getFaixa(item);
    const chave = [upper(origem), ufDestino, upper(mesorregiao), upper(faixa)].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, ufDestino, mesorregiao, rota: mesorregiao, faixa, ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0, prioridade: 'BAIXA' });
    const acc = mapa.get(chave);
    const qtd = n(item.ctes || item.qtd || item.qtdCtes || 1) || 1;
    const qtdGanha = isGanha(item) ? qtd : n(item.ctesGanhos || 0);
    const qtdPerdida = isPerdida(item) ? qtd : n(item.ctesPerdidos || 0);
    const reducao = reducaoItem(item);
    acc.ctesAnalisados += qtd;
    acc.ctesGanhos += qtdGanha;
    acc.ctesPerdidos += qtdPerdida;
    acc.volumes += n(item.volumes || item.qtdVolumes || qtd);
    acc.faturamentoPotencial += valorPotencial(item);
    acc.faturamentoCapturado += isGanha(item) ? n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado) : 0;
    acc.faturamentoNaoCapturado += isPerdida(item) ? n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado) : 0;
    if (reducao) { acc.reducaoSoma += reducao * Math.max(qtdPerdida || qtd, 1); acc.reducaoQtd += Math.max(qtdPerdida || qtd, 1); }
  });
  return finalizarAgrupados(Array.from(mapa.values())).sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos)).slice(0, 30);
}

`;
util = addBefore(util, 'function classificarRecomendacao', mesoHelpers, 'helpers mesorregiao');

if (!util.includes('const mesorregiaoFaixas = ultima ? agruparMesorregiaoFaixa(ultima) : [];')) {
  util = rep(util,
    '  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);',
    '  const mesorregiaoFaixas = ultima ? agruparMesorregiaoFaixa(ultima) : [];\n\n  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);',
    'calcula mesorregiaoFaixas'
  );
}
util = rep(util,
  '    faixasCriticas,',
  '    faixasCriticas,\n    mesorregiaoFaixas,',
  'inclui mesorregiaoFaixas no base'
);
save(utilPath, util, utilOld, 'utils laudo final');

console.log(changed ? '4.16AB1 aplicado.' : '4.16AB1 sem alterações.');
