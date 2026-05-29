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

// Garante que o resumo salvo da rodada carregue a base de NF e percentuais de frete.
// Esses campos já nascem no SimuladorPage dentro de ctesDetalhes; aqui só preservamos no service.
const servicePath = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let service = fs.readFileSync(servicePath, 'utf8');
const serviceOld = service;

if (!service.includes('valorNF: item.valorNF')) {
  service = rep(service,
    "      peso: item.peso || 0,",
    "      peso: item.peso || 0,\n      valorNF: item.valorNF || item.valorNf || item.valor_nf || item.valorNota || item.nf || 0,\n      percentualFreteRealizado: item.percentualFreteRealizado || 0,\n      percentualFreteSelecionada: item.percentualFreteSelecionada || 0,\n      percentualFreteVencedor: item.percentualFreteVencedor || 0,",
    'preserva valorNF e percentuais no resumo'
  );
}

save(servicePath, service, serviceOld, 'service metricas NF');
console.log(changed ? '4.16AD1 aplicado.' : '4.16AD1 sem alterações.');
