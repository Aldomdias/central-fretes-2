const fs = require('fs');
const path = require('path');
let changed = false;
function save(file, src, old, label) { if (src !== old) { fs.writeFileSync(file, src, 'utf8'); changed = true; console.log('OK ' + label); } else console.log('SKIP ' + label); }
function rep(src, from, to, label) { if (src.includes(from)) { changed = true; console.log('OK ' + label); return src.replace(from, to); } if (src.includes(to)) { console.log('SKIP ' + label); return src; } console.warn('WARN ' + label); return src; }
function addBefore(src, marker, block, label) { if (src.includes(block.trim().split('\n')[0])) { console.log('SKIP ' + label); return src; } const idx = src.indexOf(marker); if (idx < 0) { console.warn('WARN ' + label); return src; } changed = true; console.log('OK ' + label); return src.slice(0, idx) + block + '\n' + src.slice(idx); }

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let src = fs.readFileSync(compPath, 'utf8');
const old = src;

const helper = `function percentualPp(valor) {
  const v = Number(valor || 0);
  return `${v > 0 ? '+' : ''}${v.toFixed(2)} p.p.`;
}

function diagnosticoResumoTexto({ externo, poucaBase, atual, inicial }) {
  if (poucaBase) {
    return externo
      ? `Esta é a primeira rodada salva da análise. A proposta apresenta aderência atual de ${percentual(atual.aderencia)}, com ${numero(atual.ctesGanhos)} CT-es competitivos, ${numero(atual.volumesGanhos)} volumes competitivos e faturamento potencial capturado de ${dinheiro(atual.faturamentoMes)} por mês. As próximas seções mostram onde estão os maiores volumes e as oportunidades de ajuste.`
      : `Esta é a primeira rodada salva da análise. O cenário atual apresenta aderência de ${percentual(atual.aderencia)}, saving mensal de ${dinheiro(atual.savingMes)} e faturamento capturado de ${dinheiro(atual.faturamentoMes)} por mês.`;
  }
  return externo
    ? `A proposta saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência. Os CT-es competitivos passaram de ${numero(inicial.ctesGanhos)} para ${numero(atual.ctesGanhos)}. O objetivo da próxima rodada deve ser revisar os pontos de maior impacto listados abaixo.`
    : `A negociação saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência, com saving mensal de ${dinheiro(inicial.savingMes)} para ${dinheiro(atual.savingMes)} e faturamento capturado de ${dinheiro(inicial.faturamentoMes)} para ${dinheiro(atual.faturamentoMes)} por mês.`;
}

`;
src = addBefore(src, 'function prioridadeClasse', helper, 'helpers resumo e pp');

// Cards prometidos: competitividade + meta frete sobre NF + redução nas cargas perdidas.
src = rep(src,
`        <section className="laudo-rodadas-kpis">
          <div className="laudo-rodadas-kpi"><span>Aderência atual</span><strong>{percentual(atual.aderencia)}</strong><Variacao valor={comparativo.evolucaoAderencia} tipo="percentual" sufixo=" p.p." /></div>
          <div className="laudo-rodadas-kpi"><span>CT-es competitivos</span><strong>{numero(atual.ctesGanhos)}</strong><Variacao valor={comparativo.evolucaoCtesGanhos} /></div>
          <div className="laudo-rodadas-kpi"><span>Volumes competitivos</span><strong>{numero(atual.volumesGanhos)}</strong><Variacao valor={comparativo.evolucaoVolumes} /></div>
          <div className="laudo-rodadas-kpi"><span>Faturamento capturado/mês</span><strong>{dinheiro(atual.faturamentoMes)}</strong><Variacao valor={comparativo.evolucaoFaturamentoMes} tipo="dinheiro" /></div>
          {!externo ? <div className="laudo-rodadas-kpi"><span>Saving/mês</span><strong>{dinheiro(atual.savingMes)}</strong><Variacao valor={comparativo.evolucaoSavingMes} tipo="dinheiro" /></div> : null}
          <div className="laudo-rodadas-kpi"><span>Ajuste médio necessário</span><strong>{percentual(atual.reducaoMedia)}</strong><small>Inicial: {percentual(inicial.reducaoMedia)}</small></div>
        </section>`,
`        <section className="laudo-rodadas-kpis">
          <div className="laudo-rodadas-kpi"><span>Aderência da proposta</span><strong>{percentual(atual.aderencia)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoAderencia} tipo="percentual" sufixo=" p.p." /> : <small>Diagnóstico atual</small>}</div>
          <div className="laudo-rodadas-kpi"><span>CT-es que a proposta captura</span><strong>{numero(atual.ctesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoCtesGanhos} /> : <small>Base competitiva</small>}</div>
          <div className="laudo-rodadas-kpi"><span>Volumes que a proposta captura</span><strong>{numero(atual.volumesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoVolumes} /> : <small>Volume competitivo</small>}</div>
          <div className="laudo-rodadas-kpi"><span>Faturamento potencial capturado/mês</span><strong>{dinheiro(atual.faturamentoMes)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoFaturamentoMes} tipo="dinheiro" /> : <small>Estimativa mensal</small>}</div>
          {!externo ? <div className="laudo-rodadas-kpi"><span>Saving/mês</span><strong>{dinheiro(atual.savingMes)}</strong><Variacao valor={comparativo.evolucaoSavingMes} tipo="dinheiro" /></div> : null}
          <div className="laudo-rodadas-kpi"><span>Frete atual sobre NF</span><strong>{percentual(atual.percentualFreteReal)}</strong><small>Base realizada</small></div>
          <div className="laudo-rodadas-kpi"><span>Frete da proposta sobre NF</span><strong>{percentual(atual.percentualFreteTabela)}</strong><small>Tabela simulada</small></div>
          <div className="laudo-rodadas-kpi"><span>Redução sobre NF</span><strong>{percentualPp((atual.percentualFreteTabela || 0) - (atual.percentualFreteReal || 0))}</strong><small>Meta frete/NF</small></div>
          <div className="laudo-rodadas-kpi"><span>Redução média para capturar volume perdido</span><strong>{percentual(atual.reducaoMedia)}</strong><small>Cargas ainda não competitivas</small></div>
        </section>`,
'cards prometidos'
);

src = rep(src,
`             {externo
               ? `A proposta saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência. Os CT-es competitivos passaram de ${numero(inicial.ctesGanhos)} para ${numero(atual.ctesGanhos)}. O objetivo da próxima rodada deve ser revisar os pontos de maior impacto listados abaixo.`
               : `A negociação saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência, com saving mensal de ${dinheiro(inicial.savingMes)} para ${dinheiro(atual.savingMes)} e faturamento capturado de ${dinheiro(inicial.faturamentoMes)} para ${dinheiro(atual.faturamentoMes)} por mês.`}`, 
`             {diagnosticoResumoTexto({ externo, poucaBase, atual, inicial })}`,
'resumo diagnostico no componente'
);

// Remove onde ainda precisa melhorar e texto pronto para copiar no layout principal.
src = src.replace(/\n\s*<section className="laudo-rodadas-section">\s*<h2>\{externo \? 'Onde ainda precisa melhorar' : 'Rotas\/Cotações prioritárias'\}<\/h2>[\s\S]*?<TabelaRotas linhas=\{\(laudo\.rotasCriticas \|\| laudo\.ondeAjustar \|\| \[\]\)\.slice\(0, 12\)\} \/>\s*<\/section>/, '');
src = src.replace(/\n\s*<section className="laudo-rodadas-section">\s*<h2>Texto pronto para copiar<\/h2>[\s\S]*?<\/section>/, '');

// Onde melhorou só aparece com duas ou mais rodadas.
src = rep(src,
`        <section className="laudo-rodadas-section">
          <h2>{externo ? 'Onde a proposta melhorou' : 'Rotas/Cotações que evoluíram'}</h2>
          <TabelaMelhorias linhas={(laudo.rotasMelhoraram || laudo.ondeMelhorou || []).slice(0, 10)} />
        </section>`,
`        {!poucaBase ? (
          <section className="laudo-rodadas-section">
            <h2>{externo ? 'Onde a proposta melhorou' : 'Rotas/Cotações que evoluíram'}</h2>
            <TabelaMelhorias linhas={(laudo.rotasMelhoraram || laudo.ondeMelhorou || []).slice(0, 10)} />
          </section>
        ) : null}`,
'oculta melhoria uma rodada'
);

// Seções antigas: renomeia UF, remove faixas prioritárias antiga caso permaneça.
src = rep(src, 'titulo="UFs destino prioritárias"', 'titulo="Visão por Estado/UF"', 'titulo estado');
src = src.replace(/\n\s*<TabelaSimples titulo="Faixas de peso prioritárias" linhas=\{\(laudo\.faixasCriticas \|\| laudo\.faixasPrioritarias \|\| \[\]\)\.slice\(0, 8\)\} tipo="faixa" \/>/, '');

save(compPath, src, old, 'template cards prometidos');
console.log(changed ? '4.16AD3 aplicado.' : '4.16AD3 sem alterações.');
