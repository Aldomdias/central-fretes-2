import React from 'react';
import { montarLaudosNegociacao } from '../../utils/laudosNegociacaoHtml';
import './LaudoNegociacaoTemplate.css';

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function numero(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

function percentual(valor) {
  return `${Number(valor || 0).toFixed(2)}%`;
}

function normalizarDados({ tipo, resultado, dados }) {
  if (dados) return dados;
  const laudos = montarLaudosNegociacao(resultado || {});
  return tipo === 'transportador' ? laudos.transportador : laudos.executivo;
}

export function LaudoNegociacaoTemplate({ tipo = 'executivo', resultado = null, dados = null }) {
  const laudo = normalizarDados({ tipo, resultado, dados });
  const externo = tipo === 'transportador';
  const titulo = externo ? 'Devolutiva para Transportadora' : 'Laudo para Diretoria';
  const indicadores = laudo.indicadores || {};

  return (
    <article className="laudo-negociacao">
      <header className="laudo-negociacao__header">
        <h1 className="laudo-negociacao__title">{titulo}</h1>
        <div className="laudo-negociacao__meta">
          <span><strong>Transportadora:</strong> {laudo.transportadora || '-'}</span>
          <span><strong>Canal:</strong> {laudo.canal || '-'}</span>
          <span><strong>Periodo:</strong> {laudo.periodo || '-'}</span>
          <span><strong>Gerado em:</strong> {laudo.geradoEm ? new Date(laudo.geradoEm).toLocaleString('pt-BR') : '-'}</span>
        </div>
      </header>

      <section>
        <strong>Assunto sugerido</strong>
        <div className="laudo-negociacao__subject">{laudo.assunto || '-'}</div>
      </section>

      <section className="laudo-negociacao__kpis">
        <div className="laudo-negociacao__kpi"><span>CT-es analisados</span><strong>{numero(indicadores.ctesAnalisados)}</strong></div>
        <div className="laudo-negociacao__kpi"><span>CT-es com tabela</span><strong>{numero(indicadores.ctesComTabela)}</strong></div>
        <div className="laudo-negociacao__kpi"><span>Aderencia</span><strong>{percentual(indicadores.aderencia)}</strong></div>
        <div className="laudo-negociacao__kpi"><span>CT-es competitivos</span><strong>{numero(indicadores.ctesGanhas)}</strong></div>
        <div className="laudo-negociacao__kpi"><span>CT-es a revisar</span><strong>{numero(indicadores.ctesPerdidas)}</strong></div>
        {!externo && <div className="laudo-negociacao__kpi"><span>Saving 12 meses</span><strong>{dinheiro(indicadores.savingAno)}</strong></div>}
        {!externo && <div className="laudo-negociacao__kpi"><span>Faturamento ganho/mês</span><strong>{dinheiro(indicadores.faturamentoGanhoMes)}</strong></div>}
        <div className="laudo-negociacao__kpi"><span>Reducao media</span><strong>{percentual(indicadores.reducaoMedia)}</strong></div>
      </section>

      <section>
        <strong>Corpo do e-mail</strong>
        <div className="laudo-negociacao__body">{laudo.corpoEmail || '-'}</div>
      </section>

      <section>
        <h2>Principais rotas ganhas</h2>
        <table>
          <thead><tr><th>Rota</th><th>CT-es</th><th>{externo ? 'Posicionamento' : 'Faturamento ganho'}</th></tr></thead>
          <tbody>
            {(laudo.rotasGanhas || []).slice(0, 8).map((item) => (
              <tr key={`ganha-${item.rota}`}>
                <td>{item.rota}</td>
                <td>{numero(item.qtdGanhasSelecionada || item.ctes)}</td>
                <td>{externo ? 'Boa competitividade' : dinheiro(item.freteSelecionadaGanhadora)}</td>
              </tr>
            ))}
            {!(laudo.rotasGanhas || []).length && <tr><td colSpan={3}>Nao disponivel.</td></tr>}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Principais rotas perdidas</h2>
        <table>
          <thead><tr><th>Rota</th><th>CT-es</th><th>Reducao media</th><th>Referencia</th></tr></thead>
          <tbody>
            {(laudo.rotasPerdidas || []).slice(0, 8).map((item) => (
              <tr key={`perda-${item.rota}`}>
                <td>{item.rota}</td>
                <td>{numero(item.qtdPerdidasSelecionada || item.ctes)}</td>
                <td>{percentual(item.reducaoMediaNecessaria)}</td>
                <td>{item.principalVencedor || '-'}</td>
              </tr>
            ))}
            {!(laudo.rotasPerdidas || []).length && <tr><td colSpan={4}>Nao disponivel.</td></tr>}
          </tbody>
        </table>
      </section>

      {laudo.observacaoCubagem && (
        <section className="laudo-negociacao__subject">
          <strong>Observacao</strong>
          <div>{externo ? 'Alguns registros apresentaram inconsistencia de cubagem e foram tratados para evitar distorcoes na analise.' : laudo.observacaoCubagem}</div>
        </section>
      )}

      <footer style={{ marginTop: 18, color: '#64748b', fontSize: '0.85rem' }}>
        Analise gerada pelo sistema Central Fretes / Simulador de Fretes.
      </footer>
    </article>
  );
}
