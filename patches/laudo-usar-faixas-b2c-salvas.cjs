const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/utils/laudosRodadasNegociacaoHtml.js');
let src = fs.readFileSync(file, 'utf8');
let changed = false;
function add(before, block, msg){
  if(src.includes(block.trim().split('\n')[0])){console.log('SKIP '+msg);return;}
  const i=src.indexOf(before); if(i<0){console.warn('WARN '+msg);return;}
  src=src.slice(0,i)+block+'\n'+src.slice(i); changed=true; console.log('OK '+msg);
}
function rep(a,b,msg){
  if(src.includes(a)){src=src.replace(a,b);changed=true;console.log('OK '+msg);return;}
  if(src.includes(b)){console.log('SKIP '+msg);return;}
  console.warn('WARN '+msg);
}

add('function classificarRecomendacao', `function obterAnaliseFaixasB2CSalva(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const lista = Array.isArray(resumo.analiseFaixasB2C) ? resumo.analiseFaixasB2C : [];
  return lista.map((item) => ({
    ...item,
    chave: item.chave || [item.origem, item.destino, item.ufDestino, item.rota || item.cotacao, item.faixa].filter(Boolean).join(' > '),
    rota: item.rota || item.cotacao || [item.origem, item.destino, item.ufDestino].filter(Boolean).join(' > '),
    ufDestino: item.ufDestino || item.uf_destino || item.uf || '-',
    ctesAnalisados: n(item.ctesAnalisados || item.ctes || item.qtd || 0),
    ctesGanhos: n(item.ctesGanhos || item.ctesGanhas || item.ganhas || 0),
    ctesPerdidos: n(item.ctesPerdidos || item.ctesPerdidas || item.perdidas || 0),
    faturamentoPotencial: n(item.faturamentoPotencial || 0),
    faturamentoCapturado: n(item.faturamentoCapturado || 0),
    faturamentoNaoCapturado: n(item.faturamentoNaoCapturado || 0),
    aderencia: n(item.aderencia || 0),
    ajusteMedio: n(item.ajusteMedio || item.reducaoMedia || 0),
    prioridade: item.prioridade || 'BAIXA',
  }));
}

`, 'leitor de analiseFaixasB2C salva');

rep(`  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparPorFaixaB2C)
    .filter((f) => f.chave !== 'Sem faixa' && (n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0))
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 20) : [];`, `  const faixasSalvasUltima = ultima ? obterAnaliseFaixasB2CSalva(ultima) : [];
  const faixasCriticas = faixasSalvasUltima.length
    ? faixasSalvasUltima
        .filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0)
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 20)
    : (primeira && ultima ? compararGenerico(primeira, ultima, agruparPorFaixaB2C)
        .filter((f) => f.chave !== 'Sem faixa' && (n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0))
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 20) : []);`, 'prioriza faixas salvas');

if(changed) fs.writeFileSync(file, src, 'utf8');
console.log(changed ? '4.16G laudo aplicado.' : '4.16G laudo sem alterações.');
