const fs = require('fs');
const path = require('path');
let changed = false;
function save(file, src, old, label) { if (src !== old) { fs.writeFileSync(file, src, 'utf8'); changed = true; console.log('OK ' + label); } else console.log('SKIP ' + label); }
function rep(src, from, to, label) { if (src.includes(from)) { changed = true; console.log('OK ' + label); return src.replace(from, to); } if (src.includes(to)) { console.log('SKIP ' + label); return src; } console.warn('WARN ' + label); return src; }
function addBefore(src, marker, block, label) { if (src.includes(block.trim().split('\n')[0])) { console.log('SKIP ' + label); return src; } const idx = src.indexOf(marker); if (idx < 0) { console.warn('WARN ' + label); return src; } changed = true; console.log('OK ' + label); return src.slice(0, idx) + block + '\n' + src.slice(idx); }

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let src = fs.readFileSync(compPath, 'utf8');
const old = src;

const destinoPareto = `function TabelaDestinoFaixaPareto({ linhas = [] }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>Pareto 80% — Destino x Faixa</h2>
      <p>Mostra onde o volume está concentrado por origem, destino e faixa de peso.</p>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Origem → Destino/UF</th><th>Faixa</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">CT-es ganhos</th><th className="right">CT-es perdidos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th></tr></thead>
          <tbody>
            {linhas.map((item, idx) => (
              <tr key={item.chave || idx}>
                <td><strong>{item.rotaDestino || [item.origem, item.destino ? item.destino + (item.ufDestino ? '/' + item.ufDestino : '') : item.ufDestino].filter(Boolean).join(' → ') || '-'}</strong></td>
                <td>{item.faixa || '-'}</td>
                <td className="right">{numero(item.ctes)}</td>
                <td className="right">{numero(item.volumes)}</td>
                <td className="right">{percentual(item.pctVolume)}</td>
                <td className="right">{percentual(item.pctAcumulado)}</td>
                <td className="right">{numero(item.ctesGanhos)}</td>
                <td className="right">{numero(item.ctesPerdidos)}</td>
                <td className="right">{percentual(item.aderencia)}</td>
                <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                <td className="right">{percentual(item.ajusteMedio)}</td>
              </tr>
            ))}
            {!linhas.length ? <tr><td colSpan="11">Sem leitura suficiente por destino e faixa.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

`;
src = addBefore(src, 'function TabelaSimples', destinoPareto, 'componente pareto destino faixa');

// Oculta seção Onde a proposta melhorou quando só houver uma rodada.
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
'oculta melhoria com uma rodada'
);

// Remove seção Onde ainda precisa melhorar se ainda existir.
src = src.replace(/\n\s*<section className="laudo-rodadas-section">\s*<h2>\{externo \? 'Onde ainda precisa melhorar' : 'Rotas\/Cotações prioritárias'\}<\/h2>[\s\S]*?<TabelaRotas linhas=\{\(laudo\.rotasCriticas \|\| laudo\.ondeAjustar \|\| \[\]\)\.slice\(0, 12\)\} \/>\s*<\/section>/, '');

// Renomeia e corrige o texto da antiga cotação/rota para Destino x Faixa, se ainda existir.
src = rep(src, '<h2>Visão por cotação/rota</h2>', '<h2>Destino x Faixa</h2>', 'renomeia antiga cotacao');
src = rep(src, 'Agrupamento por origem, UF destino, nome comercial da cotação/rota e faixa de peso.', 'Detalhamento por destino e faixa de peso para indicar onde a tabela precisa de ajuste mais direto.', 'texto destino faixa');
src = rep(src, '<th>Cotação/Rota</th>', '<th>Destino</th>', 'coluna destino');

// Insere Mesorregião x Faixa antes de Destino x Faixa, caso ainda não exista.
if (!src.includes('<h2>Mesorregião x Faixa</h2>')) {
  const marker = '        <section className="laudo-rodadas-section">\n          <h2>Destino x Faixa</h2>';
  const blocoMeso = `        <section className="laudo-rodadas-section">
          <h2>Mesorregião x Faixa</h2>
          <p>Agrupamento regional por mesorregião do IBGE e faixa de peso.</p>
          <div className="laudo-rodadas-table-wrap">
            <table className="laudo-rodadas-table">
              <thead><tr><th>Origem</th><th>UF destino</th><th>Mesorregião</th><th>Faixa</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>
              <tbody>
                {(laudo.mesorregiaoFaixas || []).length > 0
                  ? (laudo.mesorregiaoFaixas || []).slice(0, 25).map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.origem || '-'}</td>
                      <td>{item.ufDestino || '-'}</td>
                      <td><strong>{item.mesorregiao || item.rota || '-'}</strong></td>
                      <td>{item.faixa || '-'}</td>
                      <td className="right">{numero(item.ctesPerdidos)}</td>
                      <td className="right">{numero(item.ctesGanhos)}</td>
                      <td className="right">{percentual(item.aderencia)}</td>
                      <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                      <td className="right">{percentual(item.ajusteMedio)}</td>
                      <td><span className={\`laudo-rodadas-badge \${prioridadeClasse(item.prioridade)}\`}>{item.prioridade || 'BAIXA'}</span></td>
                    </tr>
                  ))
                  : <tr><td colSpan={10}>Sem leitura suficiente por mesorregião.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>

`;
  if (src.includes(marker)) { src = src.replace(marker, blocoMeso + marker); changed = true; console.log('OK insere mesorregiao'); }
}

// Remove as duas seções redundantes, se existirem por título.
src = src.replace(/\n\s*<section className="laudo-rodadas-section">\s*<h2>Destino x Faixa<\/h2>[\s\S]*?<\/section>/, '');
src = src.replace(/\n\s*<section className="laudo-rodadas-section">\s*<h2>Visão por destino\/cidade<\/h2>[\s\S]*?<\/section>/, '');

// Insere o novo Pareto destino x faixa depois da mesorregião ou antes da recomendação.
if (!src.includes('<TabelaDestinoFaixaPareto')) {
  const marker = '        <section className="laudo-rodadas-section">\n          <h2>Recomendação final</h2>';
  const chamada = '        <TabelaDestinoFaixaPareto linhas={(laudo.destinoFaixaPareto || []).slice(0, 30)} />\n\n';
  if (src.includes(marker)) { src = src.replace(marker, chamada + marker); changed = true; console.log('OK chama destino faixa pareto'); }
}

src = rep(src, 'titulo="UFs destino prioritárias"', 'titulo="Visão por Estado/UF"', 'renomeia uf');

save(compPath, src, old, 'template AC');
console.log(changed ? '4.16AC2 aplicado.' : '4.16AC2 sem alterações.');
