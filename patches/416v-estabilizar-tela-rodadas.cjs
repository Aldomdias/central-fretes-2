const fs = require('fs');
const path = require('path');
let changed = false;

function write(file, src, old, label) {
  if (src !== old) {
    fs.writeFileSync(file, src, 'utf8');
    changed = true;
    console.log('OK ' + label);
  } else {
    console.log('SKIP ' + label);
  }
}

function dedupeConst(src, nome) {
  const linha = `const ${nome} = ultima ? montarParetoCidadesVolume(ultima) : [];`;
  const re = new RegExp(`(\\n\\s*${linha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}){2,}`, 'g');
  return src.replace(re, `\n  ${linha}`);
}

// 1) Evita que duplicidades dos patches de laudo quebrem o bundle.
const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
const utilOld = util;
util = dedupeConst(util, 'cidadesParetoVolume');
util = util.replace(/(\n\s*cidadesParetoVolume,){2,}/g, '\n    cidadesParetoVolume,');
write(utilPath, util, utilOld, 'dedupe util laudo');

// 2) Proteção na tela: se o laudo quebrar, mostra erro no card em vez de deixar a página branca.
const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
const compOld = comp;

// Garante helper de padronização uma única vez.
comp = comp.replace(/function nomePadrao\(v\) \{[\s\S]*?\n\}\n\nfunction nomePadrao\(v\) \{/g, 'function nomePadrao(v) {');
if (!comp.includes('function nomePadrao(v)')) {
  comp = comp.replace(
    'function prioridadeClasse(valor) {',
    `function nomePadrao(v) {\n  return String(v || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().trim();\n}\n\nfunction prioridadeClasse(valor) {`
  );
}

if (!comp.includes('function montarLaudoSeguro')) {
  comp = comp.replace(
    'export default function LaudoRodadasNegociacaoTemplate({ tabela, tipo = \'transportador\', onClose }) {',
    `function montarLaudoSeguro(tabela, tipo) {\n  try {\n    return montarLaudosRodadasNegociacao(tabela)?.[tipo] || null;\n  } catch (error) {\n    console.error('Erro ao montar laudo de rodadas:', error);\n    return {\n      titulo: 'Laudo de Rodadas',\n      erroMontagem: error?.message || 'Erro ao montar laudo.',\n      transportadora: tabela?.transportadora || tabela?.resumo_simulacao?.transportadora || '',\n      evolucaoRodadas: [],\n      comparativo: { inicial: {}, atual: {} },\n      rotasCriticas: [],\n      rotasMelhoraram: [],\n      ufsCriticas: [],\n      faixasCriticas: [],\n      cidadesParetoVolume: [],\n      recomendacao: 'Não foi possível montar o laudo desta rodada. Gere uma nova simulação ou revise os dados salvos.',\n    };\n  }\n}\n\nexport default function LaudoRodadasNegociacaoTemplate({ tabela, tipo = 'transportador', onClose }) {`
  );
}

comp = comp.replace(
  /const laudos = montarLaudosRodadasNegociacao\(tabela \|\| \{\}\);\s*const laudo = laudos\[tipo\] \|\| laudos\.transportador;/,
  `const laudo = montarLaudoSeguro(tabela || {}, tipo);`
);
comp = comp.replace(
  /const laudos = montarLaudosRodadasNegociacao\(tabela\);\s*const laudo = laudos\[tipo\] \|\| laudos\.transportador;/,
  `const laudo = montarLaudoSeguro(tabela || {}, tipo);`
);

// Se houver retorno principal, insere card de erro logo após o header quando necessário.
if (!comp.includes('laudo.erroMontagem')) {
  comp = comp.replace(
    '<section className="laudo-rodadas-section">\n          <h2>Resumo da evolução</h2>',
    `{laudo.erroMontagem ? (\n          <section className="laudo-rodadas-section">\n            <h2>Erro ao montar laudo</h2>\n            <p>{laudo.erroMontagem}</p>\n          </section>\n        ) : null}\n\n        <section className="laudo-rodadas-section">\n          <h2>Resumo da evolução</h2>`
  );
}

write(compPath, comp, compOld, 'componente laudo seguro');

console.log(changed ? '4.16V aplicado.' : '4.16V sem alterações.');
