const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let src = fs.readFileSync(file, 'utf8');
const old = src;
if (!src.includes('nomeRota: itemSelecionada?.detalhes?.frete?.nomeCotacao')) {
  src = src.replace(
    "      ganhouRealizado: freteSel > 0 && valorCte > 0 && freteSel < valorCte,",
    "      ganhouRealizado: freteSel > 0 && valorCte > 0 && freteSel < valorCte,\n      nomeRota: itemSelecionada?.detalhes?.frete?.nomeCotacao || itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.rotaNome || '',\n      faixaPeso: itemSelecionada?.detalhes?.frete?.faixaPeso || '',"
  );
}
if (src !== old) fs.writeFileSync(file, src, 'utf8');
console.log(src !== old ? '4.16Z2 simulador aplicado.' : '4.16Z2 simulador sem alterações.');
