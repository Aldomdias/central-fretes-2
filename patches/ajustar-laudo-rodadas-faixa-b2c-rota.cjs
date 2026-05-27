const fs = require('fs');
const path = require('path');

let changed = false;
function replaceOnce(src, from, to, label) {
  if (src.includes(from)) {
    console.log('OK ' + label);
    changed = true;
    return src.replace(from, to);
  }
  if (src.includes(to)) {
    console.log('SKIP ' + label);
    return src;
  }
  console.warn('WARN ' + label);
  return src;
}

const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');

const oldGetFaixa = `function getFaixa(item = {}) {
  const direta = texto(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa || item.faixa_peso_padrao);
  if (direta) return direta;
  const ini = n(item.pesoInicial || item.peso_inicial);
  const fim = n(item.pesoFinal || item.peso_final);
  if (ini || fim) return \`${'${numero(ini)}'} a ${'${fim ? numero(fim) : +}'} kg\`;
  const peso = n(item.peso || item.pesoDeclarado || item.peso_final_calculado);
  if (!peso) return 'Sem faixa';
  if (peso <= 20) return '0 a 20 kg';
  if (peso <= 50) return '21 a 50 kg';
  if (peso <= 100) return '51 a 100 kg';
  if (peso <= 300) return '101 a 300 kg';
  if (peso <= 500) return '301 a 500 kg';
  return 'Acima de 500 kg';
}`;

const newGetFaixa = `const FAIXAS_B2C_OFICIAIS = [
  { min: 0, max: 2, label: '0 a 2 kg' },
  { min: 2, max: 5, label: '2 a 5 kg' },
  { min: 5, max: 10, label: '5 a 10 kg' },
  { min: 10, max: 20, label: '10 a 20 kg' },
  { min: 20, max: 30, label: '20 a 30 kg' },
  { min: 30, max: 50, label: '30 a 50 kg' },
  { min: 50, max: 70, label: '50 a 70 kg' },
  { min: 70, max: 100, label: '70 a 100 kg' },
  { min: 100, max: Infinity, label: 'Acima de 100 kg' },
];

function normalizarFaixaB2C(valor) {
  const raw = texto(valor);
  if (!raw) return '';
  const s = raw.toLowerCase().replace(',', '.');
  if (s.includes('acima') || s.includes('+')) {
    const nums = s.match(/\d+(?:\.\d+)?/g) || [];
    const base = nums.length ? Number(nums[0]) : 100;
    if (base >= 100) return 'Acima de 100 kg';
  }
  const nums = s.match(/\d+(?:\.\d+)?/g) || [];
  if (nums.length >= 2) {
    const ini = Number(nums[0]);
    const fim = Number(nums[1]);
    const achou = FAIXAS_B2C_OFICIAIS.find((f) => Number.isFinite(f.max) && Math.abs(f.min - ini) < 0.01 && Math.abs(f.max - fim) < 0.01);
    if (achou) return achou.label;
  }
  return raw;
}

function pesoIndividualCte(item = {}) {
  return n(
    item.pesoRealizado || item.peso_realizado || item.pesoCte || item.peso_cte || item.pesoCobrado || item.peso_cobrado ||
    item.pesoCubado || item.peso_cubado || item.pesoTaxado || item.peso_taxado || item.pesoDeclarado || item.peso_declarado ||
    item.peso_final_calculado || item.pesoFinalCalculado || item.peso
  );
}

function getFaixa(item = {}) {
  const direta = normalizarFaixaB2C(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa || item.faixa_peso_padrao);
  if (direta) return direta;
  const peso = pesoIndividualCte(item);
  if (!peso) return 'Sem faixa';
  const faixa = FAIXAS_B2C_OFICIAIS.find((f) => peso > f.min && peso <= f.max) || FAIXAS_B2C_OFICIAIS[0];
  return faixa.label;
}

function chaveRotaFaixaB2C(item = {}) {
  const faixa = getFaixa(item);
  if (!faixa || faixa === 'Sem faixa') return 'Sem faixa';
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem);
  const destino = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.ufDestino || item.uf_destino);
  const ufDestino = getUfDestino(item);
  const rota = texto(item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome);
  const rotaBase = [origem || 'Origem', destino || ufDestino || 'Destino', rota].filter(Boolean).join(' > ');
  return rotaBase + ' | ' + faixa;
}`;

util = replaceOnce(util, oldGetFaixa, newGetFaixa, 'grade oficial B2C e chave rota+faixa');

const oldExtrair = `function extrairDetalhesResumo(resumo = {}) {
  const candidatos = [
    resumo.ctesDetalhes,
    resumo.detalhes,
    resumo.linhasDetalhe,
    resumo.rotas,
    resumo.rotasPerdidasDestaque,
    resumo.rotasGanhasDestaque,
  ];
  return candidatos.reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, []);
}`;
const newExtrair = `function extrairDetalhesResumo(resumo = {}) {
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

function extrairDetalhesFaixaB2C(resumo = {}) {
  const candidatos = [
    resumo.ctesDetalhes,
    resumo.detalhes,
    resumo.linhasDetalhe,
  ];
  return candidatos
    .reduce((acc, lista) => Array.isArray(lista) ? acc.concat(lista) : acc, [])
    .filter((item) => getFaixa(item) !== 'Sem faixa');
}`;
util = replaceOnce(util, oldExtrair, newExtrair, 'detalhes individuais para faixa B2C');

const oldAgrupar = `function agruparDetalhes(simulacao, agrupador) {
  const resumo = getResumoRodada(simulacao);
  const ind = getIndicadoresRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  const mapa = new Map();`;
const newAgrupar = `function agruparDetalhes(simulacao, agrupador, opcoes = {}) {
  const resumo = getResumoRodada(simulacao);
  const ind = getIndicadoresRodada(simulacao);
  const detalhes = opcoes.somenteFaixaB2C ? extrairDetalhesFaixaB2C(resumo) : extrairDetalhesResumo(resumo);
  const mapa = new Map();`;
util = replaceOnce(util, oldAgrupar, newAgrupar, 'agrupar detalhes com opção faixa B2C');

const oldFaixas = `  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, getFaixa))
    .filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];`;
const newFaixas = `  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, (sim) => agruparDetalhes(sim, chaveRotaFaixaB2C, { somenteFaixaB2C: true }))
    .filter((f) => f.chave !== 'Sem faixa' && (n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0))
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 20) : [];`;
util = replaceOnce(util, oldFaixas, newFaixas, 'faixas prioritárias por rota/cotação + faixa B2C');

fs.writeFileSync(utilPath, util, 'utf8');

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
comp = comp.replace("<th>{tipo === 'faixa' ? 'Faixa de peso' : 'UF destino'}</th>", "<th>{tipo === 'faixa' ? 'Rota/Cotação + faixa' : 'UF destino'}</th>");
comp = comp.replace("<td><strong>{tipo === 'faixa' ? (item.faixa || item.rota || item.chave) : (item.ufDestino || item.rota || item.chave)}</strong></td>", `<td>{tipo === 'faixa' ? (
                  <>
                    <strong>{item.rota || item.chave || '-'}</strong>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{item.faixa || '-'}</div>
                    {item.origem || item.destino ? <div style={{ color: '#94a3b8', fontSize: 11 }}>{[item.origem, item.destino].filter(Boolean).join(' > ')}</div> : null}
                  </>
                ) : (
                  <strong>{item.ufDestino || item.rota || item.chave}</strong>
                )}</td>`);
fs.writeFileSync(compPath, comp, 'utf8');
console.log('4.16D aplicado: análise de faixas B2C por rota/cotação.');
