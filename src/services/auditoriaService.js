/**
 * auditoriaService.js
 *
 * Serviço da tela Auditoria de CTes.
 *
 * Objetivo:
 * - Priorizar a base do módulo CT-e: realizado_local_ctes.
 * - Evitar falso "Nenhum CTe encontrado" quando a base estiver preenchida por
 *   competencia, mas data_emissao estiver vazia/inconsistente.
 * - Usar fallback seguro em outras bases conhecidas do projeto, sem quebrar caso
 *   a tabela não exista no Supabase do ambiente.
 */

import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';

export const DIVERGENCIA_THRESHOLD = 0.05;
export const META_STORAGE_KEY = 'central_fretes_auditoria_meta_v1';
export const TOGGLE_TABELAS_KEY = 'central_fretes_auditoria_tabelas_v1';

const LIMITE_CONSULTA = 100000;

const FONTES_AUDITORIA = [
  {
    id: 'realizado_local_ctes',
    tabela: 'realizado_local_ctes',
    label: 'CT-e / realizado_local_ctes',
    campoData: 'data_emissao',
    prioridade: 1,
  },
  {
    id: 'realizado_ctes',
    tabela: 'realizado_ctes',
    label: 'Realizado legado / realizado_ctes',
    campoData: 'emissao',
    prioridade: 2,
  },
  {
    id: 'realizado_ctes_enxuta',
    tabela: 'realizado_ctes_enxuta',
    label: 'Base enxuta mensal / realizado_ctes_enxuta',
    campoData: 'data_emissao',
    prioridade: 3,
  },
];

// ─── Meta ─────────────────────────────────────────────────────────────────────

export function carregarMetaAuditoria() {
  try {
    const parsed = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || 'null');
    if (parsed && typeof parsed === 'object') {
      return normalizarMetaAuditoria(parsed);
    }
  } catch {
    // mantém meta padrão
  }

  return {
    taxaCalculoMeta: 95,
    taxaAssertividadeMeta: 98,
    descricao: 'Meta recomendada: 95% dos CTes com cálculo e 98% de assertividade nos CTes calculados.',
  };
}

export function salvarMetaAuditoria(meta = {}) {
  localStorage.setItem(META_STORAGE_KEY, JSON.stringify(normalizarMetaAuditoria(meta)));
}

export function normalizarMetaAuditoria(meta = {}) {
  const taxaCalculoMeta = limitarPercentual(meta.taxaCalculoMeta ?? 95);
  const taxaAssertividadeMeta = limitarPercentual(meta.taxaAssertividadeMeta ?? 98);
  const descricao = String(meta.descricao || '').trim()
    || `Meta recomendada: ${taxaCalculoMeta}% calculados com ${taxaAssertividadeMeta}% de assertividade.`;

  return { taxaCalculoMeta, taxaAssertividadeMeta, descricao };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function limitarPercentual(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.max(0, Math.min(100, numero));
}

function competenciaParaDatas(competencia = '') {
  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) return null;
  const [ano, mes] = competencia.split('-').map(Number);
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia}`;
  return { inicio, fim };
}

function normNome(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function pick(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let text = String(value).trim();
  if (!text) return 0;
  text = text.replace(/R\$|%/gi, '').replace(/\s+/g, '');

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    text = text.replace(',', '.');
  } else if (hasDot) {
    const parts = text.split('.');
    if (parts.length > 2) {
      const decimal = parts.pop();
      text = `${parts.join('')}.${decimal}`;
    }
  }

  const numero = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numero) ? numero : 0;
}

function getCompetenciaLinha(row = {}) {
  const competencia = pick(row, ['competencia', 'mes_competencia']);
  if (competencia) return String(competencia).slice(0, 7);

  const data = pick(row, ['data_emissao', 'emissao', 'dataEmissao']);
  if (data) return String(data).slice(0, 7);

  return '';
}

function normalizarRegistroAuditoria(row = {}, fonte = {}) {
  const valorCte = toNumber(pick(row, [
    'valor_cte',
    'valorCte',
    'frete_realizado',
    'freteRealizado',
    'valor_frete',
    'frete',
  ]));

  const valorCalculado = toNumber(pick(row, [
    'valor_calculado',
    'valorCalculado',
    'frete_calculado',
    'freteCalculado',
    'valor_tabela',
    'valorTabela',
  ]));

  const diferencaInformada = pick(row, ['diferenca', 'diferença', 'diferenca_calculada', 'diferencaCalculada']);
  const diferenca = diferencaInformada !== ''
    ? toNumber(diferencaInformada)
    : (valorCalculado > 0 ? valorCte - valorCalculado : 0);

  const dataEmissao = pick(row, ['data_emissao', 'emissao', 'dataEmissao']);

  return {
    ...row,
    transportadora: String(pick(row, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']) || 'Não informado').trim() || 'Não informado',
    valor_cte: valorCte,
    valor_calculado: valorCalculado,
    diferenca,
    data_emissao: dataEmissao,
    competencia: getCompetenciaLinha(row),
    __fonte_id: fonte.id || '',
    __fonte_label: fonte.label || fonte.tabela || '',
  };
}

function isEbazar(row) {
  const nome = row.transportadora || row.transportadora_realizada || '';
  return normNome(nome).includes('EBAZAR');
}

function erroTabelaInexistente(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('does not exist')
    || msg.includes('could not find')
    || msg.includes('not found')
    || msg.includes('schema cache')
    || msg.includes('relation')
    || msg.includes('column');
}

function montarResumoFonte({ fonte, filtro, data = [], error = null }) {
  const registros = (data || []).map((row) => normalizarRegistroAuditoria(row, fonte));
  const registrosValidos = registros.filter((row) => !isEbazar(row));
  const metricas = calcularMetricasAuditoria(registrosValidos);

  return {
    fonte: fonte.id,
    tabela: fonte.tabela,
    label: fonte.label,
    filtro,
    totalBruto: data?.length || 0,
    total: registrosValidos.length,
    calculados: metricas.totalCalculados,
    semCalculo: metricas.totalSemCalculo,
    divergentes: metricas.totalDivergentes,
    taxaCalculo: metricas.taxaCalculo,
    erro: error?.message || '',
  };
}

async function consultarFontePorData({ supabase, fonte, datas }) {
  let query = supabase
    .from(fonte.tabela)
    .select('*')
    .gte(fonte.campoData, datas.inicio)
    .lte(fonte.campoData, datas.fim)
    .limit(LIMITE_CONSULTA);

  if (fonte.campoData) {
    query = query.order(fonte.campoData, { ascending: false, nullsFirst: false });
  }

  return query;
}

async function consultarFontePorCompetencia({ supabase, fonte, competencia }) {
  return supabase
    .from(fonte.tabela)
    .select('*')
    .eq('competencia', competencia)
    .limit(LIMITE_CONSULTA);
}

// ─── Carregamento ─────────────────────────────────────────────────────────────

export async function carregarDadosAuditoria({ competencia = '' } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }

  const datas = competenciaParaDatas(competencia);
  if (!datas) {
    throw new Error('Informe a competência (mês) no formato YYYY-MM.');
  }

  const supabase = getSupabaseClient();
  const diagnostico = [];
  const avisos = [];

  for (const fonte of FONTES_AUDITORIA) {
    const porData = await consultarFontePorData({ supabase, fonte, datas });

    diagnostico.push(montarResumoFonte({
      fonte,
      filtro: `${fonte.campoData} entre ${datas.inicio} e ${datas.fim}`,
      data: porData.data || [],
      error: porData.error,
    }));

    if (porData.error) {
      if (!erroTabelaInexistente(porData.error)) {
        avisos.push(`${fonte.label}: ${porData.error.message}`);
      }
    } else if ((porData.data || []).length > 0) {
      const registros = (porData.data || [])
        .map((row) => normalizarRegistroAuditoria(row, fonte))
        .filter((row) => !isEbazar(row));

      return { registros, fonte, diagnostico, avisos };
    }

    const porCompetencia = await consultarFontePorCompetencia({ supabase, fonte, competencia });

    diagnostico.push(montarResumoFonte({
      fonte,
      filtro: `competencia = ${competencia}`,
      data: porCompetencia.data || [],
      error: porCompetencia.error,
    }));

    if (porCompetencia.error) {
      if (!erroTabelaInexistente(porCompetencia.error)) {
        avisos.push(`${fonte.label}: ${porCompetencia.error.message}`);
      }
    } else if ((porCompetencia.data || []).length > 0) {
      const registros = (porCompetencia.data || [])
        .map((row) => normalizarRegistroAuditoria(row, fonte))
        .filter((row) => !isEbazar(row));

      return { registros, fonte, diagnostico, avisos };
    }
  }

  return { registros: [], fonte: null, diagnostico, avisos };
}

// ─── Métricas ─────────────────────────────────────────────────────────────────

export function calcularMetricasAuditoria(registros = []) {
  let total = 0;
  let totalCalculados = 0;
  let totalSemCalculo = 0;
  let totalDivergentes = 0;
  let totalAssertivos = 0;
  let valorTotalCte = 0;
  let valorTotalDivergencia = 0;
  let valorExcessivo = 0;
  let valorInsuficiente = 0;

  for (const r of registros) {
    total += 1;
    const valCalc = toNumber(r.valor_calculado ?? r.valorCalculado);
    const dif = toNumber(r.diferenca);
    const valCte = toNumber