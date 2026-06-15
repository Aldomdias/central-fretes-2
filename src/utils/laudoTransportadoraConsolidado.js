import {
  montarLaudosRodadasNegociacao,
  formatadoresLaudoRodadas,
  aplicarCortePareto80ComMinimoRotas,
} from './laudosRodadasNegociacaoHtml.js';
import { enriquecerTabelaGestao } from './tabelasNegociacaoGestao.js';

const { dinheiro, percentual, dataBR } = formatadoresLaudoRodadas;

function texto(v) { return String(v ?? '').trim(); }
function upper(v) { return texto(v).toUpperCase(); }
function n(v) { const x = Number(v || 0); return Number.isFinite(x) ? x : 0; }

/** Meses inclusivos entre duas datas ISO (mesma regra do Simulador). */
function mesesEntreDatas(inicio = '', fim = '') {
  const ini = texto(inicio);
  const end = texto(fim);
  if (!ini || !end) return 0;
  const dIni = new Date(`${ini}T00:00:00`);
  const dFim = new Date(`${end}T00:00:00`);
  if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFim.getTime())) return 0;
  const meses = (dFim.getFullYear() - dIni.getFullYear()) * 12 + (dFim.getMonth() - dIni.getMonth()) + 1;
  return Math.max(Number.isFinite(meses) ? meses : 0, 0);
}

/** Meses do período simulado (resumo, filtros ou datas da negociação). */
export function extrairMesesPeriodoSimulacao(t = {}) {
  const resumo = t.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao || {};
  const resumoUltima = ultima.resumo || {};
  const ind = ultima.indicadores || {};
  const filtros = resumo.filtros || resumoUltima.filtros || {};

  const mesesSalvo = n(resumo.meses || resumoUltima.meses || ind.meses);
  if (mesesSalvo > 0) return mesesSalvo;

  const inicio = texto(t.periodo_realizado_inicio || filtros.inicio);
  const fim = texto(t.periodo_realizado_fim || filtros.fim);
  const mesesDatas = mesesEntreDatas(inicio, fim);
  if (mesesDatas > 0) return mesesDatas;

  const freteSel = n(resumo.freteSelecionada || resumoUltima.freteSelecionada);
  const fatMes = n(
    resumo.faturamentoSelecionadaMes
    || resumoUltima.faturamentoSelecionadaMes
    || ind.faturamento_mes,
  );
  if (freteSel > 0 && fatMes > 0) return Math.max(freteSel / fatMes, 1);

  const freteReal = n(
    resumo.freteRealizado || resumoUltima.freteRealizado || ind.frete_realizado,
  );
  const freteRealMes = n(
    resumo.freteRealizadoMes || resumoUltima.freteRealizadoMes || ind.frete_realizado_mes,
  );
  if (freteReal > 0 && freteRealMes > 0) return Math.max(freteReal / freteRealMes, 1);

  const valorAtualPeriodo = n(
    t.valor_atual_realizado || ind.valor_atual_realizado
    || resumo.valor_atual_realizado || resumoUltima.valor_atual_realizado,
  );
  const valorAtualMes = n(
    resumo.freteRealizadoMes || resumoUltima.freteRealizadoMes
    || ind.faturamento_mes || ind.frete_realizado_mes,
  );
  if (valorAtualPeriodo > 0 && valorAtualMes > 0) return Math.max(valorAtualPeriodo / valorAtualMes, 1);

  return 1;
}

/** Período simulado (datas + meses) de uma negociação. */
export function extrairPeriodoSimulacao(t = {}) {
  const resumo = t.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao || {};
  const resumoUltima = ultima.resumo || {};
  const filtros = resumo.filtros || resumoUltima.filtros || {};
  const inicio = texto(t.periodo_realizado_inicio || filtros.inicio);
  const fim = texto(t.periodo_realizado_fim || filtros.fim);
  const meses = extrairMesesPeriodoSimulacao(t);
  return { inicio, fim, meses };
}

/** Consolida período de várias origens (intervalo mais amplo + meses máximo). */
export function montarPeriodoLaudoConsolidado(tabelas = [], origens = []) {
  const periodos = (tabelas || []).map(extrairPeriodoSimulacao);
  (origens || []).forEach((o) => {
    if (o.mesesPeriodo) periodos.push({ meses: o.mesesPeriodo, inicio: o.periodoInicio, fim: o.periodoFim });
  });

  let inicio = '';
  let fim = '';
  periodos.forEach((p) => {
    if (p.inicio && (!inicio || p.inicio < inicio)) inicio = p.inicio;
    if (p.fim && (!fim || p.fim > fim)) fim = p.fim;
  });

  const mesesDatas = mesesEntreDatas(inicio, fim);
  const mesesMax = Math.max(
    mesesDatas,
    ...periodos.map((p) => n(p.meses)).filter((m) => m > 0),
    ...(origens || []).map((o) => n(o.mesesPeriodo)),
    1,
  );

  return { inicio, fim, meses: mesesMax };
}

/** Legenda padrão de valores mensais nos cards do laudo consolidado. */
export function montarLegendaPeriodoMensal(periodo = {}) {
  const meses = Math.max(n(periodo.meses), 1);
  const labelMeses = meses === 1 ? '1 mês' : `${meses} meses`;
  const ini = texto(periodo.inicio);
  const fim = texto(periodo.fim);
  if (ini && fim) {
    return `/mês · média do período simulado (${labelMeses}: ${dataBR(ini)}–${dataBR(fim)})`;
  }
  return `/mês · média do período simulado (${labelMeses})`;
}

function calcularAderenciaPorCte(ctesGanharia = 0, ctesComTabela = 0) {
  const base = n(ctesComTabela);
  return base ? (n(ctesGanharia) / base) * 100 : 0;
}

function calcularAderenciaPorFrete(freteGanho = 0, freteTotalComTabela = 0) {
  const base = n(freteTotalComTabela);
  return base ? (n(freteGanho) / base) * 100 : 0;
}

/** Reconcilia rotas prioritárias ao frete mensal c/ concorrentes da transportadora. */
export function reconciliarRotasPrioritariasMensal(rotas = [], opcoes = {}) {
  const lista = Array.isArray(rotas) ? rotas.map((r) => ({ ...r })) : [];
  const ref = n(opcoes.freteConcorrentesTotal);
  const meses = Math.max(n(opcoes.meses), 1);
  if (!lista.length || !ref) return lista;

  let soma = lista.reduce((acc, row) => acc + n(row.faturamentoMensalEmRisco), 0);
  if (!soma || soma <= ref * 1.05) return lista;

  const ratio = soma / ref;
  if (meses > 1 && ratio >= meses * 0.85 && ratio <= meses * 1.15) {
    lista.forEach((row) => {
      row.faturamentoMensalEmRisco = n(row.faturamentoMensalEmRisco) / meses;
    });
    soma = lista.reduce((acc, row) => acc + n(row.faturamentoMensalEmRisco), 0);
  }

  if (soma > ref * 1.05) {
    const fator = ref / soma;
    lista.forEach((row) => {
      row.faturamentoMensalEmRisco = n(row.faturamentoMensalEmRisco) * fator;
    });
  } else if (soma > ref * 1.001 && ref > 0) {
    const fator = ref / soma;
    lista.forEach((row) => {
      row.faturamentoMensalEmRisco = n(row.faturamentoMensalEmRisco) * fator;
    });
  }

  return lista;
}

function normalizarValorMensal({ valorMensal = 0, valorPeriodo = 0, meses = 1 } = {}) {
  const mensal = n(valorMensal);
  if (mensal > 0) return mensal;
  const periodo = n(valorPeriodo);
  const m = Math.max(n(meses), 1);
  return periodo > 0 ? periodo / m : 0;
}

function freteConcorrenteJaMensal(item = {}) {
  return n(
    item.freteMensalConcorrente || item.freteMensalConcorrentes
    || item.freteConcorrenteMensal,
  ) > 0;
}

const RE_FAIXA_INTERVALO = /\d[\d.,]*\s*(?:a|ate|até|-)\s*\d[\d.,]*/i;

function segmentoEhFaixa(seg) {
  const s = texto(seg);
  if (!s) return true;
  const lower = s.toLowerCase();
  if (/^(?:todas?(?:\s+as)?\s+faixas?|sem faixa)$/i.test(lower)) return true;
  if (RE_FAIXA_INTERVALO.test(s)) return true;
  if (/^>\s*0\b/.test(lower)) return true;
  if (/\bkg\b/i.test(s)) return true;
  if (/^acima\b/i.test(lower)) return true;
  if (/^\d[\d.,]*$/.test(s) && n(s.replace(/\./g, '').replace(',', '.')) >= 999999) return true;
  return false;
}

function padraoComercial(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLocalComUf(valor, ufFallback = '') {
  const raw = texto(valor);
  if (!raw) return ufFallback && ufFallback !== '-' ? `/${upper(ufFallback)}` : '';
  const matchSlash = raw.match(/^(.+?)\/([A-Za-z]{2})$/);
  if (matchSlash) return `${matchSlash[1].trim()}/${upper(matchSlash[2])}`;
  const uf = upper(ufFallback);
  if (uf && uf !== '-') return `${raw}/${uf}`;
  return raw;
}

function limparSegmentoRota(seg) {
  return texto(seg)
    .replace(RE_FAIXA_INTERVALO, '')
    .replace(/^>\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrai origem/destino executivos, removendo faixas de peso e parametrização interna. */
export function normalizarRotaExecutiva(item = {}, origemNegociacao = '') {
  let origem = texto(item.origem) || texto(origemNegociacao);
  let destino = texto(item.destino);
  const ufDestino = upper(item.ufDestino);

  const candidatos = [item.rotaDestino, item.rota, item.chave, item.cotacao]
    .map(texto)
    .filter(Boolean);

  for (const cand of candidatos) {
    const separador = cand.includes('→') ? '→' : (cand.includes('>') ? '>' : null);
    if (!separador) continue;
    const partes = cand
      .split(separador)
      .map((p) => limparSegmentoRota(p))
      .filter((p) => p && !segmentoEhFaixa(p));
    if (partes.length >= 2) {
      if (!texto(item.origem)) origem = origem || partes[0];
      if (!destino) destino = partes.slice(1).join(' ');
    } else if (partes.length === 1 && !destino) {
      destino = partes[0];
    }
  }

  if (origemNegociacao && !texto(item.origem)) {
    origem = parseLocalComUf(origemNegociacao);
  }

  origem = parseLocalComUf(origem);
  destino = parseLocalComUf(destino, ufDestino);

  return {
    origem,
    destino,
    chave: `${padraoComercial(origem)}|${padraoComercial(destino)}`,
  };
}

export function classificarStatusRotaExecutiva(item = {}) {
  const ganhos = n(item.ctesGanhos);
  const perdidos = n(item.ctesPerdidos);
  const total = ganhos + perdidos || n(item.quantidadeCtes);
  const aderencia = total ? (ganhos / total) * 100 : n(item.aderencia);
  const faturamentoEmRisco = n(item.faturamentoMensalEmRisco ?? item.faturamentoNaoCapturado);

  if (perdidos === 0 && faturamentoEmRisco <= 0) return 'Aderente';
  if (aderencia >= 99.5 && faturamentoEmRisco <= 0) return 'Aderente';
  if (ganhos > 0 && perdidos > 0) return 'Parcial';
  return 'Revisar';
}

/**
 * Frete mensal c/ concorrentes = frete realizado nos CT-es perdidos (valor_cte pago a outras transportadoras).
 * Prioridade: frete concorrente explícito → freteRealizado nos perdidos → faturamentoNaoCapturado (já corrigido)
 * → freteVencedor (tabela simulada) só como último recurso.
 */
export function extrairFaturamentoEmRiscoItem(item = {}, opcoes = {}) {
  const perdidos = n(item.ctesPerdidos || item.qtdPerdidasSelecionada);
  const ganhos = n(item.ctesGanhos || item.qtdGanhasSelecionada);
  const totalCtes = ganhos + perdidos || n(item.ctes || item.ctesAnalisados || item.quantidadeCtes);
  const meses = Math.max(n(opcoes.meses || item.mesesPeriodo || item.meses), 1);
  const jaMensal = freteConcorrenteJaMensal(item) || opcoes.jaMensal;

  const explicitoMensal = n(item.freteMensalConcorrente || item.freteMensalConcorrentes || item.freteConcorrenteMensal);
  if (explicitoMensal > 0) return explicitoMensal;

  const explicito = n(item.freteConcorrente || item.freteCompetidor || item.freteConcorrentes);
  if (explicito > 0) return jaMensal ? explicito : explicito / meses;

  const fretePerdidoSalvo = n(item.freteRealizadoPerdido || item.fretePerdido);
  if (fretePerdidoSalvo > 0) return jaMensal ? fretePerdidoSalvo : fretePerdidoSalvo / meses;

  const freteReal = n(item.freteRealizado);
  const freteRealGanh = n(
    item.freteRealizadoGanharia || item.freteRealizadoGanhadora || item.freteRealizadoGanhos,
  );
  if (freteReal > 0 && perdidos > 0) {
    let valor = 0;
    if (freteRealGanh > 0) valor = Math.max(freteReal - freteRealGanh, 0);
    else if (ganhos === 0) valor = freteReal;
    else if (totalCtes > 0) valor = (freteReal / totalCtes) * perdidos;
    if (valor > 0) return jaMensal ? valor : valor / meses;
  }

  const naoCapturado = n(item.faturamentoNaoCapturado);
  if (naoCapturado > 0 && perdidos > 0) return jaMensal ? naoCapturado : naoCapturado / meses;

  const freteVenc = n(item.freteVencedor);
  if (freteVenc > 0 && perdidos > 0) {
    const valor = ganhos === 0
      ? freteVenc
      : (totalCtes > 0 ? (freteVenc / totalCtes) * perdidos : 0);
    if (valor > 0) return jaMensal ? valor : valor / meses;
  }

  if (naoCapturado > 0 && ganhos === 0) return jaMensal ? naoCapturado : naoCapturado / meses;

  const emRisco = n(item.faturamentoMensalEmRisco);
  return emRisco > 0 && !jaMensal ? emRisco / meses : emRisco;
}

function chaveDedupeFreteConcorrente(item = {}, origemNegociacao = '') {
  const chaveRota = texto(item.chave) || normalizarRotaExecutiva(item, origemNegociacao).chave;
  const origem = texto(item.origemNegociacao) || texto(origemNegociacao) || texto(item.origem);
  return `${origem}|${chaveRota}`;
}

/** Soma frete c/ concorrentes por origem, deduplicando rotas/cotações repetidas. */
export function calcularFreteConcorrentesPorOrigem(itens = [], opcoes = {}) {
  const vistos = new Set();
  let total = 0;
  (itens || []).forEach((item) => {
    const dedupe = chaveDedupeFreteConcorrente(item, opcoes.origemNegociacao);
    if (!dedupe || dedupe === '|' || vistos.has(dedupe)) return;
    vistos.add(dedupe);
    total += extrairFaturamentoEmRiscoItem(item, {
      meses: item.mesesPeriodo || item.meses || opcoes.meses,
    });
  });
  return total;
}

/** CT-es na simulação c/ tabela (ganhos + perdidos), não o total analisado sem cobertura. */
function ctesComCoberturaTabela(item = {}) {
  const ganhos = n(item.ctesGanhos);
  const perdidos = n(item.ctesPerdidos);
  const comTabela = ganhos + perdidos;
  if (comTabela > 0) return comTabela;
  return n(
    item.ctesComTabela || item.ctes_com_tabela
    || item.qtd_registros_com_tabela || item.quantidadeCtesComTabela,
  );
}

/** Redução necessária só nos CT-es perdidos (competem mas a tabela não ganha). */
function reducaoNecessariaPerdidos(item = {}) {
  const perdidos = n(item.ctesPerdidos);
  if (!perdidos) return 0;
  const reducaoSalva = n(
    item.percentualReducaoNecessaria || item.reducaoMediaNecessaria || item.reducaoMedia,
  );
  if (reducaoSalva > 0) return reducaoSalva;
  const freteSel = n(item.freteSelecionada || item.freteTabelaSelecionada);
  if (freteSel > 0 && n(item.diferencaParaVencedor) > 0) {
    return (n(item.diferencaParaVencedor) / freteSel) * 100;
  }
  const ajuste = n(item.ajusteMedio);
  return ajuste > 0 ? ajuste : 0;
}

function acumularRotaExecutiva(acc, item = {}, origemNegociacao = '', opcoes = {}) {
  const { origem, destino, chave } = normalizarRotaExecutiva(item, origemNegociacao);
  if (!chave || chave === '|') return acc;

  const ctesGanhos = n(item.ctesGanhos);
  const ctesPerdidos = n(item.ctesPerdidos);
  const ctesComTabela = ctesComCoberturaTabela(item);
  const faturamentoEmRisco = extrairFaturamentoEmRiscoItem(item, {
    meses: item.mesesPeriodo || item.meses || opcoes.meses,
  });
  const reducao = reducaoNecessariaPerdidos(item);

  if (!acc.has(chave)) {
    acc.set(chave, {
      chave,
      origem,
      destino,
      reducaoSoma: 0,
      reducaoPeso: 0,
      faturamentoMensalEmRisco: 0,
      quantidadeCtes: 0,
      ctesGanhos: 0,
      ctesPerdidos: 0,
    });
  }

  const row = acc.get(chave);
  if (reducao > 0 && ctesPerdidos > 0) {
    row.reducaoSoma += reducao * ctesPerdidos;
    row.reducaoPeso += ctesPerdidos;
  }
  row.faturamentoMensalEmRisco += faturamentoEmRisco;
  row.quantidadeCtes += ctesComTabela;
  row.ctesGanhos += ctesGanhos;
  row.ctesPerdidos += ctesPerdidos;
  return acc;
}

function mapaRotasConsolidadasOrigem(itens = [], origemNegociacao = '', opcoes = {}) {
  const mapa = (itens || []).reduce(
    (acc, item) => acumularRotaExecutiva(acc, item, origemNegociacao, opcoes),
    new Map(),
  );

  return Array.from(mapa.values())
    .map((row) => {
      const percentualReducaoNecessaria = row.reducaoPeso ? row.reducaoSoma / row.reducaoPeso : 0;
      return {
        origem: row.origem,
        destino: row.destino,
        chave: row.chave,
        percentualReducaoNecessaria,
        faturamentoMensalEmRisco: row.faturamentoMensalEmRisco,
        quantidadeCtes: row.quantidadeCtes,
        ctesGanhos: row.ctesGanhos,
        ctesPerdidos: row.ctesPerdidos,
        status: classificarStatusRotaExecutiva(row),
        origemNegociacao,
      };
    })
    .filter((row) => row.quantidadeCtes > 0 || row.faturamentoMensalEmRisco > 0 || row.percentualReducaoNecessaria > 0);
}

function agruparItensPorOrigemNegociacao(itens = []) {
  const porOrigem = new Map();
  (itens || []).forEach((item) => {
    const origemKey = texto(item.origemNegociacao) || texto(item.origem) || '—';
    if (!porOrigem.has(origemKey)) porOrigem.set(origemKey, []);
    porOrigem.get(origemKey).push(item);
  });
  return porOrigem;
}

function ordenarRotasPorRisco(a, b) {
  return (
    n(b.faturamentoMensalEmRisco) - n(a.faturamentoMensalEmRisco)
    || n(b.percentualReducaoNecessaria) - n(a.percentualReducaoNecessaria)
    || n(b.quantidadeCtes) - n(a.quantidadeCtes)
  );
}

/**
 * Consolida rotas por origem+destino, aplica Pareto 80% do em risco em cada origem
 * e retorna lista global ordenada por frete c/ concorrentes.
 */
export function consolidarRotasPrioritariasComMeta(itens = [], opcoes = {}) {
  const minRotas = n(opcoes.minRotas) || 20;
  const porOrigem = agruparItensPorOrigemNegociacao(itens);

  let emRiscoTotalCandidatos = 0;
  let qtdRotasCandidatas = 0;
  const selecionadas = [];
  const todasCandidatas = [];

  for (const [origemNegociacao, itensOrigem] of porOrigem) {
    const mesesOrigem = Math.max(
      n(itensOrigem[0]?.mesesPeriodo || itensOrigem[0]?.meses || opcoes.meses),
      1,
    );
    const opcoesOrigem = { meses: mesesOrigem, origemNegociacao };
    emRiscoTotalCandidatos += calcularFreteConcorrentesPorOrigem(itensOrigem, opcoesOrigem);
    const candidatas = mapaRotasConsolidadasOrigem(itensOrigem, origemNegociacao, opcoesOrigem)
      .sort(ordenarRotasPorRisco);
    qtdRotasCandidatas += candidatas.length;
    todasCandidatas.push(...candidatas);

    const pareto = aplicarCortePareto80ComMinimoRotas(candidatas, {
      metrica: 'faturamentoEmRisco',
      minRotas,
    });
    selecionadas.push(...pareto);
  }

  let rotasSelecionadas = selecionadas;
  if (rotasSelecionadas.length < minRotas && todasCandidatas.length >= minRotas) {
    const chaves = new Set(rotasSelecionadas.map((r) => r.chave));
    const extras = todasCandidatas
      .filter((r) => !chaves.has(r.chave))
      .sort(ordenarRotasPorRisco);
    for (const row of extras) {
      if (rotasSelecionadas.length >= minRotas) break;
      rotasSelecionadas.push(row);
      chaves.add(row.chave);
    }
    if (rotasSelecionadas.length < minRotas) {
      rotasSelecionadas = [...todasCandidatas].sort(ordenarRotasPorRisco).slice(0, minRotas);
    }
  }

  const rotas = rotasSelecionadas
    .sort(ordenarRotasPorRisco)
    .map((row, index) => ({ ...row, prioridade: index + 1 }));

  const usouMinimoRotas = rotas.length < minRotas
    ? rotas.length
    : (selecionadas.length < minRotas ? minRotas : null);

  return {
    rotas,
    meta: {
      criterioPareto: 'por_origem',
      minRotas,
      usouMinimoRotas,
      qtdRotasCandidatas,
      emRiscoTotalCandidatos,
      qtdOrigens: porOrigem.size,
    },
  };
}

/** Consolida rotas duplicadas (formatos distintos) em linhas executivas únicas. */
export function consolidarRotasPrioritarias(itens = [], opcoes = {}) {
  return consolidarRotasPrioritariasComMeta(itens, opcoes).rotas;
}

export function montarResumoRotasPrioritarias(rotas = [], meta = {}) {
  const lista = Array.isArray(rotas) ? rotas : [];
  const faturamentoTotal = lista.reduce((acc, row) => acc + n(row.faturamentoMensalEmRisco), 0);
  const reducaoPeso = lista.reduce((acc, row) => {
    const perdidos = n(row.ctesPerdidos);
    const reducao = n(row.percentualReducaoNecessaria);
    return perdidos > 0 && reducao > 0 ? acc + reducao * perdidos : acc;
  }, 0);
  const reducaoBase = lista.reduce((acc, row) => acc + n(row.ctesPerdidos), 0);
  const reducaoMediaNecessaria = reducaoBase ? reducaoPeso / reducaoBase : 0;

  const riscoPorOrigem = lista.reduce((acc, row) => {
    const origem = row.origem || '—';
    acc.set(origem, n(acc.get(origem)) + n(row.faturamentoMensalEmRisco));
    return acc;
  }, new Map());

  const origemMaisCritica = Array.from(riscoPorOrigem.entries())
    .sort((a, b) => n(b[1]) - n(a[1]))[0]?.[0] || '—';

  const emRiscoTotalCandidatos = n(meta.emRiscoTotalCandidatos);
  const pctEmRiscoCoberto = emRiscoTotalCandidatos
    ? Math.min(100, (faturamentoTotal / emRiscoTotalCandidatos) * 100)
    : (lista.length ? 100 : 0);
  const faturamentoAtual = n(meta.faturamentoAtual);
  const freteTotalComTabela = n(meta.freteTotalComTabela);
  const freteConcorrentesTotal = n(meta.freteConcorrentesTotal ?? meta.freteConcorrentesTotalReferencia);

  const pctDoTotalSimulado = freteTotalComTabela
    ? (faturamentoTotal / freteTotalComTabela) * 100
    : null;
  const pctPerdidoSimulacao = freteTotalComTabela && freteConcorrentesTotal
    ? (freteConcorrentesTotal / freteTotalComTabela) * 100
    : null;
  const pctDoFreteConcorrentesTotal = freteConcorrentesTotal
    ? Math.min(100, (faturamentoTotal / freteConcorrentesTotal) * 100)
    : null;
  const pctDoFaturamentoAtual = faturamentoAtual && faturamentoTotal <= faturamentoAtual
    ? (faturamentoTotal / faturamentoAtual) * 100
    : null;

  return {
    qtdRotas: lista.length,
    faturamentoMensalEmRiscoTotal: faturamentoTotal,
    freteConcorrentesTotalReferencia: freteConcorrentesTotal || null,
    reducaoMediaNecessaria,
    origemMaisCritica,
    criterioPareto: meta.criterioPareto || 'por_origem',
    minRotas: n(meta.minRotas) || 20,
    usouMinimoRotas: meta.usouMinimoRotas ?? null,
    qtdRotasCandidatas: n(meta.qtdRotasCandidatas) || lista.length,
    emRiscoTotalCandidatos,
    pctEmRiscoCoberto: pctDoFreteConcorrentesTotal ?? (emRiscoTotalCandidatos
      ? Math.min(100, (faturamentoTotal / emRiscoTotalCandidatos) * 100)
      : (lista.length ? 100 : 0)),
    qtdOrigens: n(meta.qtdOrigens),
    faturamentoAtualReferencia: faturamentoAtual || null,
    freteTotalComTabelaReferencia: freteTotalComTabela || null,
    pctDoFaturamentoAtual,
    pctDoTotalSimulado,
    pctPerdidoSimulacao,
    pctDoFreteConcorrentesTotal,
    pctConcorrentesDoTotalSimulado: pctDoFreteConcorrentesTotal,
  };
}

/** Rótulo da cobertura Pareto sobre o frete c/ concorrentes total (evita repetir valor monetário). */
export function rotuloCoberturaFreteConcorrentesRotas(resumo = {}) {
  const pct = resumo.pctDoFreteConcorrentesTotal ?? resumo.pctEmRiscoCoberto;
  const cobreTudo = pct != null && pct >= 99.5;
  return {
    pct,
    cobreTudo,
    titulo: 'Cobertura do frete c/ concorrentes',
    valorPrincipal: cobreTudo ? percentual(100) : (pct != null ? percentual(pct) : '—'),
    legenda: cobreTudo
      ? 'das rotas prioritárias cobrem o frete c/ concorrentes'
      : 'do frete c/ concorrentes total nas rotas prioritárias',
    valorRotas: n(resumo.faturamentoMensalEmRiscoTotal),
  };
}

function historicoRodadasNegociacao(tabela = {}) {
  const resumo = tabela.resumo_simulacao && typeof tabela.resumo_simulacao === 'object' && !Array.isArray(tabela.resumo_simulacao)
    ? tabela.resumo_simulacao
    : {};
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}

/** Origem com cidade cadastrada ou detectada na simulação (exclui "Origem não informada"). */
export function origemNegociacaoInformada(tabela = {}) {
  if (texto(tabela.origem)) return true;
  const resumo = tabela.resumo_simulacao || {};
  const detectadas = Array.isArray(resumo.origens_detectadas) ? resumo.origens_detectadas : [];
  return detectadas.some((o) => texto(o?.cidade));
}

/** Simulação salva com resultado utilizável no laudo. */
export function negociacaoTemSimulacaoSalvaLaudo(tabela = {}) {
  const resumo = tabela.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao;
  if (ultima && typeof ultima === 'object' && Object.keys(ultima).length) return true;
  if (texto(resumo.salvo_em)) return true;

  const hist = historicoRodadasNegociacao(tabela);
  if (hist.some((r) => upper(r.tipo_registro) === 'SIMULACAO' || r.simulacao)) return true;

  if (n(resumo.rodada_atual) > 0 && n(resumo.ctesComTabelaSelecionada) > 0) {
    return true;
  }
  if (n(resumo.ctesAnalisados) > 0 && (
    n(resumo.freteSelecionada) > 0
    || n(resumo.aderenciaSelecionada) > 0
    || n(resumo.freteRealizadoComTabelaSelecionada) > 0
  )) return true;

  return false;
}

/** Cobertura na malha da transportadora (CT-es com tabela ou rotas úteis). */
export function negociacaoTemCoberturaMalha(tabela = {}) {
  const resumo = tabela.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao || {};
  const resumoUltima = ultima.resumo || {};
  const ind = ultima.indicadores || {};

  const ctesComTabela = n(
    tabela.ctes_atendidos
    || ind.qtd_registros_com_tabela
    || ind.ctes_com_tabela
    || resumo.qtd_registros_com_tabela
    || resumo.ctesComTabelaSelecionada,
  );
  if (ctesComTabela > 0) return true;

  const rotas = n(resumo.qtdRotas || resumo.rotas_total || tabela.qtd_rotas);
  if (rotas > 0) return true;

  const rotasArr = resumo.rotas || resumoUltima.rotas || [];
  if (Array.isArray(rotasArr) && rotasArr.some((r) => (
    n(r.ctes || r.ctesAnalisados || r.quantidadeCtes) > 0
    || n(r.freteRealizado || r.freteConcorrente || r.faturamentoNaoCapturado) > 0
  ))) return true;

  return false;
}

/**
 * Inclui no laudo consolidado apenas origens informadas que tenham simulação salva
 * ou cobertura na malha. Regra: se não simulou e não faz parte da malha, não mostra.
 */
export function origemRelevanteParaLaudoConsolidado(tabela = {}) {
  if (!origemNegociacaoInformada(tabela)) return false;
  return negociacaoTemSimulacaoSalvaLaudo(tabela) && negociacaoTemCoberturaMalha(tabela);
}

export function filtrarTabelasLaudoConsolidado(tabelas = []) {
  return (tabelas || []).filter(origemRelevanteParaLaudoConsolidado);
}

function origemLabelTabela(tabela = {}) {
  const cidade = texto(tabela.origem);
  const uf = upper(tabela.uf_origem);
  if (cidade && uf) return `${cidade}/${uf}`;
  if (cidade) return cidade;
  const resumo = tabela.resumo_simulacao || {};
  const detectada = Array.isArray(resumo.origens_detectadas) ? resumo.origens_detectadas[0] : null;
  if (detectada?.cidade) return `${detectada.cidade}${detectada.uf ? `/${detectada.uf}` : ''}`;
  return 'Origem não informada';
}

function resumoTexto(linhas = []) {
  return linhas.filter(Boolean).join('\n');
}

/**
 * Frete mensal c/ concorrentes por origem = frete realizado nos CT-es perdidos (valor_cte).
 * Prioridade: totais do resumo → soma das rotas salvas → rotas críticas do laudo de rodadas.
 */
export function extrairFreteConcorrentesOrigem(t = {}, opcoes = {}) {
  const resumo = t.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao || {};
  const resumoUltima = ultima.resumo || {};
  const meses = Math.max(n(opcoes.meses || extrairMesesPeriodoSimulacao(t)), 1);
  const rotasCriticas = opcoes.rotasCriticas;

  const explicitoMensal = n(
    resumo.freteMensalConcorrente || resumoUltima.freteMensalConcorrente
    || resumo.freteConcorrenteMensal || resumoUltima.freteConcorrenteMensal,
  );
  if (explicitoMensal > 0) return explicitoMensal;

  const freteRealizadoComTabela = n(
    resumo.freteRealizadoComTabelaSelecionada || resumoUltima.freteRealizadoComTabelaSelecionada,
  );
  const freteRealizadoGanharia = n(
    resumo.freteRealizadoGanhariaSelecionada || resumoUltima.freteRealizadoGanhariaSelecionada,
  );
  if (freteRealizadoComTabela > 0) {
    const perdidoPeriodo = Math.max(freteRealizadoComTabela - freteRealizadoGanharia, 0);
    if (perdidoPeriodo > 0) return perdidoPeriodo / meses;
  }

  const somarRotas = (rotas = []) => calcularFreteConcorrentesPorOrigem(
    (rotas || []).map((rota) => ({ ...rota, mesesPeriodo: meses })),
    { meses },
  );

  const rotasResumo = resumo.rotas || resumoUltima.rotas || [];
  const totalRotasResumo = somarRotas(rotasResumo);
  if (totalRotasResumo > 0) return totalRotasResumo;

  if (Array.isArray(rotasCriticas) && rotasCriticas.length) {
    return somarRotas(rotasCriticas);
  }

  const freteSelecionada = n(resumo.freteSelecionada || resumoUltima.freteSelecionada);
  const freteGanho = n(resumo.freteSelecionadaGanhadora || resumoUltima.freteSelecionadaGanhadora);
  if (freteSelecionada > 0 && freteGanho >= 0) {
    return Math.max(freteSelecionada - freteGanho, 0) / meses;
  }

  return 0;
}

/** Frete ganho c/ proposta = tabela simulada nos CT-es em que a transportadora ganharia. */
export function extrairFreteGanhoPropostaOrigem(t = {}, opcoes = {}) {
  const resumo = t.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao || {};
  const resumoUltima = ultima.resumo || {};
  const ind = ultima.indicadores || {};
  const meses = Math.max(n(opcoes.meses || extrairMesesPeriodoSimulacao(t)), 1);

  return normalizarValorMensal({
    valorMensal: t.faturamento_projetado || ind.faturamento_mes
      || resumo.faturamentoSelecionadaGanhadoraMes || resumoUltima.faturamentoSelecionadaGanhadoraMes
      || resumo.faturamentoSelecionadaMes || resumoUltima.faturamentoSelecionadaMes,
    valorPeriodo: resumo.freteSelecionadaGanhadora || resumoUltima.freteSelecionadaGanhadora
      || resumo.freteSelecionada || resumoUltima.freteSelecionada,
    meses,
  });
}

/** Total simulado c/ cobertura da tabela ≈ frete ganho (proposta) + frete c/ concorrentes. */
export function extrairFreteTotalComTabelaOrigem(t = {}, metricas = {}) {
  const resumo = t.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao || {};
  const resumoUltima = ultima.resumo || {};
  const meses = Math.max(n(metricas.mesesPeriodo || extrairMesesPeriodoSimulacao(t)), 1);

  const ganho = n(metricas.freteGanhoProposta ?? extrairFreteGanhoPropostaOrigem(t, { meses }));
  const concorrentes = n(metricas.freteConcorrentes ?? extrairFreteConcorrentesOrigem(t, { meses, rotasCriticas: metricas.rotasCriticas }));
  const somaPartes = ganho + concorrentes;

  const referencia = normalizarValorMensal({
    valorMensal: resumo.faturamentoSelecionadaMes || resumoUltima.faturamentoSelecionadaMes,
    valorPeriodo: resumo.freteSelecionada || resumoUltima.freteSelecionada,
    meses,
  });

  if (somaPartes > 0) {
    if (!referencia || Math.abs(somaPartes - referencia) / Math.max(referencia, 1) <= 0.05) {
      return somaPartes;
    }
    return somaPartes;
  }
  return referencia;
}

/** Dias do período simulado (resumo salvo ou datas da negociação). */
export function extrairDiasPeriodoSimulacao(t = {}) {
  const resumo = t.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao || {};
  const resumoUltima = ultima.resumo || {};
  const filtros = resumo.filtros || resumoUltima.filtros || {};
  const diasSalvo = n(resumo.dias || resumoUltima.dias);
  if (diasSalvo > 0) return diasSalvo;

  const inicio = texto(t.periodo_realizado_inicio || filtros.inicio);
  const fim = texto(t.periodo_realizado_fim || filtros.fim);
  if (inicio && fim) {
    const dIni = new Date(`${inicio}T00:00:00`);
    const dFim = new Date(`${fim}T00:00:00`);
    if (!Number.isNaN(dIni.getTime()) && !Number.isNaN(dFim.getTime())) {
      return Math.max(Math.round((dFim.getTime() - dIni.getTime()) / 86400000) + 1, 1);
    }
  }

  return Math.max(extrairMesesPeriodoSimulacao(t) * 22, 1);
}

/**
 * Pedidos/volumes nos CT-es que a transportadora ganharia (mesma base do Simulador → resumoGanhas).
 * Não usa cargasDia/volumesDia totais do realizado analisado.
 */
export function extrairVolumetriaGanhosOrigem(t = {}) {
  const resumo = t.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao || {};
  const resumoUltima = ultima.resumo || {};
  const ind = ultima.indicadores || {};
  const meses = extrairMesesPeriodoSimulacao(t);
  const dias = extrairDiasPeriodoSimulacao(t);

  const ctesGanharia = n(
    ind.ctes_ganhos || resumo.ctesGanhariaSelecionada || ind.ctes_capturados || resumo.ctesCapturadosDeOutras,
  );
  const ctesComTabela = n(
    resumo.ctesComTabelaSelecionada || resumo.qtd_registros_com_tabela
    || ind.qtd_registros_com_tabela || ind.ctes_com_tabela
    || t.ctes_atendidos,
  );

  let pedidosDia = n(ind.pedidos_ganhos_dia);
  let pedidosMes = n(ind.pedidos_ganhos_mes);
  if (!pedidosDia && ctesGanharia > 0) pedidosDia = ctesGanharia / dias;
  if (!pedidosMes && ctesGanharia > 0) pedidosMes = ctesGanharia / meses;
  if (!pedidosMes && pedidosDia > 0) pedidosMes = pedidosDia * 22;

  let volumesDia = n(ind.volumes_ganhos_dia);
  let volumesMes = n(ind.volumes_ganhos_mes);
  const volumesPeriodo = n(resumo.volumes || resumoUltima.volumes);
  const volumesDiaTotal = n(ind.volumes_dia || resumo.volumesDia || resumoUltima.volumesDia);
  const baseCtesVolumes = ctesComTabela;
  const ratioGanhos = baseCtesVolumes > 0 && ctesGanharia > 0 ? ctesGanharia / baseCtesVolumes : 0;

  if (!volumesMes && volumesPeriodo > 0 && ratioGanhos > 0) {
    volumesMes = (volumesPeriodo / meses) * ratioGanhos;
  } else if (!volumesMes && volumesDiaTotal > 0 && ratioGanhos > 0) {
    volumesMes = volumesDiaTotal * 22 * ratioGanhos;
  }
  if (!volumesDia && volumesMes > 0) volumesDia = volumesMes / 22;

  return {
    pedidosDia,
    pedidosMes,
    volumesDia,
    volumesMes,
    ctesGanharia,
    escopo: 'ganhos',
  };
}

/** Métricas operacionais por origem (mesma prioridade de campos do Simulador / gestão). */
function extrairMetricasOperacionaisOrigem(t = {}, opcoes = {}) {
  const resumo = t.resumo_simulacao || {};
  const ultima = resumo.ultima_simulacao || {};
  const resumoUltima = ultima.resumo || {};
  const ind = ultima.indicadores || {};
  const meses = extrairMesesPeriodoSimulacao(t);
  const volumetriaGanhos = extrairVolumetriaGanhosOrigem(t);
  const pedidosDia = volumetriaGanhos.pedidosDia;
  const pedidosMes = volumetriaGanhos.pedidosMes;
  const volumesDia = volumetriaGanhos.volumesDia;
  const volumesMes = volumetriaGanhos.volumesMes;

  const freteGanhoProposta = extrairFreteGanhoPropostaOrigem(t, { meses });
  const freteConcorrentes = extrairFreteConcorrentesOrigem(t, { meses, rotasCriticas: opcoes.rotasCriticas });
  const freteTotalComTabela = extrairFreteTotalComTabelaOrigem(t, {
    mesesPeriodo: meses,
    freteGanhoProposta,
    freteConcorrentes,
    rotasCriticas: opcoes.rotasCriticas,
  });
  const faturamentoProposta = freteGanhoProposta;

  const faturamentoAtual = normalizarValorMensal({
    valorMensal: resumo.freteRealizadoMes || resumoUltima.freteRealizadoMes || ind.frete_realizado_mes,
    valorPeriodo: resumo.freteRealizado || resumoUltima.freteRealizado || ind.frete_realizado
      || t.valor_atual_realizado || ind.valor_atual_realizado
      || resumo.valor_atual_realizado || resumoUltima.valor_atual_realizado
      || resumo.freteRealizadoComTabelaSelecionada || resumoUltima.freteRealizadoComTabelaSelecionada,
    meses,
  });

  const ctesGanharia = n(ind.ctes_ganhos || resumo.ctesGanhariaSelecionada || ind.ctes_capturados || resumo.ctesCapturadosDeOutras);
  const ctesComTabela = n(
    resumo.ctesComTabelaSelecionada || resumo.qtd_registros_com_tabela
    || ind.qtd_registros_com_tabela || ind.ctes_com_tabela
    || t.ctes_atendidos,
  );
  const ctesAnalisadosOrigem = n(
    t.ctes_analisados || ind.ctes_analisados || ind.qtd_registros_analisados || resumo.ctesAnalisados,
  );
  const periodo = extrairPeriodoSimulacao(t);
  const aderenciaPorCte = calcularAderenciaPorCte(ctesGanharia, ctesComTabela);
  const aderenciaPorFrete = calcularAderenciaPorFrete(freteGanhoProposta, freteTotalComTabela);
  const aderenciaSalva = n(t.aderencia_projetada || ind.aderencia || resumo.aderenciaSelecionada);

  return {
    mesesPeriodo: meses,
    periodoInicio: periodo.inicio,
    periodoFim: periodo.fim,
    pedidosDia,
    pedidosMes,
    volumesDia,
    volumesMes,
    faturamentoProposta,
    faturamentoAtual,
    freteGanhoProposta,
    freteConcorrentes,
    freteTotalComTabela,
    ctesGanharia,
    ctesComTabela,
    ctesAnalisados: ctesAnalisadosOrigem,
    aderenciaPorCte,
    aderenciaPorFrete,
    aderenciaSalva,
    pctFreteGanhoDoFaturamentoAtual: faturamentoAtual
      ? (freteGanhoProposta / faturamentoAtual) * 100
      : null,
  };
}

function montarLinhaMetricasOperacionaisTexto(o, opcoes = {}) {
  const exibirFaturamentoGanho = opcoes.exibirFaturamentoGanho !== false;
  const linhas = [];
  if (exibirFaturamentoGanho) {
    const pctGanho = o.aderenciaPorFrete ?? (o.freteTotalComTabela
      ? (n(o.freteGanhoProposta ?? o.faturamentoProposta) / o.freteTotalComTabela) * 100
      : null);
    const pctConc = o.pctPerdidoSimulacao ?? (o.freteTotalComTabela
      ? (n(o.freteConcorrentes) / o.freteTotalComTabela) * 100
      : null);
    linhas.push(
      `  Simulação c/ tabela (${n(o.ctesComTabela).toLocaleString('pt-BR')} CT-es): total ${dinheiro(o.freteTotalComTabela)}/mês · ganho ${dinheiro(o.freteGanhoProposta ?? o.faturamentoProposta)}${pctGanho != null ? ` (${percentual(pctGanho)} do total simulado)` : ''} · c/ concorrentes ${dinheiro(o.freteConcorrentes)}${pctConc != null ? ` (${percentual(pctConc)} do total simulado)` : ''}`,
    );
  }
  linhas.push(`  Pedidos ganhos: ${n(o.pedidosDia).toLocaleString('pt-BR')}/dia · ${n(o.pedidosMes).toLocaleString('pt-BR')}/mês · Volumes ganhos: ${n(o.volumesMes).toLocaleString('pt-BR')}/mês`);
  return linhas.join('\n');
}

/** Nota explicativa da base da simulação c/ tabela. */
export function montarNotaBasesLaudoConsolidado(totais = {}) {
  const ctesComTabela = n(totais.ctesComTabela).toLocaleString('pt-BR');
  const totalSim = dinheiro(totais.freteTotalComTabela);
  const ganho = dinheiro(totais.freteGanhoProposta ?? totais.faturamentoProposta);
  const conc = dinheiro(totais.freteConcorrentes);
  return `Simulação c/ tabela (${totalSim}/mês, ${ctesComTabela} CT-es com cobertura): frete ganho (${ganho}) + frete c/ concorrentes (${conc}) nos CT-es em que a transportadora compete/simula.`;
}

function montarLinhasResumoAderenciaBasica(op = {}) {
  return [
    `- Aderência (por CT-e): ${percentual(op.aderenciaPorCte ?? 0)} · CT-es ganharia / com tabela: ${n(op.ctesGanharia).toLocaleString('pt-BR')} / ${n(op.ctesComTabela).toLocaleString('pt-BR')}`,
  ];
}

function montarLinhasResumoSimulacaoTabela(op = {}, legendaPeriodo = '') {
  const leg = legendaPeriodo ? ` ${legendaPeriodo.replace(/^\/mês · /, '· ')}` : '';
  const pctGanho = op.aderenciaPorFrete ?? (op.freteTotalComTabela
    ? (n(op.freteGanhoProposta ?? op.faturamentoProposta) / op.freteTotalComTabela) * 100
    : null);
  const pctConc = op.pctPerdidoSimulacao ?? (op.freteTotalComTabela
    ? (n(op.freteConcorrentes) / op.freteTotalComTabela) * 100
    : null);
  return [
    `SIMULAÇÃO C/ TABELA (${n(op.ctesComTabela).toLocaleString('pt-BR')} CT-es com cobertura)`,
    `- Total simulado: ${dinheiro(op.freteTotalComTabela)}/mês${leg}`,
    `- Frete ganho c/ proposta: ${dinheiro(op.freteGanhoProposta ?? op.faturamentoProposta)}/mês${pctGanho != null ? ` (${percentual(pctGanho)} do total simulado)` : ''}`,
    `- Frete c/ concorrentes: ${dinheiro(op.freteConcorrentes)}/mês${pctConc != null ? ` (${percentual(pctConc)} do total simulado)` : ''}`,
    `- Aderência (por CT-e): ${percentual(op.aderenciaPorCte ?? 0)} · Aderência (por frete simulado): ${percentual(op.aderenciaPorFrete ?? 0)}`,
    `- CT-es ganharia / com tabela: ${n(op.ctesGanharia).toLocaleString('pt-BR')} / ${n(op.ctesComTabela).toLocaleString('pt-BR')}`,
  ];
}

export const LAUDO_AUDIENCE = {
  DIRETORIA: 'diretoria',
  TRANSPORTADORA: 'transportadora',
};

export function laudoConsolidadoExterno(audience = LAUDO_AUDIENCE.TRANSPORTADORA) {
  return audience === LAUDO_AUDIENCE.TRANSPORTADORA;
}

export function laudoConsolidadoPorAudience(laudo = {}, audience = LAUDO_AUDIENCE.TRANSPORTADORA, opcoes = {}) {
  const versao = laudo?.versoes?.[audience] || laudo?.versoes?.transportadora || {};
  const exibirFaturamentoGanho = opcoes.exibirFaturamentoGanho !== false;
  const textos = remontarTextosLaudoConsolidado(laudo, audience, { exibirFaturamentoGanho });
  const base = {
    ...laudo,
    audience,
    titulo: versao.titulo || laudo.titulo,
    assunto: versao.assunto || laudo.assunto,
    relatorioTexto: textos.relatorioTexto,
    corpoEmail: textos.corpoEmail,
    relatorio: textos.relatorio,
    laudoCompleto: textos.laudoCompleto,
    recomendacao: versao.recomendacao ?? laudo.recomendacao,
    tipo: versao.tipo || laudo.tipo,
    exibirFaturamentoGanho,
  };

  if (exibirFaturamentoGanho) return base;

  const totais = { ...(laudo.totais || {}) };
  delete totais.faturamentoProposta;
  delete totais.freteGanhoProposta;
  delete totais.freteConcorrentes;
  delete totais.freteTotalComTabela;
  delete totais.pctPerdidoSimulacao;

  return {
    ...base,
    totais,
    origens: (laudo.origens || []).map((o) => {
      const origem = { ...o };
      delete origem.faturamentoProposta;
      delete origem.freteGanhoProposta;
      delete origem.freteConcorrentes;
      delete origem.freteTotalComTabela;
      delete origem.pctPerdidoSimulacao;
      return origem;
    }),
  };
}

/** Regenera textos do laudo quando faturamento ganho/proposta deve ficar oculto (export .txt/.email). */
export function remontarTextosLaudoConsolidado(laudo = {}, audience = LAUDO_AUDIENCE.TRANSPORTADORA, opcoes = {}) {
  const versao = laudo?.versoes?.[audience] || laudo?.versoes?.transportadora || {};
  const exibirFaturamentoGanho = opcoes.exibirFaturamentoGanho !== false;

  if (exibirFaturamentoGanho) {
    const relatorioTexto = versao.relatorioTexto || laudo.relatorioTexto || laudo.relatorio || '';
    return {
      relatorioTexto,
      corpoEmail: versao.corpoEmail || laudo.corpoEmail || laudo.relatorio || relatorioTexto,
      relatorio: versao.relatorio || laudo.relatorio || relatorioTexto,
      laudoCompleto: versao.laudoCompleto || laudo.laudoCompleto || '',
    };
  }

  const op = laudo.totais || {};
  const paramsBase = {
    nome: laudo.transportadora || '',
    geradoEm: laudo.geradoEm,
    origens: laudo.origens || [],
    aderenciaMedia: n(op.aderenciaMedia),
    totaisOperacionais: op,
    rotasPrioritarias: laudo.rotasPrioritarias || laudo.rotasCriticas || [],
    rotasPrioritariasResumo: laudo.rotasPrioritariasResumo || {},
    exibirFaturamentoGanho: false,
    legendaPeriodo: laudo.legendaPeriodo || montarLegendaPeriodoMensal(laudo.periodoSimulado || { meses: op.mesesPeriodo }),
  };

  let relatorio;
  if (audience === LAUDO_AUDIENCE.DIRETORIA) {
    relatorio = montarRelatorioDiretoria({
      ...paramsBase,
      savingTotal: n(op.savingMes),
      recomendacao: versao.recomendacao ?? laudo.recomendacao ?? '',
    });
  } else {
    relatorio = montarRelatorioTransportadora({
      ...paramsBase,
      recomendacao: versao.recomendacao ?? laudo.recomendacao ?? '',
    });
  }

  const assunto = versao.assunto || laudo.assunto || '';
  return {
    relatorioTexto: relatorio,
    corpoEmail: relatorio,
    relatorio,
    laudoCompleto: assunto ? `Assunto: ${assunto}\n\n${relatorio}` : relatorio,
  };
}

function montarTextoRotasPrioritarias(rotas = [], resumo = {}, opcoes = {}) {
  if (!rotas.length) return [];
  const legendaPeriodo = opcoes.legendaPeriodo || '';
  const minRotas = n(resumo.minRotas) || 20;
  const regraPareto = resumo.usouMinimoRotas
    ? `Pareto 80% por origem; mínimo ${minRotas} rotas quando o corte fica abaixo disso`
    : `Pareto 80% por origem (≥ ${minRotas} rotas mantém o corte Pareto)`;
  const cobertura = rotuloCoberturaFreteConcorrentesRotas(resumo);
  const linhaCobertura = cobertura.cobreTudo
    ? `- Cobertura do frete c/ concorrentes: ${cobertura.valorPrincipal} — rotas prioritárias cobrem o total`
    : `- Cobertura do frete c/ concorrentes: ${cobertura.valorPrincipal}${cobertura.valorRotas > 0
      ? ` (${dinheiro(cobertura.valorRotas)}/mês${legendaPeriodo ? ` ${legendaPeriodo.replace(/^\/mês · /, '· ')}` : ''} nas rotas prioritárias)`
      : ''}`;
  return [
    'ROTAS PRIORITÁRIAS PARA REVISÃO',
    `- Rotas selecionadas: ${resumo.qtdRotas ?? rotas.length} · ${regraPareto}`,
    linhaCobertura,
    `- Redução média necessária: ${percentual(resumo.reducaoMediaNecessaria)}`,
    `- Origem mais crítica: ${resumo.origemMaisCritica || '—'}`,
    '',
    'Prioridade | Origem | Destino | % redução (perdidos) | Frete c/ concorrentes | CT-es c/ tabela | Status',
    ...rotas.map((r) => (
      `${r.prioridade} | ${r.origem || '—'} | ${r.destino || '—'} | ${percentual(r.percentualReducaoNecessaria)} | ${dinheiro(r.faturamentoMensalEmRisco)} | ${n(r.quantidadeCtes).toLocaleString('pt-BR')} | ${r.status}`
    )),
  ];
}

function montarRelatorioDiretoria({
  nome, geradoEm, origens, savingTotal, aderenciaMedia, totaisOperacionais,
  rotasPrioritarias, rotasPrioritariasResumo, recomendacao, exibirFaturamentoGanho = true,
  legendaPeriodo = '',
}) {
  const op = totaisOperacionais || {};
  const linhasSimulacao = exibirFaturamentoGanho
    ? montarLinhasResumoSimulacaoTabela(op, legendaPeriodo)
    : montarLinhasResumoAderenciaBasica(op);
  return resumoTexto([
    `LAUDO CONSOLIDADO — USO INTERNO / DIRETORIA — ${nome}`,
    `Gerado em: ${dataBR(geradoEm)}`,
    '',
    'RESUMO GERAL',
    `- Origens analisadas: ${origens.length}`,
    `- Saving mensal estimado (soma das origens): ${dinheiro(savingTotal)}`,
    ...(exibirFaturamentoGanho ? [montarNotaBasesLaudoConsolidado(op), ''] : []),
    ...linhasSimulacao,
    `- Pedidos ganhos: ${n(op.pedidosDia).toLocaleString('pt-BR')}/dia · ${n(op.pedidosMes).toLocaleString('pt-BR')}/mês · Volumes ganhos: ${n(op.volumesMes).toLocaleString('pt-BR')}/mês`,
    '',
    'POR ORIGEM',
    ...origens.map((o) => [
      '',
      `▸ ${o.origem} (${o.canal || '—'}) — ${o.status}`,
      `  Rodada ${o.rodada} · Aderência CT-e ${percentual(o.aderenciaPorCte ?? o.aderencia)} · Frete ${percentual(o.aderenciaPorFrete ?? 0)} · Saving ${dinheiro(o.savingMes)}/mês`,
      `  CT-es ganharia / com tabela: ${n(o.ctesGanharia).toLocaleString('pt-BR')} / ${n(o.ctesComTabela).toLocaleString('pt-BR')} · Rotas na tabela: ${o.rotas}`,
      montarLinhaMetricasOperacionaisTexto(o, { exibirFaturamentoGanho }),
      o.recomendacao ? `  Direcionamento: ${o.recomendacao}` : '',
    ].filter(Boolean).join('\n')),
    '',
    ...montarTextoRotasPrioritarias(rotasPrioritarias, rotasPrioritariasResumo, { legendaPeriodo }),
    '',
    'OBSERVAÇÃO',
    'Laudo interno com saving e impacto financeiro. Não compartilhar com a transportadora.',
    '',
    'RECOMENDAÇÃO',
    recomendacao,
  ]);
}

function montarRelatorioTransportadora({
  nome, geradoEm, origens, aderenciaMedia, totaisOperacionais,
  rotasPrioritarias, rotasPrioritariasResumo, recomendacao, exibirFaturamentoGanho = true,
  legendaPeriodo = '',
}) {
  const op = totaisOperacionais || {};
  const origensOrdenadas = [...origens].sort((a, b) => n(a.aderenciaPorCte ?? a.aderencia) - n(b.aderenciaPorCte ?? b.aderencia) || n(b.ctesComTabela) - n(a.ctesComTabela));
  const linhasSimulacao = exibirFaturamentoGanho
    ? montarLinhasResumoSimulacaoTabela(op, legendaPeriodo)
    : montarLinhasResumoAderenciaBasica(op);
  return resumoTexto([
    `DEVOLUTIVA CONSOLIDADA — ${nome}`,
    `Gerado em: ${dataBR(geradoEm)}`,
    '',
    'RESUMO GERAL',
    `- Origens simuladas c/ tabela: ${origens.length}`,
    ...(exibirFaturamentoGanho ? [montarNotaBasesLaudoConsolidado(op), ''] : []),
    ...linhasSimulacao,
    `- Pedidos ganhos: ${n(op.pedidosDia).toLocaleString('pt-BR')}/dia · ${n(op.pedidosMes).toLocaleString('pt-BR')}/mês · Volumes ganhos: ${n(op.volumesMes).toLocaleString('pt-BR')}/mês`,
    rotasPrioritariasResumo.reducaoMediaNecessaria
      ? `- Redução média necessária nas rotas prioritárias: ${percentual(rotasPrioritariasResumo.reducaoMediaNecessaria)}`
      : '',
    '',
    'POR ORIGEM',
    ...origensOrdenadas.map((o) => [
      '',
      `▸ ${o.origem} (${o.canal || '—'}) — ${o.status}`,
      `  Rodada ${o.rodada} · Aderência CT-e ${percentual(o.aderenciaPorCte ?? o.aderencia)} · Frete ${percentual(o.aderenciaPorFrete ?? 0)}`,
      `  CT-es ganharia / com tabela: ${n(o.ctesGanharia).toLocaleString('pt-BR')} / ${n(o.ctesComTabela).toLocaleString('pt-BR')} · Rotas na tabela: ${o.rotas}`,
      montarLinhaMetricasOperacionaisTexto(o, { exibirFaturamentoGanho }),
      o.recomendacao ? `  Direcionamento: ${o.recomendacao}` : '',
    ].filter(Boolean).join('\n')),
    '',
    ...montarTextoRotasPrioritarias(rotasPrioritarias, rotasPrioritariasResumo, { legendaPeriodo }),
    '',
    'OBSERVAÇÃO',
    'Este laudo consolida as negociações por origem. Use as simulações individuais para detalhar rotas, faixas e cotações específicas.',
    '',
    'DIRECIONAMENTO',
    recomendacao,
  ]);
}

/**
 * Consolida várias negociações (origens) da mesma transportadora em um laudo de devolutiva.
 * Espera tabelas já com resumo_simulacao completo quando possível.
 */
export function montarLaudoTransportadoraConsolidado(tabelas = [], transportadoraNome = '') {
  const nome = texto(transportadoraNome) || texto(tabelas[0]?.transportadora) || 'Transportadora';
  const lista = (tabelas || []).filter((t) => upper(t.transportadora) === upper(nome) || !transportadoraNome);
  const enriquecidas = lista.map((t) => enriquecerTabelaGestao(t));
  const tabelasRelevantes = filtrarTabelasLaudoConsolidado(enriquecidas);
  const geradoEm = new Date().toISOString();

  const origens = tabelasRelevantes.map((t) => {
    const resumo = t.resumo_simulacao || {};
    const ultima = resumo.ultima_simulacao || {};
    const ind = ultima.indicadores || {};
    const laudoOrigem = montarLaudosRodadasNegociacao(t).transportador;
    const rotasCriticas = laudoOrigem.ondeAjustar || laudoOrigem.rotasCriticas || [];
    const metricas = extrairMetricasOperacionaisOrigem(t, { rotasCriticas });
    return {
      negociacaoId: t.id,
      origem: origemLabelTabela(t),
      canal: t.canal || '',
      status: t.status_gestao_label || t.status,
      rodada: n(resumo.rodada_atual || ind.rodada || 1),
      savingMes: normalizarValorMensal({
        valorMensal: t.saving_estimado || ind.saving_mes || resumo.savingSelecionadaVsRealMes,
        valorPeriodo: resumo.savingSelecionadaVsReal,
        meses: metricas.mesesPeriodo,
      }),
      ctesAnalisados: n(t.ctes_analisados || ind.ctes_analisados || ind.qtd_registros_analisados || resumo.ctesAnalisados),
      ...metricas,
      aderencia: metricas.aderenciaPorCte ?? n(t.aderencia_projetada || ind.aderencia || resumo.aderenciaSelecionada),
      rotas: n(t.qtd_rotas || resumo.qtdRotas),
      rotasCriticas,
      rotasMelhoraram: (laudoOrigem.ondeMelhorou || laudoOrigem.rotasMelhoraram || []).slice(0, 5),
      recomendacao: laudoOrigem.recomendacao || '',
    };
  }).sort((a, b) => b.savingMes - a.savingMes);

  const savingTotal = origens.reduce((acc, o) => acc + o.savingMes, 0);
  const ctesTotal = origens.reduce((acc, o) => acc + o.ctesAnalisados, 0);
  const ctesComTabela = origens.reduce((acc, o) => acc + o.ctesComTabela, 0);
  const ctesGanharia = origens.reduce((acc, o) => acc + o.ctesGanharia, 0);
  const totaisOperacionais = origens.reduce((acc, o) => ({
    faturamentoAtual: acc.faturamentoAtual + o.faturamentoAtual,
    faturamentoProposta: acc.faturamentoProposta + o.faturamentoProposta,
    freteGanhoProposta: acc.freteGanhoProposta + n(o.freteGanhoProposta ?? o.faturamentoProposta),
    freteConcorrentes: acc.freteConcorrentes + n(o.freteConcorrentes),
    freteTotalComTabela: acc.freteTotalComTabela + n(o.freteTotalComTabela),
    pedidosDia: acc.pedidosDia + o.pedidosDia,
    pedidosMes: acc.pedidosMes + o.pedidosMes,
    volumesMes: acc.volumesMes + o.volumesMes,
    ctesGanharia: acc.ctesGanharia + o.ctesGanharia,
    ctesComTabela: acc.ctesComTabela + o.ctesComTabela,
  }), {
    faturamentoAtual: 0,
    faturamentoProposta: 0,
    freteGanhoProposta: 0,
    freteConcorrentes: 0,
    freteTotalComTabela: 0,
    pedidosDia: 0,
    pedidosMes: 0,
    volumesMes: 0,
    ctesGanharia: 0,
    ctesComTabela: 0,
  });
  totaisOperacionais.ctesAnalisados = ctesTotal;
  totaisOperacionais.pctPerdidoSimulacao = totaisOperacionais.freteTotalComTabela
    ? (totaisOperacionais.freteConcorrentes / totaisOperacionais.freteTotalComTabela) * 100
    : null;
  totaisOperacionais.aderenciaPorCte = calcularAderenciaPorCte(ctesGanharia, ctesComTabela);
  totaisOperacionais.aderenciaPorFrete = calcularAderenciaPorFrete(
    totaisOperacionais.freteGanhoProposta,
    totaisOperacionais.freteTotalComTabela,
  );
  totaisOperacionais.pctFreteGanhoDoFaturamentoAtual = totaisOperacionais.faturamentoAtual
    ? (totaisOperacionais.freteGanhoProposta / totaisOperacionais.faturamentoAtual) * 100
    : null;

  const periodoLaudo = montarPeriodoLaudoConsolidado(tabelasRelevantes, origens);
  const legendaPeriodo = montarLegendaPeriodoMensal(periodoLaudo);

  const aderenciaMedia = totaisOperacionais.aderenciaPorCte;
  const aderenciaMediaPorOrigem = origens.length
    ? origens.reduce((acc, o) => acc + n(o.aderenciaPorCte ?? o.aderencia), 0) / origens.length
    : 0;

  const rotasBrutas = origens.flatMap((o) => (
    (o.rotasCriticas || []).map((r) => ({
      ...r,
      origemNegociacao: o.origem,
      mesesPeriodo: o.mesesPeriodo || periodoLaudo.meses || 1,
    }))
  ));
  const freteConcorrentesTotalReferencia = totaisOperacionais.freteConcorrentes;
  const { rotas: rotasPrioritariasBrutas, meta: rotasPrioritariasMeta } = consolidarRotasPrioritariasComMeta(rotasBrutas, {
    meses: periodoLaudo.meses,
  });
  const rotasPrioritarias = reconciliarRotasPrioritariasMensal(rotasPrioritariasBrutas, {
    freteConcorrentesTotal: freteConcorrentesTotalReferencia,
    meses: periodoLaudo.meses,
  });
  const rotasPrioritariasResumo = montarResumoRotasPrioritarias(rotasPrioritarias, {
    ...rotasPrioritariasMeta,
    faturamentoAtual: totaisOperacionais.faturamentoAtual,
    freteConcorrentesTotal: freteConcorrentesTotalReferencia,
    freteTotalComTabela: totaisOperacionais.freteTotalComTabela,
    freteConcorrentesTotalReferencia,
  });

  const recomendacaoDiretoria = savingTotal > 0
    ? 'Há oportunidade de ganho operacional. Priorize ajustes nas rotas listadas e avance com aprovação parcial nas origens já aderentes.'
    : 'Revise cobertura e impacto financeiro por origem antes de uma nova rodada de proposta.';

  const recomendacaoTransportadora = rotasPrioritarias.length
    ? 'Priorize os ajustes nas rotas listadas acima e retorne com nova proposta nas origens com menor aderência.'
    : 'Revise cobertura e competitividade por origem antes de uma nova rodada de proposta.';

  const relatorioDiretoria = montarRelatorioDiretoria({
    nome, geradoEm, origens, savingTotal, aderenciaMedia, totaisOperacionais,
    rotasPrioritarias, rotasPrioritariasResumo, recomendacao: recomendacaoDiretoria,
    legendaPeriodo,
  });

  const relatorioTransportadora = montarRelatorioTransportadora({
    nome, geradoEm, origens, aderenciaMedia, totaisOperacionais,
    rotasPrioritarias, rotasPrioritariasResumo, recomendacao: recomendacaoTransportadora,
    legendaPeriodo,
  });

  const assuntoDiretoria = `Laudo consolidado (diretoria) — ${nome} (${origens.length} origem(ns))`;
  const assuntoTransportadora = `Devolutiva de negociação — ${nome} (${origens.length} origem(ns))`;

  const versoes = {
    diretoria: {
      tipo: 'executivo_consolidado',
      titulo: `Laudo consolidado — uso interno — ${nome}`,
      assunto: assuntoDiretoria,
      relatorio: relatorioDiretoria,
      relatorioTexto: relatorioDiretoria,
      corpoEmail: relatorioDiretoria,
      laudoCompleto: `Assunto: ${assuntoDiretoria}\n\n${relatorioDiretoria}`,
      recomendacao: recomendacaoDiretoria,
    },
    transportadora: {
      tipo: 'transportador_consolidado',
      titulo: `Devolutiva consolidada — ${nome}`,
      assunto: assuntoTransportadora,
      relatorio: relatorioTransportadora,
      relatorioTexto: relatorioTransportadora,
      corpoEmail: relatorioTransportadora,
      laudoCompleto: `Assunto: ${assuntoTransportadora}\n\n${relatorioTransportadora}`,
      recomendacao: recomendacaoTransportadora,
    },
  };

  return {
    transportadora: nome,
    geradoEm,
    periodoSimulado: periodoLaudo,
    legendaPeriodo,
    origens,
    totais: {
      savingMes: savingTotal,
      aderenciaMedia,
      aderenciaMediaPorOrigem,
      aderenciaPorCte: totaisOperacionais.aderenciaPorCte,
      aderenciaPorFrete: totaisOperacionais.aderenciaPorFrete,
      ctesAnalisados: ctesTotal,
      ctesComTabela,
      ctesGanharia,
      faturamentoAtual: totaisOperacionais.faturamentoAtual,
      faturamentoProposta: totaisOperacionais.faturamentoProposta,
      freteGanhoProposta: totaisOperacionais.freteGanhoProposta,
      freteConcorrentes: totaisOperacionais.freteConcorrentes,
      freteTotalComTabela: totaisOperacionais.freteTotalComTabela,
      pctPerdidoSimulacao: totaisOperacionais.pctPerdidoSimulacao,
      pctFreteGanhoDoFaturamentoAtual: totaisOperacionais.pctFreteGanhoDoFaturamentoAtual,
      pedidosDia: totaisOperacionais.pedidosDia,
      pedidosMes: totaisOperacionais.pedidosMes,
      volumesMes: totaisOperacionais.volumesMes,
      mesesPeriodo: periodoLaudo.meses,
      qtdOrigens: origens.length,
    },
    rotasPrioritarias,
    rotasPrioritariasResumo,
    rotasCriticas: rotasPrioritarias,
    versoes,
  };
}
