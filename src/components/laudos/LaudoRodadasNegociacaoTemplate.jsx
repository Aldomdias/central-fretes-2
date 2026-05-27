import React from 'react';
import { montarLaudosRodadasNegociacao, formatadoresLaudoRodadas } from '../../utils/laudosRodadasNegociacaoHtml';
import './LaudoRodadasNegociacaoTemplate.css';

const { dinheiro, numero, percentual, dataBR } = formatadoresLaudoRodadas;

function Variacao({ valor, tipo = 'numero', sufixo = '' }) {
  const v = Number(valor || 0);
  const positivo = v >= 0;
  const texto = tipo === 'dinheiro'
    ? dinheiro(Math.abs(v))
    : tipo === 'percentual'
      ? percentual(Math.abs(v))
      : numero(Math.abs(v));
  return <small style={{ color: positivo ? '#15803d' : '#b91c1c', fontWeight: 800 }}>{positivo ? '+' : '-'}{texto}{sufixo}</small>;
}

function prioridadeClasse(valor) {
  const v = String(valor || '').toLowerCase();
  if (v.includes('alta')) return 'alta';
  if (v.includes('média') || v.includes('media')) return 'media';
  return 'baixa';
}

function TabelaEvolucao({ linhas = [], externo }) {
  return (
    <div className="laudo-rodadas-table-wrap">
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>Rodada</th>
            <th>Data</th>
            <th className="right">CT-es ganhos</th>
            <th className="right">Volumes</th>
            <th className="right">Aderência</th>
            <th className="right">Faturamento/mês</th>
            {!externo ? <th className="right">Saving/mês</th> : null}
            <th className="right">Ajuste médio</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((item) => (
            <tr key={item.id || `${item.rodada}-${item.criadoEm}`}>
              <td><strong>{item.rodada}ª</strong></td>
              <td>{dataBR(item.criadoEm)}</td>
              <td className="right">{numero(item.ctesGanhos)}</td>
              <td className="right">{numero(item.volumesGanhos)}</td>
              <td className="right">{percentual(item.aderencia)}</td>
              <td className="right">{dinheiro(item.faturamentoMes)}</td>
              {!externo ? <td className="right">{dinheiro(item.savingMes)}</td> : null}
              <td className="right">{percentual(item.reducaoMedia)}</td>
            </tr>
          ))}
          {!linhas.length ? <tr><td colSpan={externo ? 7 : 8}>Nenhuma simulação salva para montar evolução.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function TabelaRotas({ linhas = [], externo }) {
  return (
    <div className="laudo-rodadas-table-wrap">
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>Rota/Cotação</th>
            <th>UF</th>
            <th>Faixa</th>
            <th className="right">CT-es perdidos</th>
            <th className="right">CT-es ganhos</th>
            <th className="right">Fat. não capturado</th>
            <th className="right">Ajuste médio</th>
            <th>Prioridade</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((item) => (
            <tr key={item.chave || item.rota}>
              <td>
                <strong>{item.rota || item.chave || '-'}</strong>
                {item.origem || item.destino ? <div style={{ color: '#64748b', fontSize: 11 }}>{[item.origem, item.destino].filter(Boolean).join(' > ')}</div> : null}
              </td>
              <td>{item.ufDestino || '-'}</td>
              <td>{item.faixa || '-'}</td>
              <td className="right">{numero(item.ctesPerdidos)}</td>
              <td className="right">{numero(item.ctesGanhos)}</td>
              <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
              <td className="right">{percentual(item.ajusteMedio)}</td>
              <td><span className={`laudo-rodadas-badge ${prioridadeClasse(item.prioridade)}`}>{item.prioridade || 'BAIXA'}</span></td>
            </tr>
          ))}
          {!linhas.length ? <tr><td colSpan="8">Não há rotas críticas suficientes para este recorte.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function TabelaMelhorias({ linhas = [] }) {
  return (
    <div className="laudo-rodadas-table-wrap">
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>Rota/Cotação</th>
            <th>UF</th>
            <th className="right">Ganhos 1ª rodada</th>
            <th className="right">Ganhos atual</th>
            <th className="right">Evolução</th>
            <th className="right">Aderência atual</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((item) => (
            <tr key={item.chave || item.rota}>
              <td><strong>{item.rota || item.chave || '-'}</strong></td>
              <td>{item.ufDestino || '-'}</td>
              <td className="right">{numero(item.ctesGanhosInicial)}</td>
              <td className="right">{numero(item.ctesGanhosFinal)}</td>
              <td className="right">+{numero(item.evolucaoCtes)}</td>
              <td className="right">{percentual(item.aderenciaAtual)}</td>
            </tr>
          ))}
          {!linhas.length ? <tr><td colSpan="6">Ainda não há melhoria destacada por rota/cotação.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function TabelaSimples({ titulo, linhas = [], tipo = 'uf' }) {
  return (
    <section className="laudo-rodadas-section">
      <h2>{titulo}</h2>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead>
            <tr>
              <th>{tipo === 'faixa' ? 'Faixa de peso' : 'UF destino'}</th>
              <th className="right">CT-es perdidos</th>
              <th className="right">CT-es ganhos</th>
              <th className="right">Aderência</th>
              <th className="right">Fat. não capturado</th>
              <th className="right">Ajuste médio</th>
              <th>Prioridade</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((item) => (
              <tr key={item.chave || item.rota || item.faixa}>
                <td><strong>{tipo === 'faixa' ? (item.faixa || item.rota || item.chave) : (item.ufDestino || item.rota || item.chave)}</strong></td>
                <td className="right">{numero(item.ctesPerdidos)}</td>
                <td className="right">{numero(item.ctesGanhos)}</td>
                <td className="right">{percentual(item.aderencia)}</td>
                <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                <td className="right">{percentual(item.ajusteMedio)}</td>
                <td><span className={`laudo-rodadas-badge ${prioridadeClasse(item.prioridade)}`}>{item.prioridade || 'BAIXA'}</span></td>
              </tr>
            ))}
            {!linhas.length ? <tr><td colSpan="7">Sem leitura suficiente para este agrupamento.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LaudoRodadasNegociacaoTemplate({ tipo = 'executivo', tabela = null, dados = null }) {
  const laudos = dados ? null : montarLaudosRodadasNegociacao(tabela || {});
  const laudo = dados || (tipo === 'transportador' ? laudos.transportador : laudos.executivo);
  const externo = tipo === 'transportador' || laudo.tipo === 'transportador_rodadas';
  const comparativo = laudo.comparativo || {};
  const inicial = comparativo.inicial || {};
  const atual = comparativo.atual || {};
  const poucaBase = Number(laudo.quantidadeSimulacoes || 0) < 2;

  return (
    <article className="laudo-rodadas-page">
      <header className="laudo-rodadas-header">
        <small>{externo ? 'Devolutiva comercial' : 'Uso interno - diretoria e gestão'}</small>
        <h1>{laudo.titulo}</h1>
        <p>{laudo.transportadora || 'Transportadora'} · {laudo.canal || '-'} · {laudo.origem || 'Origem não informada'}</p>
        <div className="laudo-rodadas-meta">
          <div><span>Transportadora</span><strong>{laudo.transportadora || '-'}</strong></div>
          <div><span>Canal</span><strong>{laudo.canal || '-'}</strong></div>
          <div><span>Período</span><strong>{laudo.periodo || '-'}</strong></div>
          <div><span>Rodadas</span><strong>{numero(laudo.quantidadeSimulacoes || 0)}</strong></div>
          <div><span>Gerado em</span><strong>{dataBR(laudo.geradoEm)}</strong></div>
        </div>
      </header>

      <div className="laudo-rodadas-body">
        {externo ? (
          <div className="laudo-rodadas-alert">Este relatório mostra oportunidades de ajuste comercial por rota, cotação, UF e faixa de peso. Não expõe referências internas nem concorrentes.</div>
        ) : (
          <div className="laudo-rodadas-alert danger">Uso interno: contém saving, impacto financeiro e recomendação estratégica. Não enviar esta versão ao transportador.</div>
        )}

        {poucaBase ? (
          <div className="laudo-rodadas-alert warn">Para análise completa de evolução, o ideal é ter pelo menos duas simulações salvas. Com uma única rodada, o laudo mostra apenas o diagnóstico atual.</div>
        ) : null}

        <section className="laudo-rodadas-kpis">
          <div className="laudo-rodadas-kpi"><span>Aderência atual</span><strong>{percentual(atual.aderencia)}</strong><Variacao valor={comparativo.evolucaoAderencia} tipo="percentual" sufixo=" p.p." /></div>
          <div className="laudo-rodadas-kpi"><span>CT-es competitivos</span><strong>{numero(atual.ctesGanhos)}</strong><Variacao valor={comparativo.evolucaoCtesGanhos} /></div>
          <div className="laudo-rodadas-kpi"><span>Volumes competitivos</span><strong>{numero(atual.volumesGanhos)}</strong><Variacao valor={comparativo.evolucaoVolumes} /></div>
          <div className="laudo-rodadas-kpi"><span>Faturamento capturado/mês</span><strong>{dinheiro(atual.faturamentoMes)}</strong><Variacao valor={comparativo.evolucaoFaturamentoMes} tipo="dinheiro" /></div>
          {!externo ? <div className="laudo-rodadas-kpi"><span>Saving/mês</span><strong>{dinheiro(atual.savingMes)}</strong><Variacao valor={comparativo.evolucaoSavingMes} tipo="dinheiro" /></div> : null}
          <div className="laudo-rodadas-kpi"><span>Ajuste médio necessário</span><strong>{percentual(atual.reducaoMedia)}</strong><small>Inicial: {percentual(inicial.reducaoMedia)}</small></div>
        </section>

        <section className="laudo-rodadas-section">
          <h2>Resumo da evolução</h2>
          <p>
            {externo
              ? `A proposta saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência. Os CT-es competitivos passaram de ${numero(inicial.ctesGanhos)} para ${numero(atual.ctesGanhos)}. O objetivo da próxima rodada deve ser revisar os pontos de maior impacto listados abaixo.`
              : `A negociação saiu de ${percentual(inicial.aderencia)} para ${percentual(atual.aderencia)} de aderência, com saving mensal de ${dinheiro(inicial.savingMes)} para ${dinheiro(atual.savingMes)} e faturamento capturado de ${dinheiro(inicial.faturamentoMes)} para ${dinheiro(atual.faturamentoMes)} por mês.`}
          </p>
        </section>

        <section className="laudo-rodadas-section">
          <h2>Evolução rodada a rodada</h2>
          <TabelaEvolucao linhas={laudo.evolucaoRodadas || []} externo={externo} />
        </section>

        <section className="laudo-rodadas-section">
          <h2>{externo ? 'Onde ainda precisa melhorar' : 'Rotas/Cotações prioritárias'}</h2>
          <p>{externo ? 'Pontos com maior volume, perda de competitividade ou faturamento potencial ainda não capturado.' : 'Ranking interno de oportunidades, priorizado por faturamento não capturado, CT-es perdidos e ajuste médio necessário.'}</p>
          <TabelaRotas linhas={(laudo.rotasCriticas || laudo.ondeAjustar || []).slice(0, 12)} externo={externo} />
        </section>

        <section className="laudo-rodadas-section">
          <h2>{externo ? 'Onde a proposta melhorou' : 'Rotas/Cotações que evoluíram'}</h2>
          <TabelaMelhorias linhas={(laudo.rotasMelhoraram || laudo.ondeMelhorou || []).slice(0, 10)} />
        </section>

        <TabelaSimples titulo="UFs destino prioritárias" linhas={(laudo.ufsCriticas || laudo.ufsPrioritarias || []).slice(0, 8)} tipo="uf" />
        <TabelaSimples titulo="Faixas de peso prioritárias" linhas={(laudo.faixasCriticas || laudo.faixasPrioritarias || []).slice(0, 8)} tipo="faixa" />

        <section className="laudo-rodadas-section">
          <h2>Recomendação final</h2>
          <div className="laudo-rodadas-recomendacao">{laudo.recomendacao}</div>
        </section>

        <section className="laudo-rodadas-section">
          <h2>Texto pronto para copiar</h2>
          <pre className="laudo-rodadas-copy">{laudo.relatorioTexto || laudo.relatorio || laudo.corpoEmail}</pre>
        </section>
      </div>
    </article>
  );
}
