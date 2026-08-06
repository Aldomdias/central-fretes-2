import React, { useEffect, useMemo, useRef, useState } from 'react';
import { gestaoStyles } from './GestaoStyles';
import { formatarData } from '../../utils/tabelasNegociacaoGestao';
import { listarRealizadoLocalCtesParaSimulacao, listarTransportadorasRealizadoReajustes } from '../../services/freteDatabaseService';
import { atualizarDataReferenciaSaving, atualizarVinculoTransportadoraSaving, salvarSavingPosAprovacaoCache } from '../../services/tabelasNegociacaoService';
import { normalizarTextoReajuste } from '../../utils/reajustesLocal';
import { calcularJanelasSaving, calcularSavingPorRotaFaixa, MESES_BASE_SAVING_PADRAO } from '../../utils/savingsPosAprovacaoNegociacao';

// Filtro de transportadora é feito no cliente como reforço (não é o filtro principal):
// ilike com wildcard nas duas pontas não usa índice em realizado_local_ctes, então a
// consulta já filtra no servidor (ilike ou lista exata de vínculo) e isso aqui só
// blinda contra falso-positivo de nome parcial.
function filtrarLinhasPorTransportadora(linhas = [], nomeTransportadora = '') {
  const alvo = normalizarTextoReajuste(nomeTransportadora);
  if (!alvo) return linhas;
  return (linhas || []).filter((row) => {
    const nome = normalizarTextoReajuste(row.transportadora || row.nomeTransportadora || '');
    return nome === alvo || nome.includes(alvo) || alvo.includes(nome);
  });
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatPercent(value) {
  return `${(Number(value || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

const STATUS_ELEGIVEIS = ['APROVADA_GESTOR', 'PUBLICADA_OFICIAL'];

function nomeArquivoSeguro(v) {
  return String(v || 'relatorio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function linhaTabelaHtml(cols) {
  return `<tr>${cols.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`;
}

function gerarHtmlLaudoSavings(negociacoes = [], resultados = {}) {
  const dataRef = new Date().toLocaleString('pt-BR');
  const calculadas = negociacoes.filter((item) => resultados[item.id]);
  const pendentes = negociacoes.filter((item) => !resultados[item.id]);
  const savingTotal = calculadas.reduce((acc, item) => acc + (resultados[item.id]?.totais.saving || 0), 0);
  const positivas = calculadas.filter((item) => (resultados[item.id]?.totais.saving || 0) >= 0).length;
  const negativas = calculadas.length - positivas;

  const porTransportadora = new Map();
  calculadas.forEach((item) => {
    const r = resultados[item.id];
    const atual = porTransportadora.get(item.transportadora) || {
      transportadora: item.transportadora, canal: item.canal, qtd: 0, saving: 0, rotas: 0, aprovadoEm: item.aprovadoEm,
    };
    atual.qtd += 1;
    atual.saving += r.totais.saving || 0;
    atual.rotas += r.linhas.length;
    if (String(item.aprovadoEm) > String(atual.aprovadoEm)) atual.aprovadoEm = item.aprovadoEm;
    porTransportadora.set(item.transportadora, atual);
  });
  const rankingTransportadoras = [...porTransportadora.values()].sort((a, b) => b.saving - a.saving);

  const cards = [
    ['Negociações aprovadas', negociacoes.length],
    ['Já calculadas', calculadas.length],
    ['Pendentes de cálculo', pendentes.length],
    ['Transportadoras acompanhadas', porTransportadora.size],
    ['Saving projetado (total)', formatMoney(savingTotal)],
    ['Com saving positivo', positivas],
    ['Com saving negativo', negativas],
  ];

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Laudo - Savings pós-aprovação</title>
  <style>
    body { margin: 0; background: #f4f6fa; color: #0f172a; font-family: Arial, sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    section { background: #fff; border: 1px solid #dbe4f0; border-radius: 10px; padding: 18px; margin-bottom: 16px; }
    h1 { margin: 0 0 4px; color: #001f4f; }
    h2 { margin: 0 0 12px; color: #001f4f; font-size: 18px; }
    .muted { color: #64748b; font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .card { border: 1px solid #dbe4f0; border-radius: 8px; padding: 12px; }
    .card span { color: #475569; font-size: 12px; display: block; }
    .card strong { display: block; margin-top: 6px; font-size: 20px; color: #001f4f; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #001f4f; }
    .pos { color: #087f3f; font-weight: 700; }
    .neg { color: #c1121f; font-weight: 700; }
    @media print { body { background: #fff; } main { padding: 0; max-width: none; } section { break-inside: avoid; } }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Laudo de savings pós-aprovação</h1>
      <div class="muted">Gerado em ${dataRef}. Compara o percentual de frete praticado pela transportadora hoje contra o mercado (todas as transportadoras) na mesma rota/faixa, antes da negociação.</div>
    </section>
    <section>
      <h2>Resumo geral</h2>
      <div class="cards">
        ${cards.map(([label, value]) => `<div class="card"><span>${label}</span><strong>${value}</strong></div>`).join('')}
      </div>
    </section>
    <section>
      <h2>Saving projetado por transportadora</h2>
      <table>
        <thead><tr><th>Transportadora</th><th>Canal</th><th>Negociações</th><th>Rotas comparáveis</th><th>Saving</th></tr></thead>
        <tbody>
          ${rankingTransportadoras.map((t) => linhaTabelaHtml([
            t.transportadora,
            t.canal,
            t.qtd,
            t.rotas,
            `<span class="${t.saving >= 0 ? 'pos' : 'neg'}">${formatMoney(t.saving)}</span>`,
          ])).join('') || linhaTabelaHtml(['Nenhuma negociação calculada ainda', '', '', '', ''])}
        </tbody>
        <tfoot>
          <tr><td colspan="4"><strong>Total geral</strong></td><td><strong>${formatMoney(savingTotal)}</strong></td></tr>
        </tfoot>
      </table>
    </section>
    <section>
      <h2>Acompanhamento — negociações já calculadas</h2>
      <table>
        <thead><tr><th>Transportadora</th><th>Negociação</th><th>Canal</th><th>Aprovado em</th><th>Rotas</th><th>Saving</th></tr></thead>
        <tbody>
          ${calculadas.map((item) => {
            const r = resultados[item.id];
            return linhaTabelaHtml([
              item.transportadora,
              item.nome,
              item.canal,
              formatarData(item.aprovadoEm),
              r.linhas.length,
              `<span class="${r.totais.saving >= 0 ? 'pos' : 'neg'}">${formatMoney(r.totais.saving)}</span>`,
            ]);
          }).join('') || linhaTabelaHtml(['Nenhuma negociação calculada ainda', '', '', '', '', ''])}
        </tbody>
      </table>
    </section>
    <section>
      <h2>Pendentes de cálculo</h2>
      <table>
        <thead><tr><th>Transportadora</th><th>Negociação</th><th>Canal</th><th>Aprovado em</th></tr></thead>
        <tbody>
          ${pendentes.map((item) => linhaTabelaHtml([
            item.transportadora, item.nome, item.canal, formatarData(item.aprovadoEm),
          ])).join('') || linhaTabelaHtml(['Todas as negociações aprovadas já foram calculadas', '', '', ''])}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function baixarLaudoSavings(negociacoes, resultados) {
  const html = gerarHtmlLaudoSavings(negociacoes, resultados);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${nomeArquivoSeguro('laudo-savings-pos-aprovacao')}-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

export default function GestaoSavingsAprovados({ tabelas = [] }) {
  const [resultados, setResultados] = useState({});
  const [carregando, setCarregando] = useState({});
  const [erros, setErros] = useState({});
  const [abertos, setAbertos] = useState({});
  const [datasReferencia, setDatasReferencia] = useState({});
  const [salvandoData, setSalvandoData] = useState({});
  const [vinculos, setVinculos] = useState({});
  const [vinculosAbertos, setVinculosAbertos] = useState({});
  const [salvandoVinculo, setSalvandoVinculo] = useState({});
  const [nomesRealizado, setNomesRealizado] = useState([]);
  const [carregandoNomes, setCarregandoNomes] = useState(false);
  const [buscaVinculo, setBuscaVinculo] = useState({});
  const [calculandoTodas, setCalculandoTodas] = useState(false);
  const [progressoTodas, setProgressoTodas] = useState(null);
  // Cache da consulta "base" (mercado inteiro) por canal+período — várias negociações
  // do mesmo canal com a mesma janela reaproveitam a mesma busca em vez de repetir
  // uma consulta pesada (empresa inteira) pra cada transportadora em "Calcular todas".
  const cacheBaseRef = useRef(new Map());

  const negociacoesAprovadas = useMemo(() => {
    return (tabelas || [])
      .filter((t) => STATUS_ELEGIVEIS.includes(t.status_gestao) && t.transportadora && t.aprovado_em)
      .map((t) => ({
        id: t.id,
        transportadora: t.transportadora,
        nome: t.descricao || t.nome_negociacao || t.transportadora,
        origem: t.origem || '',
        canal: t.canal || '',
        aprovadoEm: t.aprovado_em,
        dataReferenciaSalva: t.data_referencia_saving || t.aprovado_em,
        vinculoSalvo: Array.isArray(t.vinculo_transportadoras_saving) ? t.vinculo_transportadoras_saving : [],
        publicadoEm: t.publicado_em || '',
        statusGestao: t.status_gestao,
        savingCache: t.saving_pos_aprovacao_detalhe || null,
        savingCacheCalculadoEm: t.saving_pos_aprovacao_calculado_em || '',
      }))
      .sort((a, b) => String(b.aprovadoEm).localeCompare(String(a.aprovadoEm)));
  }, [tabelas]);

  // Hidrata o resultado a partir do cache salvo no banco (sobrevive a um F5),
  // sem sobrescrever um cálculo já feito nesta sessão.
  useEffect(() => {
    setResultados((prev) => {
      let mudou = false;
      const next = { ...prev };
      negociacoesAprovadas.forEach((item) => {
        if (!next[item.id] && item.savingCache) {
          next[item.id] = { ...item.savingCache, deCache: true };
          mudou = true;
        }
      });
      return mudou ? next : prev;
    });
  }, [negociacoesAprovadas]);

  function dataReferenciaAtual(item) {
    return String(datasReferencia[item.id] || item.dataReferenciaSalva || item.aprovadoEm).slice(0, 10);
  }

  function vinculoAtual(item) {
    return vinculos[item.id] || item.vinculoSalvo || [];
  }

  async function salvarDataReferencia(item, novaData) {
    setSalvandoData((prev) => ({ ...prev, [item.id]: true }));
    setErros((prev) => ({ ...prev, [item.id]: '' }));
    try {
      await atualizarDataReferenciaSaving(item.id, novaData);
      setDatasReferencia((prev) => ({ ...prev, [item.id]: novaData }));
      setResultados((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (err) {
      setErros((prev) => ({ ...prev, [item.id]: err?.message || 'Erro ao salvar a data de referência.' }));
    } finally {
      setSalvandoData((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function abrirBuscaVinculos(item) {
    setVinculosAbertos((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
    setBuscaVinculo((prev) => ({ ...prev, [item.id]: prev[item.id] ?? item.transportadora }));
    if (!nomesRealizado.length && !carregandoNomes) {
      setCarregandoNomes(true);
      try {
        const lista = await listarTransportadorasRealizadoReajustes();
        setNomesRealizado(lista);
      } catch (err) {
        setErros((prev) => ({ ...prev, [item.id]: err?.message || 'Erro ao buscar transportadoras do realizado.' }));
      } finally {
        setCarregandoNomes(false);
      }
    }
  }

  function alternarVinculo(item, nome) {
    setVinculos((prev) => {
      const atual = prev[item.id] || item.vinculoSalvo || [];
      const existe = atual.includes(nome);
      const proximo = existe ? atual.filter((n) => n !== nome) : [...atual, nome];
      return { ...prev, [item.id]: proximo };
    });
  }

  async function salvarVinculo(item) {
    const lista = vinculoAtual(item);
    setSalvandoVinculo((prev) => ({ ...prev, [item.id]: true }));
    setErros((prev) => ({ ...prev, [item.id]: '' }));
    try {
      await atualizarVinculoTransportadoraSaving(item.id, lista);
      setResultados((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (err) {
      setErros((prev) => ({ ...prev, [item.id]: err?.message || 'Erro ao salvar o vínculo de transportadora.' }));
    } finally {
      setSalvandoVinculo((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  function resultadosBusca(item) {
    const termo = normalizarTextoReajuste(buscaVinculo[item.id] ?? item.transportadora);
    const lista = nomesRealizado.filter((n) => !termo || normalizarTextoReajuste(n.nome).includes(termo));
    return lista.slice(0, 40);
  }

  async function calcularSaving(item, { abrirDepois = true } = {}) {
    const dataReferencia = dataReferenciaAtual(item);
    const janelas = calcularJanelasSaving(dataReferencia, MESES_BASE_SAVING_PADRAO);
    if (!janelas) {
      setErros((prev) => ({ ...prev, [item.id]: 'Data de referência inválida.' }));
      return;
    }
    setCarregando((prev) => ({ ...prev, [item.id]: true }));
    setErros((prev) => ({ ...prev, [item.id]: '' }));
    try {
      const vinculoLista = vinculoAtual(item);
      // Se houver vínculo manual, usa lista exata (rápido, indexado). Senão cai no
      // ilike pelo nome da negociação — pode não achar tudo se o nome cadastrado
      // divergir do nome usado no realizado; por isso o botão "Buscar vínculos".
      const filtroTransportadora = vinculoLista.length
        ? { transportadorasExatas: vinculoLista }
        : { transportadoraRealizada: item.transportadora };

      // A base NÃO é filtrada por transportadora: é o percentual praticado por
      // TODAS as transportadoras na mesma rota+faixa, nos meses anteriores à data
      // de referência — o "preço de mercado" daquela rota antes da negociação.
      // O "atual" é só desta transportadora, que pode ser nova na rota (sem
      // histórico próprio) — é justamente esse o caso que o saving mede.
      // Filtra canal no servidor (rápido, indexado) — AMBOS já entra na lista de
      // variantes de qualquer canal, então não perde CT-e nenhum.
      const chaveCacheBase = `${item.canal}|${janelas.inicioBase}|${janelas.fimBase}`;
      let promiseBase = cacheBaseRef.current.get(chaveCacheBase);
      if (!promiseBase) {
        promiseBase = listarRealizadoLocalCtesParaSimulacao({
          canal: item.canal || undefined,
          inicio: janelas.inicioBase,
          fim: janelas.fimBase,
        });
        cacheBaseRef.current.set(chaveCacheBase, promiseBase);
        promiseBase.catch(() => cacheBaseRef.current.delete(chaveCacheBase));
      }

      const [linhasBaseBruto, linhasAtualBruto] = await Promise.all([
        promiseBase,
        listarRealizadoLocalCtesParaSimulacao({
          ...filtroTransportadora,
          inicio: janelas.inicioAtual,
          fim: janelas.fimAtual,
        }),
      ]);
      const linhasAtual = vinculoLista.length ? linhasAtualBruto : filtrarLinhasPorTransportadora(linhasAtualBruto, item.transportadora);
      const resultado = calcularSavingPorRotaFaixa(linhasBaseBruto, linhasAtual, { canalPadrao: item.canal });
      const resultadoCompleto = { ...resultado, janelas, ctesBase: linhasBaseBruto.length, ctesAtual: linhasAtual.length, deCache: false, calculadoEm: new Date().toISOString() };
      setResultados((prev) => ({ ...prev, [item.id]: resultadoCompleto }));
      if (abrirDepois) setAbertos((prev) => ({ ...prev, [item.id]: true }));
      // Salva o resultado no banco pra sobreviver a um F5 — se der erro (ex: migration
      // ainda não aplicada), o cálculo em tela continua valendo, só não persiste.
      salvarSavingPosAprovacaoCache(item.id, resultadoCompleto).catch(() => {});
    } catch (err) {
      setErros((prev) => ({ ...prev, [item.id]: err?.message || 'Erro ao calcular saving.' }));
    } finally {
      setCarregando((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function calcularTodas() {
    setCalculandoTodas(true);
    for (let i = 0; i < negociacoesAprovadas.length; i += 1) {
      const item = negociacoesAprovadas[i];
      setProgressoTodas({ atual: i + 1, total: negociacoesAprovadas.length, transportadora: item.transportadora });
      // eslint-disable-next-line no-await-in-loop
      await calcularSaving(item, { abrirDepois: false });
    }
    setProgressoTodas(null);
    setCalculandoTodas(false);
  }

  function verDetalhe(item) {
    setAbertos((prev) => ({ ...prev, [item.id]: true }));
    const el = document.getElementById(`saving-item-${item.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const negociacoesCalculadas = negociacoesAprovadas.filter((item) => resultados[item.id]);
  const negociacoesPendentes = negociacoesAprovadas.filter((item) => !resultados[item.id]);
  const savingTotal = negociacoesCalculadas.reduce((acc, item) => acc + (resultados[item.id]?.totais.saving || 0), 0);
  const transportadorasAcompanhadas = new Set(negociacoesCalculadas.map((item) => item.transportadora)).size;
  const kpis = [
    { label: 'Aprovadas', value: negociacoesAprovadas.length },
    { label: 'Já calculadas', value: negociacoesCalculadas.length },
    { label: 'Pendentes', value: negociacoesPendentes.length },
    { label: 'Transportadoras', value: transportadorasAcompanhadas },
    { label: 'Saving projetado', value: formatMoney(savingTotal) },
  ];

  return (
    <section className="sim-card">
      <h2 style={{ marginTop: 0 }}>Savings pós-aprovação</h2>
      <p style={{ color: '#64748b' }}>
        Transportadoras já aprovadas pelo gestor. Para cada rota + faixa de peso que a transportadora carrega hoje,
        compara com o percentual médio de frete praticado por TODAS as transportadoras nessa mesma rota/faixa nos
        {' '}{MESES_BASE_SAVING_PADRAO} meses antes da data de referência, e projeta o saving sobre o valor de NF atual.
      </p>

      {!negociacoesAprovadas.length ? (
        <div className="sim-alert info">Nenhuma negociação aprovada pelo gestor até o momento.</div>
      ) : (
        <>
          <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 4 }}>
            {kpis.map((c) => (
              <div key={c.label} className="summary-card">
                <span>{c.label}</span>
                <strong>{c.value}</strong>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" className="sim-tab" onClick={calcularTodas} disabled={calculandoTodas}>
              {calculandoTodas ? 'Calculando todas…' : negociacoesPendentes.length ? 'Calcular todas (pendentes)' : 'Recalcular todas'}
            </button>
            <button
              type="button"
              className="sim-tab"
              onClick={() => baixarLaudoSavings(negociacoesAprovadas, resultados)}
              disabled={!negociacoesCalculadas.length}
              title={!negociacoesCalculadas.length ? 'Calcule ao menos uma negociação para gerar o laudo' : ''}
            >
              Gerar laudo
            </button>
          </div>

          {progressoTodas ? (
            <div style={{ marginTop: 10, maxWidth: 420 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#334155', marginBottom: 4 }}>
                <span>Calculando {progressoTodas.atual}/{progressoTodas.total} · <strong>{progressoTodas.transportadora}</strong></span>
                <span>{Math.round((progressoTodas.atual / progressoTodas.total) * 100)}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(progressoTodas.atual / progressoTodas.total) * 100}%`, background: '#3b82f6', transition: 'width 0.3s' }} />
              </div>
            </div>
          ) : null}
        </>
      )}

      {negociacoesAprovadas.length ? (
        <div style={{ marginTop: 14, ...gestaoStyles.tabelaWrap }}>
          <table className="sim-table">
            <thead>
              <tr>
                <th>Transportadora</th>
                <th>Negociação</th>
                <th>Origem</th>
                <th>Canal</th>
                <th>Aprovado em</th>
                <th>Status</th>
                <th>Rotas comparáveis</th>
                <th>Saving</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {negociacoesAprovadas.map((item) => {
                const r = resultados[item.id];
                return (
                  <tr key={item.id}>
                    <td><strong>{item.transportadora}</strong></td>
                    <td>{item.nome}</td>
                    <td>{item.origem || '—'}</td>
                    <td>{item.canal}</td>
                    <td>{formatarData(item.aprovadoEm)}</td>
                    <td style={{ maxWidth: 260 }}>
                      {r ? (
                        <span style={gestaoStyles.badgeStatus('#087f3f')}>Calculado</span>
                      ) : carregando[item.id] ? (
                        <span style={gestaoStyles.badgeStatus('#1d4ed8')}>Calculando…</span>
                      ) : erros[item.id] ? (
                        <div>
                          <span style={gestaoStyles.badgeStatus('#c1121f')}>Erro</span>
                          <div style={{ fontSize: 11, color: '#c1121f', marginTop: 3 }}>{erros[item.id]}</div>
                        </div>
                      ) : (
                        <span style={gestaoStyles.badgeStatus('#b45309')}>Pendente</span>
                      )}
                    </td>
                    <td>{r ? r.linhas.length : '—'}</td>
                    <td style={{ fontWeight: 700, color: r ? (r.totais.saving >= 0 ? '#087f3f' : '#c1121f') : '#94a3b8' }}>
                      {r ? formatMoney(r.totais.saving) : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="sim-tab"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => (r ? verDetalhe(item) : calcularSaving(item))}
                        disabled={Boolean(carregando[item.id])}
                        title={!r && erros[item.id] ? erros[item.id] : ''}
                      >
                        {carregando[item.id] ? 'Calculando…' : r ? 'Ver detalhe' : erros[item.id] ? 'Tentar de novo' : 'Calcular'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}><strong>Total geral</strong></td>
                <td style={{ fontWeight: 800 }}>{formatMoney(savingTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        {negociacoesAprovadas.map((item) => {
          const resultado = resultados[item.id];
          const aberto = Boolean(abertos[item.id]);
          const vinculoLista = vinculoAtual(item);
          const vinculoMudou = JSON.stringify([...vinculoLista].sort()) !== JSON.stringify([...(item.vinculoSalvo || [])].sort());
          return (
            <div key={item.id} id={`saving-item-${item.id}`} style={gestaoStyles.origemCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{item.transportadora}</strong>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {item.nome}{item.origem ? ` · ${item.origem}` : ''}{item.canal ? ` · ${item.canal}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Aprovado no sistema em {formatarData(item.aprovadoEm)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 11, color: '#64748b' }}>Data de referência p/ saving:</label>
                    <input
                      type="date"
                      value={dataReferenciaAtual(item)}
                      onChange={(e) => setDatasReferencia((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                    />
                    {dataReferenciaAtual(item) !== String(item.dataReferenciaSalva).slice(0, 10) ? (
                      <button
                        type="button"
                        className="sim-tab"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        disabled={Boolean(salvandoData[item.id])}
                        onClick={() => salvarDataReferencia(item, dataReferenciaAtual(item))}
                      >
                        {salvandoData[item.id] ? 'Salvando…' : 'Salvar data'}
                      </button>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="sim-tab"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => abrirBuscaVinculos(item)}
                    >
                      {vinculoLista.length ? `Vínculo: ${vinculoLista.length} nome(s)` : 'Buscar vínculos'}
                    </button>
                  </div>
                  {vinculosAbertos[item.id] ? (
                    <div style={{ marginTop: 8, padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, maxWidth: 480 }}>
                      {carregandoNomes ? (
                        <div style={{ fontSize: 12, color: '#64748b' }}>Carregando transportadoras do realizado…</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                            Pesquise e marque o(s) nome(s) exatos usados no realizado que correspondem a "{item.transportadora}":
                          </div>
                          <input
                            type="text"
                            value={buscaVinculo[item.id] ?? item.transportadora}
                            onChange={(e) => setBuscaVinculo((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="Pesquisar transportadora…"
                            style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', marginBottom: 8 }}
                          />
                          <div style={{ display: 'grid', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                            {resultadosBusca(item).length ? resultadosBusca(item).map((n) => (
                              <label key={n.nome} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input
                                  type="checkbox"
                                  checked={vinculoLista.includes(n.nome)}
                                  onChange={() => alternarVinculo(item, n.nome)}
                                />
                                {n.nome} <span style={{ color: '#94a3b8' }}>({n.ctes} CT-es)</span>
                              </label>
                            )) : (
                              <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhum resultado para essa busca.</div>
                            )}
                          </div>
                          {vinculoLista.length ? (
                            <div style={{ fontSize: 11, color: '#1d4ed8', marginTop: 6 }}>
                              Selecionados: {vinculoLista.join(', ')}
                            </div>
                          ) : null}
                          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              className="sim-tab"
                              style={{ padding: '3px 8px', fontSize: 11 }}
                              disabled={!vinculoMudou || Boolean(salvandoVinculo[item.id])}
                              onClick={() => salvarVinculo(item)}
                            >
                              {salvandoVinculo[item.id] ? 'Salvando…' : 'Salvar vínculo'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {resultado ? (
                    <>
                      <strong style={{ color: resultado.totais.saving >= 0 ? '#087f3f' : '#c1121f' }}>
                        Saving: {formatMoney(resultado.totais.saving)}
                      </strong>
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>
                        {resultado.deCache
                          ? `salvo em ${formatarData(item.savingCacheCalculadoEm)}`
                          : 'calculado agora'}
                      </span>
                    </>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="sim-tab"
                      onClick={() => (resultado ? setAbertos((prev) => ({ ...prev, [item.id]: !aberto })) : calcularSaving(item))}
                      disabled={Boolean(carregando[item.id])}
                    >
                      {carregando[item.id] ? 'Calculando…' : resultado ? (aberto ? 'Ocultar' : 'Ver detalhe') : 'Calcular saving'}
                    </button>
                    {resultado ? (
                      <button
                        type="button"
                        className="sim-tab"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => calcularSaving(item)}
                        disabled={Boolean(carregando[item.id])}
                      >
                        Recalcular
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {erros[item.id] ? <div className="sim-alert erro" style={{ marginTop: 8 }}>{erros[item.id]}</div> : null}

              {resultado && aberto ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                    Base (mercado, todas as transportadoras): {formatarData(resultado.janelas.inicioBase)} a {formatarData(resultado.janelas.fimBase)} ({resultado.ctesBase} CT-es) ·
                    {' '}Atual (só essa transportadora): {formatarData(resultado.janelas.inicioAtual)} a {formatarData(resultado.janelas.fimAtual)} ({resultado.ctesAtual} CT-es)
                  </div>
                  {!resultado.linhas.length ? (
                    <div className="sim-alert info">
                      {resultado.ctesAtual === 0
                        ? 'Não há CT-e nenhum dessa transportadora no período atual (ou com esse vínculo). Confira a data de referência e o vínculo de transportadora.'
                        : 'Nenhuma rota/faixa do período atual dessa transportadora teve preço de mercado comparável na base (nenhuma outra transportadora rodou nessas mesmas rotas/faixas antes).'}
                    </div>
                  ) : (
                    <div style={gestaoStyles.tabelaWrap}>
                      <table className="sim-table">
                        <thead>
                          <tr>
                            <th>Rota</th>
                            <th>Faixa</th>
                            <th>% antes</th>
                            <th>% atual</th>
                            <th>Diferença</th>
                            <th>Valor NF atual</th>
                            <th>Saving</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultado.linhas.map((linha) => (
                            <tr key={`${linha.rota}||${linha.faixa}`}>
                              <td>{linha.rota}</td>
                              <td>{linha.faixa}</td>
                              <td>{formatPercent(linha.pctBase)}</td>
                              <td>{formatPercent(linha.pctAtual)}</td>
                              <td style={{ color: linha.diffPct >= 0 ? '#087f3f' : '#c1121f', fontWeight: 700 }}>
                                {formatPercent(linha.diffPct)}
                              </td>
                              <td>{formatMoney(linha.valorNFAtual)}</td>
                              <td style={{ fontWeight: 700 }}>{formatMoney(linha.saving)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={2}><strong>Total</strong></td>
                            <td>{formatPercent(resultado.totais.pctBaseMedio)}</td>
                            <td>{formatPercent(resultado.totais.pctAtualMedio)}</td>
                            <td>{formatPercent(resultado.totais.pctBaseMedio - resultado.totais.pctAtualMedio)}</td>
                            <td>{formatMoney(resultado.totais.valorNFAtual)}</td>
                            <td style={{ fontWeight: 800 }}>{formatMoney(resultado.totais.saving)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
