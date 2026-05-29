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

function ensureAfter(src, marker, block, label) {
  if (src.includes(block.trim().split('\n')[0])) return src;
  const idx = src.indexOf(marker);
  if (idx < 0) {
    console.warn('WARN ' + label);
    return src;
  }
  changed = true;
  console.log('OK ' + label);
  return src.slice(0, idx + marker.length) + '\n\n' + block + src.slice(idx + marker.length);
}

function replaceSection(src, titlePattern, block, label) {
  const rx = new RegExp('\\n\\s*(?:\\{mesorregioesReais\\.length \\? \\(\\s*)?<section className="laudo-rodadas-section">\\s*<h2>' + titlePattern + '<\\/h2>[\\s\\S]*?<\\/section>\\s*(?:\\) : null\\})?', 'g');
  const next = src.replace(rx, '\n' + block);
  if (next !== src) {
    changed = true;
    console.log('OK ' + label);
  } else {
    console.log('SKIP ' + label);
  }
  return next;
}

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
const compOld = comp;

comp = comp.replace(/\{\!poucaBase \? \(\s*\{\!poucaBase \? \(/g, '{!poucaBase ? (');
comp = comp.replace(/\) : null\}\s*\) : null\}/g, ') : null}');

comp = ensureAfter(comp, "function percentualPp(valor) {\n  const v = Number(valor || 0);\n  return (v > 0 ? '+' : '') + v.toFixed(2) + ' p.p.';\n}", `function mesorregiaoReal(valor) {
  const texto = String(valor || '').trim().toLowerCase();
  return texto && !texto.includes('não identificada') && !texto.includes('nao identificada');
}
`, 'helper mesorregiao real');

if (!comp.includes('const mesorregioesReais = (laudo.mesorregiaoFaixas || [])')) {
  comp = comp.replace(
    '  const poucaBase = Number(laudo.quantidadeSimulacoes || 0) < 2;\n  const tipoArquivo = externo ?',
    '  const poucaBase = Number(laudo.quantidadeSimulacoes || 0) < 2;\n  const mesorregioesReais = (laudo.mesorregiaoFaixas || []).filter((item) => mesorregiaoReal(item.mesorregiao || item.rota));\n  const tipoArquivo = externo ?'
  );
}

if (!comp.includes('const poucaBase = Number(laudo.quantidadeSimulacoes || 0) < 2;\n  const mesorregioesReais = (laudo.mesorregiaoFaixas || [])')) {
  comp = comp.replace(
    'function exportarExcel(laudo = {}, externo) {\n  const wb = XLSX.utils.book_new();',
    'function exportarExcel(laudo = {}, externo) {\n  const poucaBase = Number(laudo.quantidadeSimulacoes || 0) < 2;\n  const mesorregioesReais = (laudo.mesorregiaoFaixas || []).filter((item) => mesorregiaoReal(item.mesorregiao || item.rota));\n  const wb = XLSX.utils.book_new();'
  );
}

comp = comp.replace(
  "  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.rotasMelhoraram || laudo.ondeMelhorou || [])), 'Rotas Melhoraram');",
  "  if (!poucaBase) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.rotasMelhoraram || laudo.ondeMelhorou || [])), 'Rotas Melhoraram');"
);
comp = comp.replace(
  "  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.faixasCriticas || laudo.faixasPrioritarias || [])), 'Faixas Prioritarias');",
  "  if (mesorregioesReais.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(mesorregioesReais)), 'Mesorregiao Faixa');\n  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.paretoCidades || [])), 'Pareto Cidades');\n  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.destinoFaixaPareto || [])), 'Pareto Destino Faixa');"
);
comp = comp.replace(
  /(\n\s*XLSX\.utils\.book_append_sheet\(wb, XLSX\.utils\.json_to_sheet\(paretoCidadesExcel\(laudo\.cidadesParetoVolume \|\| \[\]\)\), 'Pareto Cidades'\);)(?:\s*\n\s*XLSX\.utils\.book_append_sheet\(wb, XLSX\.utils\.json_to_sheet\(paretoCidadesExcel\(laudo\.cidadesParetoVolume \|\| \[\]\)\), 'Pareto Cidades'\);)+/g,
  '$1'
);
comp = comp.replace(
  /\n\s*XLSX\.utils\.book_append_sheet\(wb, XLSX\.utils\.json_to_sheet\(oportunidadesExcel\(laudo\.paretoCidades \|\| \[\]\)\), 'Pareto Cidades'\);/g,
  ''
);
comp = comp.replace(
  /(\n\s*<TabelaParetoCidades linhas=\{\(laudo\.cidadesParetoVolume \|\| \[\]\)\.slice\(0, 20\)\} \/>)(?:\s*\n\s*<TabelaParetoCidades linhas=\{\(laudo\.cidadesParetoVolume \|\| \[\]\)\.slice\(0, 20\)\} \/>)+/g,
  '$1'
);

comp = comp.replace(/\n\s*<section className="laudo-rodadas-section">\s*<h2>\{externo \? 'Onde ainda precisa melhorar' : 'Rotas\/Cotações prioritárias'\}<\/h2>[\s\S]*?<\/section>/g, '');
comp = replaceSection(comp, 'Texto pronto para copiar', '', 'remove texto copiar');
comp = replaceSection(comp, 'Faixas de peso prioritárias', '', 'remove faixas antigas');

const mesoBlock = `        {mesorregioesReais.length ? (
        <section className="laudo-rodadas-section">
          <h2>Mesorregião x Faixa</h2>
          <p>Agrupamento regional por mesorregião do IBGE e faixa de peso, para direcionar ajustes sem depender do nome comercial da cotação.</p>
          <div className="laudo-rodadas-table-wrap">
            <table className="laudo-rodadas-table">
              <thead><tr><th>Origem</th><th>UF destino</th><th>Mesorregião</th><th>Faixa</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>
              <tbody>
                {mesorregioesReais.slice(0, 25).map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.origem || '-'}</td>
                    <td>{item.ufDestino || '-'}</td>
                    <td><strong>{item.mesorregiao || item.rota || '-'}</strong></td>
                    <td>{item.faixa || '-'}</td>
                    <td className="right">{numero(item.ctesPerdidos)}</td>
                    <td className="right">{numero(item.ctesGanhos)}</td>
                    <td className="right">{percentual(item.aderencia)}</td>
                    <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                    <td className="right">{percentual(item.ajusteMedio)}</td>
                    <td><span className={\`laudo-rodadas-badge \${prioridadeClasse(item.prioridade)}\`}>{item.prioridade || 'BAIXA'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        ) : null}`;
comp = replaceSection(comp, 'Mesorregi(?:ão|Ã£o) x Faixa', mesoBlock, 'mesorregiao condicional');

save(compPath, comp, compOld, 'template laudo final');

const pagePath = path.join(process.cwd(), 'src/pages/TabelasNegociacaoPage.jsx');
let page = fs.readFileSync(pagePath, 'utf8');
const pageOld = page;
page = page.replace(
  /(\n\s*const \[tipoLaudoRodadas, setTipoLaudoRodadas\] = useState\('transportador'\);)(?:\s*\n\s*const \[tipoLaudoRodadas, setTipoLaudoRodadas\] = useState\('transportador'\);)+/g,
  '$1'
);
save(pagePath, page, pageOld, 'dedupe estado laudo rodadas');

const simPath = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let sim = fs.readFileSync(simPath, 'utf8');
const simOld = sim;
sim = sim.replace(
  /(\n\s*const \[baseRealizadoPesquisada, setBaseRealizadoPesquisada\] = useState\(null\);\s*\n\s*const \[resumoPesquisaRealizado, setResumoPesquisaRealizado\] = useState\(null\);\s*\n\s*const \[pesquisandoRealizado, setPesquisandoRealizado\] = useState\(false\);\s*\n\s*const \[filtrosPesquisaRealizado, setFiltrosPesquisaRealizado\] = useState\(''\);)(?:\s*\n\s*const \[baseRealizadoPesquisada, setBaseRealizadoPesquisada\] = useState\(null\);\s*\n\s*const \[resumoPesquisaRealizado, setResumoPesquisaRealizado\] = useState\(null\);\s*\n\s*const \[pesquisandoRealizado, setPesquisandoRealizado\] = useState\(false\);\s*\n\s*const \[filtrosPesquisaRealizado, setFiltrosPesquisaRealizado\] = useState\(''\);)+/g,
  '$1'
);
const recalcularMarker = '\n  const recalcularRealizadoComMesmaBase = async () => {';
const firstRecalc = sim.indexOf(recalcularMarker);
const secondRecalc = firstRecalc >= 0 ? sim.indexOf(recalcularMarker, firstRecalc + recalcularMarker.length) : -1;
if (secondRecalc >= 0) {
  const afterSecond = sim.indexOf('\n  const onPesquisarRealizado', secondRecalc);
  if (afterSecond >= 0) {
    sim = sim.slice(0, secondRecalc) + sim.slice(afterSecond);
  }
}
save(simPath, sim, simOld, 'dedupe simulador pesquisa/recalculo');

const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let service = fs.readFileSync(servicePath, 'utf8');
const serviceOld = service;
const helperFaixaMarker = '\nfunction formatarLimiteFaixaServico(valor) {';
const firstHelperFaixa = service.indexOf(helperFaixaMarker);
const secondHelperFaixa = firstHelperFaixa >= 0 ? service.indexOf(helperFaixaMarker, firstHelperFaixa + helperFaixaMarker.length) : -1;
if (secondHelperFaixa >= 0) {
  const afterDuplicateHelpers = service.indexOf('\nexport async function salvarResultadoSimulacaoNegociacao', secondHelperFaixa);
  if (afterDuplicateHelpers >= 0) {
    service = service.slice(0, secondHelperFaixa) + service.slice(afterDuplicateHelpers);
  }
}
save(servicePath, service, serviceOld, 'dedupe helpers faixa service');

const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
const utilOld = util;

util = util.replace(
  '  const mesorregiaoFaixas = ultima ? agruparMesorregiaoFaixa(ultima) : [];',
  "  const mesorregiaoFaixas = ultima ? agruparMesorregiaoFaixa(ultima).filter((item) => {\n    const meso = String(item.mesorregiao || item.rota || '').toLowerCase();\n    return meso && !meso.includes('não identificada') && !meso.includes('nao identificada');\n  }) : [];"
);
util = util.replace(
  /(\n  const destinoFaixaPareto = ultima \? montarParetoDestinoFaixa\(ultima\) : \[\];\n)\s*const mesorregiaoFaixas = ultima \? agruparMesorregiaoFaixa\(ultima\)\.filter\(\(item\) => \{[\s\S]*?\n  \}\) : \[\];\n/g,
  '$1'
);
const mesoDeclMarker = '\n  const mesorregiaoFaixas = ultima ? agruparMesorregiaoFaixa(ultima).filter((item) => {';
const firstMesoDecl = util.indexOf(mesoDeclMarker);
const secondMesoDecl = firstMesoDecl >= 0 ? util.indexOf(mesoDeclMarker, firstMesoDecl + mesoDeclMarker.length) : -1;
if (secondMesoDecl >= 0) {
  const endSecondMeso = util.indexOf('\n\n  const recomendacaoExecutivo', secondMesoDecl);
  if (endSecondMeso >= 0) {
    util = util.slice(0, secondMesoDecl) + util.slice(endSecondMeso);
  }
}
const faixaB2CMarker = '\nconst FAIXAS_B2C_OFICIAIS = [';
const firstFaixaB2C = util.indexOf(faixaB2CMarker);
const secondFaixaB2C = firstFaixaB2C >= 0 ? util.indexOf(faixaB2CMarker, firstFaixaB2C + faixaB2CMarker.length) : -1;
if (secondFaixaB2C >= 0) {
  const afterDuplicateB2C = util.indexOf('\nfunction getFaixa', secondFaixaB2C);
  if (afterDuplicateB2C >= 0) {
    util = util.slice(0, secondFaixaB2C) + util.slice(afterDuplicateB2C);
  }
}
util = util.replace(
  /(\n\s*const cidadesParetoVolume = ultima \? montarParetoCidadesVolume\(ultima\) : \[\];)(?:\s*\n\s*const cidadesParetoVolume = ultima \? montarParetoCidadesVolume\(ultima\) : \[\];)+/g,
  '$1'
);
util = util.replace(
  /(\n\s*if \(quantidadeRodadas < 2\) \{\s*\n\s*return `Esta é a primeira rodada salva da análise\.[\s\S]*?\n\s*\})(?:\s*\n\s*if \(quantidadeRodadas < 2\) \{\s*\n\s*return `Esta é a primeira rodada salva da análise\.[\s\S]*?\n\s*\})+/g,
  '$1'
);
['mesorregiaoFaixas', 'destinoFaixaPareto', 'cidadesParetoVolume'].forEach((nome) => {
  const rx = new RegExp('(\\n\\s*' + nome + ',)(?:\\s*\\n\\s*' + nome + ',)+', 'g');
  util = util.replace(rx, '$1');
});

const relatorioTransportador = `function montarRelatorioTransportador({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, destinoFaixaPareto = [], paretoCidades = [], recomendacao }) {
  const t = tabela || {};
  const poucaBase = evolucaoRodadas.length < 2;
  const linhas = [
    \`DEVOLUTIVA GERAL DAS RODADAS - \${t.transportadora || 'Transportadora'}\`,
    \`Canal: \${t.canal || '-'}\`,
    \`Origem: \${t.origem || '-'}\`,
    \`Rodadas avaliadas: \${evolucaoRodadas.length}\`,
    '',
    poucaBase ? 'DIAGNÓSTICO INICIAL' : 'RESUMO DA EVOLUÇÃO',
    poucaBase
      ? \`Esta é a primeira rodada salva da análise. A proposta apresenta aderência atual de \${percentual(comparativo.atual.aderencia)}, com \${numero(comparativo.atual.ctesGanhos)} CT-es competitivos, \${numero(comparativo.atual.volumesGanhos)} volumes competitivos e faturamento potencial capturado de \${dinheiro(comparativo.atual.faturamentoMes)} por mês. As próximas seções mostram onde estão os maiores volumes e as oportunidades de ajuste.\`
      : \`A proposta saiu de \${percentual(comparativo.inicial.aderencia)} para \${percentual(comparativo.atual.aderencia)} de aderência no recorte analisado.\`,
    \`Hoje o frete representa \${percentual(comparativo.atual.percentualFreteReal)} das notas. Com a proposta, passaria para \${percentual(comparativo.atual.percentualFreteTabela)}. Redução: \${Number(comparativo.atual.reducaoPpFreteNf || 0).toFixed(2)} p.p.\`,
    '',
    'EVOLUÇÃO DAS RODADAS',
    ...evolucaoRodadas.map((r) => \`- \${r.rodada}ª rodada (\${dataBR(r.criadoEm)}): aderência \${percentual(r.aderencia)}, CT-es competitivos \${numero(r.ctesGanhos)}, volumes \${numero(r.volumesGanhos)}, faturamento \${dinheiro(r.faturamentoMes)}/mês.\`),
  ];

  if (!poucaBase) {
    linhas.push('', 'ONDE A PROPOSTA MELHOROU');
    linhas.push(...(rotasMelhoraram.length ? rotasMelhoraram.slice(0, 8).map((r) => \`- \${r.rota}: evolução de \${numero(r.evolucaoCtes)} CT-es competitivos.\`) : ['- Ainda não há melhoria destacada por rota/cotação.']));
  }

  linhas.push(
    '',
    'VISÃO POR ESTADO/UF',
    ...(ufsCriticas.length ? ufsCriticas.slice(0, 8).map((u) => \`- \${u.rota || u.ufDestino}: \${numero(u.ctesPerdidos)} CT-es a revisar, aderência atual \${percentual(u.aderencia)}.\`) : ['- Sem leitura suficiente por UF.']),
    '',
    'PARETO 80% DAS CIDADES POR VOLUME TOTAL',
    ...(paretoCidades.length ? paretoCidades.slice(0, 8).map((p) => \`- \${p.cidade || '-'} / \${p.ufDestino || '-'}: \${numero(p.volumes)} volumes, \${percentual(p.pctAcumulado)} acumulado.\`) : ['- Sem leitura suficiente para Pareto de cidades.']),
    '',
    'PARETO 80% - DESTINO X FAIXA',
    ...(destinoFaixaPareto.length ? destinoFaixaPareto.slice(0, 10).map((p) => \`- \${p.rotaDestino || p.rota || p.chave}: faixa \${p.faixa || '-'}, \${numero(p.volumes)} volumes, aderência \${percentual(p.aderencia)}.\`) : ['- Sem leitura suficiente por destino e faixa.']),
    '',
    'DIRECIONAL FINAL',
    recomendacao
  );
  return resumoTexto(linhas);
}

`;
util = util.replace(/function montarRelatorioTransportador\([\s\S]*?\n}\n\nexport function montarLaudosRodadasNegociacao/, relatorioTransportador + 'export function montarLaudosRodadasNegociacao');
util = util.replace(
  'const relatorioTransportador = montarRelatorioTransportador({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, faixasCriticas, recomendacao: recomendacaoTransp });',
  'const relatorioTransportador = montarRelatorioTransportador({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, destinoFaixaPareto, paretoCidades, recomendacao: recomendacaoTransp });'
);

save(utilPath, util, utilOld, 'utils laudo final');
console.log(changed ? '4.16AF aplicado.' : '4.16AF sem alterações.');
