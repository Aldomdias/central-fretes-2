const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let src = fs.readFileSync(file, 'utf8');
let changed = false;
function rep(a, b, msg) {
  if (src.includes(a)) {
    src = src.replace(a, b);
    changed = true;
    console.log('OK ' + msg);
    return;
  }
  if (src.includes(b)) {
    console.log('SKIP ' + msg);
    return;
  }
  console.warn('WARN ' + msg);
}

rep(`  const candidatos = [
    item.rotaSelecionada,
    item.rotaCotacao,
    item.rotaVencedora,
    item.cotacao,
    item.cotacaoFinal,
    item.faixaCotacao,
    item.rota,
    item.nomeRota,
    item.todosResultados?.[0]?.rotaNome,
    item.selecionadaDetalhes?.frete?.faixaPeso,
    item.selecionadaDetalhes?.frete?.faixa_peso,
    item.vencedorDetalhes?.frete?.faixaPeso,
    item.vencedorDetalhes?.frete?.faixa_peso,
  ];
  const bruto = texto(candidatos.find((v) => texto(v))) || texto(item.destino || item.cidadeDestino || 'Destino');`, `  const candidatos = [
    item.faixaCotacaoSelecionada,
    item.selecionadaDetalhes?.frete?.faixaPeso,
    item.selecionadaDetalhes?.frete?.faixa_peso,
    item.selecionadaDetalhes?.frete?.faixa,
    item.selecionadaDetalhes?.frete?.nomeFaixa,
    item.vencedorDetalhes?.frete?.faixaPeso,
    item.vencedorDetalhes?.frete?.faixa_peso,
    item.cotacao,
    item.cotacaoFinal,
    item.faixaCotacao,
    item.rota,
    item.nomeRota,
    item.rotaCotacao,
    item.rotaSelecionada,
    item.rotaVencedora,
    item.todosResultados?.[0]?.rotaNome,
  ];
  const valores = candidatos.map((v) => texto(v)).filter(Boolean);
  const bruto = valores.find((v) => !String(v).toUpperCase().includes('IBGE')) || valores[0] || texto(item.destino || item.cidadeDestino || 'Destino');`, 'cotacao comercial antes de rota tecnica');

if (changed) fs.writeFileSync(file, src, 'utf8');
console.log(changed ? 'fix cotacao comercial aplicado.' : 'fix cotacao comercial sem alterações.');
