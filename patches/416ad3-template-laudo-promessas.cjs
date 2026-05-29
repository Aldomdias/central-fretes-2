const fs = require('fs');
const path = require('path');
let changed = false;

const file = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let s = fs.readFileSync(file, 'utf8');
const old = s;

function sub(rx, val, label) {
  if (rx.test(s)) {
    s = s.replace(rx, val);
    changed = true;
    console.log('OK ' + label);
  } else {
    console.log('SKIP ' + label);
  }
}

function insertBefore(marker, block, label) {
  if (s.includes(block.split('\n')[0])) {
    console.log('SKIP ' + label);
    return;
  }
  const idx = s.indexOf(marker);
  if (idx >= 0) {
    s = s.slice(0, idx) + block + '\n' + s.slice(idx);
    changed = true;
    console.log('OK ' + label);
  } else {
    console.warn('WARN ' + label);
  }
}

const helper = [
  'function percentualPp(valor) {',
  '  const v = Number(valor || 0);',
  "  return (v > 0 ? '+' : '') + v.toFixed(2) + ' p.p.';",
  '}',
  '',
  'function diagnosticoResumoTexto({ externo, poucaBase, atual, inicial }) {',
  '  if (poucaBase) {',
  '    return externo',
  "      ? 'Esta é a primeira rodada salva da análise. A proposta apresenta aderência atual de ' + percentual(atual.aderencia) + ', com ' + numero(atual.ctesGanhos) + ' CT-es competitivos, ' + numero(atual.volumesGanhos) + ' volumes competitivos e faturamento potencial capturado de ' + dinheiro(atual.faturamentoMes) + ' por mês. As próximas seções mostram onde estão os maiores volumes e as oportunidades de ajuste.'",
  "      : 'Esta é a primeira rodada salva da análise. O cenário atual apresenta aderência de ' + percentual(atual.aderencia) + ', saving mensal de ' + dinheiro(atual.savingMes) + ' e faturamento capturado de ' + dinheiro(atual.faturamentoMes) + ' por mês.';",
  '  }',
  '  return externo',
  "    ? 'A proposta saiu de ' + percentual(inicial.aderencia) + ' para ' + percentual(atual.aderencia) + ' de aderência. Os CT-es competitivos passaram de ' + numero(inicial.ctesGanhos) + ' para ' + numero(atual.ctesGanhos) + '. O objetivo da próxima rodada deve ser revisar os pontos de maior impacto listados abaixo.'",
  "    : 'A negociação saiu de ' + percentual(inicial.aderencia) + ' para ' + percentual(atual.aderencia) + ' de aderência, com saving mensal de ' + dinheiro(inicial.savingMes) + ' para ' + dinheiro(atual.savingMes) + ' e faturamento capturado de ' + dinheiro(inicial.faturamentoMes) + ' para ' + dinheiro(atual.faturamentoMes) + ' por mês.';",
  '}',
  ''
].join('\n');
insertBefore('function prioridadeClasse', helper, 'helpers');

const kpis = [
  '        <section className="laudo-rodadas-kpis">',
  '          <div className="laudo-rodadas-kpi"><span>Aderência da proposta</span><strong>{percentual(atual.aderencia)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoAderencia} tipo="percentual" sufixo=" p.p." /> : <small>Diagnóstico atual</small>}</div>',
  '          <div className="laudo-rodadas-kpi"><span>CT-es que a proposta captura</span><strong>{numero(atual.ctesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoCtesGanhos} /> : <small>Base competitiva</small>}</div>',
  '          <div className="laudo-rodadas-kpi"><span>Volumes que a proposta captura</span><strong>{numero(atual.volumesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoVolumes} /> : <small>Volume competitivo</small>}</div>',
  '          <div className="laudo-rodadas-kpi"><span>Faturamento potencial capturado/mês</span><strong>{dinheiro(atual.faturamentoMes)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoFaturamentoMes} tipo="dinheiro" /> : <small>Estimativa mensal</small>}</div>',
  '          {!externo ? <div className="laudo-rodadas-kpi"><span>Saving/mês</span><strong>{dinheiro(atual.savingMes)}</strong><Variacao valor={comparativo.evolucaoSavingMes} tipo="dinheiro" /></div> : null}',
  '          <div className="laudo-rodadas-kpi"><span>Frete atual sobre NF</span><strong>{percentual(atual.percentualFreteReal)}</strong><small>Base realizada</small></div>',
  '          <div className="laudo-rodadas-kpi"><span>Frete da proposta sobre NF</span><strong>{percentual(atual.percentualFreteTabela)}</strong><small>Tabela simulada</small></div>',
  '          <div className="laudo-rodadas-kpi"><span>Redução sobre NF</span><strong>{percentualPp((atual.percentualFreteTabela || 0) - (atual.percentualFreteReal || 0))}</strong><small>Meta frete/NF</small></div>',
  '          <div className="laudo-rodadas-kpi"><span>Redução média para capturar volume perdido</span><strong>{percentual(atual.reducaoMedia)}</strong><small>Cargas ainda não competitivas</small></div>',
  '        </section>'
].join('\n');
sub(/\n\s*<section className="laudo-rodadas-kpis">[\s\S]*?<\/section>/, '\n' + kpis, 'kpis');

const resumo = [
  '        <section className="laudo-rodadas-section">',
  '          <h2>{poucaBase ? \'Diagnóstico inicial\' : \'Resumo da evolução\'}</h2>',
  '          <p>{diagnosticoResumoTexto({ externo, poucaBase, atual, inicial })}</p>',
  '        </section>'
].join('\n');
sub(/\n\s*<section className="laudo-rodadas-section">\s*<h2>Resumo da evolução<\/h2>[\s\S]*?<\/section>/, '\n' + resumo, 'resumo');

sub(/\n\s*<section className="laudo-rodadas-section">\s*<h2>\{externo \? 'Onde ainda precisa melhorar' : 'Rotas\/Cotações prioritárias'\}<\/h2>[\s\S]*?<\/section>/, '', 'remove melhorar');
sub(/\n\s*<section className="laudo-rodadas-section">\s*<h2>Texto pronto para copiar<\/h2>[\s\S]*?<\/section>/, '', 'remove copiar');
sub(/\n\s*<section className="laudo-rodadas-section">\s*<h2>Faixas por cotação\/rota<\/h2>[\s\S]*?<\/section>/, '', 'remove faixas cotacao');
sub(/\n\s*<section className="laudo-rodadas-section">\s*<h2>Destino x Faixa<\/h2>[\s\S]*?<\/section>/, '', 'remove destino faixa antigo');

// A seção "Onde a proposta melhorou" já é condicionada pelo patch AC2.
// Não reaplicamos o wrapper aqui para não duplicar {!poucaBase ? (...)}.
console.log('SKIP melhoria: controle feito pelo AC2');

s = s.replace('titulo="UFs destino prioritárias"', 'titulo="Visão por Estado/UF"');
s = s.replace(/\n\s*<TabelaSimples titulo="Faixas de peso prioritárias" linhas=\{\(laudo\.faixasCriticas \|\| laudo\.faixasPrioritarias \|\| \[\]\)\.slice\(0, 8\)\} tipo="faixa" \/>/, '');

if (s !== old) {
  fs.writeFileSync(file, s, 'utf8');
  changed = true;
}
console.log(changed ? '4.16AD3 aplicado.' : '4.16AD3 sem alterações.');
