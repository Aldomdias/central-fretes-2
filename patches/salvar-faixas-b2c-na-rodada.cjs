const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

function add(before, block, msg) {
  if (src.includes(block.trim().split('\n')[0])) { console.log('SKIP ' + msg); return; }
  const i = src.indexOf(before);
  if (i < 0) { console.warn('WARN ' + msg); return; }
  src = src.slice(0, i) + block + '\n' + src.slice(i);
  changed = true;
  console.log('OK ' + msg);
}
function rep(a,b,msg){
  if(src.includes(a)){src=src.replace(a,b);changed=true;console.log('OK '+msg);return;}
  if(src.includes(b)){console.log('SKIP '+msg);return;}
  console.warn('WARN '+msg);
}

add('// ─────────────────────────────────────────────────────────────────────────────\nexport async function salvarResultadoSimulacaoNegociacao', `function faixaB2CLaudoServico(peso) {
  const p = numero(peso);
  if (!p) return '';
  if (p <= 2) return '0 a 2 kg';
  if (p <= 5) return '2 a 5 kg';
  if (p <= 10) return '5 a 10 kg';
  if (p <= 20) return '10 a 20 kg';
  if (p <= 30) return '20 a 30 kg';
  if (p <= 50) return '30 a 50 kg';
  if (p <= 70) return '50 a 70 kg';
  if (p <= 100) return '70 a 100 kg';
  return 'Acima de 100 kg';
}

function pesoFaixaLaudoServico(item = {}) {
  return numero(item.pesoConsiderado || item.peso || item.pesoDeclarado || item.pesoRealizado || item.pesoCubado || item.selecionadaDetalhes?.frete?.pesoConsiderado || item.vencedorDetalhes?.frete?.pesoConsiderado || item.todosResultados?.[0]?.detalhes?.frete?.pesoConsiderado);
}

function cotacaoLaudoServico(item = {}) {
  return texto(item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.rota || item.nomeRota || item.selecionadaDetalhes?.frete?.faixa_peso || item.selecionadaDetalhes?.frete?.faixa || item.vencedorDetalhes?.frete?.faixa_peso || item.todosResultados?.[0]?.detalhes?.frete?.faixa_peso || item.destino || item.cidadeDestino || 'Destino');
}

function montarAnaliseFaixasB2CLaudoServico(resultado = {}) {
  const detalhes = Array.isArray(resultado.ctesDetalhes) ? resultado.ctesDetalhes : [];
  const mapa = new Map();
  detalhes.forEach((item) => {
    const peso = pesoFaixaLaudoServico(item);
    const faixa = faixaB2CLaudoServico(peso);
    if (!faixa) return;
    const origem = texto(item.origem || item.cidadeOrigem || resultado.filtros?.origem || 'Origem');
    const destino = texto(item.destino || item.cidadeDestino || 'Destino');
    const ufDestino = upper(item.ufDestino || item.uf || item.estadoDestino || '');
    const rota = cotacaoLaudoServico(item);
    const chave = [origem, destino, ufDestino, rota, faixa].map(upper).join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, destino, ufDestino, rota, cotacao: rota, faixa, ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, pesoTotal: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    const acc = mapa.get(chave);
    const status = upper(item.statusSelecionada);
    const ganhou = status === 'GANHARIA' || item.ganhouRealizado === true || numero(item.savingSelecionada) > 0;
    const perdeu = status === 'PERDERIA' || (!ganhou && numero(item.freteSelecionada) > 0);
    acc.ctesAnalisados += 1;
    if (ganhou) acc.ctesGanhos += 1;
    if (perdeu) acc.ctesPerdidos += 1;
    acc.volumes += numero(item.volumes || item.qtdVolumes);
    acc.pesoTotal += peso;
    acc.faturamentoPotencial += numero(item.freteRealizado);
    if (ganhou) acc.faturamentoCapturado += numero(item.freteRealizado);
    if (perdeu) acc.faturamentoNaoCapturado += numero(item.freteRealizado);
    if (perdeu && numero(item.reducaoNecessaria)) { acc.reducaoSoma += numero(item.reducaoNecessaria); acc.reducaoQtd += 1; }
  });
  return Array.from(mapa.values()).map((x) => {
    const base = x.ctesGanhos + x.ctesPerdidos || x.ctesAnalisados;
    const aderencia = base ? (x.ctesGanhos / base) * 100 : 0;
    const ajusteMedio = x.reducaoQtd ? x.reducaoSoma / x.reducaoQtd : 0;
    let prioridade = 'BAIXA';
    if (x.faturamentoNaoCapturado >= 50000 || x.ctesPerdidos >= 100 || ajusteMedio >= 15) prioridade = 'ALTA';
    else if (x.faturamentoNaoCapturado >= 15000 || x.ctesPerdidos >= 30 || ajusteMedio >= 8) prioridade = 'MÉDIA';
    return { ...x, aderencia, ajusteMedio, prioridade };
  }).sort((a,b) => numero(b.faturamentoNaoCapturado) - numero(a.faturamentoNaoCapturado) || numero(b.ctesPerdidos) - numero(a.ctesPerdidos));
}
`, 'helpers analise faixas b2c');

rep(`    laudos: resultado.laudos || null,
    pareto80Volume: resultado.pareto80Volume || null,`, `    laudos: resultado.laudos || null,
    pareto80Volume: resultado.pareto80Volume || null,
    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 500),`, 'grava analiseFaixasB2C');

if(changed) fs.writeFileSync(file, src, 'utf8');
console.log(changed ? '4.16G service aplicado.' : '4.16G service sem alterações.');
