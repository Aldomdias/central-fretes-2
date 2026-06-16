import React from 'react';
import './LaudoNegociacaoTemplate.css';

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBR(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '-' : data.toLocaleDateString('pt-BR');
}

export function LaudoExcedentesTemplate({ laudo = {} }) {
  const linhas = laudo.linhas || [];
  const porTransportadora = laudo.porTransportadora || [];

  return (
    <article className="laudo-page">
      <header className="laudo-header">
        <div className="laudo-header__label">Auditoria Lotação — Excedentes</div>
        <h1>{laudo.titulo || 'Laudo de Excedentes'}</h1>
        <p>Valores pagos acima do acertado/tabela, aprovados pela Operação</p>
        <div className="laudo-header__meta">
          <div><span>Período</span><strong>{laudo.periodo || '-'}</strong></div>
          <div><span>Itens</span><strong>{laudo.totalItens || 0}</strong></div>
          <div><span>Gerado em</span><strong>{dataBR(laudo.geradoEm)}</strong></div>
        </div>
      </header>

      <div className="laudo-content">
        <section className="laudo-kpis">
          <div className="laudo-kpi info"><span>Valor lançado</span><strong>{dinheiro(laudo.totalLancado)}</strong></div>
          <div className="laudo-kpi warn"><span>Valor excedente</span><strong>{dinheiro(laudo.totalExcedente)}</strong><small>acima do acertado/tabela</small></div>
          <div className="laudo-kpi info"><span>Itens analisados</span><strong>{laudo.totalItens || 0}</strong></div>
        </section>

        <section className="laudo-section">
          <h2>Resumo por transportadora</h2>
          <table  >
            <thead>
              <tr><th>Transportadora</th><th>Itens</th><th>Valor lançado</th><th>Valor excedente</th></tr>
            </thead>
            <tbody>
              {porTransportadora.length ? porTransportadora.map((t) => (
                <tr key={t.transportadora}>
                  <td>{t.transportadora}</td>
                  <td>{t.qtd}</td>
                  <td>{dinheiro(t.totalLancado)}</td>
                  <td>{dinheiro(t.totalExcedente)}</td>
                </tr>
              )) : <tr><td colSpan={4}>Nenhum excedente no período.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="laudo-section">
          <h2>Detalhe dos lançamentos</h2>
          <table  >
            <thead>
              <tr><th>Data</th><th>Transportadora</th><th>CT-e</th><th>DIST</th><th>Valor lançado</th><th>Excedente</th><th>Motivo</th><th>Aprovado por</th></tr>
            </thead>
            <tbody>
              {linhas.length ? linhas.map((l, idx) => (
                <tr key={`${l.cte}-${idx}`}>
                  <td>{dataBR(l.data)}</td>
                  <td>{l.transportadora}</td>
                  <td>{l.cte}</td>
                  <td>{l.dist}</td>
                  <td>{dinheiro(l.valorLancado)}</td>
                  <td>{dinheiro(l.valorExcedente)}</td>
                  <td>{l.motivo}</td>
                  <td>{l.aprovadoPor}</td>
                </tr>
              )) : <tr><td colSpan={8}>Nenhum item encontrado.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </article>
  );
}

export default LaudoExcedentesTemplate;
