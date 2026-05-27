const fs = require('fs');
const path = require('path');
let changed = false;
function rep(src, a, b, msg){
  if(src.includes(a)){changed=true;console.log('OK '+msg);return src.replace(a,b);}
  if(src.includes(b)){console.log('SKIP '+msg);return src;}
  console.warn('WARN '+msg);return src;
}
function addBefore(src, marker, block, msg){
  if(src.includes(block.trim().split('\n')[0])){console.log('SKIP '+msg);return src;}
  const i=src.indexOf(marker); if(i<0){console.warn('WARN '+msg);return src;}
  changed=true;console.log('OK '+msg);return src.slice(0,i)+block+'\n'+src.slice(i);
}
function save(file, src, old, msg){ if(src!==old){fs.writeFileSync(file,src,'utf8');changed=true;console.log('OK '+msg);} }

const utilPath = path.join(process.cwd(),'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath,'utf8');
const utilOld = util;
const paretoFn = `function montarParetoCidadesVolume(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const candidatos = [resumo.ctesDetalhes, resumo.detalhes, resumo.linhasDetalhe];
  const detalhes = candidatos.reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, []);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const cidade = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.municipioDestino || item.municipio_destino);
    const uf = getUfDestino(item);
    if (!cidade && (!uf || uf === '-')) return;
    const chave = [cidade || 'Destino', uf || '-'].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, cidade: cidade || 'Destino', ufDestino: uf || '-', ctes: 0, volumes: 0, peso: 0, freteRealizado: 0, valorNF: 0 });
    const acc = mapa.get(chave);
    const qtd = n(item.ctes || item.qtd || item.qtdCtes || 1) || 1;
    const vols = n(item.volumes || item.qtdVolumes || item.volumesTotal || item.volume) || qtd;
    acc.ctes += qtd;
    acc.volumes += vols;
    acc.peso += n(item.peso || item.pesoRealizado || item.pesoDeclarado || item.pesoCubado);
    acc.freteRealizado += n(item.freteRealizado || item.valorCte || item.valorCTe || item.faturamentoPotencial);
    acc.valorNF += n(item.valorNF || item.valor_nf);
  });
  const totalVolumes = Array.from(mapa.values()).reduce((s, i) => s + n(i.volumes), 0);
  let acumulado = 0;
  const lista = Array.from(mapa.values())
    .sort((a, b) => n(b.volumes) - n(a.volumes) || n(b.ctes) - n(a.ctes))
    .map((item) => {
      const pctVolume = totalVolumes ? (n(item.volumes) / totalVolumes) * 100 : 0;
      const acumuladoAntes = acumulado;
      acumulado += pctVolume;
      return { ...item, pctVolume, pctAcumulado: acumulado, pareto80: acumuladoAntes < 80 };
    });
  const pareto = lista.filter((item) => item.pareto80);
  return pareto.length ? pareto : lista.slice(0, 10);
}

`;
util = addBefore(util, 'function classificarRecomendacao', paretoFn, 'função pareto cidades volume');
util = rep(util, `  const primeira = simulacoes[0] || null;
  const ultima = simulacoes[simulacoes.length - 1] || primeira;`, `  const primeira = simulacoes[0] || null;
  const ultima = simulacoes[simulacoes.length - 1] || primeira;
  const cidadesParetoVolume = ultima ? montarParetoCidadesVolume(ultima) : [];`, 'calcula pareto da ultima rodada');
util = rep(util, `    faixasCriticas,`, `    faixasCriticas,
    cidadesParetoVolume,`, 'inclui pareto no laudo');
save(utilPath, util, utilOld, 'utils pareto cidades');

const compPath = path.join(process.cwd(),'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath,'utf8');
const compOld = comp;
const excelFn = `function paretoCidadesExcel(linhas = []) {
  return linhas.map((item, idx) => ({
    Posicao: idx + 1,
    Cidade: item.cidade || '',
    UF_Destino: item.ufDestino || '',
    CTEs: item.ctes || 0,
    Volumes: item.volumes || 0,
    Percentual_Volume: item.pctVolume || 0,
    Percentual_Acumulado: item.pctAcumulado || 0,
    Frete_Realizado: item.freteRealizado || 0,
    Valor_NF: item.valorNF || 0,
  }));
}

`;
comp = addBefore(comp, 'function exportarExcel', excelFn, 'excel pareto cidades');
comp = rep(comp, `  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.ufsCriticas || laudo.ufsPrioritarias || [])), 'UFs Prioritarias');`, `  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(oportunidadesExcel(laudo.ufsCriticas || laudo.ufsPrioritarias || [])), 'UFs Prioritarias');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paretoCidadesExcel(laudo.cidadesParetoVolume || [])), 'Pareto Cidades');`, 'aba excel pareto cidades');
const tableFn = `function TabelaParetoCidades({ linhas = [] }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>Pareto 80% das cidades por volume total</h2>
      <p>Cidades que concentram aproximadamente 80% do volume total da última rodada analisada, independentemente de ganho ou perda.</p>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Cidade destino</th><th>UF</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">Frete realizado</th></tr></thead>
          <tbody>{linhas.map((item) => (<tr key={item.chave || item.cidade}><td><strong>{item.cidade || '-'}</strong></td><td>{item.ufDestino || '-'}</td><td className="right">{numero(item.ctes)}</td><td className="right">{numero(item.volumes)}</td><td className="right">{percentual(item.pctVolume)}</td><td className="right">{percentual(item.pctAcumulado)}</td><td className="right">{dinheiro(item.freteRealizado)}</td></tr>))}{!linhas.length ? <tr><td colSpan="7">Sem base individual suficiente para calcular o Pareto de cidades.</td></tr> : null}</tbody>
        </table>
      </div>
    </section>
  );
}

`;
comp = addBefore(comp, 'function TabelaSimples', tableFn, 'componente pareto cidades');
comp = rep(comp, `        <TabelaSimples titulo="Visão por Estado/UF" linhas={(laudo.ufsCriticas || laudo.ufsPrioritarias || []).slice(0, 8)} tipo="uf" />`, `        <TabelaParetoCidades linhas={(laudo.cidadesParetoVolume || []).slice(0, 20)} />
        <TabelaSimples titulo="Visão por Estado/UF" linhas={(laudo.ufsCriticas || laudo.ufsPrioritarias || []).slice(0, 8)} tipo="uf" />`, 'insere pareto antes UF renomeada');
comp = rep(comp, `        <TabelaSimples titulo="UFs destino prioritárias" linhas={(laudo.ufsCriticas || laudo.ufsPrioritarias || []).slice(0, 8)} tipo="uf" />`, `        <TabelaParetoCidades linhas={(laudo.cidadesParetoVolume || []).slice(0, 20)} />
        <TabelaSimples titulo="UFs destino prioritárias" linhas={(laudo.ufsCriticas || laudo.ufsPrioritarias || []).slice(0, 8)} tipo="uf" />`, 'insere pareto antes UF antiga');
save(compPath, comp, compOld, 'componente pareto cidades');
console.log(changed ? '4.16K aplicado.' : '4.16K sem alterações.');
