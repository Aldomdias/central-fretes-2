import { exportarRealizadoLocal } from './realizadoLocalDb';
import * as XLSX from 'xlsx';

// Threshold mínimo para considerar divergência (R$ 0,05 = 5 centavos)
export const DIVERGENCIA_THRESHOLD = 0.05;

export const META_STORAGE_KEY = 'central_fretes_auditoria_meta_v1';
export const TOGGLE_TABELAS_KEY = 'central_fretes_auditoria_tabelas_v1';

// ─── Meta ────────────────────────────────────────────────────────────────────

export function carregarMetaAuditoria() {
  try {
    const parsed = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || 'null');
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  // Padrão: meta atual da área (que está sendo revisada)
  return {
    taxaCalculoMeta: 95,
    taxaAssertividadeMeta: 98,
    descricao: 'Proposta: 95% dos CTes calculados com 98% de acurácia',
  };
}

export function salvarMetaAuditoria(meta = {}) {
  localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
}

// ─── Carregamento ─────────────────────────────────────────────────────────────

export async function carregarDadosAuditoria(filtros = {}) {
  const { rows } = await exportarRealizadoLocal(
    { ...filtros, excluirEbazar: true },
    { limit: 500000 }
  );
  return rows;
}

// ─── Cálculo de métricas ──────────────────────────────────────────────────────

export function calcularMetricasAuditoria(registros = []) {
  let total = 0;
  let totalCalculados = 0;
  let totalSemCalculo = 0;
  let totalDivergentes = 0;
  let totalAssertivos = 0;
  let valorTotalCte = 0;
  let valorTotalDivergencia = 0;
  let valorExcessivo = 0;      // CTE cobrado acima do calculado (pagamos mais)
  let valorInsuficiente = 0;   // CTE cobrado abaixo do calculado

  for (const r of registros) {
    total++;
    const valCalc = Number(r.valorCalculado || 0);
    const dif = Number(r.diferenca || 0);
    const temCalculo = valCalc > 0;
    const temDiv = temCalculo && Math.abs(dif) > DIVERGENCIA_THRESHOLD;

    valorTotalCte += Number(r.valorCte || 0);

    if (temCalculo) {
      totalCalculados++;
      if (temDiv) {
        totalDivergentes++;
        valorTotalDivergencia += Math.abs(dif);
        // diferenca = valorCte - valorCalculado
        // dif > 0 → cobrou mais que o calculado (excessivo para o tomador)
        // dif < 0 → cobrou menos que o calculado
        if (dif > 0) valorExcessivo += dif;
        else valorInsuficiente += Math.abs(dif);
      } else {
        totalAssertivos++;
      }
    } else {
      totalSemCalculo++;
    }
  }

  const taxaCalculo = total > 0 ? (totalCalculados / total) * 100 : 0;
  const taxaAssertividade = totalCalculados > 0 ? (totalAssertivos / totalCalculados) * 100 : 0;
  const taxaDivergencia = totalCalculados > 0 ? (totalDivergentes / totalCalculados) * 100 : 0;

  return {
    total,
    totalCalculados,
    totalSemCalculo,
    totalDivergentes,
    totalAssertivos,
    taxaCalculo,
    taxaAssertividade,
    taxaDivergencia,
    valorTotalCte,
    valorTotalDivergencia,
    valorExcessivo,
    valorInsuficiente,
  };
}

// ─── Agrupamento por transportadora ──────────────────────────────────────────

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
    it.total++;
    it.valorCte += Number(r.valorCte || 0);

    const valCalc = Number(r.valorCalculado || 0);
    const dif = Number(r.diferenca || 0);
    const temCalculo = valCalc > 0;
    const temDiv = temCalculo && Math.abs(dif) > DIVERGENCIA_THRESHOLD;

    if (temCalculo) {
      it.calculados++;
      if (temDiv) {
        it.divergentes++;
        it.valorDivergencia += Math.abs(dif);
        if (dif > 0) it.valorExcessivo += dif;
        else it.valorInsuficiente += Math.abs(dif);
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
      taxaCalculo: it.total > 0 ? (it.calculados / it.total) * 100 : 0,
      taxaAssertividade: it.calculados > 0 ? (it.assertivos / it.calculados) * 100 : 0,
    }))
    .sort((a, b) => b.valorDivergencia - a.valorDivergencia || b.total - a.total);
}

// ─── Priorização "Onde Atacar" ────────────────────────────────────────────────

export function calcularOndeAtacar(porTransportadora = [], meta = {}) {
  const metaAssert = Number(meta.taxaAssertividadeMeta || 98);

  return porTransportadora
    .filter((it) => it.divergentes > 0 || it.semCalculo > 0)
    .map((it) => {
      const valorMedioCte = it.total > 0 ? it.valorCte / it.total : 0;
      const pesoSemCalculo = it.semCalculo * valorMedioCte;
      const pesoDivergencia = it.valorDivergencia * 2;
      const prioridade = pesoDivergencia + pesoSemCalculo;

      let acaoSugerida;
      let severidade;

      if (it.semCalculo > it.calculados) {
        acaoSugerida = 'Cadastrar tabela — sem cobertura';
        severidade = 'critico';
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

// ─── Sugestão de nova meta ────────────────────────────────────────────────────

export function sugerirNovaMeta(metricas = {}) {
  // Sugere metas realistas baseadas na performance atual
  const taxaCalcAtual = metricas.taxaCalculo || 0;
  const taxaAssertAtual = metricas.taxaAssertividade || 0;

  // Meta de cálculo: atual + 5pp, limitado a 99%
  const metaCalcSugerida = Math.min(Math.round(taxaCalcAtual + 5), 99);
  // Meta de assertividade: 98% ou atual + 3pp se ainda longe de 98
  const metaAssertSugerida = taxaAssertAtual >= 95 ? 98 : Math.min(Math.round(taxaAssertAtual + 3), 99);

  return {
    taxaCalculoMeta: metaCalcSugerida,
    taxaAssertividadeMeta: metaAssertSugerida,
    descricao: `Meta ajustada: ${metaCalcSugerida}% calculados com ${metaAssertSugerida}% de acurácia`,
  };
}

// ─── Exportar Excel ───────────────────────────────────────────────────────────

export function exportarAuditoriaExcel(porTransportadora = [], metricas = {}, competencia = '') {
  const wb = XLSX.utils.book_new();

  const resumo = [
    {
      'Competência': competencia || 'Todas',
      'Total CTes': metricas.total,
      'Com cálculo': metricas.totalCalculados,
      'Sem cálculo': metricas.totalSemCalculo,
      'Assertivos': metricas.totalAssertivos,
      'Divergentes': metricas.totalDivergentes,
      'Taxa cálculo %': Number(metricas.taxaCalculo || 0).toFixed(2),
      'Taxa assertividade %': Number(metricas.taxaAssertividade || 0).toFixed(2),
      'Taxa divergência %': Number(metricas.taxaDivergencia || 0).toFixed(2),
      'Valor total CTe': Number(metricas.valorTotalCte || 0).toFixed(2),
      'Valor divergência total': Number(metricas.valorTotalDivergencia || 0).toFixed(2),
      'Cobrança excessiva': Number(metricas.valorExcessivo || 0).toFixed(2),
      'Cobrança insuficiente': Number(metricas.valorInsuficiente || 0).toFixed(2),
    },
  ];

  const detalhes = porTransportadora.map((it) => ({
    'Transportadora': it.transportadora,
    'Total CTes': it.total,
    'Com cálculo': it.calculados,
    'Sem cálculo': it.semCalculo,
    'Assertivos': it.assertivos,
    'Divergentes': it.divergentes,
    'Taxa cálculo %': Number(it.taxaCalculo || 0).toFixed(2),
    'Taxa assertividade %': Number(it.taxaAssertividade || 0).toFixed(2),
    'Valor CTe': Number(it.valorCte || 0).toFixed(2),
    'Valor divergência': Number(it.valorDivergencia || 0).toFixed(2),
    'Cobrança excessiva': Number(it.valorExcessivo || 0).toFixed(2),
    'Cobrança insuficiente': Number(it.valorInsuficiente || 0).toFixed(2),
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhes), 'Por Transportadora');
  XLSX.writeFile(wb, `auditoria-ctes-${competencia || 'geral'}.xlsx`);
}

