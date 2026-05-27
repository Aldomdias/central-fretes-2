const fs = require('fs');
const path = require('path');

const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
let changed = false;

function replaceAllRegex(regex, replacement, label) {
  const next = util.replace(regex, replacement);
  if (next !== util) {
    util = next;
    changed = true;
    console.log('OK ' + label);
  } else {
    console.log('SKIP ' + label);
  }
}

// A 4.16K já cria cidadesParetoVolume e a 4.16U pode inserir novamente.
replaceAllRegex(
  /(\n\s*const cidadesParetoVolume = ultima \? montarParetoCidadesVolume\(ultima\) : \[\];){2,}/g,
  '\n  const cidadesParetoVolume = ultima ? montarParetoCidadesVolume(ultima) : [];',
  'remove declaração duplicada de cidadesParetoVolume'
);

// Garante que a recomendação inteligente exista mesmo quando o bloco da 4.16U não é inserido
// porque a função montarParetoCidadesVolume já veio da 4.16K.
if (!util.includes('function recomendacaoPorAnalise')) {
  const fn = [
    'function recomendacaoPorAnalise({ faixasCriticas = [], cidadesParetoVolume = [], rotasCriticas = [] }) {',
    "  const topFaixas = (faixasCriticas || []).slice(0, 3).map((f) => [f.origem, f.ufDestino, f.rota || f.cotacao, f.faixa].filter(Boolean).join(' / '));",
    "  if (topFaixas.length) return 'Para a próxima rodada, recomendamos concentrar a revisão nas combinações de maior impacto: ' + topFaixas.join('; ') + '. Não é necessário alterar toda a tabela; o ganho de competitividade deve vir de ajustes direcionados nas rotas, cotações e faixas destacadas.';",
    "  const topCidades = (cidadesParetoVolume || []).slice(0, 3).map((c) => [c.cidade, c.ufDestino].filter(Boolean).join('/'));",
    "  if (topCidades.length) return 'Para a próxima rodada, recomendamos priorizar as cidades que concentram 80% do volume analisado: ' + topCidades.join('; ') + '. A revisão deve focar os pontos com maior perda de competitividade dentro desse bloco.';",
    '  return classificarRecomendacao({ atual: {} }, rotasCriticas || []);',
    '}',
    '',
  ].join('\n');
  const marker = 'function classificarRecomendacao';
  const idx = util.indexOf(marker);
  if (idx >= 0) {
    util = util.slice(0, idx) + fn + util.slice(idx);
    changed = true;
    console.log('OK adiciona recomendacaoPorAnalise ausente');
  } else {
    console.warn('WARN marcador classificarRecomendacao não encontrado');
  }
} else {
  console.log('SKIP recomendacaoPorAnalise já existe');
}

// Evita repetição de propriedade no objeto base, se os patches anteriores já tiverem inserido.
replaceAllRegex(
  /(\n\s*cidadesParetoVolume,){2,}/g,
  '\n    cidadesParetoVolume,',
  'remove propriedade cidadesParetoVolume duplicada'
);

if (changed) fs.writeFileSync(utilPath, util, 'utf8');
console.log(changed ? '4.16U dedupe aplicado.' : '4.16U dedupe sem alterações.');
