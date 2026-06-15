import React from 'react';



import {

  laudoConsolidadoExterno,

  laudoConsolidadoPorAudience,

  LAUDO_AUDIENCE,

  montarLegendaPeriodoMensal,

  montarNotaBasesLaudoConsolidado,

  rotuloCoberturaFreteConcorrentesRotas,

} from '../../utils/laudoTransportadoraConsolidado';

import { formatadoresLaudoRodadas } from '../../utils/laudosRodadasNegociacaoHtml';



import './LaudoRodadasNegociacaoTemplate.css';



const { dinheiro, percentual, dataBR, exibirCidade, numero } = formatadoresLaudoRodadas;



function statusClasse(status) {

  if (status === 'Aderente') return 'baixa';

  if (status === 'Parcial') return 'media';

  return 'alta';

}



function legendaPeriodo(laudoView = {}) {

  return laudoView.legendaPeriodo

    || montarLegendaPeriodoMensal(laudoView.periodoSimulado || { meses: laudoView.totais?.mesesPeriodo });

}



function rotuloPareto(resumo = {}) {

  const minRotas = Number(resumo.minRotas) || 20;

  if (resumo.usouMinimoRotas) {

    return `Pareto 80% por origem; mín. ${minRotas} rotas se o corte ficar abaixo`;

  }

  return `Pareto 80% por origem (≥ ${minRotas} rotas mantém o corte)`;

}



export default function LaudoTransportadoraConsolidadoTemplate({

  laudo = null,

  audience = LAUDO_AUDIENCE.TRANSPORTADORA,

  exibirFaturamentoGanho = true,

}) {

  if (!laudo) return null;



  const laudoView = laudoConsolidadoPorAudience(laudo, audience, { exibirFaturamentoGanho });

  const mostrarFaturamentoGanho = laudoView.exibirFaturamentoGanho !== false;

  const externo = laudoConsolidadoExterno(audience);

  const totais = laudoView.totais || {};

  const origens = Array.isArray(laudoView.origens) ? laudoView.origens : [];

  const rotasPrioritarias = Array.isArray(laudoView.rotasPrioritarias)

    ? laudoView.rotasPrioritarias

    : (Array.isArray(laudoView.rotasCriticas) ? laudoView.rotasCriticas : []);

  const resumoRotas = laudoView.rotasPrioritariasResumo || {};

  const coberturaRotas = rotuloCoberturaFreteConcorrentesRotas(resumoRotas);

  const periodoSub = legendaPeriodo(laudoView);

  const origensExibidas = externo

    ? [...origens].sort((a, b) => Number(a.aderenciaPorCte ?? a.aderencia ?? 0) - Number(b.aderenciaPorCte ?? b.aderencia ?? 0))

    : origens;

  const colunasPorOrigem = (externo ? 11 : 12) + (mostrarFaturamentoGanho ? 3 : 0);



  return (

    <article className="laudo-page">

      <header className="laudo-header">

        <div className="laudo-kicker">

          {externo ? 'Devolutiva consolidada' : 'Laudo consolidado — uso interno / diretoria'}

        </div>

        <h2>{laudoView.titulo || laudoView.transportadora}</h2>

        <p className="laudo-meta">Gerado em {dataBR(laudoView.geradoEm)} · {origens.length} origem(ns)</p>

      </header>



      {externo ? (

        <div className="laudo-rodadas-alert" style={{ marginBottom: 16 }}>

          Versão para envio à transportadora — sem saving nem métricas internas de ganho.

        </div>

      ) : (

        <div className="laudo-rodadas-alert danger" style={{ marginBottom: 16 }}>

          Uso interno: contém saving e impacto financeiro. Não enviar esta versão à transportadora.

        </div>

      )}



      <section className="laudo-section">

        <h3>{externo ? 'Resumo da simulacao c/ tabela' : 'Resumo geral'}</h3>

        {mostrarFaturamentoGanho && totais.freteTotalComTabela > 0 ? (

          <p className="laudo-meta" style={{ marginTop: -4, marginBottom: 16 }}>

            {montarNotaBasesLaudoConsolidado(totais)}

          </p>

        ) : null}

        {!externo ? (

          <div className="summary-card" style={{ marginBottom: 16, maxWidth: 280 }}>

            <span>Saving mensal</span>

            <strong>{dinheiro(totais.savingMes)}</strong>

            <small>{periodoSub}</small>

          </div>

        ) : null}

        {mostrarFaturamentoGanho ? (

          <>

            <h4 className="laudo-subsecao-titulo">

              Simulação c/ tabela ({numero(totais.ctesComTabela)} CT-es com cobertura)

            </h4>

            <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 20 }}>

              <div className="summary-card">

                <span>Total simulado c/ tabela</span>

                <strong>{dinheiro(totais.freteTotalComTabela)}</strong>

                <small>{periodoSub} · ganho + frete c/ concorrentes</small>

              </div>

              <div className="summary-card">

                <span>Frete ganho c/ proposta</span>

                <strong>{dinheiro(totais.freteGanhoProposta ?? totais.faturamentoProposta)}</strong>

                <small>

                  {periodoSub}

                  {totais.aderenciaPorFrete != null

                    ? ` · ${percentual(totais.aderenciaPorFrete)} do total simulado`

                    : ''}

                </small>

              </div>

              <div className="summary-card">

                <span>Frete c/ concorrentes</span>

                <strong>{dinheiro(totais.freteConcorrentes)}</strong>

                <small>

                  {periodoSub}

                  {totais.pctPerdidoSimulacao != null

                    ? ` · ${percentual(totais.pctPerdidoSimulacao)} do total simulado`

                    : ''}

                </small>

              </div>

              <div className="summary-card">

                <span>Aderência (por CT-e)</span>

                <strong>{percentual(totais.aderenciaPorCte ?? totais.aderenciaMedia)}</strong>

                <small>{numero(totais.ctesGanharia)} ganharia / {numero(totais.ctesComTabela)} com tabela</small>

              </div>

              <div className="summary-card">

                <span>Aderência (por frete simulado)</span>

                <strong>{percentual(totais.aderenciaPorFrete ?? 0)}</strong>

                <small>frete ganho ÷ total simulado c/ tabela</small>

              </div>

            </div>

          </>

        ) : (

          <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 20 }}>

            <div className="summary-card">

              <span>Aderência (por CT-e)</span>

              <strong>{percentual(totais.aderenciaPorCte ?? totais.aderenciaMedia)}</strong>

              <small>{numero(totais.ctesGanharia)} ganharia / {numero(totais.ctesComTabela)} com tabela</small>

            </div>

          </div>

        )}

        <h4 className="laudo-subsecao-titulo">Volumetria (CT-es que ganharia)</h4>

        <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>

          <div className="summary-card">

            <span>Pedidos ganhos/dia</span>

            <strong>{numero(totais.pedidosDia)}</strong>

            <small>média do período simulado</small>

          </div>

          <div className="summary-card">

            <span>Pedidos ganhos/mês</span>

            <strong>{numero(totais.pedidosMes)}</strong>

            <small>{periodoSub}</small>

          </div>

          <div className="summary-card">

            <span>Volumes ganhos/mês</span>

            <strong>{numero(totais.volumesMes)}</strong>

            <small>{periodoSub}</small>

          </div>

          {externo && resumoRotas.reducaoMediaNecessaria ? (

            <div className="summary-card">

              <span>Redução média necessária</span>

              <strong className="laudo-destaque-percentual">{percentual(resumoRotas.reducaoMediaNecessaria)}</strong>

              <small>rotas prioritárias</small>

            </div>

          ) : null}

        </div>

      </section>



      <section className="laudo-section">

        <h3>Por origem</h3>

        <div className="sim-analise-tabela-wrap">

          <table className="sim-analise-tabela">

            <thead>

              <tr>

                <th>Origem</th>

                <th>Canal</th>

                <th>Status</th>

                <th>Rodada</th>

                <th>Aderência CT-e</th>

                <th>Aderência frete</th>

                {!externo ? <th>Saving/mês</th> : null}

                <th className="right">Ganharia / participou</th>

                {mostrarFaturamentoGanho ? (

                  <>

                    <th className="right">Frete ganho</th>

                    <th className="right">Frete c/ conc.</th>

                    <th className="right">Total simulado</th>

                  </>

                ) : null}

                <th className="right">Ped. ganhos/dia</th>

                <th className="right">Ped. ganhos/mês</th>

                <th className="right">Vol. ganhos/mês</th>

              </tr>

            </thead>

            <tbody>

              {origensExibidas.map((o) => (

                <tr key={o.negociacaoId || o.origem}>

                  <td><strong>{o.origem}</strong></td>

                  <td>{o.canal || '—'}</td>

                  <td>{o.status || '—'}</td>

                  <td>{o.rodada}ª</td>

                  <td>{percentual(o.aderenciaPorCte ?? o.aderencia)}</td>

                  <td>{percentual(o.aderenciaPorFrete ?? 0)}</td>

                  {!externo ? <td>{dinheiro(o.savingMes)}</td> : null}

                  <td className="right">{numero(o.ctesGanharia)} / {numero(o.ctesComTabela)}</td>

                  {mostrarFaturamentoGanho ? (

                    <>

                      <td className="right">{dinheiro(o.freteGanhoProposta ?? o.faturamentoProposta)}</td>

                      <td className="right">{dinheiro(o.freteConcorrentes)}</td>

                      <td className="right">{dinheiro(o.freteTotalComTabela)}</td>

                    </>

                  ) : null}

                  <td className="right">{numero(o.pedidosDia)}</td>

                  <td className="right">{numero(o.pedidosMes)}</td>

                  <td className="right">{numero(o.volumesMes)}</td>

                </tr>

              ))}

              {!origensExibidas.length ? (

                <tr><td colSpan={colunasPorOrigem}>Nenhuma origem simulada com cobertura na malha.</td></tr>

              ) : null}

            </tbody>

          </table>

        </div>

      </section>



      {rotasPrioritarias.length ? (

        <section className="laudo-section">

          <h3>Rotas prioritárias para revisão</h3>

          <p className="laudo-meta" style={{ marginTop: -4, marginBottom: 12 }}>

            {rotuloPareto(resumoRotas)}. Valores mensalizados ({periodoSub.replace(/^\/mês · /, '')}).

            {' '}Frete c/ concorrentes por rota — total da transportadora no resumo geral acima.

          </p>

          <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 12 }}>

            <div className="summary-card">

              <span>Rotas selecionadas</span>

              <strong>{resumoRotas.qtdRotas ?? rotasPrioritarias.length}</strong>

              <small>{rotuloPareto(resumoRotas)}</small>

            </div>

            <div className="summary-card">

              <span>{coberturaRotas.titulo}</span>

              <strong>{coberturaRotas.valorPrincipal}</strong>

              <small>

                {coberturaRotas.cobreTudo
                  ? coberturaRotas.legenda
                  : (
                    <>
                      {coberturaRotas.legenda}
                      {coberturaRotas.valorRotas > 0
                        ? ` (${dinheiro(coberturaRotas.valorRotas)}${periodoSub ? ` ${periodoSub}` : ''})`
                        : ''}
                    </>
                  )}

              </small>

            </div>

            <div className="summary-card">

              <span>Redução média necessária</span>

              <strong className="laudo-destaque-percentual">{percentual(resumoRotas.reducaoMediaNecessaria)}</strong>

            </div>

            <div className="summary-card">

              <span>Origem mais crítica</span>

              <strong>{exibirCidade(resumoRotas.origemMaisCritica) || '—'}</strong>

            </div>

          </div>

          <div className="sim-analise-tabela-wrap">

            <table className="sim-analise-tabela laudo-rotas-prioritarias-tabela">

              <thead>

                <tr>

                  <th>Prioridade</th>

                  <th>Origem</th>

                  <th>Destino</th>

                  <th className="right">% redução (perdidos)</th>

                  <th className="right">Frete mensal c/ concorrentes</th>

                  <th className="right">CT-es c/ tabela</th>

                  <th>Status</th>

                </tr>

              </thead>

              <tbody>

                {rotasPrioritarias.map((r) => (

                  <tr key={r.chave || `${r.origem}-${r.destino}-${r.prioridade}`}>

                    <td><strong>{r.prioridade}</strong></td>

                    <td>{exibirCidade(r.origem) || '—'}</td>

                    <td>{exibirCidade(r.destino) || '—'}</td>

                    <td className="right"><strong className="laudo-destaque-percentual">{percentual(r.percentualReducaoNecessaria)}</strong></td>

                    <td className="right">{dinheiro(r.faturamentoMensalEmRisco)}</td>

                    <td className="right">{numero(r.quantidadeCtes)}</td>

                    <td>

                      <span className={`laudo-rodadas-badge ${statusClasse(r.status)}`}>{r.status || 'Revisar'}</span>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        </section>

      ) : null}



      {laudoView.recomendacao ? (

        <section className="laudo-section">

          <h3>{externo ? 'Direcionamento' : 'Recomendação'}</h3>

          <p>{laudoView.recomendacao}</p>

        </section>

      ) : null}

    </article>

  );

}


