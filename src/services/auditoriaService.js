import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';

export const DIVERGENCIA_THRESHOLD = 0.05;
export const META_STORAGE_KEY = 'central_fretes_auditoria_meta_v1';
export const TOGGLE_TABELAS_KEY = 'central_fretes_auditoria_tabelas_v1';

const PAGE_SIZE = 1000;
const MAX_REGISTROS_MES = 300000;

const FONTES_AUDITORIA = [
  {
    id: 'realizado_local_ctes',
    tabela: 'realizado_local_ctes',
    label: 'CT-e / realizado_local_ctes',
    campoData: 'data_emissao',
  },
  {
    id: 'realizado_ctes',
    tabela: 'realizado_ctes',
    label: 'Realizado legado / realizado_ctes',
    campoData: 'emissao',
  },
  {
    id: 'realizado_ctes_enxuta',
    tabela: 'realizado_ctes_enxuta',
    label: 'Base enxuta mensal / realizado_ctes_enxuta',
    campoData: 'data_emissao',
  },
];

const COLUNAS_VALOR_CTE = [
  'valor_cte',
  'valorCte',
  'valor_frete',
  'valorFrete',
  'frete_realizado',
  'freteRealizado',
  'frete',
  'total_cte',
  'totalCte',
  'valor_total_cte',
  'valorTotalCte',
];

const COLUNAS_VALOR_CALCULADO = [
  'valor_calculado',
  'valorCalculado',
  'frete_calculado',
  'freteCalculado',
  'valor_tabela',
  'valorTabela',
  'frete_tabela',
  'freteTabela',
  'valor_simulado',
  'valorSimulado',
  'frete_simulado',
  'freteSimulado',
  'valor_auditado',
  'valorAuditado',
  'valor_auditoria',
  'valorAuditoria',
  'custo_calculado',
  'custoCalculado',
  'custo_tabela',
  'custoTabela',
  'total_calculado',
  'totalCalculado',
  'total_geral_calculado',
  'totalGeralCalculado',
  'frete_previsto',
  'fretePrevisto',
  'valor_previsto',
  'valorPrevisto',
  'menor_preco',
  'menorPreco',
  'valor_menor_preco',
  'valorMenorPreco',
];

const COLUNAS_DIFERENCA = [
  'diferenca',
  'diferenca_calculada',
  'diferencaCalculada',
  'divergencia',
  'valor_divergencia',
  'valorDivergencia',
];

export function getColunasValorCalculadoAuditadas() {
  return [...COLUNAS_VALOR_CALCULADO];
}

export function carregarMetaAuditoria() {
  try {
    const parsed = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || 'null');
    if (parsed && typeof parsed === 'object') return normalizarMetaAuditoria(parsed);
  } catch (error) {
    console.warn('Não foi possível carregar a meta de auditoria:', error);
  }

  return normalizarMetaAuditoria({
    taxaCalculoMeta: 95,
    taxaAssertividadeMeta: 98,
    descricao: 'Meta recomendada: 95% dos CTes com cálculo e 98% de assertividade nos CTes calculados.',
  });
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

function pickInfo(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return { key, value };
    }
  }
  return { key: '', value: '' };
}

function pick(row = {}, keys = []) {
  return pickInfo(row, keys).value;
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
  const valorCteInfo = pickInfo(row, COLUNAS_VALOR_CTE);
  const valorCalculadoInfo = pickInfo(row, COLUNAS_VALOR_CALCULADO);
  const diferencaInfo = pickInfo(row, COLUNAS_DIFERENCA);

  const valorCte = toNumber(valorCteInfo.value);
  const valorCalculado = toNumber(valorCalculadoInfo.value);
  const diferenca = diferencaInfo.value !== ''
    ? toNumber(diferencaInfo.value)
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
    __coluna_valor_cte: valorCteInfo.key,
    __coluna_valor_calculado: valorCalculadoInfo.key,
    __coluna_diferenca: diferencaInfo.key,
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

function mapearColunas(data = []) {
  const primeira = data.find((row) => row && typeof row === 'object') || {};
  const colunas = Object.keys(primeira);
  return {
    colunasDisponiveis: colunas,
    colunasValorCteEncontradas: colunas.filter((col) => COLUNAS_VALOR_CTE.includes(col)),
    colunasValorCalculadoEncontradas: colunas.filter((col) => COLUNAS_VALOR_CALCULADO.includes(col)),
    colunasDiferencaEncontradas: colunas.filter((col) => COLUNAS_DIFERENCA.includes(col)),
  };
}

function montarResumoFonte({ fonte, filtro, data = [], error = null, parcial = false, limiteAtingido = false }) {
  const registros = (data || []).map((row) => normalizarRegistroAuditoria(row, fonte));
  const registrosValidos = registros.filter((row) => !isEbazar(row));
  const metricas = calcularMetricasAuditoria(registrosValidos);
  const mapaColunas = mapearColunas(data);

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
    ...mapaColunas,
  };
}

async function consultarFontePaginada({ supabase, fonte, filtro, competencia, datas, onProgress }) {
  let acumulado = [];
  let offset = 0;

  while (offset < MAX_REGISTROS_MES) {
    const to = Math.min(offset + PAGE_SIZE - 1, MAX_REGISTROS_MES - 1);
    let query = supabase.from(fonte.tabela).select('*').range(offset, to);

    if (filtro === 'data') {
      query = query.gte(fonte.campoData, datas.inicio).lte(fonte.campoData, datas.fim);
    } else if (filtro === 'competencia') {
      query = query.eq('competencia', competencia);
    }

    const { data, error } = await query;

    if (error) {
      return {
        data: acumulado,
        error,
        parcial: acumulado.length > 0,
        limiteAtingido: false,
      };
    }

    const lote = data || [];
    acumulado = acumulado.concat(lote);
    onProgress?.({ fonte, filtro, carregados: acumulado.length, limite: MAX_REGISTROS_MES });

    if (lote.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return {
    data: acumulado,
    error: null,
    parcial: false,
    limiteAtingido: acumulado.length >= MAX_REGISTROS_MES,
  };
}

function normalizarResultadoConsulta({ data = [], fonte }) {
  return (data || [])
    .map((row) => normalizarRegistroAuditoria(row, fonte))
    .filter((row) => !isEbazar(row));
}

function criarAvisoColunaCalculo(registros = [], diagnostico = []) {
  if (!registros.length) return '';
  const colunasUsadas = new Set(registros.map((row) => row.__coluna_valor_calculado).filter(Boolean));
  if (colunasUsadas.size > 0) {
    return `Coluna(s) usada(s) como valor calculado: ${Array.from(colunasUsadas).join(', ')}.`;
  }

  const ultimoDiag = [...diagnostico].reverse().find((item) => item.totalBruto > 0);
  const colunas = ultimoDiag?.colunasDisponiveis || [];
  const amostraColunas = colunas.slice(0, 40).join(', ');

  return `Nenhuma coluna de valor calculado foi encontrada na base carregada. A auditoria procurou por: ${COLUNAS_VALOR_CALCULADO.join(', ')}. Colunas encontradas na amostra: ${amostraColunas || 'sem amostra'}. Se o cálculo vem do simulador, será necessário resimular e gravar o valor calculado ou integrar a auditoria com o motor de cálculo.`;
}

export async function carregarDadosAuditoria({ competencia = '', onProgress = null } = {}) {
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
    const consultaPorData = await consultarFontePaginada({
      supabase,
      fonte,
      filtro: 'data',
      competencia,
      datas,
      onProgress,
    });

    diagnostico.push(montarResumoFonte({
      fonte,
      filtro: `${fonte.campoData} entre ${datas.inicio} e ${datas.fim}`,
      data: consultaPorData.data || [],
      error: consultaPorData.error,
      parcial: consultaPorData.parcial,
      limiteAtingido: consultaPorData.limiteAtingido,
    }));

    if (consultaPorData.error) {
      if (!erroTabelaInexistente(consultaPorData.error)) {
        avisos.push(`${fonte.label}: ${consultaPorData.error.message}`);
      }
    } else if ((consultaPorData.data || []).length > 0) {
      const registros = normalizarResultadoConsulta({ data: consultaPorData.data, fonte });
      const avisoColuna = criarAvisoColunaCalculo(registros, diagnostico);
      if (avisoColuna) avisos.push(avisoColuna);
      if (consultaPorData.limiteAtingido) avisos.push(`A leitura atingiu o limite de ${MAX_REGISTROS_MES.toLocaleString('pt-BR')} registros no mês. Aumente MAX_REGISTROS_MES se necessário.`);
      return { registros, fonte, diagnostico, avisos };
    }

    const consultaPorCompetencia = await consultarFontePaginada({
      supabase,
      fonte,
      filtro: 'competencia',
      competencia,
      datas,
      onProgress,
    });

    diagnostico.push(montarResumoFonte({
      fonte,
      filtro: `competencia = ${competencia}`,
      data: consultaPorCompetencia.data || [],
      error: consultaPorCompetencia.error,
      parcial: consultaPorCompetencia.parcial,
      limiteAtingido: consultaPorCompetencia.limiteAtingido,
    }));

    if (consultaPorCompetencia.error) {
      if (!erroTabelaInexistente(consultaPorCompetencia.error)) {
        avisos.push(`${fonte.label}: ${consultaPorCompetencia.error.message}`);
      }
    } else if ((consultaPorCompetencia.data || []).length > 0) {
      const registros = normalizarResultadoConsulta({ data: consultaPorCompetencia.data, fonte });
      const avisoColuna = criarAvisoColunaCalculo(registros, diagnostico);
      if (avisoColuna) avisos.push(avisoColuna);
      if (consultaPorCompetencia.limiteAtingido) avisos.push(`A leitura atingiu o limite de ${MAX_REGISTROS_MES.toLocaleString('pt-BR')} registros no mês. Aumente MAX_REGISTROS_MES se necessário.`);
      return { registros, fonte, diagnostico, avisos };
    }
  }

  return { registros: [], fonte: null, diagnostico, avisos };
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
      mensagem: 'A base carregou, mas não encontrou coluna de valor calculado. Verifique se o valor calculado foi gravado na base ou se precisa resimular com as tabelas cadastradas.',
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
    'Parcial': item.parcial ? 'Sim' : 'Não',
    'Limite atingido': item.limiteAtingido ? 'Sim' : 'Não',
    'Colunas valor CT-e': (item.colunasValorCteEncontradas || []).join(', '),
    'Colunas valor calculado': (item.colunasValorCalculadoEncontradas || []).join(', '),
    'Colunas diferença': (item.colunasDiferencaEncontradas || []).join(', '),
    Erro: item.erro || '',
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhes), 'Por Transportadora');
  if (diag.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(diag), 'Diagnóstico');

  XLSX.writeFile(wb, `auditoria-ctes-${competencia || 'geral'}.xlsx`);
}
