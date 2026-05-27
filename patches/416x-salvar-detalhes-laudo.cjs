const fs = require('fs');
const path = require('path');
let changed = false;

function save(file, src, old, label) {
  if (src !== old) {
    fs.writeFileSync(file, src, 'utf8');
    changed = true;
    console.log('OK ' + label);
  } else {
    console.log('SKIP ' + label);
  }
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

// 1) Simulador: adiciona campos explícitos de cotação comercial no detalhe de cada CT-e.
const simPath = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let sim = fs.readFileSync(simPath, 'utf8');
const simOld = sim;
if (!sim.includes('nomeRotaCotacao:')) {
  sim = rep(sim,
    "      transportadoraReal: row.transportadora || '',",
    "      nomeRotaCotacao: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.detalhes?.frete?.nomeCotacao || itemSelecionada?.rotaNome || '',\n      cotacaoComercial: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.detalhes?.frete?.nomeCotacao || itemSelecionada?.rotaNome || '',\n      faixaPesoCotacao: itemSelecionada?.detalhes?.frete?.faixaPeso || itemSelecionada?.detalhes?.frete?.faixa_peso || itemSelecionada?.detalhes?.frete?.faixa || '',\n      transportadoraReal: row.transportadora || '',",
    'insere nomeRotaCotacao no cteDetalhes'
  );
} else {
  console.log('SKIP nomeRotaCotacao já existe no SimuladorPage');
}
if (!sim.includes('nomeRotaCotacao: r.detalhes?.frete?.rotaCotacao')) {
  sim = rep(sim,
    "        detalhes: r.detalhes || null,",
    "        nomeRotaCotacao: r.detalhes?.frete?.rotaCotacao || r.detalhes?.frete?.cotacaoComercial || r.rotaNome || '',\n        detalhes: r.detalhes || null,",
    'insere nomeRotaCotacao em todosResultados'
  );
}
save(simPath, sim, simOld, 'SimuladorPage detalhes laudo');

// 2) Service: salva uma base individual leve dentro da rodada para o laudo/Pareto.
const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let service = fs.readFileSync(servicePath, 'utf8');
const serviceOld = service;
const helpers = `function rotaComercialLaudoServico(item = {}) {
  const candidatos = [
    item.nomeRotaCotacao,
    item.cotacaoComercial,
    item.rotaCotacao,
    item.rotaSelecionada,
    item.rotaVencedora,
    item.selecionadaDetalhes?.frete?.rotaCotacao,
    item.selecionadaDetalhes?.frete?.cotacaoComercial,
    item.selecionadaDetalhes?.frete?.nomeCotacao,
    item.vencedorDetalhes?.frete?.rotaCotacao,
    item.todosResultados?.[0]?.nomeRotaCotacao,
    item.todosResultados?.[0]?.detalhes?.frete?.rotaCotacao,
    item.todosResultados?.[0]?.detalhes?.frete?.cotacaoComercial,
  ].map((v) => texto(v)).filter(Boolean);
  const invalida = (v) => {
    const s = upper(v);
    if (!s) return true;
    if (s.includes('IBGE')) return true;
    if (/^\\d+[.,]?\\d*\\s*(ATE|ATÉ|A)\\s*\\d+[.,]?\\d*/i.test(s)) return true;
    if (/^ACIMA DE\\s*\\d+/i.test(s)) return true;
    return false;
  };
  return candidatos.find((v) => !invalida(v)) || '';
}

function montarCtesDetalhesLaudoServico(resultado = {}) {
  const detalhes = Array.isArray(resultado.ctesDetalhes) ? resultado.ctesDetalhes : [];
  return detalhes.slice(0, 12000).map((item) => {
    const nomeRota = rotaComercialLaudoServico(item);
    const status = upper(item.statusSelecionada);
    const ganhou = status === 'GANHARIA' || item.ganhouRealizado === true || numero(item.savingSelecionada) > 0;
    const perdeu = status === 'PERDERIA' || (!ganhou && numero(item.freteSelecionada) > 0);
    return {
      cte: item.cte || '',
      data: item.data || '',
      origem: texto(item.origem || item.cidadeOrigem || resultado.filtros?.origem || ''),
      ufOrigem: upper(item.ufOrigem || ''),
      destino: texto(item.destino || item.cidadeDestino || ''),
      ufDestino: upper(item.ufDestino || item.uf || item.estadoDestino || ''),
      canal: item.canal || resultado.filtros?.canal || '',
      transportadoraReal: item.transportadoraReal || '',
      nomeRotaCotacao: nomeRota,
      cotacaoComercial: nomeRota,
      rotaCotacao: nomeRota,
      faixaPesoCotacao: texto(item.faixaPesoCotacao || item.selecionadaDetalhes?.frete?.faixaPeso || item.selecionadaDetalhes?.frete?.faixa_peso || ''),
      peso: numero(item.peso),
      volumes: numero(item.volumes || item.qtdVolumes || 1) || 1,
      valorNF: numero(item.valorNF),
      freteRealizado: numero(item.freteRealizado),
      freteSelecionada: numero(item.freteSelecionada),
      freteVencedor: numero(item.freteVencedor),
      statusSelecionada: item.statusSelecionada || '',
      ganhouRealizado: ganhou,
      perdeuRealizado: perdeu,
      reducaoNecessaria: numero(item.reducaoNecessaria),
      savingSelecionada: numero(item.savingSelecionada),
      diferencaParaVencedor: numero(item.diferencaParaVencedor),
    };
  });
}

function montarParetoCidadesVolumeServico(resultado = {}) {
  const detalhes = Array.isArray(resultado.ctesDetalhesLaudo) ? resultado.ctesDetalhesLaudo : montarCtesDetalhesLaudoServico(resultado);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const cidade = texto(item.destino || item.cidadeDestino || 'Destino');
    const ufDestino = upper(item.ufDestino || item.uf || item.estadoDestino || '');
    if (!cidade && !ufDestino) return;
    const chave = [upper(cidade), ufDestino].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, cidade, ufDestino, ctes: 0, volumes: 0, ctesGanhos: 0, ctesPerdidos: 0, freteRealizado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    const acc = mapa.get(chave);
    const volumes = numero(item.volumes || 1) || 1;
    const ganhou = item.ganhouRealizado === true || upper(item.statusSelecionada) === 'GANHARIA';
    const perdeu = item.perdeuRealizado === true || upper(item.statusSelecionada) === 'PERDERIA';
    acc.ctes += 1;
    acc.volumes += volumes;
    if (ganhou) acc.ctesGanhos += 1;
    if (perdeu) acc.ctesPerdidos += 1;
    acc.freteRealizado += numero(item.freteRealizado);
    if (perdeu) acc.faturamentoNaoCapturado += numero(item.freteRealizado);
    if (perdeu && numero(item.reducaoNecessaria)) { acc.reducaoSoma += numero(item.reducaoNecessaria); acc.reducaoQtd += 1; }
  });
  const totalVolumes = Array.from(mapa.values()).reduce((s, i) => s + numero(i.volumes), 0);
  let acumulado = 0;
  return Array.from(mapa.values()).sort((a, b) => numero(b.volumes) - numero(a.volumes) || numero(b.ctes) - numero(a.ctes)).map((item) => {
    const pctVolume = totalVolumes ? (numero(item.volumes) / totalVolumes) * 100 : 0;
    const antes = acumulado;
    acumulado += pctVolume;
    const base = item.ctesGanhos + item.ctesPerdidos || item.ctes;
    return { ...item, pctVolume, pctAcumulado: acumulado, pareto80: antes < 80, aderencia: base ? (item.ctesGanhos / base) * 100 : 0, ajusteMedio: item.reducaoQtd ? item.reducaoSoma / item.reducaoQtd : 0 };
  }).filter((item) => item.pareto80);
}

`;
service = addBefore(service, 'export async function salvarResultadoSimulacaoNegociacao', helpers, 'helpers detalhes laudo service');
if (!service.includes('ctesDetalhesLaudo: resultado.ctesDetalhesLaudo')) {
  service = rep(service,
    "    pareto80Volume: resultado.pareto80Volume || null,",
    "    pareto80Volume: resultado.pareto80Volume || null,\n    ctesDetalhesLaudo: resultado.ctesDetalhesLaudo || montarCtesDetalhesLaudoServico(resultado),\n    paretoCidadesVolume: resultado.paretoCidadesVolume || montarParetoCidadesVolumeServico(resultado),",
    'salva ctesDetalhesLaudo e pareto'
  );
}
service = rep(service,
  "    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 500),",
  "    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 10000),",
  'aumenta limite faixas laudo'
);
save(servicePath, service, serviceOld, 'service salva detalhes individuais');

// 3) Utils do laudo: usa a base individual leve e prioriza nomeRotaCotacao.
const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
const utilOld = util;
util = rep(util,
  "    resumo.ctesDetalhes,\n    resumo.detalhes,",
  "    resumo.ctesDetalhesLaudo,\n    resumo.ctesDetalhes,\n    resumo.detalhes,",
  'extrairDetalhesResumo lê ctesDetalhesLaudo'
);
util = rep(util,
  "  const rota = texto(item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome);",
  "  const rota = texto(item.nomeRotaCotacao || item.cotacaoComercial || item.rotaCotacao || item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome);",
  'chaveRota prioriza cotação comercial'
);
util = rep(util,
  "      rota: texto(item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome) || chave,",
  "      rota: texto(item.nomeRotaCotacao || item.cotacaoComercial || item.rotaCotacao || item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome) || chave,",
  'agregarRegistro prioriza cotação comercial'
);
util = rep(util,
  "  const candidatos = [resumo.ctesDetalhes, resumo.detalhes, resumo.linhasDetalhe];",
  "  const candidatos = [resumo.paretoCidadesVolume, resumo.ctesDetalhesLaudo, resumo.ctesDetalhes, resumo.detalhes, resumo.linhasDetalhe];",
  'pareto lê dados salvos'
);
save(utilPath, util, utilOld, 'utils laudo lê detalhes individuais');

console.log(changed ? '4.16X aplicado.' : '4.16X sem alterações.');
