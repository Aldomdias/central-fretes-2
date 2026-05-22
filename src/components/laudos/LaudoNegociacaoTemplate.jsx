import React from 'react';
import {
  formatMoneyLaudo,
  formatNumberLaudo,
  formatPercentLaudo,
  montarDadosLaudoNegociacao,
  numeroLaudo,
} from '../../utils/laudosNegociacaoHtml';
import './LaudoNegociacaoTemplate.css';

function KpiCard({ label, value, sub, tone = 'info' }) {
  return (
    <div className={`laudo-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function StatusBadge({ status, tone }) {
  return <span className={`laudo-badge ${tone || 'info'}`}>{status || '-'}</span>;
}

function TabelaRotas({ titulo, subtitulo, rotas = [], tipo = 'criticas' }) {
  return (
    <section className="laudo-section">
      <div className="laudo-section-header">
        <div>
          <span className={`laudo-dot ${tipo === 'boas' ? 'good' : 'danger'}`} />
          <strong>{titulo}</strong>
        </div>
        {subtitulo ? <small>{subtitulo}</small> : null}
      </div>
      <div className="laudo-table-wrap">
        <table className="laudo-table">
          <thead>
            <tr>
              <th>Rota / destino</th>
              <th>CT-es</th>
              <th>Peso</th>
              <th>Realizado</th>
              <th>Tabela</th>
              <th>Diferença</th>
              <th>Gap</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rotas.map((rota, index) => {
              const destino = rota.rota || `${rota.origem || ''} → ${rota.destino || rota.cidadeDestino || ''}`;
              const diferenca = numeroLaudo(rota.diferenca);
              return (
                <tr key={`${destino}-${index}`} className={rota.tone === 'danger' ? 'critical' : ''}>
                  <td><strong>{destino}</strong></td>
                  <td>{formatNumberLaudo(rota.ctes || rota.qtdComSelecionada || 0)}</td>
                  <td>{formatNumberLaudo(rota.peso || 0, 0)} kg</td>
                  <td>{formatMoneyLaudo(rota.freteRealizado)}</td>
                  <td>{formatMoneyLaudo(rota.freteSelecionada || rota.freteTabela)}</td>
                  <td className={diferenca > 0 ? 'negativo' : 'positivo'}>{formatMoneyLaudo(diferenca)}</td>
                  <td className={numeroLaudo(rota.gapPct) > 0 ? 'negativo' : 'positivo'}>{formatPercentLaudo(rota.gapPct || 0)}</td>
                  <td><StatusBadge status={rota.status} tone={rota.tone} /></td>
                </tr>
              );
            })}
            {!rotas.length ? (
              <tr><td colSpan={8}>Sem rotas disponíveis para este bloco.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function LaudoNegociacaoTemplate({ resultado, dados: dadosProp, tipo = 'transportador' }) {
  const dados = dadosProp || montarDadosLaudoNegociacao(resultado || {});
  const executivo = tipo === 'executivo';
  const diferencaTone = dados.diferencaTotal > 0 ? 'danger' : 'good';

  return (
    <article className="laudo-page">
      <header className="laudo-header">
        <div>
          <div className="laudo-label">{executivo ? 'Laudo Executivo de Negociação' : 'Devolutiva de Competitividade de Tabela'}</div>
          <h1>{dados.transportadora}</h1>
          <p>{dados.origem} · {dados.canal}</p>
        </div>
        <div className="laudo-meta-grid">
          <div><span>Período</span><strong>{dados.periodo}</strong></div>
          <div><span>Gerado em</span><strong>{dados.geradoEm}</strong></div>
          <div><span>CT-es analisados</span><strong>{formatNumberLaudo(dados.ctesAnalisados)}</strong></div>
        </div>
      </header>

      <main className="laudo-content">
        <div className="laudo-kpi-grid">
          <KpiCard label="Frete realizado" value={formatMoneyLaudo(dados.freteRealizado)} sub="Total do recorte" tone="info" />
          <KpiCard label="Frete pela tabela" value={formatMoneyLaudo(dados.freteTabela)} sub={dados.diferencaTotal > 0 ? `${formatMoneyLaudo(dados.diferencaTotal)} acima` : `${formatMoneyLaudo(Math.abs(dados.diferencaTotal))} abaixo`} tone={diferencaTone} />
          <KpiCard label="Diferença total" value={formatPercentLaudo(dados.diferencaPercentual)} sub={dados.diferencaTotal > 0 ? 'Tabela acima do praticado' : 'Tabela abaixo do praticado'} tone={diferencaTone} />
          <KpiCard label="Aderência competitiva" value={formatPercentLaudo(dados.aderencia)} sub={`${formatNumberLaudo(dados.ctesGanharia)} de ${formatNumberLaudo(dados.ctesComTabela)} CT-es`} tone={dados.aderencia >= 50 ? 'good' : 'danger'} />
          {executivo ? (
            <>
              <KpiCard label="Saving mensal" value={formatMoneyLaudo(dados.savingMensal)} sub="Somente cargas ganhas" tone="good" />
              <KpiCard label="Saving anual" value={formatMoneyLaudo(dados.savingAnual)} sub="Projeção 12 meses" tone="good" />
              <KpiCard label="Fat. mensal" value={formatMoneyLaudo(dados.faturamentoMensal)} sub="Tabela ganhadora" tone="info" />
              <KpiCard label="Redução média" value={formatPercentLaudo(dados.reducaoMediaNecessaria)} sub="Para virar ganhadora" tone="warning" />
            </>
          ) : null}
        </div>

        <div className={`laudo-callout ${executivo ? 'executivo' : 'transportador'}`}>
          <strong>{executivo ? 'Leitura executiva:' : 'Direcional para negociação:'}</strong>{' '}
          {executivo
            ? `A tabela foi simulada sobre ${formatNumberLaudo(dados.ctesAnalisados)} CT-es. A aderência atual é ${formatPercentLaudo(dados.aderencia)}, com impacto anual estimado de ${formatMoneyLaudo(dados.impactoAnual)} e saving anual projetado de ${formatMoneyLaudo(dados.savingAnual)} nas cargas ganhas.`
            : `A tabela apresenta aderência competitiva de ${formatPercentLaudo(dados.aderencia)}. As rotas abaixo concentram as maiores oportunidades de revisão comercial, priorizando maior volume e maior diferença frente ao praticado.`}
        </div>

        <TabelaRotas
          titulo="Rotas com maior impacto — atenção prioritária"
          subtitulo="Ordenado por diferença e volume"
          rotas={dados.rotasCriticas}
          tipo="criticas"
        />

        <TabelaRotas
          titulo="Rotas com boa competitividade"
          subtitulo="Tabela competitiva ou com CT-es ganhos"
          rotas={dados.rotasCompetitivas}
          tipo="boas"
        />

        <section className="laudo-section">
          <div className="laudo-section-header">
            <div>
              <span className="laudo-dot info" />
              <strong>{executivo ? 'Texto executivo sugerido' : 'Texto para e-mail ao transportador'}</strong>
            </div>
            <small>Pronto para copiar</small>
          </div>
          <pre className="laudo-email-box">{executivo ? dados.textoExecutivo : dados.textoTransportador}</pre>
        </section>
      </main>

      <footer className="laudo-footer">
        <span>{dados.fonte || 'Central Fretes'} · {executivo ? 'Uso interno' : 'Devolutiva comercial'}</span>
        <span>{dados.transportadora} · {dados.geradoEm}</span>
      </footer>
    </article>
  );
}
