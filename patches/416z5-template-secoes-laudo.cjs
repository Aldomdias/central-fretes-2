const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/components/laudos/LaudoRodadasNegociacaoTemplate.jsx');
let src = fs.readFileSync(file, 'utf8');
const old = src;

const alvo = `        <TabelaSimples titulo="UFs destino prioritárias" linhas={(laudo.ufsCriticas || laudo.ufsPrioritarias || []).slice(0, 8)} tipo="uf" />
        <TabelaSimples titulo="Faixas de peso prioritárias" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />`;

const bloco = `        <TabelaSimples titulo="UFs destino prioritárias" linhas={(laudo.ufsCriticas || laudo.ufsPrioritarias || []).slice(0, 8)} tipo="uf" />
        <TabelaSimples titulo="Faixas de peso prioritárias" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />

        <section className="laudo-rodadas-section">
          <h2>Visão por cotação/rota</h2>
          <p>Agrupamento por origem, UF destino, nome comercial da cotação/rota e faixa de peso.</p>
          <div className="laudo-rodadas-table-wrap">
            <table className="laudo-rodadas-table">
              <thead><tr><th>Origem</th><th>UF destino</th><th>Cotação/Rota</th><th>Faixa de peso</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>
              <tbody>
                {(laudo.faixasDetalhadas || []).length > 0
                  ? (laudo.faixasDetalhadas || []).slice(0, 25).map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.origem || '-'}</td>
                      <td>{item.ufDestino || '-'}</td>
                      <td><strong>{item.rota || item.chave || '-'}</strong></td>
                      <td>{item.faixa || '-'}</td>
                      <td className="right">{numero(item.ctesPerdidos)}</td>
                      <td className="right">{numero(item.ctesGanhos)}</td>
                      <td className="right">{percentual(item.aderencia)}</td>
                      <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                      <td className="right">{percentual(item.ajusteMedio)}</td>
                      <td><span className={\`laudo-rodadas-badge \${prioridadeClasse(item.prioridade)}\`}>{item.prioridade}</span></td>
                    </tr>
                  ))
                  : <tr><td colSpan={10}>Execute uma nova simulação para gerar a visão por cotação/rota.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section className="laudo-rodadas-section">
          <h2>Pareto 80% das cidades por volume total</h2>
          <p>Cidades que concentram 80% do volume total da última rodada, independentemente de ganho ou perda.</p>
          <div className="laudo-rodadas-table-wrap">
            <table className="laudo-rodadas-table">
              <thead><tr><th>Cidade destino</th><th>UF</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">CT-es ganhos</th><th className="right">CT-es perdidos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th></tr></thead>
              <tbody>
                {(laudo.paretoCidades || []).length > 0
                  ? (laudo.paretoCidades || []).map((item, idx) => (
                    <tr key={idx}>
                      <td><strong>{item.cidade || '-'}</strong></td>
                      <td>{item.ufDestino || '-'}</td>
                      <td className="right">{numero(item.ctes)}</td>
                      <td className="right">{numero(item.volumes)}</td>
                      <td className="right">{percentual(item.pctVolume)}</td>
                      <td className="right">{percentual(item.pctAcumulado)}</td>
                      <td className="right">{numero(item.ctesGanhos)}</td>
                      <td className="right">{numero(item.ctesPerdidos)}</td>
                      <td className="right">{percentual(item.aderencia)}</td>
                      <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                    </tr>
                  ))
                  : <tr><td colSpan={10}>Execute uma nova simulação para gerar o Pareto de cidades.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>`;

if (!src.includes('laudo.faixasDetalhadas')) {
  src = src.replace(alvo, bloco);
}
if (src !== old) fs.writeFileSync(file, src, 'utf8');
console.log(src !== old ? '4.16Z5 template aplicado.' : '4.16Z5 template sem alterações.');
