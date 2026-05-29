const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/utils/calculoFrete.js');
let src = fs.readFileSync(file, 'utf8');
const old = src;
if (!src.includes('nomeCotacao: rota?.__nomeCotacao')) {
  src = src.replace(/(\n\s*faixaPeso:\s*cotacao \?[^\n]+,)/, "$1\n      nomeCotacao: rota?.__nomeCotacao || cotacao?.rota || cotacao?.faixaCotacao || cotacao?.id || '',");
}
if (src !== old) fs.writeFileSync(file, src, 'utf8');
console.log(src !== old ? '4.16Z1 calculo aplicado.' : '4.16Z1 calculo sem alterações.');
