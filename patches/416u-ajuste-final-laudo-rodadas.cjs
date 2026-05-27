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
  if (src.includes(from)) { changed = true; console.log('OK ' + label); return src.replace(from, to); }
  if (src.includes(to)) { console.log('SKIP ' + label); return src; }
  console.warn('WARN ' + label); return src;
}
function addBefore(src, marker, block, label) {
  if (src.includes(block.trim().split('\n')[0])) { console.log('SKIP ' + label); return src; }
  const i = src.indexOf(marker);
  if (i < 0) { console.warn('WARN ' + label); return src; }
  changed = true; console.log('OK ' + label);
  return src.slice(0, i) + block + '\n' + src.slice(i);
}
function replaceRange(src, startMarker, endMarker, block, label) {
  const s = src.indexOf(startMarker);
  const e = s >= 0 ? src.indexOf(endMarker, s) : -1;
  if (s >= 0 && e > s) { changed = true; console.log('OK ' + label); return src.slice(0, s) + block + '\n\n' + src.slice(e); }
  console.warn('WARN ' + label); return src;
}

// 1) Motor: não altera cálculo, apenas preserva o nome comercial da cotação/rota no detalhe.
const calcPath = path.join(process.cwd(), 'src/utils/calculoFrete.js');
let calc = fs.readFileSync(calcPath, 'utf8');
const calcOld = calc;
calc = rep(calc,
`      tipoCalculo: calculo.tipoCalculo,
      faixaPeso: cotacao ? \`${toNumber(cotacao.pesoMin)} até ${cotacao.pesoMax ?? cotacao.pesoLimite ?? 'sem limite'}\` : 'Sem cotação',`,
`      tipoCalculo: calculo.tipoCalculo,
      rotaCotacao: cotacao?.rota || rota?.nomeRota || '',
      cotacaoComercial: cotacao?.rota || rota?.nomeRota || '',
      faixaPeso: cotacao ? \`${toNumber(cotacao.pesoMin)} até ${cotacao.pesoMax ?? cotacao.pesoLimite ?? 'sem limite'}\` : 'Sem cotação',`,
'preserva rota comercial no detalhe do frete');
save(calcPath, calc, calcOld, 'calculoFrete');

// 2) Simulador: leva a rota comercial para cada CT-e detalhado salvo na rodada.
const simPath = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let sim = fs.readFileSync(simPath, 'utf8');
const simOld = sim;
sim = rep(sim,
`      canal,
      transportadoraReal: row.transportadora || '',`,
`      canal,
      rotaCotacao: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.rotaNome || '',
      rotaSelecionada: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.rotaNome || '',
      rotaVencedora: vencedor?.detalhes?.frete?.rotaCotacao || vencedor?.rotaNome || '',
      faixaCotacaoSelecionada: itemSelecionada?.detalhes?.frete?.faixaPeso || '',
      transportadoraReal: row.transportadora || '',`,
'rota comercial no cteDetalhes original');
sim = rep(sim,
`      canal,
      rotaSelecionada: itemSelecionada?.rotaNome || '',
      rotaCotacao: itemSelecionada?.detalhes?.frete?.faixaPeso || itemSelecionada?.detalhes?.frete?.faixa_peso || itemSelecionada?.detalhes?.frete?.faixa || itemSelecionada?.detalhes?.frete?.nomeFaixa || itemSelecionada?.rotaNome || vencedor?.rotaNome || '',
      rotaVencedora: vencedor?.rotaNome || '',
      faixaCotacaoSelecionada: itemSelecionada?.detalhes?.frete?.faixaPeso || itemSelecionada?.detalhes?.frete?.faixa_peso || itemSelecionada?.detalhes?.frete?.faixa || itemSelecionada?.detalhes?.frete?.nomeFaixa || '',
      transportadoraReal: row.transportadora || '',`,
`      canal,
      rotaCotacao: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.rotaNome || '',
      rotaSelecionada: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.rotaNome || '',
      rotaVencedora: vencedor?.detalhes?.frete?.rotaCotacao || vencedor?.rotaNome || '',
      faixaCotacaoSelecionada: itemSelecionada?.detalhes?.frete?.faixaPeso || '',
      transportadoraReal: row.transportadora || '',`,
'corrige rota comercial no cteDetalhes já patchado');
sim = rep(sim,
`      todosResultados: resultado.slice(0, 8).map((r) => ({
        transportadora: r.transportadora,
        total: r.total,
        ranking: r.ranking,
        origem: r.origem,
        detalhes: r.detalhes || null,
      })),`,
`      todosResultados: resultado.slice(0, 8).map((r) => ({
        transportadora: r.transportadora,
        total: r.total,
        ranking: r.ranking,
        origem: r.origem,
        rotaNome: r.detalhes?.frete?.rotaCotacao || r.rotaNome || '',
        detalhes: r.detalhes || null,
      })),`,
'rota comercial em todosResultados');
save(simPath, sim, simOld, 'SimuladorPage');

// 3) Service: gera faixas por origem + UF + rota comercial + faixa e salva Pareto de cidades.
const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let service = fs.readFileSync(servicePath, 'utf8');
const serviceOld = service;
const cotacaoFn = `function cotacaoLaudoServico(item = {}) {
  const candidatos = [
    item.rotaCotacao,
    item.rotaSelecionada,
    item.cotacaoComercial,
    item.selecionadaDetalhes?.frete?.rotaCotacao,
    item.selecionadaDetalhes?.frete?.cotacaoComercial,
    item.vencedorDetalhes?.frete?.rotaCotacao,
    item.cotacao,
    item.cotacaoFinal,
    item.faixaCotacao,
    item.rota,
    item.nomeRota,
    item.todosResultados?.[0]?.rotaNome,
  ].map((v) => texto(v)).filter(Boolean);
  const invalida = (v) => {
    const s = String(v || '').toUpperCase();
    if (!s) return true;
    if (s.includes('IBGE')) return true;
    if (/^\\d+[.,]?\\d*\\s*(ATE|ATÉ|A)\\s*\\d+[.,]?\\d*/i.test(s)) return true;
    if (/^ACIMA DE\\s*\\d+/i.test(s)) return true;
    return false;
  };
  const bruto = candidatos.find((v) => !invalida(v)) || candidatos[0] || texto(item.destino || item.cidadeDestino || 'Destino');
  const partes = bruto.split('|').map((p) => texto(p)).filter(Boolean);
  const base = partes[0] || bruto;
  return base.replace(/ [0-9][0-9.,]* *A *[0-9][0-9.,]* *KG.*$/i, '').trim() || base;
}`;
service = replaceRange(service, 'function cotacaoLaudoServico', 'function montarAnaliseFaixasB2CLaudoServico', cotacaoFn, 'cotação comercial sem IBGE/peso');
const paretoService = `function montarParetoCidadesVolumeServico(resultado = {}) {
  const detalhes = Array.isArray(resultado.ctesDetalhes) ? resultado.ctesDetalhes : [];
  const mapa = new Map();
  detalhes.forEach((item) => {
    const cidade = texto(item.destino || item.cidadeDestino || 'Destino');
    const ufDestino = upper(item.ufDestino || item.uf || item.estadoDestino || '');
    const chave = [upper(cidade), ufDestino].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, cidade, ufDestino, ctes: 0, volumes: 0, ctesGanhos: 0, ctesPerdidos: 0, freteRealizado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    const acc = mapa.get(chave);
    const status = upper(item.statusSelecionada);
    const ganhou = status === 'GANHARIA' || item.ganhouRealizado === true || numero(item.savingSelecionada) > 0;
    const perdeu = status === 'PERDERIA' || (!ganhou && numero(item.freteSelecionada) > 0);
    const vols = numero(item.volumes || item.qtdVolumes || 1) || 1;
    acc.ctes += 1;
    acc.volumes += vols;
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
    const acumuladoAntes = acumulado;
    acumulado += pctVolume;
    const base = item.ctesGanhos + item.ctesPerdidos || item.ctes;
    const aderencia = base ? (item.ctesGanhos / base) * 100 : 0;
    const ajusteMedio = item.reducaoQtd ? item.reducaoSoma / item.reducaoQtd : 0;
    return { ...item, pctVolume, pctAcumulado: acumulado, pareto80: acumuladoAntes < 80, aderencia, ajusteMedio };
  }).filter((item) => item.pareto80);
}

`;
service = addBefore(service, 'export async function salvarResultadoSimulacaoNegociacao', paretoService, 'helper pareto cidades no service');
service = rep(service,
`    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 500),`,
`    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 10000),
    paretoCidadesVolume: resultado.paretoCidadesVolume || montarParetoCidadesVolumeServico(resultado),`,
'salva faixas completas e pareto');
service = rep(service,
`    pareto80Volume: resultado.pareto80Volume || null,`,
`    pareto80Volume: resultado.pareto80Volume || null,
    paretoCidadesVolume: resultado.paretoCidadesVolume || montarParetoCidadesVolumeServico(resultado),`,
'insere pareto se patch anterior não achou faixas');
save(servicePath, service, serviceOld, 'service laudo');

// 4) Utils: Pareto vem salvo; recomendação usa Pareto + faixas.
const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
const utilOld = util;
const paretoUtils = `function montarParetoCidadesVolume(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const salvo = Array.isArray(resumo.paretoCidadesVolume) ? resumo.paretoCidadesVolume : [];
  if (salvo.length) return salvo;
  return [];
}

function recomendacaoPorAnalise({ faixasCriticas = [], cidadesParetoVolume = [], rotasCriticas = [] }) {
  const topFaixas = (faixasCriticas || []).slice(0, 3).map((f) => [f.origem, f.ufDestino, f.rota || f.cotacao, f.faixa].filter(Boolean).join(' / '));
  if (topFaixas.length) return 'Para a próxima rodada, recomendamos concentrar a revisão nas combinações de maior impacto: ' + topFaixas.join('; ') + '. Não é necessário alterar toda a tabela; o ganho de competitividade deve vir de ajustes direcionados nas rotas, cotações e faixas destacadas.';
  const topCidades = (cidadesParetoVolume || []).slice(0, 3).map((c) => [c.cidade, c.ufDestino].filter(Boolean).join('/'));
  if (topCidades.length) return 'Para a próxima rodada, recomendamos priorizar as cidades que concentram 80% do volume analisado: ' + topCidades.join('; ') + '. A revisão deve focar os pontos com maior perda de competitividade dentro desse bloco.';
  return classificarRecomendacao({ atual: {} }, rotasCriticas || []);
}

`;
util = addBefore(util, 'function classificarRecomendacao', paretoUtils, 'utils pareto salvo e recomendação');
util = rep(util,
`  const primeira = simulacoes[0] || null;
  const ultima = simulacoes[simulacoes.length - 1] || primeira;`,
`  const primeira = simulacoes[0] || null;
  const ultima = simulacoes[simulacoes.length - 1] || primeira;
  const cidadesParetoVolume = ultima ? montarParetoCidadesVolume(ultima) : [];`,
'calcula pareto no laudo');
util = rep(util,
`  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);
  const recomendacaoTransp = recomendacaoTransportador(rotasCriticas, rotasMelhoraram);`,
`  const recomendacaoExecutivo = recomendacaoPorAnalise({ faixasCriticas, cidadesParetoVolume, rotasCriticas });
  const recomendacaoTransp = recomendacaoPorAnalise({ faixasCriticas, cidadesParetoVolume, rotasCriticas });`,
'recomendação por faixas e pareto');
util = rep(util, `    faixasCriticas,`, `    faixasCriticas,
    cidadesParetoVolume,`, 'base inclui pareto cidades');
save(utilPath, util, utilOld, 'utils laudo');

// 5) Componente: Pareto vira primeira visão, remove duplicações e mostra faixas completas.
const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
const compOld = comp;
const padrao = `function nomePadrao(v) {
  return String(v || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().trim();
}

`;
comp = addBefore(comp, 'function prioridadeClasse', padrao, 'padronização nomes');
const tabelaPareto = `function TabelaParetoCidades({ linhas = [] }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>Pareto 80% das cidades por volume total</h2>
      <p>Cidades de destino que concentram aproximadamente 80% do volume total da última rodada analisada, com leitura de ganho, perda e oportunidade.</p>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Cidade destino</th><th>UF</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">CT-es ganhos</th><th className="right">CT-es perdidos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th></tr></thead>
          <tbody>{linhas.map((item) => (<tr key={item.chave || item.cidade}><td><strong>{nomePadrao(item.cidade) || '-'}</strong></td><td>{nomePadrao(item.ufDestino) || '-'}</td><td className="right">{numero(item.ctes)}</td><td className="right">{numero(item.volumes)}</td><td className="right">{percentual(item.pctVolume)}</td><td className="right">{percentual(item.pctAcumulado)}</td><td className="right">{numero(item.ctesGanhos)}</td><td className="right">{numero(item.ctesPerdidos)}</td><td className="right">{percentual(item.aderencia)}</td><td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td></tr>))}{!linhas.length ? <tr><td colSpan="10">Sem base suficiente para calcular o Pareto de cidades.</td></tr> : null}</tbody>
        </table>
      </div>
    </section>
  );
}

`;
comp = replaceRange(comp, 'function TabelaParetoCidades', 'function TabelaSimples', tabelaPareto, 'substitui tabela pareto');
comp = addBefore(comp, 'function TabelaSimples', tabelaPareto, 'adiciona tabela pareto se faltava');
const tabelaFaixas = `function TabelaFaixas({ titulo, linhas = [] }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>{titulo}</h2>
      <p>Combinações completas por origem, UF destino, cotação/rota comercial e faixa de peso. Esta mesma base sai completa no Excel.</p>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Origem</th><th>UF destino</th><th>Cotação/Rota</th><th>Faixa</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>
          <tbody>{linhas.map((item) => (<tr key={item.chave || [item.origem, item.ufDestino, item.rota, item.faixa].filter(Boolean).join('-')}><td>{nomePadrao(item.origem) || '-'}</td><td>{nomePadrao(item.ufDestino) || '-'}</td><td><strong>{nomePadrao(item.rota || item.cotacao) || '-'}</strong></td><td><strong>{item.faixa || '-'}</strong></td><td className="right">{numero(item.ctesPerdidos)}</td><td className="right">{numero(item.ctesGanhos)}</td><td className="right">{percentual(item.aderencia)}</td><td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td><td className="right">{percentual(item.ajusteMedio)}</td><td><span className={'laudo-rodadas-badge ' + prioridadeClasse(item.prioridade)}>{item.prioridade || 'BAIXA'}</span></td></tr>))}{!linhas.length ? <tr><td colSpan="10">Sem leitura suficiente por faixa neste recorte.</td></tr> : null}</tbody>
        </table>
      </div>
    </section>
  );
}

`;
comp = replaceRange(comp, 'function TabelaFaixas', 'function TabelaSimples', tabelaFaixas, 'substitui tabela faixas');
comp = addBefore(comp, 'function TabelaSimples', tabelaFaixas, 'adiciona tabela faixas se faltava');
comp = comp.replace(/\s*<section className="laudo-rodadas-section">\s*<h2>\{externo \? 'Onde ainda precisa melhorar'[\s\S]*?<\/section>/, `\n        <TabelaParetoCidades linhas={(laudo.cidadesParetoVolume || []).slice(0, 50)} />`);
comp = comp.replace(/\s*<section className="laudo-rodadas-section">\s*<h2>Visão por cotação\/rota[\s\S]*?<\/section>/g, '');
comp = comp.replace(/\s*<section className="laudo-rodadas-section">\s*<h2>Visão por destino\/cidade[\s\S]*?<\/section>/g, '');
comp = comp.replace(/\s*<TabelaParetoCidades linhas=\{\(laudo\.cidadesParetoVolume \|\| \[\]\)\.slice\(0, 20\)\} \/>/g, '');
comp = comp.replace(/<TabelaSimples titulo="Faixas de peso prioritárias" linhas=\{\(laudo\.faixasCriticas \|\| laudo\.faixasPrioritarias \|\| \[\]\)\.slice\(0, 8\)\} tipo="faixa" \/>/g, '<TabelaFaixas titulo="Faixas por cotação/rota" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || [])} />');
comp = comp.replace(/<TabelaFaixas titulo="Faixas por cotação\/rota" linhas=\{\(laudo\.faixasCriticas \|\| laudo\.faixasPrioritarias \|\| \[\]\)\.slice\(0, 20\)\} \/>/g, '<TabelaFaixas titulo="Faixas por cotação/rota" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || [])} />');
comp = rep(comp,
`  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.faixasCriticas || laudo.faixasPrioritarias || [])), 'Faixas Prioritarias');`,
`  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.faixasCriticas || laudo.faixasPrioritarias || [])), 'Faixas Cotacao Rota');`,
'excel nome aba faixas completas');
save(compPath, comp, compOld, 'componente laudo');

console.log(changed ? '4.16U aplicado.' : '4.16U sem alterações.');
