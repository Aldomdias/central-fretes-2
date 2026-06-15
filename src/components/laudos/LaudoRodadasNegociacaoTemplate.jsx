import React, { useRef } from 'react';
import { montarLaudosRodadasNegociacao, formatadoresLaudoRodadas } from '../../utils/laudosRodadasNegociacaoHtml';
import {
  baixarLaudoRodadasEmail,
  baixarLaudoRodadasExcel,
  baixarLaudoRodadasHtml,
  baixarLaudoRodadasTexto,
  gerarLaudoRodadasPdf,
  laudoRodadasExterno,
} from '../../utils/laudoRodadasExport';
import LaudoEmailAcoes from './LaudoEmailAcoes';
import './LaudoRodadasNegociacaoTemplate.css';

const { dinheiro, numero, percentual, dataBR, exibirCidade } = formatadoresLaudoRodadas;

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

function percentualPp(valor) {
  const v = Number(valor || 0);
  return (v > 0 ? '+' : '') + v.toFixed(2) + ' p.p.';
}

function mesorregiaoReal(valor) {
  const texto = String(valor || '').trim().toLowerCase();
  return texto && !texto.includes('não identificada') && !texto.includes('nao identificada');
}

function diagnosticoResumoTexto({ externo, poucaBase, atual, inicial, comparativo }) {
  if (poucaBase) {
    return externo
      ? 'Esta é a primeira rodada salva da análise. A proposta apresenta aderência atual de ' + percentual(atual.aderencia) + ', com ' + numero(atual.ctesGanhos) + ' CT-es competitivos, ' + numero(atual.volumesGanhos) + ' volumes competitivos e faturamento potencial capturado de ' + dinheiro(atual.faturamentoMes) + ' por mês. As próximas seções mostram onde estão os maiores volumes e as oportunidades de ajuste.'
      : 'Esta é a primeira rodada salva da análise. O cenário atual apresenta aderência de ' + percentual(atual.aderencia) + ', saving mensal de ' + dinheiro(atual.savingMes) + ' e faturamento capturado de ' + dinheiro(atual.faturamentoMes) + ' por mês.';
  }
  const alertaBase = comparativo.baseMudou ? ' A base de CT-es analisados mudou entre as rodadas — a variação de aderência deve ser lida com cautela.' : '';
  return externo
    ? 'A proposta saiu de ' + percentual(inicial.aderencia) + ' para ' + percentual(atual.aderencia) + ' de aderência. Os CT-es competitivos passaram de ' + numero(inicial.ctesGanhos) + ' para ' + numero(atual.ctesGanhos) + '. O objetivo da próxima rodada deve ser revisar os pontos de maior impacto listados abaixo.' + alertaBase
    : 'A negociação saiu de ' + percentual(inicial.aderencia) + ' para ' + percentual(atual.aderencia) + ' de aderência, com saving mensal de ' + dinheiro(inicial.savingMes) + ' para ' + dinheiro(atual.savingMes) + ' e faturamento capturado de ' + dinheiro(inicial.faturamentoMes) + ' para ' + dinheiro(atual.faturamentoMes) + ' por mês.' + alertaBase;
}

function numeroOperacional(valor, casas = 1) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function VeiculoOcupacaoIlustracaoLaudo({ ocupacaoPercentual = 0 }) {
  const fill = Math.max(0, Math.min(100, ocupacaoPercentual));
  const fillColor = fill >= 90 ? '#fb923c' : fill >= 70 ? '#34d399' : '#60a5fa';
  return (
    <svg viewBox="0 0 220 88" role="img" aria-label="Ocupação estimada do veículo" style={{ width: '100%', maxWidth: 190 }}>
      <rect x="18" y="28" width="92" height="34" rx="8" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="2" />
      <rect x="20" y="30" width={Math.max(0, 88 * (fill / 100))} height="30" rx="6" fill={fillColor} opacity="0.9" />
      <path d="M110 38h22l18 16v8h-40V38Z" fill="#e0f2fe" stroke="#bfdbfe" strokeWidth="2" />
      <path d="M123 41h8l11 10h-19V41Z" fill="#f8fafc" stroke="#bfdbfe" strokeWidth="1.5" />
      <circle cx="40" cy="68" r="9" fill="#0f172a" />
      <circle cx="40" cy="68" r="4" fill="#f8fafc" />
      <circle cx="116" cy="68" r="9" fill="#0f172a" />
      <circle cx="116" cy="68" r="4" fill="#f8fafc" />
      <line x1="18" y1="66" x2="150" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// CORRIGIDO: exibe "Não informada" quando cubagemDisponivel=false em vez de "0,00 m³"
function VeiculoOperacionalLaudoCard({ dados }) {
  if (!dados || dados.semDados) return null;
  const ocupacaoPercentual = Number(dados.ocupacaoOperacional || 0) * 100;
  const badgeBg = dados.ocupacaoOperacional >= 0.9 ? '#fff7ed' : dados.ocupacaoOperacional >= 0.7 ? '#ecfdf5' : '#eff6ff';
  const badgeColor = dados.ocupacaoOperacional >= 0.9 ? '#c2410c' : dados.ocupacaoOperacional >= 0.7 ? '#047857' : '#1d4ed8';
  const faixaCubagem = numeroOperacional(dados.veiculo?.cubagemMin, 0) + ' a ' + numeroOperacional(dados.veiculo?.cubagemRef, 0) + ' m³';
  const faixaPeso = numeroOperacional(dados.veiculo?.pesoMin, 0) + ' a ' + numeroOperacional(dados.veiculo?.pesoRef, 0) + ' kg';
  return (
    <section className="laudo-rodadas-section">
      <h2>Veículo sugerido nas cargas ganhas</h2>
      <div className="laudo-rodadas-kpi" style={{ alignItems: 'stretch', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div>
            <span>Veículo sugerido</span>
            <strong style={{ fontSize: '1rem', lineHeight: 1.15 }}>{dados.veiculo?.tipo}</strong>
          </div>
          <div style={{ padding: '4px 8px', borderRadius: 999, background: badgeBg, color: badgeColor, fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
            {percentual(ocupacaoPercentual)} ocupado
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: 12, alignItems: 'center' }}>
          <VeiculoOcupacaoIlustracaoLaudo ocupacaoPercentual={ocupacaoPercentual} />
          <small style={{ display: 'grid', gap: 4 }}>
            {dados.cubagemDisponivel !== false
              ? <span>Cubagem/dia: <strong>{numeroOperacional(dados.cubagemDia, 2)} m³</strong></span>
              : <span>Cubagem/dia: <strong style={{ color: '#92400e' }}>Não informada</strong></span>
            }
            <span>Peso/dia: <strong>{numeroOperacional(dados.pesoDia, 0)} kg</strong></span>
            <span>Referência: <strong>{faixaCubagem} • {faixaPeso}</strong></span>
            {dados.qtdVeiculos > 1 ? <span>Necessidade: <strong>{dados.qtdVeiculos} veículo(s)/dia</strong></span> : null}
            <span>Limitante: <strong>{dados.fatorLimitante === 'peso' ? 'peso' : 'cubagem'}</strong></span>
          </small>
        </div>
        <small style={{ color: badgeColor }}>{dados.alerta}{dados.minimoNoLimite ? ' Menor veículo físico: ' + dados.veiculoMinimo?.tipo + '.' : ''}</small>
        <small>Uso comum: {dados.veiculo?.uso}</small>
      </div>
    </section>
  );
}

function listaLaudoSegura() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (Array.isArray(arguments[i])) return arguments[i];
  }
  return [];
}

function prioridadeClasse(valor) {
  const v = String(valor || '').toLowerCase();
  if (v.includes('alta')) return 'alta';
  if (v.includes('média') || v.includes('media')) return 'media';
  return 'baixa';
}

function TabelaEvolucao({ linhas = [], externo, baseMudou = false }) {
  return (
    <div className="laudo-rodadas-table-wrap">
      {baseMudou && (
        <div style={{ padding: '8px 12px', background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#92400e', fontSize: 12, fontWeight: 600 }}>
          ⚠ A base de CT-es analisados mudou entre rodadas. Compare a aderência com cautela.
        </div>
      )}
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>Rodada</th>
            <th>Data</th>
            <th className="right">CT-es analisados</th>
            <th className="right">CT-es ganhos</th>
            <th className="right">Volumes</th>
            <th className="right">Aderência</th>
            <th className="right">% atual</th>
            <th className="right">Percentual tabela (% da NF)</th>
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
              <td className="right">{item.ctesAnalisados ? numero(item.ctesAnalisados) : '-'}</td>
              <td className="right">{numero(item.ctesGanhos)}</td>
              <td className="right">{numero(item.volumesGanhos)}</td>
              <td className="right">{percentual(item.aderencia)}</td>
              <td className="right">{percentual(item.percentualFreteReal)}</td>
              <td className="right">{percentual(item.percentualFreteTabela)}</td>
              <td className="right">{dinheiro(item.faturamentoMes)}</td>
              {!externo ? <td className="right">{dinheiro(item.savingMes)}</td> : null}
              <td className="right">{percentual(item.reducaoMedia)}</td>
            </tr>
          ))}
          {!linhas.length ? <tr><td colSpan={externo ? 10 : 11}>Nenhuma simulação salva para montar evolução.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function TabelaRotas({ linhas = [] }) {
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
                <strong>{exibirCidade(item.rota || item.chave || '-')}</strong>
                {item.origem || item.destino ? <div style={{ color: '#64748b', fontSize: 11 }}>{[item.origem, item.destino].filter(Boolean).map(exibirCidade).join(' > ')}</div> : null}
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

// CORRIGIDO: coluna renomeada para "Ganhos rodada atual"
function TabelaMelhorias({ linhas = [] }) {
  return (
    <div className="laudo-rodadas-table-wrap">
      <table className="laudo-rodadas-table">
        <thead>
          <tr>
            <th>Rota/Cotação</th>
            <th>UF</th>
            <th className="right">Ganhos 1ª rodada (CT-es)</th>
            <th className="right">Ganhos rodada atual (CT-es)</th>
            <th className="right">Evolução</th>
            <th className="right">Aderência atual</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((item) => (
            <tr key={item.chave || item.rota}>
              <td><strong>{exibirCidade(item.rota || item.chave || '-')}</strong></td>
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

// CORRIGIDO: só renderiza se tiver dados; não duplica
function TabelaDestinoFaixaPareto({ linhas = [] }) {
  if (!linhas.length) return null;
  return (
    <section className="laudo-rodadas-section">
      <h2>Pareto 80% — Destino x Faixa</h2>
      <p>Recorte com ~80% do volume total (ganhos + perdidos) por origem, destino e faixa. O objetivo é mostrar onde está o volume e quanto se perde — redução média só nos CT-es perdidos.</p>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Origem → Destino/UF</th><th>Faixa</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">CT-es ganhos</th><th className="right">CT-es perdidos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Redução média (perdidos)</th></tr></thead>
          <tbody>
            {linhas.map((item, idx) => (
              <tr key={item.chave || idx}>
                <td><strong>{exibirCidade(item.rotaDestino || [item.origem, item.destino ? item.destino + (item.ufDestino ? '/' + item.ufDestino : '') : item.ufDestino].filter(Boolean).join(' → ') || '-')}</strong></td>
                <td>{item.faixa || '-'}</td>
                <td className="right">{numero(item.ctes)}</td>
                <td className="right">{numero(item.volumes)}</td>
                <td className="right">{percentual(item.pctVolume ?? item.pctPareto)}</td>
                <td className="right">{percentual(item.pctAcumulado)}</td>
                <td className="right">{numero(item.ctesGanhos)}</td>
                <td className="right">{numero(item.ctesPerdidos)}</td>
                <td className="right">{percentual(item.aderencia)}</td>
                <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                <td className="right">{percentual(item.ajusteMedio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TabelaFaixas({ titulo, linhas = [] }) {
  if (!linhas.length) return null;
  return (
    <section className="laudo-rodadas-section">
      <h2>{titulo}</h2>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Origem</th><th>UF destino</th><th>Destino</th><th>Faixa</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>
          <tbody>{linhas.map((item) => (<tr key={item.chave || [item.origem, item.ufDestino, item.rota, item.faixa].filter(Boolean).join('-')}><td>{exibirCidade(item.origem) || '-'}</td><td>{item.ufDestino || '-'}</td><td><strong>{exibirCidade(item.rota || item.cotacao) || '-'}</strong></td><td><strong>{item.faixa || '-'}</strong></td><td className="right">{numero(item.ctesPerdidos)}</td><td className="right">{numero(item.ctesGanhos)}</td><td className="right">{percentual(item.aderencia)}</td><td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td><td className="right">{percentual(item.ajusteMedio)}</td><td><span className={'laudo-rodadas-badge ' + prioridadeClasse(item.prioridade)}>{item.prioridade || 'BAIXA'}</span></td></tr>))}</tbody>
        </table>
      </div>
    </section>
  );
}

// CORRIGIDO: fonte única (paretoCidades), sem duplicata, oculta se vazio
function TabelaParetoCidades({ linhas = [] }) {
  if (!linhas.length) return null;
  return (
    <section className="laudo-rodadas-section">
      <h2>Pareto 80% das cidades por volume total</h2>
      <p>Cidades que concentram ~80% do volume total da última rodada (todos os CT-es). Dentro desse recorte aparecem ganhos, perdas e faturamento não capturado — para priorizar onde baixar preço.</p>
      <div className="laudo-rodadas-table-wrap">
        <table className="laudo-rodadas-table">
          <thead><tr><th>Origem → Destino/UF</th><th className="right">CT-es</th><th className="right">Volumes</th><th className="right">% volume</th><th className="right">% acumulado</th><th className="right">CT-es ganhos</th><th className="right">CT-es perdidos</th><th className="right">Aderência</th><th className="right">Fat. capturado</th><th className="right">Fat. não capturado</th><th className="right">Redução média (perdidos)</th></tr></thead>
          <tbody>{linhas.map((item) => (<tr key={item.chave || item.rotaDestino || item.cidade}><td><strong>{exibirCidade(item.rotaDestino || [item.origem, item.cidade ? item.cidade + (item.ufDestino ? '/' + item.ufDestino : '') : item.ufDestino].filter(Boolean).join(' → ') || '-')}</strong></td><td className="right">{numero(item.ctes)}</td><td className="right">{numero(item.volumes)}</td><td className="right">{percentual(item.pctVolume ?? item.pctPareto)}</td><td className="right">{percentual(item.pctAcumulado)}</td><td className="right">{numero(item.ctesGanhos)}</td><td className="right">{numero(item.ctesPerdidos)}</td><td className="right">{percentual(item.aderencia)}</td><td className="right">{dinheiro(item.faturamentoCapturado || item.freteRealizado)}</td><td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td><td className="right">{percentual(item.ajusteMedio || item.reducaoMedia)}</td></tr>))}</tbody>
        </table>
      </div>
    </section>
  );
}

function TabelaSimples({ titulo, linhas = [], tipo = 'uf' }) {
  if (!linhas.length) return null;
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
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LaudoRodadasNegociacaoTemplate({ tipo = 'executivo', tabela = null, dados = null, onFeedback = null }) {
  const laudoRef = useRef(null);
  const laudos = dados ? null : montarLaudosRodadasNegociacao(tabela || {});
  const laudo = dados || (tipo === 'transportador' ? laudos.transportador : laudos.executivo);
  const externo = laudoRodadasExterno(laudo, tipo);
  const comparativo = laudo.comparativo || {};
  const inicial = comparativo.inicial || {};
  const atual = comparativo.atual || {};
  const poucaBase = Number(laudo.quantidadeSimulacoes || 0) < 2;
  const mesorregioesReais = (laudo.mesorregiaoFaixas || []).filter((item) => mesorregiaoReal(item.mesorregiao || item.rota));
  const paretoLinhas = (laudo.paretoCidades || laudo.cidadesParetoVolume || []).slice(0, 20);

  function handlePdf() {
    if (!laudoRef.current) return;
    gerarLaudoRodadasPdf(laudoRef.current, laudo);
  }

  function handleHtml() {
    if (!laudoRef.current) return;
    baixarLaudoRodadasHtml(laudoRef.current, laudo, tipo);
  }

  function handleExcel() {
    baixarLaudoRodadasExcel(laudo, tipo);
  }

  function handleTexto() {
    baixarLaudoRodadasTexto(laudo, tipo);
  }

  function handleEmail() {
    baixarLaudoRodadasEmail(laudo, tipo);
  }

  // Label dinâmico: "Redução" ou "Variação" dependendo do sinal
  const labelVariacaoNf = atual.fretePropostaAcima ? 'Variação sobre NF' : 'Redução sobre NF';
  const variacaoNfPp = (atual.percentualFreteTabela || 0) - (atual.percentualFreteReal || 0);

  return (
    <article className="laudo-rodadas-page" ref={laudoRef}>
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
        <div className="laudo-rodadas-actions">
          <button type="button" className="primary" onClick={handlePdf}>Gerar PDF</button>
          <button type="button" className="sim-tab" onClick={handleHtml}>Exportar HTML</button>
          <button type="button" className="sim-tab" onClick={handleExcel}>Baixar Excel</button>
          <button type="button" className="sim-tab" onClick={handleTexto}>Baixar laudo (.txt)</button>
          <button type="button" className="sim-tab" onClick={handleEmail}>Baixar e-mail (.txt)</button>
          <LaudoEmailAcoes laudo={laudo} onFeedback={onFeedback} compact />
        </div>

        {externo ? (
          <div className="laudo-rodadas-alert">Este relatório mostra oportunidades de ajuste comercial por rota, cotação, UF e faixa de peso. Não expõe referências internas nem concorrentes.</div>
        ) : (
          <div className="laudo-rodadas-alert danger">Uso interno: contém saving, impacto financeiro e recomendação estratégica. Não enviar esta versão ao transportador.</div>
        )}

        {poucaBase ? (
          <div className="laudo-rodadas-alert warn">Para análise completa de evolução, o ideal é ter pelo menos duas simulações salvas. Com uma única rodada, o laudo mostra apenas o diagnóstico atual.</div>
        ) : null}

        {comparativo.baseMudou ? (
          <div className="laudo-rodadas-alert warn">⚠ A base de CT-es analisados mudou entre as rodadas. A variação de aderência deve ser comparada com cautela.</div>
        ) : null}

        <section className="laudo-rodadas-kpis">
          <div className="laudo-rodadas-kpi"><span>Aderência da proposta</span><strong>{percentual(atual.aderencia)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoAderencia} tipo="percentual" sufixo=" p.p." /> : <small>Diagnóstico atual</small>}</div>
          <div className="laudo-rodadas-kpi"><span>CT-es que a proposta captura</span><strong>{numero(atual.ctesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoCtesGanhos} /> : <small>Base competitiva</small>}</div>
          <div className="laudo-rodadas-kpi"><span>Volumes que a proposta captura</span><strong>{numero(atual.volumesGanhos)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoVolumes} /> : <small>Volume competitivo</small>}</div>
          <div className="laudo-rodadas-kpi"><span>Faturamento potencial capturado/mês</span><strong>{dinheiro(atual.faturamentoMes)}</strong>{!poucaBase ? <Variacao valor={comparativo.evolucaoFaturamentoMes} tipo="dinheiro" /> : <small>Estimativa mensal</small>}</div>
          {!externo ? <div className="laudo-rodadas-kpi"><span>Saving/mês</span><strong>{dinheiro(atual.savingMes)}</strong><Variacao valor={comparativo.evolucaoSavingMes} tipo="dinheiro" /></div> : null}
          <div className="laudo-rodadas-kpi"><span>Frete atual sobre NF</span><strong>{percentual(atual.percentualFreteReal)}</strong><small>Cargas ganhas — base realizada</small></div>
          <div className="laudo-rodadas-kpi"><span>Frete da proposta sobre NF</span><strong>{percentual(atual.percentualFreteTabela)}</strong><small>Cargas ganhas — tabela simulada</small></div>
          <div className="laudo-rodadas-kpi"><span>{labelVariacaoNf}</span><strong>{percentualPp(variacaoNfPp)}</strong><small>Meta frete/NF</small></div>
          <div className="laudo-rodadas-kpi"><span>Redução média para capturar volume perdido</span><strong>{percentual(atual.reducaoMedia)}</strong><small>Cargas ainda não competitivas</small></div>
        </section>

        <VeiculoOperacionalLaudoCard dados={laudo.veiculoOperacional || atual.veiculoOperacional} />

        <section className="laudo-rodadas-section">
          <h2>{poucaBase ? 'Diagnóstico inicial' : 'Resumo da evolução'}</h2>
          <p>{diagnosticoResumoTexto({ externo, poucaBase, atual, inicial, comparativo })}</p>
        </section>

        <section className="laudo-rodadas-section">
          <h2>Evolução rodada a rodada</h2>
          <TabelaEvolucao linhas={laudo.evolucaoRodadas || []} externo={externo} baseMudou={comparativo.baseMudou} />
        </section>

        {!poucaBase && (laudo.rotasMelhoraram || laudo.ondeMelhorou || []).length > 0 ? (
          <section className="laudo-rodadas-section">
            <h2>{externo ? 'Onde a proposta melhorou' : 'Rotas/Cotações que evoluíram'}</h2>
            <TabelaMelhorias linhas={(laudo.rotasMelhoraram || laudo.ondeMelhorou || []).slice(0, 10)} />
          </section>
        ) : null}

        {/* Pareto de cidades — fonte única, oculta se vazio */}
        <TabelaParetoCidades linhas={paretoLinhas} />

        <TabelaSimples titulo="Visão por Estado/UF" linhas={listaLaudoSegura(laudo?.ufsCriticas, laudo?.ufsPrioritarias).slice(0, 8)} tipo="uf" />

        {mesorregioesReais.length ? (
          <section className="laudo-rodadas-section">
            <h2>Mesorregião x Faixa</h2>
            <p>Agrupamento regional por mesorregião do IBGE e faixa de peso, para direcionar ajustes sem depender do nome comercial da cotação.</p>
            <div className="laudo-rodadas-table-wrap">
              <table className="laudo-rodadas-table">
                <thead><tr><th>Origem</th><th>UF destino</th><th>Mesorregião</th><th>Faixa</th><th className="right">CT-es perdidos</th><th className="right">CT-es ganhos</th><th className="right">Aderência</th><th className="right">Fat. não capturado</th><th className="right">Ajuste médio</th><th>Prioridade</th></tr></thead>
                <tbody>
                  {mesorregioesReais.slice(0, 25).map((item, idx) => (
                    <tr key={idx}>
                      <td>{exibirCidade(item.origem) || '-'}</td>
                      <td>{item.ufDestino || '-'}</td>
                      <td><strong>{exibirCidade(item.mesorregiao || item.rota) || '-'}</strong></td>
                      <td>{item.faixa || '-'}</td>
                      <td className="right">{numero(item.ctesPerdidos)}</td>
                      <td className="right">{numero(item.ctesGanhos)}</td>
                      <td className="right">{percentual(item.aderencia)}</td>
                      <td className="right">{dinheiro(item.faturamentoNaoCapturado)}</td>
                      <td className="right">{percentual(item.ajusteMedio)}</td>
                      <td><span className={`laudo-rodadas-badge ${prioridadeClasse(item.prioridade)}`}>{item.prioridade || 'BAIXA'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <TabelaDestinoFaixaPareto linhas={(laudo.destinoFaixaPareto || []).slice(0, 30)} />

        <section className="laudo-rodadas-section">
          <h2>Recomendação final</h2>
          <div className="laudo-rodadas-recomendacao">{laudo.recomendacao}</div>
        </section>
      </div>
    </article>
  );
}
