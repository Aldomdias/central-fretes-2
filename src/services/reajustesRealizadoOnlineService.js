import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const SQL_FIX_HINT = 'Rode o arquivo supabase/REAJUSTE_REALIZADO_ONLINE_FIX.sql no SQL Editor do Supabase.';

function ensureClient() {
  const client = getSupabaseClient();
  if (!client || !isSupabaseConfigured()) {
    throw new Error('Supabase não configurado para consultar o Realizado Online.');
  }
  return client;
}

export function reajustesRealizadoOnlineDisponivel() {
  return Boolean(isSupabaseConfigured() && getSupabaseClient());
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function dateFromIso(value) {
  const iso = isoDate(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function addDaysIso(value, days) {
  const date = dateFromIso(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return toIsoDate(date);
}

function addMonthsIso(value, months) {
  const date = dateFromIso(value);
  if (!date) return '';
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

function diffDaysInclusive(inicio = '', fim = '') {
  const start = dateFromIso(inicio);
  const end = dateFromIso(fim);
  if (!start || !end || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function mesesEquivalentes(inicio = '', fim = '') {
  const dias = diffDaysInclusive(inicio, fim);
  return dias ? dias / 30 : 0;
}

function mesesBaseImpacto(periodo = {}) {
  const raw = Number(periodo.mesesBaseImpacto || periodo.mesesBase || 3);
  if (!Number.isFinite(raw) || raw <= 0) return 3;
  return Math.min(Math.max(1, Math.round(raw)), 12);
}

function dataInicioItem(item = {}) {
  return isoDate(item.dataInicio || item.dataPrimeiraParcela || '');
}

function limparNome(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizarTexto(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

function nomesPossiveisItem(item = {}) {
  const selecionados = Array.isArray(item.transportadorasRealizado)
    ? item.transportadorasRealizado.map(limparNome).filter(Boolean)
    : [];

  if (selecionados.length) return selecionados;

  return [item.transportadoraSistema, item.transportadoraInformada]
    .map(limparNome)
    .filter(Boolean)
    .filter((nome, index, arr) => arr.findIndex((outro) => normalizarTexto(outro) === normalizarTexto(nome)) === index);
}

function resumoVazio() {
  return {
    ctes: 0,
    valorCte: 0,
    valorNF: 0,
    peso: 0,
    primeiraData: '',
    ultimaData: '',
  };
}

function normalizarResumo(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return resumoVazio();
  return {
    ctes: toNumber(row.ctes ?? row.total),
    valorCte: toNumber(row.valorCte ?? row.valor_cte ?? row.frete),
    valorNF: toNumber(row.valorNF ?? row.valor_nf),
    peso: toNumber(row.peso),
    primeiraData: isoDate(row.primeiraData || row.primeira_data || ''),
    ultimaData: isoDate(row.ultimaData || row.ultima_data || ''),
  };
}

const resumoCache = new Map();

function cacheKey(nomes = [], inicio = '', fim = '') {
  return JSON.stringify({
    nomes: (nomes || []).map(normalizarTexto).sort(),
    inicio: inicio || '',
    fim: fim || '',
  });
}

async function rpcResumoRealizado(client, nomes = [], inicio = '', fim = '') {
  const transportadoras = (nomes || [])
    .map(limparNome)
    .filter(Boolean)
    .filter((nome, index, arr) => arr.findIndex((outro) => normalizarTexto(outro) === normalizarTexto(nome)) === index);

  if (!transportadoras.length) return resumoVazio();

  const key = cacheKey(transportadoras, inicio, fim);
  if (resumoCache.has(key)) return resumoCache.get(key);

  const { data, error } = await client.rpc('reajustes_resumo_realizado_ctes', {
    p_transportadoras: transportadoras,
    p_inicio: inicio || null,
    p_fim: fim || null,
  });

  if (error) {
    throw new Error(
      `Erro ao resumir CT-es do Realizado Online. ${SQL_FIX_HINT} Detalhe: ${error.message || error.details || 'erro desconhecido'}`
    );
  }

  const resumo = normalizarResumo(data);
  resumoCache.set(key, resumo);
  return resumo;
}

export async function listarTransportadorasRealizadoReajustes() {
  const client = ensureClient();
  const { data, error } = await client.rpc('reajustes_realizado_transportadoras');

  if (error) {
    throw new Error(
      `Erro ao carregar transportadoras do Realizado Online. ${SQL_FIX_HINT} Detalhe: ${error.message || error.details || 'erro desconhecido'}`
    );
  }

  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row) => ({
      nome: limparNome(row.nome || row.transportadora),
      ctes: toNumber(row.ctes),
      frete: toNumber(row.frete || row.valorCte || row.valor_cte),
      valorNF: toNumber(row.valorNF || row.valor_nf),
      primeiraData: isoDate(row.primeiraData || row.primeira_data || ''),
      ultimaData: isoDate(row.ultimaData || row.ultima_data || ''),
    }))
    .filter((row) => row.nome)
    .sort((a, b) => b.frete - a.frete || b.ctes - a.ctes || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export async function obterUltimaDataRealizadoReajustes() {
  const client = ensureClient();
  const { data, error } = await client.rpc('reajustes_realizado_ultima_data');
  if (error) {
    throw new Error(
      `Erro ao consultar última data do Realizado Online. ${SQL_FIX_HINT} Detalhe: ${error.message || error.details || 'erro desconhecido'}`
    );
  }
  return isoDate(data || '');
}

function calcularJanela(inicio = '', meses = 3, ultimaDataRealizado = '') {
  if (!inicio) {
    return {
      inicioBase: '',
      fimBase: '',
      inicioRealizado: '',
      fimRealizado: '',
      diasRealizados: 0,
      mesesRealizados: 0,
    };
  }

  const fimRealizado = ultimaDataRealizado && ultimaDataRealizado >= inicio ? ultimaDataRealizado : '';
  return {
    inicioBase: addMonthsIso(inicio, -meses),
    fimBase: addDaysIso(inicio, -1),
    inicioRealizado: inicio,
    fimRealizado,
    diasRealizados: fimRealizado ? diffDaysInclusive(inicio, fimRealizado) : 0,
    mesesRealizados: fimRealizado ? mesesEquivalentes(inicio, fimRealizado) : 0,
  };
}


export async function diagnosticarRealizadoOnlineReajustes() {
  const client = ensureClient();
  const { data, error } = await client.rpc('diagnosticar_realizado_online_reajustes');
  if (error) {
    throw new Error(
      `Erro ao diagnosticar Realizado Online. ${SQL_FIX_HINT} Detalhe: ${error.message || error.details || 'erro desconhecido'}`
    );
  }
  return data || {};
}

export async function calcularImpactosReajustesOnline(itens = [], periodo = {}) {
  const client = ensureClient();
  resumoCache.clear();

  const ultimaDataRealizado = await obterUltimaDataRealizadoReajustes();
  const mesesBasePadrao = mesesBaseImpacto(periodo);
  const resultado = [];

  for (const item of itens || []) {
    const inicio = dataInicioItem(item);
    const meses = mesesBaseImpacto({
      ...periodo,
      mesesBaseImpacto: item.mesesBaseImpacto || periodo.mesesBaseImpacto || mesesBasePadrao,
    });
    const nomes = nomesPossiveisItem(item);
    const janela = calcularJanela(inicio, meses, ultimaDataRealizado);
    const podeCalcular = Boolean(inicio && nomes.length);

    const base = podeCalcular
      ? await rpcResumoRealizado(client, nomes, janela.inicioBase, janela.fimBase)
      : resumoVazio();

    const realizado = podeCalcular && janela.fimRealizado
      ? await rpcResumoRealizado(client, nomes, janela.inicioRealizado, janela.fimRealizado)
      : resumoVazio();

    const valorFreteBaseTotal = base.valorCte;
    const valorNFBaseTotal = base.valorNF;
    const pesoBaseTotal = base.peso;
    const ctesPeriodo = base.ctes;

    const valorFretePeriodo = valorFreteBaseTotal / Math.max(meses, 1);
    const valorNFPeriodo = valorNFBaseTotal / Math.max(meses, 1);
    const pesoPeriodo = pesoBaseTotal / Math.max(meses, 1);

    const mesesRealizados = janela.mesesRealizados > 0 ? janela.mesesRealizados : 0;
    const valorFreteRealizadoTotal = realizado.valorCte;
    const valorNFRealizadoTotal = realizado.valorNF;
    const pesoRealizadoTotal = realizado.peso;
    const ctesRealizadoReajuste = realizado.ctes;

    const valorFreteRealizadoReajuste = mesesRealizados ? valorFreteRealizadoTotal / mesesRealizados : 0;
    const valorNFRealizadoReajuste = mesesRealizados ? valorNFRealizadoTotal / mesesRealizados : 0;
    const pesoRealizadoReajuste = mesesRealizados ? pesoRealizadoTotal / mesesRealizados : 0;

    const pctSolicitado = toNumber(item.reajusteSolicitado) || toNumber(item.reajustePrimeiraParcela) || toNumber(item.propostaFinal) || toNumber(item.reajusteAplicado);
    const pctRepassado = toNumber(item.reajusteAplicado) || toNumber(item.propostaFinal) || pctSolicitado;
    const pctReducao = Math.max(pctSolicitado - pctRepassado, 0);

    const impactoPrevistoSolicitado = valorFretePeriodo * pctSolicitado;
    const impactoPrevistoRepassado = valorFretePeriodo * pctRepassado;
    const reducaoImpactoPrevisto = Math.max(impactoPrevistoSolicitado - impactoPrevistoRepassado, 0);

    const impactoRealizadoSolicitado = valorFreteRealizadoReajuste * pctSolicitado;
    const impactoRealizadoRepassado = valorFreteRealizadoReajuste * pctRepassado;
    const reducaoImpactoRealizada = Math.max(impactoRealizadoSolicitado - impactoRealizadoRepassado, 0);

    const impactoRealizadoTotalSolicitado = valorFreteRealizadoTotal * pctSolicitado;
    const impactoRealizadoTotalRepassado = valorFreteRealizadoTotal * pctRepassado;
    const reducaoImpactoRealizadaTotal = Math.max(impactoRealizadoTotalSolicitado - impactoRealizadoTotalRepassado, 0);

    const freteComReajuste = valorFretePeriodo + impactoPrevistoRepassado;
    const freteRealizadoComReajuste = valorFreteRealizadoReajuste + impactoRealizadoRepassado;
    const percentualFreteAtual = valorNFPeriodo ? valorFretePeriodo / valorNFPeriodo : 0;
    const percentualFreteComReajuste = valorNFPeriodo ? freteComReajuste / valorNFPeriodo : 0;
    const percentualFreteRealizadoReajuste = valorNFRealizadoReajuste ? valorFreteRealizadoReajuste / valorNFRealizadoReajuste : 0;
    const percentualFreteRealizadoComReajuste = valorNFRealizadoReajuste ? freteRealizadoComReajuste / valorNFRealizadoReajuste : 0;
    const variacaoPercentualFreteRealizado = percentualFreteRealizadoReajuste - percentualFreteAtual;

    resultado.push({
      ...item,
      ctesPeriodo,
      valorFretePeriodo,
      valorNFPeriodo,
      pesoPeriodo,
      valorFreteBaseTotal,
      valorNFBaseTotal,
      pesoBaseTotal,
      reajusteSolicitado: pctSolicitado,
      reajusteAplicado: pctRepassado,
      percentualReducaoReajuste: pctReducao,
      impactoPrevistoSolicitado,
      impactoPrevistoRepassado,
      reducaoImpactoPrevisto,
      impactoPrevisto: impactoPrevistoRepassado,
      impactoPeriodo: impactoPrevistoRepassado,
      freteComReajuste,
      percentualFreteAtual,
      percentualFreteComReajuste,
      ctesRealizadoReajuste,
      valorFreteRealizadoReajuste,
      valorNFRealizadoReajuste,
      pesoRealizadoReajuste,
      valorFreteRealizadoTotal,
      valorNFRealizadoTotal,
      pesoRealizadoTotal,
      impactoRealizadoSolicitado,
      impactoRealizadoRepassado,
      reducaoImpactoRealizada,
      impactoRealizado: impactoRealizadoRepassado,
      impactoRealizadoTotalSolicitado,
      impactoRealizadoTotalRepassado,
      reducaoImpactoRealizadaTotal,
      percentualFreteRealizadoReajuste,
      percentualFreteRealizadoComReajuste,
      variacaoPercentualFreteRealizado,
      inicioImpactoBase: janela.inicioBase,
      fimImpactoBase: janela.fimBase,
      inicioImpactoRealizado: janela.inicioRealizado,
      fimImpactoRealizado: janela.fimRealizado,
      mesesBaseImpacto: meses,
      diasRealizadosImpacto: janela.diasRealizados,
      mesesRealizadosImpacto: janela.mesesRealizados,
      ultimaDataRealizadoImpacto: ultimaDataRealizado,
      semDataInicioImpacto: !inicio,
      vinculado: Boolean(nomes.length && (ctesPeriodo || ctesRealizadoReajuste)),
      nomesUsadosImpacto: nomes,
      fonteImpacto: 'realizado-online-supabase',
      avisoImpacto: !nomes.length
        ? 'Sem vínculo com transportadora do Realizado Online.'
        : !inicio
          ? 'Sem data de início para calcular a janela automática.'
          : !ctesPeriodo && !ctesRealizadoReajuste
            ? 'Vínculo encontrado, mas sem CT-e dentro das janelas calculadas.'
            : '',
    });
  }

  return resultado;
}
