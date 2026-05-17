import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';

export const DIVERGENCIA_THRESHOLD = 0.05;
export const META_STORAGE_KEY = 'central_fretes_auditoria_meta_v1';
export const TOGGLE_TABELAS_KEY = 'central_fretes_auditoria_tabelas_v1';

const LIMITE_CONSULTA = 100000;
const FONTES_AUDITORIA = [
  { id: 'realizado_local_ctes', tabela: 'realizado_local_ctes', label: 'CT-e / realizado_local_ctes', campoData: 'data_emissao' },
  { id: 'realizado_ctes', tabela: 'realizado_ctes', label: 'Realizado legado / realizado_ctes', campoData: 'emissao' },
  { id: 'realizado_ctes_enxuta', tabela: 'realizado_ctes_enxuta', label: 'Base enxuta / realizado_ctes_enxuta', campoData: 'data_emissao' },
];

function limitarPercentual(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.max(0, Math.min(100, numero));
}

export function normalizarMetaAuditoria(meta = {}) {
  const taxaCalculoMeta = limitarPercentual(meta.taxaCalculoMeta ?? 95);
  const taxaAssertividadeMeta = limitarPercentual(meta.taxaAssertividadeMeta ?? 98);
  const descricao = String(meta.descricao || '').trim()
    || `Meta recomendada: ${taxaCalculoMeta}% calculados com ${taxaAssertividadeMeta}% de assertividade.`;
  return { taxaCalculoMeta, taxaAssertividadeMeta, descricao };
}

export function carregarMetaAuditoria() {
  try {
    const meta = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || 'null');
    if (meta && typeof meta === 'object') return normalizarMetaAuditoria(meta);
  } catch (error) {
    console.warn('Nao foi possivel carregar a meta da auditoria:', error);
  }
  return normalizarMetaAuditoria({ taxaCalculoMeta: 95, taxaAssertividadeMeta: 98 });
}

export function salvarMetaAuditoria(meta = {}) {
  localStorage.setItem(META_STORAGE_KEY, JSON.stringify(normalizarMetaAuditoria(meta)));
}

function competenciaParaDatas(competencia = '') {
  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) return null;
  const [ano, mes] = competencia.split('-').map(Number);
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia}`;
  return { inicio, fim };
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function pick(row = {}, keys = []) {
  for (const key of keys) {
    const value = row[key];
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
    'valor_cte', 'valorCte', 'frete_realizado', 'freteRealizado', 'valor_frete', 'frete',
  ]));

  const valorCalculado = toNumber(pick(row, [
    'valor_calculado', 'valorCalculado', 'frete_calculado', 'freteCalculado', 'valor_tabela', 'valorTabela',
  ]));

  const diferencaInformada = pick(row, ['diferenca', 'diferenca_calculada', 'diferencaCalculada']);
  const diferenca = diferencaInformada !== ''
    ? toNumber(diferencaInformada)
    : (valorCalculado > 0 ? valorCte - valorCalculado : 0);

  return {
    ...row,
    transportadora: String(pick(row, ['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador']) || 'Nao informado').trim() || 'Nao informado',
    valor_cte: valorCte,
    valor_calculado: valorCalculado,
    diferenca,
    data_emissao: pick(row, ['data_emissao', 'emissao', 'dataEmissao']),
    competencia: getCompetenciaLinha(row),
    __fonte_id: fonte.id || '',
    __fonte_label: fonte.label || fonte.tabela || '',
  };
}

function isEbazar(row = {}) {
  const nome = row.transportadora || row.transportadora_realizada || '';
  return normalizarTexto(nome).includes('EBAZAR');
}

function erroIgnoravel(error) {
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
    totalBruto: data.length || 0,
    total: registrosValidos.length,
    calculados: metricas.totalCalculados,
    semCalculo: metricas.totalSemCalculo,
    divergentes: metricas.totalDivergentes,
    taxaCalculo: metricas.taxaCalculo,
    erro: error ? error.message : '',
  };
}

async function consultarPorData(supabase, fonte, datas) {
  let query = supabase
    .from(fonte.tabela)
    .select('*')
    .gte(fonte.campoData, datas.inicio)
    .lte(fonte.campoData, datas.fim)
    .limit(LIMITE_CONSULTA);

  query = query.order(fonte.campoData, { ascending: false, nullsFirst: false });
  return query;
}

async function consultarPorCompetencia(supabase, fonte, competencia) {
  return supabase
    .from(fonte.tabela)
    .select('*')
    .eq('competencia', competencia)
    .limit(LIMITE_CONSULTA);
}

export async function carregarDadosAuditoria({ competencia = '' } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase nao configurado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }

  const datas = competenciaParaDatas(competencia);
  if (!datas) throw new Error('Informe a competencia no formato YYYY-MM.');

  const supabase = getSupabaseClient();
  const diagnostico = [];
  const avisos = [];

  for (const fonte of FONTES_AUDITORIA) {
    const porData = await consultarPorData(supabase, fonte, datas);
    diagnostico.push(montarResumoFonte({
      fonte,
      filtro: `${fonte.campoData} entre ${datas.inicio} e ${datas.fim}`,
      data: porData.data || [],
      error: porData.error,
    }));

    if (!porData.error && (porData.data || []).length > 0) {
      const registros = porData.data
        .map((row) => normalizarRegistroAuditoria(row, fonte))
        .filter((row) => !isEbazar(row));
      return { registros, fonte, diagnostico, avisos };
    }
    if (porData.error && !erroIgnoravel(porData.error)) avisos.push(`${fonte.label}: ${porData.error.message}`);

    const porCompetencia = await consultarPorCompetencia(supabase, fonte, competencia);
    diagnostico.push(montarResumoFonte({
      fonte,
      filtro: `competencia = ${competencia}`,
      data: porCompetencia.data || [],
      error: porCompetencia.error,
    }));

    if (!porCompetencia.error && (porCompetencia.data || []).length > 0) {
      const registros = porCompetencia.data
        .map((row) => normalizarRegistroAuditoria(row, fonte))
        .filter((row) => !isEbazar(row));
      return { registros, fonte, diagnostico, avisos };
    }
    if (porCompetencia.error && !erroIgnoravel(porCompetencia.error)) avisos.push(`${fonte.label}: ${porCompetencia.error.message}`);
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
    const valorCalculado = toNumber(r.valor_calculado ?? r.valorCalculado);
    const diferenca = toNumber(r.diferenca);
    const valorCte = toNumber(r.valor_cte ?? r.valorCte);
    const temCalculo = valorCalculado > 0;
    const temDivergencia = temCalculo && Math.abs(diferenca) > DIVERGENCIA_THRESHOLD;

    valorTotalCte += valorCte;

    if (temCalculo) {
      totalCalculados += 1;
      if (temDivergencia) {
        totalDivergentes += 1;
        valorTotalDivergencia += Math.abs(diferenca);
        if (diferenca > 0) valorExcessivo += diferenca;
        else valorInsuficiente += Math.abs(diferenca);
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
    const nome = String(r.transportadora || 'Nao informado').trim() || 'Nao informado';
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

    const item = mapa.get(nome);
    const valorCalculado = toNumber(r.valor_calculado ?? r.valorCalculado);
    const diferenca = toNumber(r.diferenca);
    const temCalculo = valorCalculado > 0;
    const temDivergencia = temCalculo && Math.abs(diferenca) > DIVERGENCIA_THRESHOLD;

    item.total += 1;
    item.valorCte += toNumber(r.valor_cte ?? r.valorCte);

    if (temCalculo) {
      item.calculados += 1;
      if (temDivergencia) {
        item.divergentes += 1;
        item.valorDivergencia += Math.abs(diferenca);
        if (diferenca > 0) item.valorExcessivo += diferenca;
        else item.valorInsuficiente += Math.abs(diferenca);
      } else {
        item.assertivos += 1;
      }
    } else {
      item.semCalculo += 1;
    }
  }

  return Array.from(mapa.values())
    .map((item) => ({
      ...item,
      taxaCalculo: item.total > 0 ? (item.calculados / item.total) * 100 : 0,
      taxaAssertividade: item.calculados > 0 ? (item.assertivos / item.calculados) * 100 : 0,
    }))
    .sort((a, b) => b.valorDivergencia - a.valorDivergencia || b.semCalculo - a.semCalculo || b.total - a.total);
}

export function calcularOndeAtacar(porTransportadora = [], meta = {}) {
  const metaNormalizada = normalizarMetaAuditoria(meta);

  return porTransportadora
    .filter((item) => item.divergentes > 0 || item.semCalculo > 0)
    .map((item) => {
      const valorMedioCte = item.total > 0 ? item.valorCte / item.total : 0;
      const prioridade = item.valorDivergencia * 2 + item.semCalculo * valorMedioCte;
      let acaoSugerida = 'Monitorar divergencias pontuais';
      let severidade = 'medio';

      if (item.semCalculo > 0 && item.calculados === 0) {
        acaoSugerida = 'Cadastrar tabela - sem cobertura';
        severidade = 'critico';
      } else if (item.semCalculo > item.calculados) {
        acaoSugerida = 'Ampliar cobertura - muitos CTes sem calculo';
        severidade = 'alto';
      } else if (item.taxaAssertividade < metaNormalizada.taxaAssertividadeMeta * 0.8) {
        acaoSugerida = 'Revisar tabela - alta divergencia';
        severidade = 'alto';
      }

      return { ...item, prioridade, acaoSugerida, severidade };
    })
    .sort((a, b) => b.prioridade - a.prioridade)
    .slice(0, 15);
}

export function sugerirNovaMeta(metricas = {}) {
  const total = Number(metricas.total || 0);
  const calculados = Number(metricas.totalCalculados || 0);
  const taxaCalculoAtual = Number(metricas.taxaCalculo || 0);
  const taxaAssertividadeAtual = Number(metricas.taxaAssertividade || 0);

  if (total <= 0) return normalizarMetaAuditoria({ taxaCalculoMeta: 95, taxaAssertividadeMeta: 98 });

  let taxaCalculoMeta = 95;
  if (taxaCalculoAtual < 60) taxaCalculoMeta = Math.min(80, Math.round(taxaCalculoAtual + 20));
  else if (taxaCalculoAtual < 90) taxaCalculoMeta = Math.min(95, Math.round(taxaCalculoAtual + 10));
  else taxaCalculoMeta = Math.min(99, Math.round(taxaCalculoAtual + 3));

  let taxaAssertividadeMeta = 95;
  if (calculados <= 0) taxaAssertividadeMeta = 95;
  else if (taxaAssertividadeAtual < 85) taxaAssertividadeMeta = Math.min(95, Math.round(taxaAssertividadeAtual + 10));
  else if (taxaAssertividadeAtual < 96) taxaAssertividadeMeta = Math.min(98, Math.round(taxaAssertividadeAtual + 3));
  else taxaAssertividadeMeta = 98;

  return normalizarMetaAuditoria({
    taxaCalculoMeta,
    taxaAssertividadeMeta,
    descricao: `Meta ajustada: ${taxaCalculoMeta}% dos CTes com calculo e ${taxaAssertividadeMeta}% de assertividade nos calculados.`,
  });
}

export function avaliarMetaAuditoria(metricas = {}, meta = {}) {
  const metaNormalizada = normalizarMetaAuditoria(meta);
  const total = Number(metricas.total || 0);
  const totalCalculados = Number(metricas.totalCalculados || 0);
  const atingiuCalculo = Number(metricas.taxaCalculo || 0) >= metaNormalizada.taxaCalculoMeta;
  const atingiuAssertividade = Number(metricas.taxaAssertividade || 0) >= metaNormalizada.taxaAssertividadeMeta;

  if (total <= 0) {
    return { status: 'sem_dados', titulo: 'Sem base carregada', mensagem: 'Carregue uma competencia para avaliar a meta da area.' };
  }

  if (totalCalculados <= 0) {
    return { status: 'critico', titulo: 'Sem cobertura de calculo', mensagem: 'A prioridade e cadastrar ou corrigir tabelas para comecar a calcular os CTes.' };
  }

  if (atingiuCalculo && atingiuAssertividade) {
    return { status: 'ok', titulo: 'Meta atingida', mensagem: 'A base carregada esta dentro da meta configurada.' };
  }

  if (!atingiuCalculo && atingiuAssertividade) {
    return { status: 'cobertura', titulo: 'Assertividade boa, cobertura baixa', mensagem: 'Os CTes calculados estao aderentes, mas ainda ha carga sem calculo.' };
  }

  if (atingiuCalculo && !atingiuAssertividade) {
    return { status: 'assertividade', titulo: 'Cobertura boa, divergencia alta', mensagem: 'A base calcula bem em volume, mas as tabelas precisam ser revisadas.' };
  }

  return { status: 'critico', titulo: 'Abaixo da meta', mensagem: 'Cobertura e assertividade estao abaixo do alvo. Priorize as transportadoras com maior impacto.' };
}

export function exportarAuditoriaExcel(porTransportadora = [], metricas = {}, competencia = '', diagnostico = []) {
  const wb = XLSX.utils.book_new();

  const resumo = [{
    Competencia: competencia || 'Todas',
    'Total CTes': metricas.total,
    'Com calculo': metricas.totalCalculados,
    'Sem calculo': metricas.totalSemCalculo,
    Assertivos: metricas.totalAssertivos,
    Divergentes: metricas.totalDivergentes,
    'Taxa calculo %': Number(metricas.taxaCalculo || 0).toFixed(2),
    'Taxa assertividade %': Number(metricas.taxaAssertividade || 0).toFixed(2),
    'Valor total CTe': Number(metricas.valorTotalCte || 0).toFixed(2),
    'Valor divergencia': Number(metricas.valorTotalDivergencia || 0).toFixed(2),
    'Cobranca excessiva': Number(metricas.valorExcessivo || 0).toFixed(2),
    'Cobranca insuficiente': Number(metricas.valorInsuficiente || 0).toFixed(2),
  }];

  const detalhes = porTransportadora.map((item) => ({
    Transportadora: item.transportadora,
    'Total CTes': item.total,
    'Com calculo': item.calculados,
    'Sem calculo': item.semCalculo,
    Assertivos: item.assertivos,
    Divergentes: item.divergentes,
    'Taxa calculo %': Number(item.taxaCalculo || 0).toFixed(2),
    'Taxa assertividade %': Number(item.taxaAssertividade || 0).toFixed(2),
    'Valor CTe': Number(item.valorCte || 0).toFixed(2),
    'Valor divergencia': Number(item.valorDivergencia || 0).toFixed(2),
    'Cobranca excessiva': Number(item.valorExcessivo || 0).toFixed(2),
    'Cobranca insuficiente': Number(item.valorInsuficiente || 0).toFixed(2),
  }));

  const diag = (diagnostico || []).map((item) => ({
    Fonte: item.label || item.fonte,
    Tabela: item.tabela,
    Filtro: item.filtro,
    'Total bruto': item.totalBruto,
    'Total util': item.total,
    Calculados: item.calculados,
    'Sem calculo': item.semCalculo,
    Divergentes: item.divergentes,
    'Taxa calculo %': Number(item.taxaCalculo || 0).toFixed(2),
    Erro: item.erro || '',
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhes), 'Por Transportadora');
  if (diag.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(diag), 'Diagnostico');

  XLSX.writeFile(wb, `auditoria-ctes-${competencia || 'geral'}.xlsx`);
}
