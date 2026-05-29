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

const compPath = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let comp = fs.readFileSync(compPath, 'utf8');
const old = comp;

// Remove a seção Onde ainda precisa melhorar do layout principal.
comp = comp.replace(/\n\s*<section className="laudo-rodadas-section">\s*<h2>\{externo \? 'Onde ainda precisa melhorar' : 'Rotas\/Cotações prioritárias'\}<\/h2>[\s\S]*?<TabelaRotas linhas=\{\(laudo\.rotasCriticas \|\| laudo\.ondeAjustar \|\| \[\]\)\.slice\(0, 12\)\} \/>\s*<\/section>/, '');

// Ajusta o Pareto para ficar mais útil no transportador.
comp = rep(comp,
  '<thead><tr><th>Cidade destino</th><th>UF</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">Frete realizado</th></tr></thead>',
  '<thead><tr><th>Origem → Destino/UF</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">CT-es ganhos</th><th className="right">CT-es perdidos</th><th className="right">Fat. capturado</th><th className="right">Fat. não capturado</th><th className="right">Redução média</th></tr></thead>',
  'cabecalho pareto final'
);
comp = rep(comp,
  '<tbody>{linhas.map((item) => (<tr key={item.chave || item.cidade}><td><strong>{item.cidade || \'-\'}</strong></td><td>{item.ufDestino || \'-\'}</td><td className="right">{numero(item.ctes)}</td><td className="right">{numero(item.volumes)}</td><td className="right">{percentual(item.pctVolume)}</td><td className="right">{percentual(item.pctAcumulado)}</td><td className="right">{dinheiro(item.freteRealizado)}</td></tr>))}{!linhas.length ? <tr><td colSpan="7">Sem base individual suficiente para calcular o Pareto de cidades.</td></tr> : null}</tbody>',
  '<tbody>{linhas.map((item) => (<tr key={item.chave || item.rotaDestino || item.cidade}><td><strong>{item.rotaDestino || [item.origem, item.cidade ? item.cidade + (item.ufDestino ? \'/\' + item.ufDestino : \'\') : item.ufDestino].filter(Boolean).join(\' → \') || \'-\'}</strong></td><td className="right">{numero(item.ctes)}</td><td className="right">{numero(item.volumes)}</td><td className="right">{percentual(item.pctVolume)}</td><td className="right">{percentual(item.pctAcumulado)}</td><td className="right">{numero(item.ctesGanhos)}</td><td className="right">{numero(item.ctesPerdidos)}</td><td className="right">{dinheiro(item.faturamentoCapturado)}</td><td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td><td className="right">{percentual(item.ajusteMedio)}</td></tr>))}{!linhas.length ? <tr><td colSpan="10">Execute uma nova simulação para gerar o Pareto de cidades.</td></tr> : null}</tbody>',
  'linhas pareto final'
);

// A seção criada como cotação/rota passa a ser Destino x Faixa.
comp = rep(comp, '<h2>Visão por cotação/rota</h2>', '<h2>Destino x Faixa</h2>', 'renomeia destino faixa');
comp = rep(comp, 'Agrupamento por origem, UF destino, nome comercial da cotação/rota e faixa de peso.', 'Detalhamento por destino e faixa de peso para indicar onde a tabela precisa de ajuste mais direto.', 'texto destino faixa');
comp = rep(comp, '<th>Cotação/Rota</th>', '<th>Destino</th>', 'cabecalho destino');

// Insere Mesorregião x Faixa antes do Destino x Faixa usando a mesma estrutura de tabela.
if (!comp.includes('<h2>Mesorregião x Faixa</h2>')) {
  const marker = '        <section className="laudo-rodadas-section">\n          <h2>Destino x Faixa</h2>';
  const bloco = '        <section className="laudo-rodadas-section">\n          <h2>Mesorregião x Faixa</h2>\n          <p>Agrupamento regional por mesorregião do IBGE e faixa de peso, para direcionar ajustes sem depender do nome comercial da cotação.</p>\n          <div className="laudo-rodadas-table-wrap">\n            <table className="laudo-rodadas-table">\n              <thead><tr><th>Origem</th><th>UF destino</th><th>Mesorregião</th><th>Faixa</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>\n              <tbody>\n                {(laudo.mesorregiaoFaixas || []).length > 0\n                  ? (laudo.mesorregiaoFaixas || []).slice(0, 25).map((item, idx) => (\n                    <tr key={idx}>\n                      <td>{item.origem || \'-\'}</td>\n                      <td>{item.ufDestino || \'-\'}</td>\n                      <td><strong>{item.mesorregiao || item.rota || \'-\'}</strong></td>\n                      <td>{item.faixa || \'-\'}</td>\n                      <td className="right">{numero(item.ctesPerdidos)}</td>\n                      <td className="right">{numero(item.ctesGanhos)}</td>\n                      <td className="right">{percentual(item.aderencia)}</td>\n                      <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>\n                      <td className="right">{percentual(item.ajusteMedio)}</td>\n                      <td><span className={`laudo-rodadas-badge ${prioridadeClasse(item.prioridade)}`}>{item.prioridade || \'BAIXA\'}</span></td>\n                    </tr>\n                  ))\n                  : <tr><td colSpan={10}>Sem leitura suficiente por mesorregião.</td></tr>\n                }\n              </tbody>\n            </table>\n          </div>\n        </section>\n\n';
  if (comp.includes(marker)) {
    comp = comp.replace(marker, bloco + marker);
    changed = true;
    console.log('OK insere mesorregiao faixa');
  } else console.warn('WARN marcador destino faixa não encontrado');
}

// Padroniza título da visão de UF, se ainda estiver antigo.
comp = rep(comp, 'titulo="UFs destino prioritárias"', 'titulo="Visão por Estado/UF"', 'renomeia UF');

save(compPath, comp, old, 'template final laudo');
console.log(changed ? '4.16AB2 aplicado.' : '4.16AB2 sem alterações.');
