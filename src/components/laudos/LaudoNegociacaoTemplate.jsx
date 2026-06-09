import React from 'react';
import { montarLaudosNegociacao } from '../../utils/laudosNegociacaoHtml';
import { LaudoReajusteTemplate } from './LaudoReajusteTemplate';
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

function dataBR(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '-' : data.toLocaleDateString('pt-BR');
}

function normalizarDados({ tipo, resultado, dados }) {
  if (dados) return dados;
  const laudos = montarLaudosNegociacao(resultado || {});
  return tipo === 'transportador' ? laudos.transportador : laudos.executivo;
}

function prioridadePorReducao(valor) {
  const reducao = Number(valor || 0);
  if (reducao >= 30) return { label: 'Critico', classe: 'danger' };
  if (reducao >= 15) return { label: 'Revisar', classe: 'warn' };
  return { label: 'Atencao', classe: 'soft' };
}

function BarGap({ value }) {
  const pct = Math.min(Math.abs(Number(value || 0)), 100);
  return (
    <div className="laudo-bar">
      <div className="laudo-bar__bg"><div className="laudo-bar__fill" style={{ width: `${pct}%` }} /></div>
      <span>{percentual(value)}</span>
    </div>
  );
}

export function LaudoNegociacaoTemplate({ tipo = 'executivo', resultado = null, dados = null }) {
  const laudo = normalizarDados({ tipo, resultado, dados });
  const externo = tipo === 'transportador';
  const indicadores = laudo.indicadores || {};
  const isReajuste = indicadores.tipoLaudo === 'REAJUSTE';
  if (isReajuste) {
    return <LaudoReajusteTemplate tipo={tipo} laudo={laudo} />;
  }
  const rotasBoas = (laudo.rotasGanhas || []).slice(0, 8);
  const rotasCriticas = (laudo.rotasPerdidas || []).slice(0, 10);
  const titulo = isReajuste
    ? (externo ? 'Devolutiva do Reajuste' : 'Analise Executiva do Reajuste')
    : (externo ? 'Devolutiva de Competitividade' : 'Analise Executiva de Competitividade');
  const subtitulo = externo ? 'Oportunidades de ajuste comercial' : 'Uso interno - diretoria e gestao';

  return (
    <article className="laudo-page">
      <header className="laudo-header">
        <div className="laudo-header__label">{isReajuste ? 'Impacto Financeiro e Competitividade do Reajuste' : 'Analise de Competitividade de Tabela de Frete'}</div>
        <h1>{laudo.transportadora || 'Transportadora'}</h1>
        <p>{titulo} - {subtitulo}</p>
        <div className="laudo-header__meta">
          <div><span>Canal</span><strong>{laudo.canal || '-'}</strong></div>
          <div><span>Origem</span><strong>{laudo.origem || '-'}</strong></div>
          <div><span>Periodo</span><strong>{laudo.periodo || '-'}</strong></div>
          <div><span>Gerado em</span><strong>{dataBR(laudo.geradoEm)}</strong></div>
        </div>
      </header>

      <div className="laudo-content">
        {!externo ? (
          <div className="laudo-warning">
            <strong>Uso interno.</strong> Este laudo contem saving, impacto financeiro e informacoes estrategicas. Nao enviar para transportadora.
          </div>
        ) : null}

        <section className="laudo-kpis">
          {isReajuste ? (
            <>
              <div className="laudo-kpi info"><span>Frete atual</span><strong>{dinheiro(indicadores.valorAtual)}</strong><small>{percentual(indicadores.fretePctAtual)} da NF</small></div>
              <div className="laudo-kpi warn"><span>Frete reajustado</span><strong>{dinheiro(indicadores.valorNovo)}</strong><small>{percentual(indicadores.fretePctNovo)} da NF</small></div>
              <div className="laudo-kpi warn"><span>Impacto mensal</span><strong>{dinheiro(indicadores.impactoMes)}</strong><small>{percentual(indicadores.impactoPercentual)}</small></div>
              <div className="laudo-kpi info"><span>Ganhos atuais/projetados</span><strong>{numero(indicadores.ganhosAtuais)} / {numero(indicadores.ganhosProjetados)}</strong><small>CT-es competitivos</small></div>
              <div className="laudo-kpi info"><span>Aderencia atual/projetada</span><strong>{percentual(indicadores.aderenciaAtual)} / {percentual(indicadores.aderenciaProjetada)}</strong></div>
              <div className="laudo-kpi info"><span>Volume atual/projetado</span><strong>{numero(indicadores.volumesAtuais)} / {numero(indicadores.volumesProjetados)}</strong></div>
              <div className="laudo-kpi warn"><span>Rotas com aumento</span><strong>{numero(indicadores.rotasAumento)}</strong></div>
              <div className="laudo-kpi good"><span>Rotas com reducao</span><strong>{numero(indicadores.rotasReducao)}</strong></div>
            </>
          ) : externo ? (
            <>
              <div className="laudo-kpi info"><span>CT-es analisados</span><strong>{numero(indicadores.ctesAnalisados)}</strong><small>Base considerada</small></div>
              <div className="laudo-kpi good"><span>Boa competitividade</span><strong>{numero(indicadores.ctesGanhas)}</strong><small>CT-es competitivos</small></div>
              <div className="laudo-kpi warn"><span>Pontos a revisar</span><strong>{numero(indicadores.ctesPerdidas)}</strong><small>CT-es com oportunidade</small></div>
              <div className="laudo-kpi info"><span>Aderencia</span><strong>{percentual(indicadores.aderencia)}</strong><small>Dentro do recorte</small></div>
            </>
          ) : (
            <>
              <div className="laudo-kpi info"><span>CT-es analisados</span><strong>{numero(indicadores.ctesAnalisados)}</strong><small>{numero(indicadores.ctesComTabela)} com tabela</small></div>
              <div className="laudo-kpi good"><span>Saving 12 meses</span><strong>{dinheiro(indicadores.savingAno)}</strong><small>{dinheiro(indicadores.savingMes)} por mes</small></div>
              <div className="laudo-kpi good"><span>Faturamento ganho</span><strong>{dinheiro(indicadores.faturamentoGanhoMes)}</strong><small>{dinheiro(indicadores.faturamentoGanhoAno)} em 12 meses</small></div>
              <div className="laudo-kpi warn"><span>Aderencia</span><strong>{percentual(indicadores.aderencia)}</strong><small>{numero(indicadores.ctesGanhas)} CT-es ganhos</small></div>
            </>
          )}
        </section>

        <section className="laudo-callout">
          {isReajuste ? (
            <><strong>Recomendacao executiva:</strong> {laudo.recomendacao || 'Revisar impacto e aderencia antes da decisao.'}</>
          ) : externo ? (
            <>
              <strong>Resumo da devolutiva:</strong> a tabela apresentou boa competitividade em parte das rotas avaliadas, mas tambem possui oportunidades de ajuste. A recomendacao e priorizar as rotas com maior volume de CT-es e maior percentual medio de reducao necessaria.
            </>
          ) : (
            <>
              <strong>Resumo executivo:</strong> a simulacao indica potencial de ganho competitivo e captura de saving nas rotas em que a tabela fica melhor posicionada. As rotas criticas devem ser priorizadas na negociacao para melhorar aderencia e reduzir perda para concorrentes.
            </>
          )}
        </section>

        <section className="laudo-section">
          <div className="laudo-section__head">
            <span className="laudo-dot danger" />
            <h2>{externo ? 'Rotas com oportunidade de ajuste' : 'Rotas com maior impacto para negociacao'}</h2>
            <small>Top {rotasCriticas.length || 0}</small>
          </div>
          <table>
            <thead>
              <tr>
                <th>Rota</th>
                <th className="right">CT-es</th>
                <th>Reducao media</th>
                {!externo ? <th>Referencia interna</th> : null}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rotasCriticas.map((item) => {
                const prioridade = prioridadePorReducao(item.reducaoMediaNecessaria);
                return (
                  <tr key={`critica-${item.rota}`}>
                    <td>{item.rota || '-'}</td>
                    <td className="right">{numero(item.qtdPerdidasSelecionada || item.ctes)}</td>
                    <td><BarGap value={item.reducaoMediaNecessaria} /></td>
                    {!externo ? <td>{item.principalVencedor || '-'}</td> : null}
                    <td><span className={`laudo-badge ${prioridade.classe}`}>{prioridade.label}</span></td>
                  </tr>
                );
              })}
              {!rotasCriticas.length ? <tr><td colSpan={externo ? 4 : 5}>Nao disponivel para o recorte atual.</td></tr> : null}
            </tbody>
          </table>
        </section>

        <section className="laudo-section">
          <div className="laudo-section__head">
            <span className="laudo-dot good" />
            <h2>Rotas com boa competitividade</h2>
            <small>Top {rotasBoas.length || 0}</small>
          </div>
          <table>
            <thead>
              <tr>
                <th>Rota</th>
                <th className="right">CT-es</th>
                {!externo ? <th className="right">Faturamento ganho</th> : null}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rotasBoas.map((item) => (
                <tr key={`boa-${item.rota}`}>
                  <td>{item.rota || '-'}</td>
                  <td className="right">{numero(item.qtdGanhasSelecionada || item.ctes)}</td>
                  {!externo ? <td className="right">{dinheiro(item.freteSelecionadaGanhadora)}</td> : null}
                  <td><span className="laudo-badge good">Competitiva</span></td>
                </tr>
              ))}
              {!rotasBoas.length ? <tr><td colSpan={externo ? 3 : 4}>Nao disponivel para o recorte atual.</td></tr> : null}
            </tbody>
          </table>
        </section>

        {laudo.observacaoCubagem ? (
          <section className="laudo-note">
            {externo
              ? 'Alguns registros apresentaram inconsistencia de cubagem e foram tratados para evitar distorcoes na analise.'
              : laudo.observacaoCubagem}
          </section>
        ) : null}
      </div>

      <footer className="laudo-footer">
        <span>Central Fretes / Simulador de Fretes</span>
        <span>{externo ? 'Devolutiva comercial' : 'Uso interno'}</span>
      </footer>
    </article>
  );
}
