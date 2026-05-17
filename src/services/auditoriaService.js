/**
 * auditoriaService.js
 *
 * Serviço da tela Auditoria de CTes.
 *
 * Objetivo:
 * - Priorizar a base do módulo CT-e: realizado_local_ctes.
 * - Carregar o mês inteiro usando paginação, sem travar em 1.000 linhas.
 * - Evitar timeout buscando primeiro por competência.
 * - Salvar o mês carregado em auditoria_cte_resultados e auditoria_cte_resumo_mensal.
 */

import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';

export const DIVERGENCIA_THRESHOLD = 0.05;
export const META_STORAGE_KEY = 'central_fretes_auditoria_meta_v1';
export const TOGGLE_TABELAS_KEY = 'central_fretes_auditoria_tabelas_v1';

const PAGE_SIZE = 1000;
const INSERT_CHUNK_SIZE = 500;
const MAX_REGISTROS_POR_COMPETENCIA = 400000;

const FONTES_AUDITORIA = [
  {
    id: 'realizado_local_ctes',
    tabela: 'realizado_local_ctes',
    label: 'CT-e / realizado_local_ctes',
    campoData: 'data_emissao',
    prioridade: 1,
  },
  {
    id: 'realizado_ctes_enxuta',
    tabela: 'realizado_ctes_enxuta',
    label: 'Base enxuta mensal / realizado_ctes_enxuta',
    campoData: 'data_emissao',
    prioridade: 2,
  },
  {
    id: 'realizado_ctes',
    tabela: 'realizado_ctes',
    label: 'Realizado legado / realizado_ctes',
    campoData: 'emissao',
    prioridade: 3,
  },
];

export function carregarMetaAuditoria() {
  try {
    const parsed = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || 'null');
    if (parsed && typeof parsed === 'object') return normalizarMetaAuditoria(parsed);
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
    'valor_simulado',
    'valorSimulado',
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

function montarResumoFonte({ fonte, filtro, data = [], error = null, parcial = false, limiteAtingido = false }) {
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
    parcial,
    limiteAtingido,
  };
}

async function consultarFontePaginada({ supabase, fonte, competencia, datas, filtro = 'competencia', onProgress }) {
  const registros = [];
  let from = 0;

  while (from < MAX_REGISTROS_POR_COMPETENCIA) {
    let query = supabase.from(fonte.tabela).select('*');

    if (filtro === 'competencia') {
      query = query.eq('competencia', competencia);
    } else {
      query = query.gte(fonte.campoData, datas.inicio).lte(fonte.campoData, datas.fim);
    }

    query = query.range(from, from + PAGE_SIZE - 1);

    if (fonte.campoData) {
      query = query.order(fonte.campoData, { ascending: false, nullsFirst: false });
    }

    const { data, error } = await query;

    if (error) {
      return {
        data: registros,
        error,
        parcial: registros.length > 0,
        limiteAtingido: false,
      };
    }

    const lote = data || [];
    registros.push(...lote);

    onProgress?.({
      etapa: `carregando_${fonte.tabela}_${filtro}`,
      carregados: registros.length,
      total: null,
    });

    if (lote.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return {
    data: registros,
    error: null,
    parcial: false,
    limiteAtingido: registros.length >= MAX_REGISTROS_POR_COMPETENCIA,
  };
}

export async function carregarDadosAuditoria({ competencia = '', onProgress } = {}) {
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
    const porCompetencia = await consultarFontePaginada({
      supabase,
      fonte,
      competencia,
      datas,
      filtro: 'competencia',
      onProgress,
    });

    diagnostico.push(montarResumoFonte({
      fonte,
      filtro: `competencia = ${competencia}`,
      data: porCompetencia.data || [],
      error: porCompetencia.error,
      parcial: porCompetencia.parcial,
      limiteAtingido: porCompetencia.limiteAtingido,
    }));

    if (porCompetencia.error) {
      if (!erroTabelaInexistente(porCompetencia.error)) {
        avisos.push(`${fonte.label}: ${porCompetencia.error.message}`);
      }
    } else if ((porCompetencia.data || []).length > 0) {
      const registros = (porCompetencia.data || [])
        .map((row) => normalizarRegistroAuditoria(row, fonte))
        .filter((row) => !isEbazar(row));

      if (porCompetencia.limiteAtingido) {
        avisos.push(`A leitura atingiu o limite de ${MAX_REGISTROS_POR_COMPETENCIA.toLocaleString('pt-BR')} registros. Aumente MAX_REGISTROS_POR_COMPETENCIA se necessário.`);
      }

      return { registros, fonte, diagnostico, avisos };
    }

    const porData = await consultarFontePaginada({
      supabase,
      fonte,
      competencia,
      datas,
      filtro: 'data',
      onProgress,
    });

    diagnostico.push(montarResumoFonte({
      fonte,
      filtro: `${fonte.campoData} entre ${datas.inicio} e ${datas.fim}`,
      data: porData.data || [],
      error: porData.error,
      parcial: porData.parcial,
      limiteAtingido: porData.limiteAtingido,
    }));

    if (porData.error) {
      if (!erroTabelaInexistente(porData.error)) {
        avisos.push(`${fonte.label}: ${porData.error.message}`);
      }
    } else if ((porData.data || []).length > 0) {
      const registros = (porData.data || [])
        .map((row) => normalizarRegistroAuditoria(row, fonte))
        .filter((row) => !isEbazar(row));

      if (porData.limiteAtingido) {
        avisos.push(`A leitura atingiu o limite de ${MAX_REGISTROS_POR_COMPETENCIA.toLocaleString('pt-BR')} registros. Aumente MAX_REGISTROS_POR_COMPETENCIA se necessário.`);
      }

      return { registros, fonte, diagnostico, avisos };
    }
  }

  return { registros: [], fonte: null, diagnostico, avisos };
}

async function buscarRealizadoLocalCompletoPorCompetencia({ supabase, competencia, onProgress }) {
  const resposta = await consultarFontePaginada({
    supabase,
    fonte: FONTES_AUDITORIA[0],
    competencia,
    datas: competenciaParaDatas(competencia),
    filtro: 'competencia',
    onProgress,
  });

  if (resposta.error) {
    throw new Error(`Erro ao buscar CT-es para salvar: ${resposta.error.message}`);
  }

  return (resposta.data || [])
    .map((row) => normalizarRegistroAuditoria(row, FONTES_AUDITORIA[0]))
    .filter((row) => !isEbazar(row));
}

function montarLinhaResultadoAuditoria(row = {}, competencia = '') {
  const valorCte = toNumber(row.valor_cte ?? row.valorCte);
  const valorCalculado = toNumber(row.valor_calculado ?? row.valorCalculado);
  const diferenca = row.diferenca !== undefined && row.diferenca !== null && String(row.diferenca).trim() !== ''
    ? toNumber(row.diferenca)
    : (valorCalculado > 0 ? valorCte - valorCalculado : 0);

  return {
    competencia: String(row.competencia || competencia || '').slice(0, 7),
    data_emissao: pick(row, ['data_emissao', 'emissao', 'dataEmissao']) || null,
    chave_cte: pick(row, ['chave_cte', 'chaveCte', 'chave']) || null,
    numero_cte: pick(row, ['numero_cte', 'numeroCte', 'cte', 'nro_cte']) || null,
    transportadora: pick(row, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']) || null,
    cnpj_transportadora: pick(row, ['cnpj_transportadora', 'cnpjTransportadora']) || null,
    tomador_servico: pick(row, ['tomador_servico', 'tomadorServico', 'tomador']) || null,
    cidade_origem: pick(row, ['cidade_origem', 'cidadeOrigem', 'origem']) || null,
    uf_origem: String(pick(row, ['uf_origem', 'ufOrigem']) || '').toUpperCase() || null,
    ibge_origem: pick(row, ['ibge_origem', 'ibgeOrigem']) || null,
    cidade_destino: pick(row, ['cidade_destino', 'cidadeDestino', 'destino']) || null,
    uf_destino: String(pick(row, ['uf_destino', 'ufDestino']) || '').toUpperCase() || null,
    ibge_destino: pick(row, ['ibge_destino', 'ibgeDestino']) || null,
    canal: pick(row, ['canal', 'canal_original', 'canais']) || null,
    peso: toNumber(pick(row, ['peso', 'peso_final', 'pesoFinal'])),
    peso_declarado: toNumber(pick(row, ['peso_declarado', 'pesoDeclarado', 'peso'])),
    peso_cubado: toNumber(pick(row, ['peso_cubado', 'pesoCubado'])),
    cubagem: toNumber(pick(row, ['cubagem', 'cubagem_total', 'cubagemTotal'])),
    qtd_volumes: toNumber(pick(row, ['qtd_volumes', 'qtdVolumes', 'volumes'])),
    valor_nf: toNumber(pick(row, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota'])),
    valor_cte: valorCte,
    valor_calculado: valorCalculado,
    diferenca,
    diferenca_abs: Math.abs(diferenca),
    percentual_diferenca: valorCalculado > 0 ? (diferenca / valorCalculado) * 100 : 0,
    status_calculo: valorCalculado > 0 ? 'CALCULADO' : 'SEM_CALCULO',
    motivo_sem_calculo: valorCalculado > 0 ? '' : 'CT-e sem valor calculado na base CTS.',
    transportadora_tabela: pick(row, ['transportadora', 'transportadora_tabela', 'transportadora_contratada']) || null,
    tipo_calculo: pick(row, ['tipo_calculo', 'tipoCalculo']) || null,
    detalhes_calculo: {
      fonte: 'realizado_local_ctes',
      situacao: pick(row, ['situacao']),
      status: pick(row, ['status']),
      status_conciliacao: pick(row, ['status_conciliacao', 'statusConciliacao']),
      status_erp: pick(row, ['status_erp', 'statusErp']),
      percentual_frete: toNumber(pick(row, ['percentual_frete', 'percentualFrete'])),
      arquivo_origem: pick(row, ['arquivo_origem', 'arquivoOrigem']),
    },
  };
}

function montarResumoMensalAuditoria(registros = [], competencia = '') {
  const total = registros.length;
  const calculados = registros.filter((row) => toNumber(row.valor_calculado) > 0).length;
  const semCalculo = total - calculados;
  const divergentes = registros.filter((row) => (
    toNumber(row.valor_calculado) > 0 && Math.abs(toNumber(row.diferenca)) > DIVERGENCIA_THRESHOLD
  )).length;
  const assertivos = calculados - divergentes;
  const valorTotalCte = registros.reduce((acc, row) => acc + toNumber(row.valor_cte), 0);
  const valorTotalCalculado = registros.reduce((acc, row) => acc + toNumber(row.valor_calculado), 0);
  const valorTotalDivergencia = registros.reduce((acc, row) => acc + Math.abs(toNumber(row.diferenca)), 0);
  const valorExcessivo = registros.reduce((acc, row) => acc + Math.max(toNumber(row.diferenca), 0), 0);
  const valorInsuficiente = registros.reduce((acc, row) => acc + Math.abs(Math.min(toNumber(row.diferenca), 0)), 0);

  return {
    competencia,
    total_ctes: total,
    calculados,
    sem_calculo: semCalculo,
    assertivos,
    divergentes,
    valor_total_cte: valorTotalCte,
    valor_total_calculado: valorTotalCalculado,
    valor_total_divergencia: valorTotalDivergencia,
    valor_excessivo: valorExcessivo,
    valor_insuficiente: valorInsuficiente,
    taxa_calculo: total > 0 ? (calculados / total) * 100 : 0,
    taxa_assertividade: calculados > 0 ? (assertivos / calculados) * 100 : 0,
    taxa_divergencia: calculados > 0 ? (divergentes / calculados) * 100 : 0,
    processado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function salvarMesCarregadoAuditoria({ competencia = '', onProgress } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }

  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
    throw new Error('Informe a competência no formato YYYY-MM antes de salvar o mês.');
  }

  const supabase = getSupabaseClient();
  const registrosBase = await buscarRealizadoLocalCompletoPorCompetencia({ supabase, competencia, onProgress });

  if (!registrosBase.length) {
    throw new Error(`Nenhum CT-e encontrado na base CTS para a competência ${competencia}.`);
  }

  const linhasResultado = registrosBase.map((row) => montarLinhaResultadoAuditoria(row, competencia));
  const resumo = montarResumoMensalAuditoria(linhasResultado, competencia);

  onProgress?.({ etapa: 'limpando_resultado_anterior', carregados: 0, total: linhasResultado.length });

  const { error: deleteError } = await supabase