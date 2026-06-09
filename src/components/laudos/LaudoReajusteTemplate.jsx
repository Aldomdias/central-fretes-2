import React from 'react';
import './LaudoNegociacaoTemplate.css';

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function numero(valor, casas = 0) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function percentual(valor) {
  return `${numero(valor, 2)}%`;
}

function dataBR(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '-' : data.toLocaleDateString('pt-BR');
}

function classeImpacto(valor) {
  return Number(valor || 0) > 0 ? 'warn' : 'good';
}

function TabelaRotas({ titulo, linhas = [], tipo }) {
  return (
    <section className="laudo-section">
      <div className="laudo-section__head">
        <span className={`laudo-dot ${tipo === 'perda' ? 'danger' : tipo === 'ganho' ? 'good' : 'soft'}`} />
        <h2>{titulo}</h2>
        <small>{numero(linhas.length)}</small>
      </div>
      <table>
        <thead><tr><th>Rota</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">Variação</th></tr></thead>
        <tbody>
          {linhas.slice(0, 12).map((item, indice) => (
            <tr key={`${tipo}-${item.chave || item.rota || indice}`}>
              <td>{item.rota || '-'}</td>
              <td className="right">{numero(item.ctes || item.ganhosProjetados || 0)}</td>
              <td className="right">{numero(item.volumes || 0)}</td>
              <td className="right">{numero(item.variacaoGanhos || 0)}</td>
            </tr>
          ))}
          {!linhas.length ? <tr><td colSpan="4">Nenhuma rota nesta classificação.</td></tr> : null}
        </tbody>
      </table>
    </section>
  );
}

function TabelaPareto({ titulo, linhas = [] }) {
  const visiveis = linhas.filter((item) => item.pareto80);
  const dados = visiveis.length ? visiveis : linhas;
  return (
    <section className="laudo-section">
      <div className="laudo-section__head">
        <span className="laudo-dot info" />
        <h2>{titulo}</h2>
        <small>Pareto 80%</small>
      </div>
      <table>
        <thead><tr><th>Canal</th><th>Faixa</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% acumulado</th><th className="right">Impacto</th></tr></thead>
        <tbody>
          {dados.map((item) => (
            <tr key={item.chave}>
              <td>{item.canal}</td>
              <td>{item.faixa}</td>
              <td className="right">{numero(item.ctes)}</td>
              <td className="right">{numero(item.volumes)}</td>
              <td className="right">{percentual(item.percentualAcumulado)}</td>
              <td className="right">{dinheiro(item.impacto)}</td>
            </tr>
          ))}
          {!dados.length ? <tr><td colSpan="6">Sem dados individuais suficientes para esta classificação.</td></tr> : null}
        </tbody>
      </table>
    </section>
  );
}

export function LaudoReajusteTemplate({ tipo = 'executivo', laudo = {} }) {
  const externo = tipo === 'transportador';
  const indicadores = laudo.indicadores || {};
  const financeira = laudo.visaoFinanceira || {};
  const competitiva = laudo.visaoCompetitiva || {};
  const pareto = laudo.pareto || {};

  return (
    <article className="laudo-page">
      <header className="laudo-header">
        <div className="laudo-header__label">Laudo de Reajuste · Impacto Financeiro e Competitivo</div>
        <h1>{laudo.transportadora || 'Transportadora'}</h1>
        <p>{externo ? 'Devolutiva específica do reajuste' : 'Análise executiva para decisão do reajuste'}</p>
        <div className="laudo-header__meta">
          <div><span>Canal</span><strong>{laudo.canal || '-'}</strong></div>
          <div><span>Origem</span><strong>{laudo.origem || '-'}</strong></div>
          <div><span>Período</span><strong>{laudo.periodo || '-'}</strong></div>
          <div><span>Gerado em</span><strong>{dataBR(laudo.geradoEm)}</strong></div>
        </div>
      </header>

      <div className="laudo-content">
        {!externo ? <div className="laudo-warning"><strong>Uso interno.</strong> Contém impacto financeiro, captura de volume e posição competitiva.</div> : null}

        <section className="laudo-section">
          <div className="laudo-section__head"><span className="laudo-dot info" /><h2>Visão 1 · Impacto financeiro do reajuste</h2></div>
          <div className="laudo-kpis">
            <div className="laudo-kpi info"><span>Frete atual/base</span><strong>{dinheiro(financeira.valorAtual)}</strong><small>{percentual(financeira.fretePctAtual)} da NF</small></div>
            <div className={`laudo-kpi ${classeImpacto(financeira.impacto)}`}><span>Frete reajustado</span><strong>{dinheiro(financeira.valorNovo)}</strong><small>{percentual(financeira.fretePctNovo)} da NF</small></div>
            <div className={`laudo-kpi ${classeImpacto(financeira.impacto)}`}><span>Impacto total</span><strong>{dinheiro(financeira.impacto)}</strong><small>{percentual(financeira.impactoPct)}</small></div>
            <div className={`laudo-kpi ${classeImpacto(financeira.impactoMes)}`}><span>Impacto mensal</span><strong>{dinheiro(financeira.impactoMes)}</strong><small>Anual: {dinheiro(financeira.impactoAno)}</small></div>
            <div className="laudo-kpi info"><span>Frete médio atual</span><strong>{dinheiro(financeira.freteMedioAtual)}</strong></div>
            <div className="laudo-kpi info"><span>Frete médio novo</span><strong>{dinheiro(financeira.freteMedioNovo)}</strong></div>
          </div>
        </section>

        <section className="laudo-section">
          <div className="laudo-section__head"><span className="laudo-dot good" /><h2>Visão 2 · Impacto competitivo</h2></div>
          {!competitiva.disponivel ? (
            <div className="laudo-warning">
              A comparação com tabelas oficiais/concorrentes não foi marcada nesta simulação. Refaça a simulação com o flag ativo para preencher ranking e movimentação competitiva.
            </div>
          ) : null}
          <div className="laudo-kpis">
            <div className="laudo-kpi info"><span>Nova aderência</span><strong>{percentual(competitiva.aderenciaProjetada)}</strong><small>Antes: {percentual(competitiva.aderenciaAtual)}</small></div>
            <div className="laudo-kpi info"><span>Variação de CT-es</span><strong>{numero(competitiva.variacaoCtes)}</strong><small>{numero(competitiva.ganhosAtuais)} → {numero(competitiva.ganhosProjetados)}</small></div>
            <div className="laudo-kpi info"><span>Variação de volumes</span><strong>{numero(competitiva.variacaoVolumes)}</strong><small>{numero(competitiva.volumesAtuais)} → {numero(competitiva.volumesProjetados)}</small></div>
            <div className="laudo-kpi good"><span>Faturamento potencial</span><strong>{dinheiro(competitiva.faturamentoPotencial)}</strong></div>
            <div className="laudo-kpi info"><span>Ranking médio novo</span><strong>{competitiva.rankingMedioNovo ? numero(competitiva.rankingMedioNovo, 2) : '-'}</strong><small>{numero(competitiva.primeirosLugares)} primeiros lugares</small></div>
            <div className="laudo-kpi info"><span>Visão geral</span><strong>{numero(indicadores.ctesComTabela)} / {numero(indicadores.ctesAnalisados)}</strong><small>CT-es cobertos / analisados</small></div>
          </div>
        </section>

        <div className="laudo-callout"><strong>Recomendação:</strong> {laudo.recomendacao || 'Avaliar impacto financeiro e competitivo antes da aprovação.'}</div>

        <TabelaRotas titulo="Rotas ganhas" linhas={competitiva.rotasGanhas || []} tipo="ganho" />
        <TabelaRotas titulo="Rotas perdidas" linhas={competitiva.rotasPerdidas || []} tipo="perda" />
        <TabelaRotas titulo="Rotas mantidas" linhas={competitiva.rotasMantidas || []} tipo="mantida" />

        <section className="laudo-callout">
          <strong>Regra do Pareto:</strong> cada CT-e foi classificado individualmente na grade do canal ATACADO ou B2C antes do agrupamento.
        </section>
        <TabelaPareto titulo="Pareto por faixa de peso" linhas={pareto.peso || []} />
        <TabelaPareto titulo="Pareto por faixa de valor da NF" linhas={pareto.valorNF || []} />
        <TabelaPareto titulo="Pareto por faixa de cubagem" linhas={pareto.cubagem || []} />
      </div>

      <footer className="laudo-footer">
        <span>Central Fretes / Simulador de Fretes</span>
        <span>Laudo específico de reajuste</span>
      </footer>
    </article>
  );
}
