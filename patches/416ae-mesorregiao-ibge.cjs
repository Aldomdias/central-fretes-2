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
function replace(src, from, to, label) {
  if (src.includes(from)) {
    changed = true;
    console.log('OK ' + label);
    return src.replace(from, to);
  }
  if (src.includes(to)) console.log('SKIP ' + label);
  else console.warn('WARN ' + label);
  return src;
}

const pagePath = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let page = fs.readFileSync(pagePath, 'utf8');
const pageOld = page;

page = replace(page,
"    cte: row.numeroCte || row.chaveCte || '',",
"    cte: row.numeroCte || row.chaveCte || '',",
'noop referencia cte'
);

if (!page.includes('const municipioDestinoDetalhe = municipioPorIbge?.get?.(String(destino));')) {
  page = replace(page,
"    ctesDetalhes.push({\n      cte: row.numeroCte || row.chaveCte || '',",
"    const municipioDestinoDetalhe = municipioPorIbge?.get?.(String(destino));\n\n    ctesDetalhes.push({\n      cte: row.numeroCte || row.chaveCte || '',",
'inclui municipio destino detalhe'
  );
}

if (!page.includes('ibgeDestino: destino,')) {
  page = replace(page,
"      destino: row.cidadeDestino || vencedor?.cidadeDestino || '',\n      ufDestino: row.ufDestino || vencedor?.ufDestino || '',",
"      destino: row.cidadeDestino || vencedor?.cidadeDestino || municipioDestinoDetalhe?.cidade || '',\n      ufDestino: row.ufDestino || vencedor?.ufDestino || municipioDestinoDetalhe?.uf || '',\n      ibgeDestino: destino,\n      mesorregiaoDestino: municipioDestinoDetalhe?.mesorregiao || municipioDestinoDetalhe?.regiaoIntermediaria || '',",
'salva ibge e mesorregiao no detalhe'
  );
}

save(pagePath, page, pageOld, 'SimuladorPage mesorregiao');

const utilPath = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let util = fs.readFileSync(utilPath, 'utf8');
const utilOld = util;

util = replace(util,
"return texto(item.mesorregiaoDestino || item.mesorregiao || item.mesoRegiaoDestino || item.mesoRegiao || item.meso_regiao || item.microrregiao || item.regiaoDestino || item.regiao || 'Mesorregião não identificada');",
"return padraoComercialLaudo(item.mesorregiaoDestino || item.mesorregiao || item.mesoRegiaoDestino || item.mesoRegiao || item.meso_regiao || item.microrregiao || item.regiaoDestino || item.regiao || 'Mesorregião não identificada');",
'padroniza mesorregiao'
);

save(utilPath, util, utilOld, 'utils mesorregiao');

console.log(changed ? '4.16AE aplicado.' : '4.16AE sem alterações.');
