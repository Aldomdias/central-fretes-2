/**
 * auditoriaService.js
 *
 * Serviço da tela Auditoria de CTes.
 *
 * Objetivo:
 * - Priorizar a base do módulo CT-e: realizado_local_ctes.
 * - Carregar o mês inteiro usando paginação, sem travar em 1.000 linhas.
 * - Buscar primeiro por competência para evitar timeout por data.
 * - Salvar o mês carregado em auditoria_cte_resultados e auditoria_cte_resumo_mensal.
 */

import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';
import { filtrarCpComercialCte } from './cteBasePolicy';

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

  // Cálculo original da Verum. Em resultados salvos vem em valor_calculado_verum;
  // na base crua (realizado_local_ctes) o próprio valor_calculado já é o da Verum.
  const verumInformado = pick(row, ['valor_calculado_verum', 'valorCalculadoVerum']);
  const valorCalculadoVerum = verumInformado !== '' ? toNumber(verumInformado) : valorCalculado;

  const diferencaInformada = pick(row, ['diferenca', 'diferença', 'diferenca_calculada', 'diferencaCalculada']);
  const diferenca = diferencaInformada !== ''
    ? toNumber(diferencaInformada)
    : (valorCalculado > 0 ? valorCte - valorCalculado : 0);
  const diferencaVerum = valorCalculadoVerum > 0 ? valorCte - valorCalculadoVerum : 0;

  const dataEmissao = pick(row, ['data_emissao', 'emissao', 'dataEmissao']);

  return {
    ...row,
    transportadora: String(pick(row, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']) || 'Não informado').trim() || 'Não informado',
    valor_cte: valorCte,
    valor_calculado: valorCalculado,
    valor_calculado_verum: valorCalculadoVerum,
    diferenca_verum: diferencaVerum,
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

function aplicarFiltrosBaseAuditoria(rows = []) {
  return filtrarCpComercialCte((rows || []).filter((row) => !isEbazar(row)));
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
  const registrosValidos = aplicarFiltrosBaseAuditoria(registros);
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

function normalizarCanalAuditoria(valor) {
  const v = String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  if (!v) return 'A DEFINIR';
  if (v.includes('A DEFINIR') || v.includes('SEM TABELA') || v.includes('SEM VINCULO')) return 'A DEFINIR';
  if (v.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (v.includes('REVERSA')) return 'REVERSA';
  if (v.includes('ATACADO') || v === 'B2B' || v.endsWith(' B2B') || v.startsWith('B2B ')) return 'ATACADO';
  if (v.includes('B2C') || v.includes('MARKETPLACE') || v.includes('ECOMMERCE')) return 'B2C';
  return v;
}

export async function carregarDadosAuditoria({ competencia = '', dataInicio = '', dataFim = '', canais, onProgress } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }

  // Carga por competência OU por período (datas). Quando há período, consulta
  // direto por data_emissao e ignora a competência (pode até cruzar meses).
  const temPeriodo = Boolean(dataInicio || dataFim);
  const datas = temPeriodo
    ? { inicio: dataInicio || '0001-01-01', fim: dataFim || '9999-12-31' }
    : competenciaParaDatas(competencia);

  if (!datas) {
    throw new Error('Informe a competência (mês) ou um período (datas) para carregar.');
  }

  const supabase = getSupabaseClient();
  const diagnostico = [];
  const avisos = [];

  for (const fonte of FONTES_AUDITORIA) {
    // No modo período, pula a consulta por competência e vai direto pela data.
    if (!temPeriodo) {
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
        let registros = (porCompetencia.data || [])
          .map((row) => normalizarRegistroAuditoria(row, fonte));
        registros = aplicarFiltrosBaseAuditoria(registros);
        if (canais?.length) {
          const cSet = new Set(canais);
          registros = registros.filter((r) => cSet.has(normalizarCanalAuditoria(r.canal || r.canal_original)));
        }

        if (porCompetencia.limiteAtingido) {
          avisos.push(`A leitura atingiu o limite de ${MAX_REGISTROS_POR_COMPETENCIA.toLocaleString('pt-BR')} registros. Aumente MAX_REGISTROS_POR_COMPETENCIA se necessário.`);
        }

        return { registros, fonte, diagnostico, avisos };
      }
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
      let registros = (porData.data || [])
        .map((row) => normalizarRegistroAuditoria(row, fonte));
      registros = aplicarFiltrosBaseAuditoria(registros);
      if (canais?.length) {
        const cSet = new Set(canais);
        registros = registros.filter((r) => cSet.has(normalizarCanalAuditoria(r.canal || r.canal_original)));
      }

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

  return aplicarFiltrosBaseAuditoria(
    (resposta.data || []).map((row) => normalizarRegistroAuditoria(row, FONTES_AUDITORIA[0])),
  );
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
    .from('auditoria_cte_resultados')
    .delete()
    .eq('competencia', competencia);

  if (deleteError) {
    throw new Error(`Erro ao limpar resultado anterior da auditoria: ${deleteError.message}`);
  }

  for (let index = 0; index < linhasResultado.length; index += INSERT_CHUNK_SIZE) {
    const chunk = linhasResultado.slice(index, index + INSERT_CHUNK_SIZE);
    const { error } = await supabase
      .from('auditoria_cte_resultados')
      .insert(chunk);

    if (error) {
      throw new Error(`Erro ao salvar resultado detalhado da auditoria: ${error.message}`);
    }

    onProgress?.({
      etapa: 'salvando_resultado_detalhado',
      carregados: Math.min(index + INSERT_CHUNK_SIZE, linhasResultado.length),
      total: linhasResultado.length,
    });
  }

  const { error: resumoError } = await supabase
    .from('auditoria_cte_resumo_mensal')
    .upsert(resumo, { onConflict: 'competencia' });

  if (resumoError) {
    throw new Error(`Erro ao salvar resumo mensal da auditoria: ${resumoError.message}`);
  }

  onProgress?.({ etapa: 'concluido', carregados: linhasResultado.length, total: linhasResultado.length });

  return {
    registros: linhasResultado,
    resumo,
    fonte: {
      id: 'auditoria_cte_resultados',
      tabela: 'auditoria_cte_resultados',
      label: 'Auditoria salva / auditoria_cte_resultados',
    },
  };
}

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
    const valCte = toNumber(r.valor_cte ?? r.valorCte);
    const temCalculo = valCalc > 0;
    const temDiv = temCalculo && Math.abs(dif) > DIVERGENCIA_THRESHOLD;

    valorTotalCte += valCte;

    if (temCalculo) {
      totalCalculados += 1;
      if (temDiv) {
        totalDivergentes += 1;
        valorTotalDivergencia += Math.abs(dif);
        if (dif > 0) valorExcessivo += dif;
        else valorInsuficiente += Math.abs(dif);
      } else {
        totalAssertivos += 1;
      }
    } else {
      totalSemCalculo += 1;
    }
  }

  return {
    total,
    totalCalculados,
    totalSemCalculo,
    totalDivergentes,
    totalAssertivos,
    taxaCalculo: total > 0 ? (totalCalculados / total) * 100 : 0,
    taxaAssertividade: totalCalculados > 0 ? (totalAssertivos / totalCalculados) * 100 : 0,
    taxaDivergencia: totalCalculados > 0 ? (totalDivergentes / totalCalculados) * 100 : 0,
    valorTotalCte,
    valorTotalDivergencia,
    valorExcessivo,
    valorInsuficiente,
  };
}

export function agruparPorTransportadora(registros = []) {
  const mapa = new Map();

  for (const r of registros) {
    const nome = String(r.transportadora || 'Não informado').trim() || 'Não informado';
    if (!mapa.has(nome)) {
      mapa.set(nome, {
        transportadora: nome,
        total: 0,
        calculados: 0,
        semCalculo: 0,
        divergentes: 0,
        assertivos: 0,
        valorCte: 0,
        valorDivergencia: 0,
        valorExcessivo: 0,
        valorInsuficiente: 0,
      });
    }

    const it = mapa.get(nome);
    const valCalc = toNumber(r.valor_calculado ?? r.valorCalculado);
    const dif = toNumber(r.diferenca);
    const temCalculo = valCalc > 0;
    const temDiv = temCalculo && Math.abs(dif) > DIVERGENCIA_THRESHOLD;

    it.total += 1;
    it.valorCte += toNumber(r.valor_cte ?? r.valorCte);

    if (temCalculo) {
      it.calculados += 1;
      if (temDiv) {
        it.divergentes += 1;
        it.valorDivergencia += Math.abs(dif);
        if (dif > 0) it.valorExcessivo += dif;
        else it.valorInsuficiente += Math.abs(dif);
      } else {
        it.assertivos += 1;
      }
    } else {
      it.semCalculo += 1;
    }
  }

  return Array.from(mapa.values())
    .map((it) => ({
      ...it,
      taxaCalculo: it.total > 0 ? (it.calculados / it.total) * 100 : 0,
      taxaAssertividade: it.calculados > 0 ? (it.assertivos / it.calculados) * 100 : 0,
    }))
    .sort((a, b) => b.valorDivergencia - a.valorDivergencia || b.semCalculo - a.semCalculo || b.total - a.total);
}

export function calcularOndeAtacar(porTransportadora = [], meta = {}) {
  const metaAssert = Number(meta.taxaAssertividadeMeta || 98);

  return porTransportadora
    .filter((it) => it.divergentes > 0 || it.semCalculo > 0)
    .map((it) => {
      const valorMedioCte = it.total > 0 ? it.valorCte / it.total : 0;
      const prioridade = it.valorDivergencia * 2 + it.semCalculo * valorMedioCte;
      let acaoSugerida;
      let severidade;

      if (it.semCalculo > 0 && it.calculados === 0) {
        acaoSugerida = 'Cadastrar tabela — sem cobertura';
        severidade = 'critico';
      } else if (it.semCalculo > it.calculados) {
        acaoSugerida = 'Ampliar cobertura — muitos CTes sem cálculo';
        severidade = 'alto';
      } else if (it.taxaAssertividade < metaAssert * 0.8) {
        acaoSugerida = 'Revisar tabela — alta divergência';
        severidade = 'alto';
      } else if (it.divergentes > 0) {
        acaoSugerida = 'Monitorar — divergências pontuais';
        severidade = 'medio';
      } else {
        acaoSugerida = 'Verificar cobertura de cálculo';
        severidade = 'baixo';
      }

      return { ...it, prioridade, acaoSugerida, severidade };
    })
    .sort((a, b) => b.prioridade - a.prioridade)
    .slice(0, 15);
}

export function sugerirNovaMeta(metricas = {}) {
  const total = Number(metricas.total || 0);
  const calculados = Number(metricas.totalCalculados || 0);
  const taxaCalcAtual = Number(metricas.taxaCalculo || 0);
  const taxaAssertAtual = Number(metricas.taxaAssertividade || 0);

  if (total <= 0) {
    return {
      taxaCalculoMeta: 95,
      taxaAssertividadeMeta: 98,
      descricao: 'Meta recomendada: 95% dos CTes com cálculo e 98% de assertividade nos CTes calculados.',
    };
  }

  let metaCalcSugerida;
  if (taxaCalcAtual < 60) metaCalcSugerida = Math.min(80, Math.round(taxaCalcAtual + 20));
  else if (taxaCalcAtual < 90) metaCalcSugerida = Math.min(95, Math.round(taxaCalcAtual + 10));
  else metaCalcSugerida = Math.min(99, Math.round(taxaCalcAtual + 3));

  let metaAssertSugerida;
  if (calculados <= 0) metaAssertSugerida = 95;
  else if (taxaAssertAtual < 85) metaAssertSugerida = Math.min(95, Math.round(taxaAssertAtual + 10));
  else if (taxaAssertAtual < 96) metaAssertSugerida = Math.min(98, Math.round(taxaAssertAtual + 3));
  else metaAssertSugerida = 98;

  metaCalcSugerida = Math.max(0, Math.min(99, metaCalcSugerida));
  metaAssertSugerida = Math.max(0, Math.min(99, metaAssertSugerida));

  return {
    taxaCalculoMeta: metaCalcSugerida,
    taxaAssertividadeMeta: metaAssertSugerida,
    descricao: `Meta ajustada: ${metaCalcSugerida}% dos CTes com cálculo e ${metaAssertSugerida}% de assertividade nos calculados.`,
  };
}

export function avaliarMetaAuditoria(metricas = {}, meta = {}) {
  const metaNorm = normalizarMetaAuditoria(meta);
  const atingiuCalculo = Number(metricas.taxaCalculo || 0) >= metaNorm.taxaCalculoMeta;
  const atingiuAssertividade = Number(metricas.taxaAssertividade || 0) >= metaNorm.taxaAssertividadeMeta;

  if (metricas.total <= 0) {
    return {
      status: 'sem_dados',
      titulo: 'Sem base carregada',
      mensagem: 'Carregue uma competência para avaliar a meta da área.',
    };
  }

  if (metricas.totalCalculados <= 0) {
    return {
      status: 'critico',
      titulo: 'Sem cobertura de cálculo',
      mensagem: 'A prioridade é cadastrar ou corrigir tabelas para começar a calcular os CTes.',
    };
  }

  if (atingiuCalculo && atingiuAssertividade) {
    return {
      status: 'ok',
      titulo: 'Meta atingida',
      mensagem: 'A base carregada está dentro da meta configurada para cobertura e assertividade.',
    };
  }

  if (!atingiuCalculo && atingiuAssertividade) {
    return {
      status: 'cobertura',
      titulo: 'Assertividade boa, cobertura baixa',
      mensagem: 'Os CTes calculados estão aderentes, mas ainda há muita carga sem cálculo.',
    };
  }

  if (atingiuCalculo && !atingiuAssertividade) {
    return {
      status: 'assertividade',
      titulo: 'Cobertura boa, divergência alta',
      mensagem: 'A base está calculando bem em volume, mas as tabelas precisam ser revisadas para reduzir divergências.',
    };
  }

  return {
    status: 'critico',
    titulo: 'Abaixo da meta',
    mensagem: 'A cobertura e a assertividade estão abaixo do alvo. Priorize transportadoras com maior impacto financeiro.',
  };
}

export function exportarAuditoriaExcel(porTransportadora = [], metricas = {}, competencia = '', diagnostico = []) {
  const wb = XLSX.utils.book_new();

  const resumo = [{
    Competência: competencia || 'Todas',
    'Total CTes': metricas.total,
    'Com cálculo': metricas.totalCalculados,
    'Sem cálculo': metricas.totalSemCalculo,
    Assertivos: metricas.totalAssertivos,
    Divergentes: metricas.totalDivergentes,
    'Taxa cálculo %': Number(metricas.taxaCalculo || 0).toFixed(2),
    'Taxa assertividade %': Number(metricas.taxaAssertividade || 0).toFixed(2),
    'Taxa divergência %': Number(metricas.taxaDivergencia || 0).toFixed(2),
    'Valor total CTe': Number(metricas.valorTotalCte || 0).toFixed(2),
    'Valor divergência': Number(metricas.valorTotalDivergencia || 0).toFixed(2),
    'Cobrança excessiva': Number(metricas.valorExcessivo || 0).toFixed(2),
    'Cobrança insuficiente': Number(metricas.valorInsuficiente || 0).toFixed(2),
  }];

  const detalhes = porTransportadora.map((it) => ({
    Transportadora: it.transportadora,
    'Total CTes': it.total,
    'Com cálculo': it.calculados,
    'Sem cálculo': it.semCalculo,
    Assertivos: it.assertivos,
    Divergentes: it.divergentes,
    'Taxa cálculo %': Number(it.taxaCalculo || 0).toFixed(2),
    'Taxa assertividade %': Number(it.taxaAssertividade || 0).toFixed(2),
    'Valor CTe': Number(it.valorCte || 0).toFixed(2),
    'Valor divergência': Number(it.valorDivergencia || 0).toFixed(2),
    'Cobrança excessiva': Number(it.valorExcessivo || 0).toFixed(2),
    'Cobrança insuficiente': Number(it.valorInsuficiente || 0).toFixed(2),
  }));

  const diag = (diagnostico || []).map((item) => ({
    Fonte: item.label || item.fonte,
    Tabela: item.tabela,
    Filtro: item.filtro,
    'Total bruto': item.totalBruto,
    'Total útil': item.total,
    Calculados: item.calculados,
    'Sem cálculo': item.semCalculo,
    Divergentes: item.divergentes,
    'Taxa cálculo %': Number(item.taxaCalculo || 0).toFixed(2),
    Erro: item.erro || '',
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhes), 'Por Transportadora');
  if (diag.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(diag), 'Diagnóstico');

  XLSX.writeFile(wb, `auditoria-ctes-${competencia || 'geral'}.xlsx`);
}

// Export CT-e a CT-e: uma linha por CT-e com Frete Pago, Cálculo Verum, Cálculo AMD
// (nosso motor) e as duas diferenças, mais colunas de detalhe do cálculo.
export function exportarCtesDetalhadoExcel(registros = [], competencia = '') {
  const parseDetalhe = (d) => {
    if (!d) return {};
    if (typeof d === 'object') return d;
    try { return JSON.parse(d); } catch { return {}; }
  };

  const linhas = (registros || []).map((r) => {
    const det = parseDetalhe(r.detalhes_calculo);
    const fretePago = toNumber(r.valor_cte);
    const verum = toNumber(r.valor_calculado_verum);
    const amd = toNumber(r.valor_calculado);
    const difVerum = r.diferenca_verum !== undefined && r.diferenca_verum !== null
      ? toNumber(r.diferenca_verum) : (verum > 0 ? fretePago - verum : 0);
    const difAmd = r.diferenca !== undefined && r.diferenca !== null
      ? toNumber(r.diferenca) : (amd > 0 ? fretePago - amd : 0);
    return {
      'Nº CT-e': r.numero_cte || '',
      'Chave CT-e': r.chave_cte || '',
      'Data emissão': r.data_emissao || '',
      Transportadora: r.transportadora || '',
      'Cidade origem': r.cidade_origem || '',
      'UF origem': r.uf_origem || '',
      'Cidade destino': r.cidade_destino || '',
      'UF destino': r.uf_destino || '',
      Peso: Number(toNumber(r.peso)).toFixed(2),
      'Valor NF': Number(toNumber(r.valor_nf)).toFixed(2),
      'Frete Pago': fretePago.toFixed(2),
      'Cálculo Verum': verum.toFixed(2),
      'Dif. Verum': difVerum.toFixed(2),
      'Cálculo AMD': amd.toFixed(2),
      'Dif. AMD': difAmd.toFixed(2),
      'Dif. AMD %': amd > 0 ? ((difAmd / amd) * 100).toFixed(2) : '',
      Status: r.status_calculo || '',
      Motivo: r.motivo_sem_calculo || '',
      'Tipo cálculo': r.tipo_calculo || det.tipo_calculo || '',
      'Origem tabela': det.origem_cidade || '',
      'Rota tabela': det.rota_nome || '',
      'Valor base': det.valor_base !== undefined ? Number(toNumber(det.valor_base)).toFixed(2) : '',
      Subtotal: det.subtotal !== undefined ? Number(toNumber(det.subtotal)).toFixed(2) : '',
      ICMS: det.icms !== undefined ? Number(toNumber(det.icms)).toFixed(2) : '',
      Taxas: det.taxas !== undefined ? Number(toNumber(det.taxas)).toFixed(2) : '',
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'CT-es');
  XLSX.writeFile(wb, `auditoria-ctes-detalhe-${competencia || 'geral'}.xlsx`);
}
