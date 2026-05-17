/**
 * auditoriaService.js
 *
 * Lê dados de auditoria da tabela realizado_local_ctes (mesma do CT-e).
 * Campo de data: data_emissao (não emissao).
 * Filtros: eBazar excluído por nome da transportadora (client-side).
 * Tomador (CPX, ITR, GP Pneus): aplicado na importação — coluna pode não existir.
 */

import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';

const TABELA = 'realizado_local_ctes';
export const DIVERGENCIA_THRESHOLD = 0.05;
export const META_STORAGE_KEY   = 'central_fretes_auditoria_meta_v1';
export const TOGGLE_TABELAS_KEY = 'central_fretes_auditoria_tabelas_v1';

// ─── Meta ─────────────────────────────────────────────────────────────────────

export function carregarMetaAuditoria() {
  try {
    const parsed = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || 'null');
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return {
    taxaCalculoMeta: 95,
    taxaAssertividadeMeta: 98,
    descricao: 'Proposta: 95% dos CTes calculados com 98% de acurácia',
  };
}

export function salvarMetaAuditoria(meta = {}) {
  localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function isEbazar(row) {
  const nome = row.transportadora || row.transportadora_realizada || '';
  return normNome(nome).includes('EBAZAR');
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

  const { data, error } = await supabase
    .from(TABELA)
    .select('transportadora, valor_cte, valor_calculado, diferenca, data_emissao, competencia')
    .gte('data_emissao', datas.inicio)
    .lte('data_emissao', datas.fim)
    .limit(100000);

  if (error) {
    throw new Error(`Erro ao consultar ${TABELA}: ${error.message}`);
  }

  return (data || []).filter((r) => !isEbazar(r));
}

// ─── Métricas ─────────────────────────────────────────────────────────────────

export function calcularMetricasAuditoria(registros = []) {
  let total = 0, totalCalculados = 0, totalSemCalculo = 0;
  let totalDivergentes = 0, totalAssertivos = 0;
  let valorTotalCte = 0, valorTotalDivergencia = 0;
  let valorExcessivo = 0, valorInsuficiente = 0;

  for (const r of registros) {
    total++;
    const valCalc = Number(r.valor_calculado ?? r.valorCalculado ?? 0);
    const dif     = Number(r.diferenca ?? 0);
    const valCte  = Number(r.valor_cte  ?? r.valorCte  ?? 0);
    const temCalculo = valCalc > 0;
    const temDiv     = temCalculo && Math.abs(dif) > DIVERGENCIA_THRESHOLD;

    valorTotalCte += valCte;

    if (temCalculo) {
      totalCalculados++;
      if (temDiv) {
        totalDivergentes++;
        valorTotalDivergencia += Math.abs(dif);
        if (dif > 0) valorExcessivo    += dif;
        else          valorInsuficiente += Math.abs(dif);
      } else {
        totalAssertivos++;
      }
    } else {
      totalSemCalculo++;
    }
  }

  return {
    total, totalCalculados, totalSemCalculo, totalDivergentes, totalAssertivos,
    taxaCalculo:       total > 0           ? (totalCalculados / total)            * 100 : 0,
    taxaAssertividade: totalCalculados > 0 ? (totalAssertivos / totalCalculados)  * 100 : 0,
    taxaDivergencia:   totalCalculados > 0 ? (totalDivergentes / totalCalculados) * 100 : 0,
    valorTotalCte, valorTotalDivergencia, valorExcessivo, valorInsuficiente,
  };
}

// ─── Agrupamento ──────────────────────────────────────────────────────────────

export function agruparPorTransportadora(registros = []) {
  const mapa = new Map();

  for (const r of registros) {
    const nome = String(r.transportadora || 'Não informado').trim() || 'Não informado';
    if (!mapa.has(nome)) {
      mapa.set(nome, {
        transportadora: nome, total: 0, calculados: 0, semCalculo: 0,
        divergentes: 0, assertivos: 0, valorCte: 0,
        valorDivergencia: 0, valorExcessivo: 0, valorInsuficiente: 0,
      });
    }
    const it      = mapa.get(nome);
    const valCalc = Number(r.valor_calculado ?? 0);
    const dif     = Number(r.diferenca ?? 0);
    const temCalculo = valCalc > 0;
    const temDiv     = temCalculo && Math.abs(dif) > DIVERGENCIA_THRESHOLD;

    it.total++;
    it.valorCte += Number(r.valor_cte ?? 0);

    if (temCalculo) {
      it.calculados++;
      if (temDiv) {
        it.divergentes++;
        it.valorDivergencia += Math.abs(dif);
        if (dif > 0) it.valorExcessivo    += dif;
        else          it.valorInsuficiente += Math.abs(dif);
      } else {
        it.assertivos++;
      }
    } else {
      it.semCalculo++;
    }
  }

  return Array.from(mapa.values())
    .map((it) => ({
      ...it,
      taxaCalculo:       it.total > 0      ? (it.calculados / it.total)       * 100 : 0,
      taxaAssertividade: it.calculados > 0 ? (it.assertivos / it.calculados)  * 100 : 0,
    }))
    .sort((a, b) => b.valorDivergencia - a.valorDivergencia || b.total - a.total);
}

// ─── Onde Atacar ──────────────────────────────────────────────────────────────

export function calcularOndeAtacar(porTransportadora = [], meta = {}) {
  const metaAssert = Number(meta.taxaAssertividadeMeta || 98);

  return porTransportadora
    .filter((it) => it.divergentes > 0 || it.semCalculo > 0)
    .map((it) => {
      const valorMedioCte = it.total > 0 ? it.valorCte / it.total : 0;
      const prioridade    = it.valorDivergencia * 2 + it.semCalculo * valorMedioCte;
      let acaoSugerida, severidade;
      if (it.semCalculo > it.calculados) {
        acaoSugerida = 'Cadastrar tabela — sem cobertura'; severidade = 'critico';
      } else if (it.taxaAssertividade < metaAssert * 0.8) {
        acaoSugerida = 'Revisar tabela — alta divergência'; severidade = 'alto';
      } else if (it.divergentes > 0) {
        acaoSugerida = 'Monitorar — divergências pontuais'; severidade = 'medio';
      } else {
        acaoSugerida = 'Verificar cobertura de cálculo'; severidade = 'baixo';
      }
      return { ...it, prioridade, acaoSugerida, severidade };
    })
    .sort((a, b) => b.prioridade - a.prioridade)
    .slice(0, 15);
}

// ─── Sugestão de meta ─────────────────────────────────────────────────────────

export function sugerirNovaMeta(metricas = {}) {
  const taxaCalcAtual   = metricas.taxaCalculo       || 0;
  const taxaAssertAtual = metricas.taxaAssertividade || 0;
  const metaCalcSugerida    = Math.min(Math.round(taxaCalcAtual + 5), 99);
  const metaAssertSugerida  = taxaAssertAtual >= 95 ? 98 : Math.min(Math.round(taxaAssertAtual + 3), 99);
  return {
    taxaCalculoMeta: metaCalcSugerida,
    taxaAssertividadeMeta: metaAssertSugerida,
    descricao: `Meta ajustada: ${metaCalcSugerida}% calculados com ${metaAssertSugerida}% de acurácia`,
  };
}

// ─── Exportar Excel ───────────────────────────────────────────────────────────

export function exportarAuditoriaExcel(porTransportadora = [], metricas = {}, competencia = '') {
  const wb = XLSX.utils.book_new();

  const resumo = [{
    'Competência': competencia || 'Todas',
    'Total CTes': metricas.total,
    'Com cálculo': metricas.totalCalculados,
    'Sem cálculo': metricas.totalSemCalculo,
    'Assertivos': metricas.totalAssertivos,
    'Divergentes': metricas.totalDivergentes,
    'Taxa cálculo %': Number(metricas.taxaCalculo        || 0).toFixed(2),
    'Taxa assertividade %': Number(metricas.taxaAssertividade || 0).toFixed(2),
    'Taxa divergência %': Number(metricas.taxaDivergencia    || 0).toFixed(2),
    'Valor total CTe': Number(metricas.valorTotalCte          || 0).toFixed(2),
    'Valor divergência': Number(metricas.valorTotalDivergencia || 0).toFixed(2),
    'Cobrança excessiva': Number(metricas.valorExcessivo      || 0).toFixed(2),
    'Cobrança insuficiente': Number(metricas.valorInsuficiente || 0).toFixed(2),
  }];

  const detalhes = porTransportadora.map((it) => ({
    'Transportadora': it.transportadora,
    'Total CTes': it.total,
    'Com cálculo': it.calculados,
    'Sem cálculo': it.semCalculo,
    'Assertivos': it.assertivos,
    'Divergentes': it.divergentes,
    'Taxa cálculo %': Number(it.taxaCalculo        || 0).toFixed(2),
    'Taxa assertividade %': Number(it.taxaAssertividade || 0).toFixed(2),
    'Valor CTe': Number(it.valorCte          || 0).toFixed(2),
    'Valor divergência': Number(it.valorDivergencia   || 0).toFixed(2),
    'Cobrança excessiva': Number(it.valorExcessivo    || 0).toFixed(2),
    'Cobrança insuficiente': Number(it.valorInsuficiente || 0).toFixed(2),
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo),   'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhes), 'Por Transportadora');
  XLSX.writeFile(wb, `auditoria-ctes-${competencia || 'geral'}.xlsx`);
}
