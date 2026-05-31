const fs = require('fs');
const c = fs.readFileSync('src/services/tabelasNegociacaoService.js', 'utf8');
const i = c.indexOf('async function excluirRodadaNegociacao');
console.log(c.slice(i, i + 1500));
