import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';
import {
  listarRealizadoDiarioReajustes,
  listarTransportadorasRealizadoReajustes,
} from '../services/freteDatabaseService';
import {
  carregarConfigReajustesSupabase,
  carregarReajustesSupabase,
  obterInfoReajustesSupabase,
  reajustesSupabaseConfigurado,
  salvarConfigReajustesSupabase,
  salvarReajustesSupabase,
} from '../services/reajustesSupabaseService';
import {
  aplicarVinculoAutomatico,
  calcularImpactosReajustes,
  calcularSerieMensalReajustes,
  carregarConfigReajustes,
  carregarReajustes,
  criarReajusteManual,
  detectarMelhoresVinculos,
  formatarMesReferencia,
  formatarMoedaReajuste,
  formatarPercentualReajuste,
  importarControleReajustes,
  isEfetivado,
  mesAtualPadrao,
  mesesDisponiveisRealizado,
  normalizarTextoReajuste,
  obterPeriodoConsultaImpactoReajustes,
  parsePercentReajuste,
  resumoReajustes,
  salvarConfigReajustes,
  salvarReajustes,
} from '../utils/reajustesLocal';

const STATUS_OPTIONS = ['EM ANÁLISE', 'ADIADO', 'APROVADO', 'EFETIVADO', 'NEGADO', 'PENDENTE', 'AGUARDANDO RETORNO'];
const CANAIS_OPTIONS = ['', 'ATACADO', 'B2C', 'ATACADO E B2C'];
const FORM_MANUAL_VAZIO = {
  transportadoraInformada: '',
  canal: '',
  dataInicio: '',
  reajusteSolicitado: '',
  reajusteAplicado: '',
  status: 'EM ANÁLISE',
  observacao: '',
};
const REALIZADO_IMPACTO_CACHE_KEY = 'central_fretes_reajustes_realizado_cache_v1';

function carregarCacheRealizadoImpacto() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(REALIZADO_IMPACTO_CACHE_KEY) || 'null');
    if (parsed?.rows?.length) return parsed;
  } catch {}
  return null;
}

function salvarCacheRealizadoImpacto(rows = [], consultaInicio = '') {
  try {
    sessionStorage.setItem(REALIZADO_IMPACTO_CACHE_KEY, JSON.stringify({
      rows: rows.slice(0, 500000),
      consultaInicio: String(consultaInicio || '').slice(0, 10),
      savedAt: new Date().toISOString(),
    }));
  } catch {}
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text || /nao|não|sem|n\/a/i.test(text)) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const n = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function percentualParaInput(value) {
  const n = toNumber(value);
  if (!n) return '';
  return (n * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatDate(value) {
  if (!value) return '-';
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split('-');
  if (y && m && d) return `${d}/${m}/${y}`;
  return raw;
}

function periodoLabel(inicio, fim) {
  const a = formatDate(inicio);
  const b = formatDate(fim);
  if (a === '-' && b === '-') return '-';
  return `${a} a ${b}`;
}

function safeSheetName(nome) {
  return String(nome || 'Planilha').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Planilha';
}

function aplicarFormato(ws, rows = []) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0] || {});
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  ws['!cols'] = headers.map((header) => {
    if (/observ/i.test(header)) return { wch: 44 };
    if (/transportadora|vinculo/i.test(header)) return { wch: 42 };
    if (/data/i.test(header)) return { wch: 14 };
    if (/valor|impacto|frete|faturamento|nf/i.test(header)) return { wch: 18 };
    if (/%|reajuste|percentual/i.test(header)) return { wch: 16 };
    return { wch: Math.min(Math.max(String(header).length + 4, 12), 28) };
  });

  headers.forEach((header, colIndex) => {
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
      const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = ws[ref];
      if (!cell || typeof cell.v !== 'number') continue;
      if (/valor|impacto|frete|faturamento|nf/i.test(header)) cell.z = 'R$ #,##0.00';
      else if (/%|reajuste|percentual/i.test(header)) cell.z = '0.00%';
      else cell.z = '#,##0.00';
    }
  });
}

function baixarXlsx(nomeArquivo, abas) {
  const wb = XLSX.utils.book_new();
  Object.entries(abas).forEach(([nome, rows]) => {
    const safeRows = rows || [];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    aplicarFormato(ws, safeRows);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(nome));
  });
  XLSX.writeFile(wb, nomeArquivo);
}

function linhasRelatorio(itens = [], fimPeriodo = '') {
  return itens.map((item) => ({
    Transportadora_Informada: item.transportadoraInformada || '',
    Vinculos_Realizado: (item.transportadorasRealizado || []).join(' | '),
    Canal: item.canal || '',
    Status: item.status || '',
    Data_Inicio: item.dataInicio || '',
    Meses_Base_Auto: toNumber(item.mesesBaseImpacto || 3),
    Periodo_Base_Auto: periodoLabel(item.inicioImpactoBase, item.fimImpactoBase),
    Periodo_Realizado_Apos_Inicio: periodoLabel(item.inicioImpactoRealizado, item.fimImpactoRealizado),
    Reajuste_Solicitado: toNumber(item.reajusteSolicitado),
    Reajuste_Repassado_Aplicado: toNumber(item.reajusteAplicado),
    Reducao_Percentual_Reajuste: toNumber(item.percentualReducaoReajuste),
    Efetivado_No_Periodo: isEfetivado(item, fimPeriodo) ? 'Sim' : 'Não',
    CTEs_Base_Automatica: toNumber(item.ctesPeriodo),
    Frete_Base_Total: toNumber(item.valorFreteBaseTotal),
    Frete_Base_Medio_Mes: toNumber(item.valorFretePeriodo),
    Impacto_Previsto_Solicitado_Mes: toNumber(item.impactoPrevistoSolicitado),
    Impacto_Previsto_Repassado_Mes: toNumber(item.impactoPrevistoRepassado || item.impactoPrevisto || item.impactoPeriodo),
    Reducao_Impacto_Previsto_Mes: toNumber(item.reducaoImpactoPrevisto),
    CTEs_Realizado_Apos_Inicio: toNumber(item.ctesRealizadoReajuste),
    Dias_Realizados_Apos_Inicio: toNumber(item.diasRealizadosImpacto),
    Meses_Realizados_Equivalentes: toNumber(item.mesesRealizadosImpacto),
    Frete_Realizado_Total: toNumber(item.valorFreteRealizadoTotal),
    Frete_Realizado_Medio_Mes: toNumber(item.valorFreteRealizadoReajuste),
    Impacto_Realizado_Solicitado_Mes: toNumber(item.impactoRealizadoSolicitado),
    Impacto_Realizado_Repassado_Mes: toNumber(item.impactoRealizadoRepassado || item.impactoRealizado),
    Reducao_Impacto_Realizada_Mes: toNumber(item.reducaoImpactoRealizada),
    Impacto_Realizado_Repassado_Total: toNumber(item.impactoRealizadoTotalRepassado),
    Reducao_Impacto_Realizada_Total: toNumber(item.reducaoImpactoRealizadaTotal),
    Valor_NF_Base_Medio_Mes: toNumber(item.valorNFPeriodo),
    Valor_NF_Realizado_Medio_Mes: toNumber(item.valorNFRealizadoReajuste),
    Percentual_Frete_Base: toNumber(item.percentualFreteAtual),
    Percentual_Frete_Realizado: toNumber(item.percentualFreteRealizadoReajuste),
    Variacao_Percentual_Frete_pontos: toNumber(item.variacaoPercentualFreteRealizado),
    Observacao: item.observacao || '',
  }));
}

function linhasImpactoMensal(serie) {
  return (serie?.meses || []).map((mes) => ({
    Mes: mes.mes,
    Mes_Referencia: mes.mesLabel,
    Reajustes_Vigentes: toNumber(mes.itensVigentes),
    CTEs_Mes: toNumber(mes.ctes),
    Frete_Realizado_Mes: toNumber(mes.freteRealizado),
    Impacto_Previsto_Solicitado_Mes: toNumber(mes.impactoPrevistoSolicitado),
    Impacto_Previsto_Repassado_Mes: toNumber(mes.impactoPrevistoRepassado),
    Saving_Previsto_Mes: toNumber(mes.savingPrevisto),
    Impacto_Realizado_Solicitado_Mes: toNumber(mes.impactoRealizadoSolicitado),
    Impacto_Realizado_Repassado_Mes: toNumber(mes.impactoRealizadoRepassado),
    Saving_Realizado_Mes: toNumber(mes.savingRealizado),
  }));
}

function linhasImpactoMensalDetalhe(serie) {
  return (serie?.porItem || []).map((linha) => ({
    Mes: linha.mes,
    Mes_Referencia: linha.mesLabel,
    Transportadora: linha.transportadora,
    Canal: linha.canal,
    CTEs_Mes: toNumber(linha.ctes),
    Frete_Realizado_Mes: toNumber(linha.freteRealizado),
    Impacto_Realizado_Solicitado_Mes: toNumber(linha.impactoRealizadoSolicitado),
    Impacto_Realizado_Repassado_Mes: toNumber(linha.impactoRealizadoRepassado),
    Saving_Realizado_Mes: toNumber(linha.savingRealizado),
    Impacto_Previsto_Repassado_Mes: toNumber(linha.impactoPrevistoRepassado),
  }));
}

function linhasPreenchimentoReajustes(itens = []) {
  return (itens || []).map((item) => ({
    ID_Sistema: item.id || '',
    Transportadora: item.transportadoraInformada || '',
    Canal: item.canal || '',
    Status: item.status || '',
    Data_Inicio: String(item.dataInicio || '').slice(0, 10),
    'Reajuste_Solicitado_%': toNumber(item.reajusteSolicitado),
    'Reajuste_Aplicado_%': toNumber(item.reajusteAplicado),
    Vinculo_Realizado: (item.transportadorasRealizado || []).join(' | '),
    Observacao: item.observacao || '',
  }));
}

function normalizarChavePlanilha(value = '') {
  return normalizarTextoReajuste(value).replace(/\s+/g, '');
}

function pickPlanilha(row = {}, ...nomes) {
  const mapa = new Map(Object.keys(row || {}).map((key) => [normalizarChavePlanilha(key), key]));
  for (const nome of nomes) {
    const key = mapa.get(normalizarChavePlanilha(nome));
    if (key !== undefined) return row[key];
  }
  return '';
}

function dataPlanilhaParaIso(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = String(value || '').trim();
  const iso = raw.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/);
  if (br) return `${br[3]}-${String(br[2]).padStart(2, '0')}-${String(br[1]).padStart(2, '0')}`;
  return raw.slice(0, 10);
}

function separarVinculos(value = '') {
  return String(value || '')
    .split('|')
    .map((nome) => nome.trim())
    .filter(Boolean)
    .filter((nome, index, arr) => arr.findIndex((outro) => normalizarTextoReajuste(outro) === normalizarTextoReajuste(nome)) === index);
}

function parecePreenchimentoSimplificado(rows = []) {
  if (!rows.length) return false;
  const headers = Object.keys(rows[0] || {}).map(normalizarChavePlanilha);
  return headers.includes('IDSISTEMA')
    || (headers.includes('TRANSPORTADORA') && headers.some((header) => header.includes('REAJUSTEAPLICADO')))
    || (headers.includes('TRANSPORTADORA') && headers.includes('DATAINICIO') && headers.includes('STATUS'));
}

function linhaPreenchimentoParaDados(row = {}) {
  const transportadora = String(pickPlanilha(row, 'Transportadora', 'Transportadora_Informada') || '').trim();
  const canal = String(pickPlanilha(row, 'Canal') || '').trim();
  const status = String(pickPlanilha(row, 'Status', 'Negociação', 'Negociacao') || '').trim();
  const dataInicio = dataPlanilhaParaIso(pickPlanilha(row, 'Data_Inicio', 'Data Inicio', 'Data início', 'Inicio'));
  const reajusteSolicitado = parsePercentReajuste(pickPlanilha(row, 'Reajuste_Solicitado_%', 'Solicitado_%', 'Solicitado', 'Reajuste Solicitado'));
  const reajusteAplicado = parsePercentReajuste(pickPlanilha(row, 'Reajuste_Aplicado_%', 'Aplicado_%', 'Aplicado', 'Proposta Final', 'Reajuste Aplicado'));
  const vinculos = separarVinculos(pickPlanilha(row, 'Vinculo_Realizado', 'Vínculo_Realizado', 'Vinculos_Realizado', 'Vínculos_Realizado'));
  const observacao = String(pickPlanilha(row, 'Observacao', 'Observação', 'Obs') || '').trim();

  return {
    id: String(pickPlanilha(row, 'ID_Sistema', 'ID Sistema', 'Id') || '').trim(),
    transportadora,
    canal,
    status,
    dataInicio,
    reajusteSolicitado,
    reajusteAplicado,
    vinculos,
    observacao,
  };
}

function atualizarReajustesComPreenchimento(itensAtuais = [], rows = []) {
  const itens = [...(itensAtuais || [])];
  const porId = new Map(itens.map((item, index) => [String(item.id || ''), index]).filter(([id]) => id));
  const porNomeCanal = new Map();
  itens.forEach((item, index) => {
    const chave = `${normalizarTextoReajuste(item.transportadoraInformada)}|${normalizarTextoReajuste(item.canal)}`;
    if (!porNomeCanal.has(chave)) porNomeCanal.set(chave, index);
  });

  let atualizados = 0;
  let criados = 0;
  let ignorados = 0;

  rows.forEach((row) => {
    const dados = linhaPreenchimentoParaDados(row);
    if (!dados.id && !dados.transportadora) {
      ignorados += 1;
      return;
    }

    const chaveNomeCanal = `${normalizarTextoReajuste(dados.transportadora)}|${normalizarTextoReajuste(dados.canal)}`;
    const index = porId.has(dados.id) ? porId.get(dados.id) : porNomeCanal.get(chaveNomeCanal);

    if (index !== undefined && itens[index]) {
      const atual = itens[index];
      itens[index] = {
        ...atual,
        transportadoraInformada: dados.transportadora || atual.transportadoraInformada,
        canal: dados.canal,
        status: dados.status || atual.status,
        dataInicio: dados.dataInicio,
        reajusteSolicitado: dados.reajusteSolicitado,
        reajusteSolicitadoTexto: dados.reajusteSolicitado ? `${(dados.reajusteSolicitado * 100).toLocaleString('pt-BR')}%` : '',
        reajusteAplicado: dados.reajusteAplicado,
        propostaFinal: dados.reajusteAplicado,
        transportadorasRealizado: dados.vinculos,
        transportadoraSistema: dados.vinculos.join(' | '),
        observacao: dados.observacao,
        atualizadoEm: new Date().toISOString(),
      };
      atualizados += 1;
      return;
    }

    if (!dados.transportadora) {
      ignorados += 1;
      return;
    }

    const novo = criarReajusteManual({
      transportadoraInformada: dados.transportadora,
      canal: dados.canal,
      dataInicio: dados.dataInicio,
      reajusteSolicitado: dados.reajusteSolicitado,
      reajusteAplicado: dados.reajusteAplicado,
      status: dados.status || 'EM ANÁLISE',
      observacao: dados.observacao,
    });
    novo.transportadorasRealizado = dados.vinculos;
    novo.transportadoraSistema = dados.vinculos.join(' | ');
    itens.push(novo);
    porId.set(novo.id, itens.length - 1);
    porNomeCanal.set(chaveNomeCanal, itens.length - 1);
    criados += 1;
  });

  return { itens, atualizados, criados, ignorados };
}

function lerWorkbookParaJson(wb, preferencia = []) {
  const nomesNormalizados = new Map(wb.SheetNames.map((name) => [normalizarChavePlanilha(name), name]));
  const sheetName = preferencia
    .map((name) => nomesNormalizados.get(normalizarChavePlanilha(name)))
    .find(Boolean) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return {
    sheetName,
    rows: XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }),
  };
}

function nomesUnicosRealizado(rows = []) {
  const mapa = new Map();

  (rows || []).forEach((row) => {
    const nome = String(row.transportadora || row.nomeTransportadora || row.transportadoraRealizada || '').trim();
    if (!nome) return;
    const key = normalizarTextoReajuste(nome);
    if (!key) return;

    const atual = mapa.get(key) || { nome, ctes: 0, frete: 0 };
    atual.ctes += Math.max(toNumber(row.ctes ?? row.totalCtes ?? row.quantidadeCtes), 1);
    atual.frete += toNumber(row.valorCte || row.valorCTe || row.valorFrete || row.freteRealizado);
    mapa.set(key, atual);
  });

  return [...mapa.values()].sort((a, b) => b.frete - a.frete || b.ctes - a.ctes || a.nome.localeCompare(b.nome, 'pt-BR'));
}

function rowsRealizadoComValor(rows = []) {
  return (rows || []).filter((row) => {
    const nome = row.transportadora || row.nomeTransportadora || row.transportadoraRealizada;
    const valor = row.valorCte ?? row.valorCTe ?? row.valorFrete ?? row.freteRealizado;
    return String(nome || '').trim() && toNumber(valor) > 0;
  });
}

function totalCtesRealizado(rows = []) {
  return (rows || []).reduce((acc, row) => acc + Math.max(toNumber(row.ctes ?? row.totalCtes ?? row.quantidadeCtes), 1), 0);
}

function ultimaDataRows(rows = []) {
  return (rows || [])
    .map((row) => String(row.dataEmissao || row.emissao || row.data || '').slice(0, 10))
    .filter((d) => /^20\d{2}-\d{2}-\d{2}$/.test(d))
    .sort()
    .at(-1) || '';
}

async function carregarRealizadoParaReajustes(filtros = {}, options = {}) {
  const limitLocal = Number(options.limit || 500000) || 500000;
  const limitSupabase = Math.min(Number(options.limit || 100000) || 100000, 100000);

  const [remotoResult, localResult] = await Promise.allSettled([
    listarRealizadoDiarioReajustes({ ...filtros, limit: limitSupabase }),
    exportarRealizadoLocal(filtros, { ...options, limit: limitLocal }),
  ]);

  const rowsRemotos = remotoResult.status === 'fulfilled'
    ? (Array.isArray(remotoResult.value) ? remotoResult.value : (remotoResult.value?.rows || []))
    : [];
  const erroRemoto = remotoResult.status === 'rejected' ? remotoResult.reason : null;

  const localData = localResult.status === 'fulfilled' ? localResult.value : { rows: [], totalCompativel: 0, limit: limitLocal };
  const rowsLocais = localData.rows || [];

  const temRemoto = rowsRealizadoComValor(rowsRemotos).length > 0;
  const temLocal = rowsRealizadoComValor(rowsLocais).length > 0;

  if (!temRemoto && !temLocal) {
    if (erroRemoto && !rowsLocais.length) {
      throw new Error(`Não consegui carregar realizado do Supabase (${erroRemoto?.message || erroRemoto}) e o Realizado Local está vazio.`);
    }
    return {
      rows: [],
      totalCompativel: 0,
      limit: limitSupabase,
      origem: 'Vazio',
      erroSupabase: erroRemoto?.message || '',
    };
  }

  if (temRemoto && !temLocal) {
    return {
      rows: rowsRemotos,
      totalCompativel: totalCtesRealizado(rowsRemotos),
      limit: limitSupabase,
      origem: 'Supabase realizado_local_ctes',
    };
  }

  if (!temRemoto && temLocal) {
    return {
      rows: rowsLocais,
      totalCompativel: Number(localData.totalCompativel || rowsLocais.length),
      limit: Number(localData.limit || limitLocal),
      origem: 'Realizado Local',
    };
  }

  // Ambos têm dados — preferir quem tem a data mais recente
  const ultimaRemota = ultimaDataRows(rowsRemotos);
  const ultimaLocal = ultimaDataRows(rowsLocais);

  if (ultimaLocal > ultimaRemota) {
    return {
      rows: rowsLocais,
      totalCompativel: Number(localData.totalCompativel || rowsLocais.length),
      limit: Number(localData.limit || limitLocal),
      origem: `Realizado Local (mais recente: ${ultimaLocal} vs Supabase: ${ultimaRemota})`,
    };
  }

  return {
    rows: rowsRemotos,
    totalCompativel: totalCtesRealizado(rowsRemotos),
    limit: limitSupabase,
    origem: `Supabase realizado_local_ctes (mais recente: ${ultimaRemota})`,
  };
}

function filtrarOpcoesRealizado(opcoes = [], busca = '', itemNome = '') {
  const texto = normalizarTextoReajuste(busca || itemNome);
  if (!texto) return opcoes.slice(0, 25);

  const palavras = texto.split(' ').filter((p) => p.length >= 2);

  return opcoes
    .map((opcao) => {
      const norm = normalizarTextoReajuste(opcao.nome);
      let score = 0;
      if (norm === texto) score = 100;
      else if (norm.includes(texto) || texto.includes(norm)) score = 80;
      else if (palavras.length) score = palavras.filter((p) => norm.includes(p)).length * 20;
      return { ...opcao, score };
    })
    .filter((opcao) => opcao.score > 0)
    .sort((a, b) => b.score - a.score || b.frete - a.frete || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, 25);
}

function resumoVinculosSelecionados(selecionadas = [], opcoesRealizado = []) {
  const selecionadasNorm = new Set(selecionadas.map(normalizarTextoReajuste));
  return (opcoesRealizado || []).reduce((acc, opcao) => {
    if (!selecionadasNorm.has(normalizarTextoReajuste(opcao.nome))) return acc;
    acc.ctes += toNumber(opcao.ctes);
    acc.frete += toNumber(opcao.frete);
    return acc;
  }, { ctes: 0, frete: 0 });
}

function atualizarPercentualTemporario(setPercentuais, id, campo, valor) {
  setPercentuais((prev) => ({
    ...prev,
    [id]: {
      ...(prev[id] || {}),
      [campo]: valor,
    },
  }));
}

function GraficoBarrasMensal({ dados = [], barras = [], altura = 200, formatar }) {
  if (!dados.length) {
    return <p className="compact" style={{ color: '#64748b' }}>Sem dados mensais. Calcule o impacto para ver os gráficos.</p>;
  }

  const valores = dados.flatMap((linha) => barras.map((barra) => Math.abs(toNumber(linha[barra.key]))));
  const max = Math.max(...valores, 1);
  const larguraGrupo = Math.max(barras.length * 16 + 24, 52);
  const larguraTotal = dados.length * larguraGrupo;
  const areaAltura = altura - 30;
  const larguraBarra = Math.max((larguraGrupo - 20) / barras.length, 6);
  const formatarValor = formatar || ((valor) => String(toNumber(valor)));

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
        {barras.map((barra) => (
          <span key={barra.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: barra.cor, display: 'inline-block' }} />
            {barra.nome}
          </span>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={Math.max(larguraTotal, 280)} height={altura} role="img" style={{ display: 'block' }}>
          <line x1="0" y1={areaAltura} x2={Math.max(larguraTotal, 280)} y2={areaAltura} stroke="#e2e8f0" strokeWidth="1" />
          {dados.map((linha, indice) => {
            const x0 = indice * larguraGrupo + 10;
            return (
              <g key={linha.mes || indice}>
                {barras.map((barra, posicao) => {
                  const valor = Math.abs(toNumber(linha[barra.key]));
                  const altBarra = max ? (valor / max) * areaAltura : 0;
                  const x = x0 + posicao * larguraBarra;
                  const y = areaAltura - altBarra;
                  return (
                    <rect key={barra.key} x={x} y={y} width={Math.max(larguraBarra - 2, 4)} height={altBarra} fill={barra.cor} rx="2">
                      <title>{`${barra.nome} • ${linha.mesLabel || linha.mes}: ${formatarValor(linha[barra.key])}`}</title>
                    </rect>
                  );
                })}
                <text x={x0 + (larguraGrupo - 20) / 2} y={altura - 8} textAnchor="middle" fontSize="10" fill="#64748b">
                  {linha.mesLabel || linha.mes}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function PainelVinculo({
  item,
  opcoesRealizado,
  busca,
  onBusca,
  onToggle,
  onMarcar,
  onLimpar,
  onFechar,
}) {
  if (!item) return null;

  const selecionadas = Array.isArray(item.transportadorasRealizado) ? item.transportadorasRealizado : [];
  const selecionadasNorm = new Set(selecionadas.map(normalizarTextoReajuste));
  const sugestoes = detectarMelhoresVinculos(item.transportadoraInformada, opcoesRealizado.map((opcao) => opcao.nome), 10);
  const opcoes = filtrarOpcoesRealizado(opcoesRealizado, busca, item.transportadoraInformada);
  const resumo = resumoVinculosSelecionados(selecionadas, opcoesRealizado);

  return (
    <section className="panel-card" style={{ border: '2px solid #0b1f52' }}>
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Editar vínculo no Realizado Local</div>
          <p className="compact">
            Transportadora da planilha: <strong>{item.transportadoraInformada}</strong>. Marque uma ou mais variações do nome usado na base realizada.
          </p>
        </div>
        <div className="actions-right gap-row">
          <button type="button" className="btn-secondary" onClick={onLimpar} disabled={!selecionadas.length}>Limpar vínculo</button>
          <button type="button" className="btn-primary" onClick={onFechar}>Concluir vínculo</button>
        </div>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card"><span>Selecionados</span><strong>{selecionadas.length.toLocaleString('pt-BR')}</strong><small>nomes do realizado</small></div>
        <div className="summary-card"><span>CT-es vinculados</span><strong>{resumo.ctes.toLocaleString('pt-BR')}</strong><small>base realizada total</small></div>
        <div className="summary-card"><span>Frete vinculado</span><strong>{formatarMoedaReajuste(resumo.frete)}</strong><small>base realizada total</small></div>
      </div>

      <div className="form-grid two">
        <label className="field">Buscar no Realizado Local
          <input
            value={busca || ''}
            onChange={(event) => onBusca(event.target.value)}
            placeholder="Ex.: ALFA, TRANSLOVATO, JAD..."
            autoFocus
          />
        </label>
        <div className="field">
          <span>Selecionados</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 42, alignItems: 'center' }}>
            {selecionadas.length
              ? selecionadas.map((nome) => <span key={nome} className="pill-soft">{nome}</span>)
              : <span className="pill-soft">Sem vínculo realizado</span>}
          </div>
        </div>
      </div>

      {sugestoes.length > 0 && (
        <div className="hint-box compact">
          <strong>Sugestões rápidas: </strong>
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {sugestoes.map((nome) => (
              <button key={nome} type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => onToggle(nome, true)}>
                + {nome}
              </button>
            ))}
          </span>
        </div>
      )}

      <div className="actions-right top-space-sm">
        <button type="button" className="btn-secondary" onClick={() => onMarcar(opcoes.map((opcao) => opcao.nome))} disabled={!opcoes.length}>
          Marcar todos filtrados
        </button>
      </div>

      <div className="sim-analise-tabela-wrap top-space-sm" style={{ maxHeight: 360 }}>
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Usar</th>
              <th>Nome no Realizado Local</th>
              <th>CT-es</th>
              <th>Frete realizado</th>
            </tr>
          </thead>
          <tbody>
            {opcoes.map((opcao) => {
              const checked = selecionadasNorm.has(normalizarTextoReajuste(opcao.nome));
              return (
                <tr key={opcao.nome}>
                  <td>
                    <input type="checkbox" checked={checked} onChange={(event) => onToggle(opcao.nome, event.target.checked)} />
                  </td>
                  <td><strong>{opcao.nome}</strong></td>
                  <td>{opcao.ctes.toLocaleString('pt-BR')}</td>
                  <td>{formatarMoedaReajuste(opcao.frete)}</td>
                </tr>
              );
            })}
            {!opcoes.length && <tr><td colSpan="4">Nenhum nome encontrado na base realizada local.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResumoVinculoLinha({ item, opcoesRealizado, onEditar }) {
  const selecionadas = Array.isArray(item.transportadorasRealizado) ? item.transportadorasRealizado : [];
  const resumo = resumoVinculosSelecionados(selecionadas, opcoesRealizado);

  return (
    <div style={{ minWidth: 280, display: 'grid', gap: 6 }}>
      {selecionadas.length ? (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {selecionadas.slice(0, 3).map((nome) => <span key={nome} className="pill-soft">{nome}</span>)}
            {selecionadas.length > 3 && <span className="pill-soft">+{selecionadas.length - 3}</span>}
          </div>
          <small style={{ color: '#64748b' }}>
            {selecionadas.length.toLocaleString('pt-BR')} vínculo(s) • {resumo.ctes.toLocaleString('pt-BR')} CT-e(s) • {formatarMoedaReajuste(resumo.frete)}
          </small>
        </>
      ) : (
        <span className="pill-soft">Sem vínculo realizado</span>
      )}
      <div>
        <button type="button" className="btn-secondary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onEditar}>
          Editar vínculo
        </button>
      </div>
    </div>
  );
}

export default function ReajustesPage() {
  const [itens, setItens] = useState(() => carregarReajustes());
  const [config, setConfig] = useState(() => {
    const salvo = carregarConfigReajustes();
    if (salvo?.inicio || salvo?.fim) return salvo;
    return mesAtualPadrao();
  });
  const [arquivo, setArquivo] = useState(null);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [somenteEfetivados, setSomenteEfetivados] = useState(false);
  const [mesReferencia, setMesReferencia] = useState('');
  const [opcoesRealizado, setOpcoesRealizado] = useState([]);
  const [buscasVinculo, setBuscasVinculo] = useState({});
  const [vinculoAtivoId, setVinculoAtivoId] = useState(null);
  const [percentuaisEditando, setPercentuaisEditando] = useState({});
  const [mostrarManual, setMostrarManual] = useState(false);
  const [manual, setManual] = useState(FORM_MANUAL_VAZIO);
  const [realizadoImpactoRows, setRealizadoImpactoRows] = useState(() => carregarCacheRealizadoImpacto()?.rows || []);
  const [fontePersistencia, setFontePersistencia] = useState(() => reajustesSupabaseConfigurado() ? 'supabase' : 'local');
  const [persistenciaPronta, setPersistenciaPronta] = useState(false);
  const [sincronizandoSupabase, setSincronizandoSupabase] = useState(false);
  const [ultimoSyncSupabase, setUltimoSyncSupabase] = useState('');
  const [diagRealizado, setDiagRealizado] = useState(null);
  const autoImpactoDisparadoRef = useRef(false);

  useEffect(() => {
    let cancelado = false;

    async function carregarPersistencia() {
      if (!reajustesSupabaseConfigurado()) {
        setFontePersistencia('local');
        setPersistenciaPronta(true);
        return;
      }

      setSincronizandoSupabase(true);
      setMensagem('Carregando controle de reajustes do Supabase...');
      setErro('');

      try {
        const [remotos, configRemota] = await Promise.all([
          carregarReajustesSupabase(),
          carregarConfigReajustesSupabase(),
        ]);
        if (cancelado) return;

        const locais = carregarReajustes();
        if (remotos.length) {
          setItens(remotos);
          if (configRemota?.inicio || configRemota?.fim) setConfig((prev) => ({ ...prev, ...configRemota }));
          setFontePersistencia('supabase');
          setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
          setMensagem(`Controle de reajustes carregado do Supabase: ${remotos.length.toLocaleString('pt-BR')} registro(s).`);
        } else if (locais.length) {
          await salvarReajustesSupabase(locais);
          await salvarConfigReajustesSupabase(configRemota || config);
          if (cancelado) return;
          setFontePersistencia('supabase');
          setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
          setMensagem(`Dados locais migrados para o Supabase: ${locais.length.toLocaleString('pt-BR')} registro(s).`);
        } else {
          if (configRemota?.inicio || configRemota?.fim) setConfig((prev) => ({ ...prev, ...configRemota }));
          setFontePersistencia('supabase');
          setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
          setMensagem('Controle de reajustes conectado ao Supabase. Nenhum registro salvo ainda.');
        }
      } catch (error) {
        if (!cancelado) {
          setFontePersistencia('local');
          setErro(error.message || 'Não foi possível carregar o controle de reajustes do Supabase. Mantive os dados locais deste navegador.');
        }
      } finally {
        if (!cancelado) {
          setSincronizandoSupabase(false);
          setPersistenciaPronta(true);
        }
      }
    }

    carregarPersistencia();
    carregarNomesRealizado(false).catch(() => {});

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    salvarConfigReajustes(config);
    if (!persistenciaPronta || fontePersistencia !== 'supabase') return undefined;

    const handle = window.setTimeout(() => {
      salvarConfigReajustesSupabase(config)
        .then(() => setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR')))
        .catch((error) => setErro(error.message || 'Erro ao salvar configuração de reajustes no Supabase.'));
    }, 500);

    return () => window.clearTimeout(handle);
  }, [config, fontePersistencia, persistenciaPronta]);

  useEffect(() => {
    if (!persistenciaPronta || fontePersistencia !== 'supabase') return undefined;

    const handle = window.setTimeout(() => {
      setSincronizandoSupabase(true);
      salvarReajustesSupabase(itens)
        .then(() => {
          setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
        })
        .catch((error) => {
          setErro(error.message || 'Erro ao salvar reajustes no Supabase.');
        })
        .finally(() => setSincronizandoSupabase(false));
    }, 700);

    return () => window.clearTimeout(handle);
  }, [itens, fontePersistencia, persistenciaPronta]);

  useEffect(() => {
    if (!persistenciaPronta || !itens.length || autoImpactoDisparadoRef.current) return undefined;
    const consulta = obterPeriodoConsultaImpactoReajustes(itens, config);
    if (!consulta.inicio) return undefined;

    autoImpactoDisparadoRef.current = true;
    calcularImpacto({ automatico: true }).catch(() => {});
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistenciaPronta, itens.length, config.mesesBaseImpacto]);

  const mesRefAplicadoRef = useRef('');

  useEffect(() => {
    if (!persistenciaPronta) return;
    if (mesRefAplicadoRef.current === mesReferencia) return;
    mesRefAplicadoRef.current = mesReferencia;
    const rows = realizadoImpactoRows.length
      ? realizadoImpactoRows
      : (carregarCacheRealizadoImpacto()?.rows || []);
    if (!rows.length) return;
    setItens((prev) => {
      const recalc = calcularImpactosReajustes(prev, rows, { ...config, mesReferencia });
      salvarReajustes(recalc);
      return recalc;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesReferencia, persistenciaPronta]);

  const resumo = useMemo(() => resumoReajustes(itens), [itens]);

  const serieMensal = useMemo(
    () => calcularSerieMensalReajustes(itens, realizadoImpactoRows, config),
    [itens, realizadoImpactoRows, config],
  );

  const dashboard = useMemo(() => {
    const meses = serieMensal.meses || [];
    const previstoRepassadoAcum = meses.reduce((acc, mes) => acc + toNumber(mes.impactoPrevistoRepassado), 0);
    const realizadoRepassadoAcum = meses.reduce((acc, mes) => acc + toNumber(mes.impactoRealizadoRepassado), 0);
    const savingRealizadoAcum = meses.reduce((acc, mes) => acc + toNumber(mes.savingRealizado), 0);
    const savingPrevistoAcum = meses.reduce((acc, mes) => acc + toNumber(mes.savingPrevisto), 0);
    const ctesAcum = meses.reduce((acc, mes) => acc + toNumber(mes.ctes), 0);
    const mesesComRealizado = meses.filter((mes) => toNumber(mes.freteRealizado) > 0).length;
    const aderencia = previstoRepassadoAcum ? realizadoRepassadoAcum / previstoRepassadoAcum : 0;
    const hoje = new Date().toISOString().slice(0, 10);
    const reajustesVigentes = itens.filter((item) => {
      const inicio = String(item.dataInicio || item.dataPrimeiraParcela || '').slice(0, 10);
      return inicio && inicio <= hoje;
    }).length;
    const melhorMes = [...meses].sort((a, b) => toNumber(b.impactoRealizadoRepassado) - toNumber(a.impactoRealizadoRepassado))[0] || null;
    return {
      meses,
      previstoRepassadoAcum,
      realizadoRepassadoAcum,
      savingRealizadoAcum,
      savingPrevistoAcum,
      ctesAcum,
      mesesComRealizado,
      aderencia,
      reajustesVigentes,
      melhorMes,
    };
  }, [serieMensal, itens]);

  const ranking = useMemo(() => {
    const base = (itens || [])
      .map((item) => ({
        nome: item.transportadoraInformada || 'Sem nome',
        canal: item.canal || '',
        previsto: toNumber(item.impactoPrevistoRepassado || item.impactoPrevisto || item.impactoPeriodo),
        realizado: toNumber(item.impactoRealizadoRepassado || item.impactoRealizado),
        savingRealizado: toNumber(item.reducaoImpactoRealizada),
      }))
      .filter((linha) => linha.previsto > 0 || linha.realizado > 0);

    const totalRealizado = base.reduce((acc, linha) => acc + linha.realizado, 0);
    const usarRealizado = totalRealizado > 0;
    const ordenadas = base
      .sort((a, b) => (usarRealizado ? b.realizado - a.realizado : b.previsto - a.previsto)
        || b.previsto - a.previsto
        || a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, 10);

    const totalMetrica = ordenadas.reduce((acc, linha) => acc + (usarRealizado ? linha.realizado : linha.previsto), 0);
    let acumulado = 0;
    return {
      usarRealizado,
      linhas: ordenadas.map((linha) => {
        const metrica = usarRealizado ? linha.realizado : linha.previsto;
        acumulado += metrica;
        return {
          ...linha,
          percentual: totalMetrica ? metrica / totalMetrica : 0,
          percentualAcumulado: totalMetrica ? acumulado / totalMetrica : 0,
        };
      }),
    };
  }, [itens]);

  const mesesRealizadoDisponiveis = useMemo(
    () => mesesDisponiveisRealizado(realizadoImpactoRows),
    [realizadoImpactoRows],
  );
  const mesReferenciaLabel = formatarMesReferencia(mesReferencia);
  const sufixoRealizado = mesReferencia ? ` ${mesReferenciaLabel}` : '/mês';

  const minDataInicioReajuste = useMemo(() => itens
    .map((item) => String(item.dataInicio || item.dataPrimeiraParcela || '').slice(0, 10))
    .filter((d) => /^20\d{2}-\d{2}-\d{2}$/.test(d))
    .sort()[0] || '', [itens]);

  const itemVinculoAtivo = useMemo(() => itens.find((item) => item.id === vinculoAtivoId) || null, [itens, vinculoAtivoId]);

  const itensFiltrados = useMemo(() => {
    const texto = normalizarTextoReajuste(filtroTexto);
    return (itens || [])
      .filter((item) => !texto || normalizarTextoReajuste(`${item.transportadoraInformada} ${(item.transportadorasRealizado || []).join(' ')} ${item.observacao}`).includes(texto))
      .filter((item) => !filtroStatus || item.status === filtroStatus)
      .filter((item) => !somenteEfetivados || isEfetivado(item))
      .sort((a, b) => toNumber(b.impactoRealizado || b.impactoPrevisto || b.impactoPeriodo) - toNumber(a.impactoRealizado || a.impactoPrevisto || a.impactoPeriodo) || String(a.transportadoraInformada).localeCompare(String(b.transportadoraInformada), 'pt-BR'));
  }, [itens, filtroTexto, filtroStatus, somenteEfetivados]);

  function persistir(novos, options = {}) {
    const rowsImpacto = realizadoImpactoRows.length
      ? realizadoImpactoRows
      : (carregarCacheRealizadoImpacto()?.rows || []);
    const deveRecalcular = options.recalcularImpacto && rowsImpacto.length;
    const base = deveRecalcular
      ? calcularImpactosReajustes(novos, rowsImpacto, { ...config, mesReferencia })
      : novos;
    if (deveRecalcular && !realizadoImpactoRows.length && rowsImpacto.length) {
      setRealizadoImpactoRows(rowsImpacto);
    }
    setItens(base);
    salvarReajustes(base);
    return base;
  }

  function alterarItem(id, campo, valor, options = {}) {
    const novos = itens.map((item) => item.id === id ? { ...item, [campo]: valor, atualizadoEm: new Date().toISOString() } : item);
    persistir(novos, options);
  }

  function salvarPercentualItem(id, campo, valorVisual) {
    const decimal = parsePercentReajuste(valorVisual);
    alterarItem(id, campo, decimal, { recalcularImpacto: true });
    setPercentuaisEditando((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [campo]: undefined,
      },
    }));
  }

  function alterarBuscaVinculo(id, valor) {
    setBuscasVinculo((prev) => ({ ...prev, [id]: valor }));
  }

  function setVinculosItem(id, nomes) {
    const limpos = (nomes || [])
      .map((nome) => String(nome || '').trim())
      .filter(Boolean)
      .filter((nome, index, arr) => arr.findIndex((n) => normalizarTextoReajuste(n) === normalizarTextoReajuste(nome)) === index)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const novos = itens.map((item) => item.id === id
      ? {
          ...item,
          transportadorasRealizado: limpos,
          transportadoraSistema: limpos.join(' | '),
          atualizadoEm: new Date().toISOString(),
        }
      : item);
    persistir(novos, { recalcularImpacto: true });
  }

  function toggleVinculo(id, nome, checked) {
    const item = itens.find((row) => row.id === id);
    if (!item) return;
    const atuais = Array.isArray(item.transportadorasRealizado) ? item.transportadorasRealizado : [];
    if (checked) setVinculosItem(id, [...atuais, nome]);
    else setVinculosItem(id, atuais.filter((atual) => normalizarTextoReajuste(atual) !== normalizarTextoReajuste(nome)));
  }

  async function carregarNomesRealizado(exibirMensagem = true) {
    if (exibirMensagem) {
      setCarregando(true);
      setErro('');
      setMensagem('Carregando nomes de transportadoras do Realizado...');
    }
    try {
      let nomes = await listarTransportadorasRealizadoReajustes();
      let origem = 'Supabase realizado_local_ctes';
      if (!nomes.length) {
        const realizado = await carregarRealizadoParaReajustes({}, { limit: 500000 });
        nomes = nomesUnicosRealizado(realizado.rows || []);
        origem = realizado.origem;
      }
      setOpcoesRealizado(nomes);
      if (exibirMensagem) setMensagem(`Transportadoras carregadas do ${origem}: ${nomes.length.toLocaleString('pt-BR')} nome(s).`);
      return nomes;
    } catch (error) {
      if (exibirMensagem) setErro(error.message || 'Erro ao carregar transportadoras do Realizado.');
      return [];
    } finally {
      if (exibirMensagem) setCarregando(false);
    }
  }

  async function importarArquivo() {
    if (!arquivo) {
      setErro('Selecione a planilha de controle de reajustes.');
      return;
    }
    setCarregando(true);
    setErro('');
    setMensagem('Lendo planilha de reajustes...');
    try {
      const buffer = await arquivo.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
      const leitura = lerWorkbookParaJson(wb, ['Preenchimento', 'Atualizacao_Reajustes', 'Atualização_Reajustes']);

      if (parecePreenchimentoSimplificado(leitura.rows)) {
        const resultado = atualizarReajustesComPreenchimento(itens, leitura.rows);
        persistir(resultado.itens);
        setVinculoAtivoId(null);
        setMensagem(
          `Preenchimento simples importado da aba ${leitura.sheetName}: ${resultado.atualizados.toLocaleString('pt-BR')} atualizado(s), ${resultado.criados.toLocaleString('pt-BR')} novo(s)`
          + (resultado.ignorados ? ` e ${resultado.ignorados.toLocaleString('pt-BR')} linha(s) ignorada(s).` : '.')
        );
        return;
      }

      const resultado = await importarControleReajustes(arquivo);
      let nomes = opcoesRealizado;
      if (!nomes.length) nomes = await carregarNomesRealizado(false);
      const comVinculo = aplicarVinculoAutomatico(resultado.itens, nomes.map((item) => item.nome));
      persistir(comVinculo);
      setVinculoAtivoId(null);
      setMensagem(`Importado da aba ${resultado.sheetName}: ${resultado.total.toLocaleString('pt-BR')} reajuste(s). Agora revise os vínculos e calcule o impacto.`);
    } catch (error) {
      setErro(error.message || 'Erro ao importar controle de reajustes.');
    } finally {
      setCarregando(false);
    }
  }

  async function tentarVincular() {
    let nomes = opcoesRealizado;
    if (!nomes.length) nomes = await carregarNomesRealizado(false);
    const novos = aplicarVinculoAutomatico(itens, nomes.map((item) => item.nome));
    persistir(novos);
    setVinculoAtivoId(null);
    setMensagem('Vínculo automático atualizado com base nos nomes do Realizado.');
    setErro('');
  }

  async function calcularImpacto(options = {}) {
    const automatico = options.automatico === true;
    if (!automatico) {
      setCarregando(true);
    }
    setErro('');
    const consulta = obterPeriodoConsultaImpactoReajustes(itens, config);
    if (!consulta.inicio) {
      if (!automatico) {
        setCarregando(false);
        setErro('Informe a Data_Inicio dos reajustes antes de calcular. O impacto agora é sempre automático pela data de início, sem período manual.');
      }
      return;
    }

    if (!automatico) {
      setMensagem(`Buscando Realizado a partir de ${formatDate(consulta.inicio)}. O realizado será medido até a data mais recente encontrada na base.`);
    }
    try {
      const { rows, totalCompativel, limit, origem } = await carregarRealizadoParaReajustes({
        inicio: consulta.inicio,
      }, { limit: 500000 });

      if (automatico && !(rows || []).length) return;

      const datas = (rows || [])
        .map((row) => String(row.dataEmissao || row.emissao || row.data || '').slice(0, 10))
        .filter((d) => /^20\d{2}-\d{2}-\d{2}$/.test(d))
        .sort();
      const primeiraDataBase = datas[0] || '';
      const ultimaDataBase = datas.at(-1) || '';
      setDiagRealizado({
        totalRows: (rows || []).length,
        totalCompativel: Number(totalCompativel || totalCtesRealizado(rows || [])),
        primeiraData: primeiraDataBase,
        ultimaData: ultimaDataBase,
        origem,
        consultaInicio: consulta.inicio,
        calculadoEm: new Date().toISOString(),
      });

      const calculados = calcularImpactosReajustes(itens, rows || [], { ...config, mesReferencia });
      setRealizadoImpactoRows(rows || []);
      salvarCacheRealizadoImpacto(rows || [], consulta.inicio);
      const nomesCalculados = nomesUnicosRealizado(rows || []);
      if (nomesCalculados.length) setOpcoesRealizado(nomesCalculados);
      persistir(calculados);
      const resumoCalculado = resumoReajustes(calculados);
      const semRealizado = calculados.filter((item) => item.semRealizadoAposInicio).length;
      const ultimaBase = formatDate(resumoCalculado.ultimaDataRealizado) || 'a última data da base';

      setMensagem(
        `${automatico ? 'Impacto recalculado automaticamente' : 'Impacto calculado'} com ${Number(totalCompativel || totalCtesRealizado(rows || [])).toLocaleString('pt-BR')} CT-e(s). `
        + `Fonte: ${origem}. `
        + `Base prevista: média dos ${Number(config.mesesBaseImpacto || 3).toLocaleString('pt-BR')} mês(es) anteriores à Data_Inicio. `
        + `Realizado: da Data_Inicio até ${ultimaBase}${totalCompativel > limit ? ' dentro do limite exportado' : ''}.`
        + (semRealizado
          ? ` ${semRealizado.toLocaleString('pt-BR')} reajuste(s) ainda sem CT-es após a vigência${ultimaBase !== '-' ? ` (base atual até ${ultimaBase})` : ''}.`
          : '')
      );
    } catch (error) {
      if (!automatico) {
        setErro(error.message || 'Erro ao calcular impacto pelo Realizado.');
      }
    } finally {
      if (!automatico) {
        setCarregando(false);
      }
    }
  }

  function exportarRelatorio() {
    const relatorio = linhasRelatorio(itens);
    const efetivados = linhasRelatorio(itens.filter((item) => isEfetivado(item)));
    const semVinculo = linhasRelatorio(itens.filter((item) => !(item.transportadorasRealizado || []).length));
    const resumoRows = [{
      Meses_Base_Automatica: toNumber(config.mesesBaseImpacto || 3),
      Realizado_Ate_Data_Mais_Recente_Base: resumo.ultimaDataRealizado || '',
      Reajustes: itens.length,
      Efetivados: efetivados.length,
      Sem_Vinculo: semVinculo.length,
      Frete_Base_Automatica: resumo.freteBase,
      Impacto_Previsto_Solicitado: resumo.impactoPrevistoSolicitado,
      Impacto_Previsto_Repassado: resumo.impactoTotal,
      Reducao_Impacto_Previsto: resumo.reducaoImpactoPrevisto,
      Frete_Realizado_Apos_Data_Inicio: resumo.freteRealizadoReajuste,
      Impacto_Realizado_Solicitado: resumo.impactoRealizadoSolicitado,
      Impacto_Realizado_Repassado: resumo.impactoRealizado,
      Reducao_Impacto_Realizada: resumo.reducaoImpactoRealizada,
      Impacto_Realizado_Efetivado: resumo.impactoRealizadoEfetivado,
      Reducao_Realizada_Efetivada: resumo.reducaoImpactoRealizadaEfetivada,
    }];

    const rowsImpacto = realizadoImpactoRows.length
      ? realizadoImpactoRows
      : (carregarCacheRealizadoImpacto()?.rows || []);
    const serie = calcularSerieMensalReajustes(itens, rowsImpacto, config);

    baixarXlsx(`controle-reajustes-impacto-${new Date().toISOString().slice(0, 10)}.xlsx`, {
      Resumo: resumoRows,
      Controle_Reajustes: relatorio,
      Impacto_Mensal: linhasImpactoMensal(serie),
      Impacto_Mensal_Detalhe: linhasImpactoMensalDetalhe(serie),
      Efetivados: efetivados,
      Sem_Vinculo: semVinculo,
    });
  }

  function exportarPreenchimento() {
    if (!itens.length) {
      setErro('Não há reajustes carregados para gerar o modelo de preenchimento.');
      return;
    }

    const preenchimento = linhasPreenchimentoReajustes(itens);
    const orientacao = [
      { Campo: 'ID_Sistema', Como_preencher: 'Não alterar. Essa coluna fica oculta e serve para atualizar o mesmo registro.', Obrigatorio: 'Sim' },
      { Campo: 'Transportadora', Como_preencher: 'Nome da transportadora. Pode ajustar o nome se necessário.', Obrigatorio: 'Sim' },
      { Campo: 'Canal', Como_preencher: 'ATACADO, B2C ou ATACADO E B2C.', Obrigatorio: 'Não' },
      { Campo: 'Status', Como_preencher: 'EM ANÁLISE, ADIADO, APROVADO, EFETIVADO, NEGADO, PENDENTE ou AGUARDANDO RETORNO.', Obrigatorio: 'Não' },
      { Campo: 'Data_Inicio', Como_preencher: 'Data de início no formato AAAA-MM-DD ou DD/MM/AAAA.', Obrigatorio: 'Não' },
      { Campo: 'Reajuste_Solicitado_%', Como_preencher: 'Digite 10%, 10 ou 0,10 para representar 10%.', Obrigatorio: 'Não' },
      { Campo: 'Reajuste_Aplicado_%', Como_preencher: 'Percentual aprovado/aplicado. Esse é o principal campo para atualizar.', Obrigatorio: 'Não' },
      { Campo: 'Vinculo_Realizado', Como_preencher: 'Use | para separar mais de um nome. Ex.: ALFA | ALFA TRANSPORTES.', Obrigatorio: 'Não' },
      { Campo: 'Observacao', Como_preencher: 'Observação da negociação.', Obrigatorio: 'Não' },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(preenchimento);
    aplicarFormato(ws, preenchimento);
    ws['!cols'] = ws['!cols'] || [];
    ws['!cols'][0] = { ...(ws['!cols'][0] || {}), hidden: true, wch: 12 };
    XLSX.utils.book_append_sheet(wb, ws, 'Preenchimento');

    const wsOrientacao = XLSX.utils.json_to_sheet(orientacao);
    aplicarFormato(wsOrientacao, orientacao);
    XLSX.utils.book_append_sheet(wb, wsOrientacao, 'Orientacao');

    XLSX.writeFile(wb, `preenchimento-reajustes-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setMensagem('Modelo simples exportado. Atualize os campos necessários e importe o mesmo arquivo para gravar as alterações.');
    setErro('');
  }

  function limparTudo() {
    if (!window.confirm('Deseja limpar o controle de reajustes local deste navegador?')) return;
    persistir([]);
    setVinculoAtivoId(null);
    setMensagem('Controle de reajustes limpo.');
  }

  function adicionarManual() {
    try {
      const novo = criarReajusteManual(manual);
      persistir([novo, ...itens]);
      setManual(FORM_MANUAL_VAZIO);
      setMostrarManual(false);
      setMensagem('Reajuste manual incluído. Agora faça o vínculo com o Realizado Local.');
      setErro('');
    } catch (error) {
      setErro(error.message || 'Erro ao incluir reajuste manual.');
    }
  }

  async function sincronizarSupabaseAgora() {
    if (!reajustesSupabaseConfigurado()) {
      setErro('Supabase não configurado. Confira as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setSincronizandoSupabase(true);
    setErro('');
    setMensagem('Salvando controle de reajustes no Supabase...');

    try {
      await salvarReajustesSupabase(itens);
      await salvarConfigReajustesSupabase(config);
      const info = obterInfoReajustesSupabase();
      setFontePersistencia('supabase');
      setPersistenciaPronta(true);
      setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
      setMensagem(`Controle de reajustes salvo no Supabase${info.host ? ` (${info.host})` : ''}: ${itens.length.toLocaleString('pt-BR')} registro(s).`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar controle de reajustes no Supabase.');
    } finally {
      setSincronizandoSupabase(false);
    }
  }

  const vinculados = itens.filter((item) => (item.transportadorasRealizado || []).length).length;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Reajustes</div>
        <h1>Controle de reajustes</h1>
        <p>Gestão de solicitações, vínculos com o Realizado Local e cálculo de impacto previsto e realizado.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Fluxo de trabalho</div>
            <p className="compact">A ferramenta fica mais fácil seguindo estes passos: carregar/importar, vincular nomes, calcular impacto e exportar relatório.</p>
          </div>
        </div>

        <div className="summary-strip lotacao-summary-mini">
          <div className="summary-card"><span>1. Registros</span><strong>{itens.length.toLocaleString('pt-BR')}</strong><small>importados ou manuais</small></div>
          <div className="summary-card"><span>2. Vínculos</span><strong>{vinculados.toLocaleString('pt-BR')}</strong><small>{resumo.semVinculo.toLocaleString('pt-BR')} sem vínculo</small></div>
          <div className="summary-card"><span>3. Frete base médio/mês</span><strong>{formatarMoedaReajuste(resumo.freteBase)}</strong><small>{toNumber(config.mesesBaseImpacto || 3)} mês(es) antes</small></div>
          <div className="summary-card"><span>4. Previsto repassado/mês</span><strong>{formatarMoedaReajuste(resumo.impactoTotal)}</strong><small>média base × aplicado</small></div>
          <div className="summary-card"><span>5. Saving previsto/mês</span><strong>{formatarMoedaReajuste(resumo.reducaoImpactoPrevisto)}</strong><small>solicitado - aplicado</small></div>
          <div className="summary-card"><span>6. Realizado repassado{mesReferencia ? ` ${mesReferenciaLabel}` : '/mês'}</span><strong>{formatarMoedaReajuste(resumo.impactoRealizado)}</strong><small>{mesReferencia ? `total do mês ${mesReferenciaLabel}` : 'mensalizado após início'}</small></div>
          <div className="summary-card"><span>7. Saving realizado{mesReferencia ? ` ${mesReferenciaLabel}` : '/mês'}</span><strong>{formatarMoedaReajuste(resumo.reducaoImpactoRealizada)}</strong><small>solicitado - aplicado</small></div>
        </div>

        <div className="hint-box compact">
          <strong>Regra de cálculo:</strong> informe somente a Data_Inicio do reajuste. O previsto usa a média mensal dos meses anteriores à vigência. Ex.: início em 23/03 e base de 3 meses = frete de 23/12 a 22/03 dividido por 3. O realizado usa o volume da Data_Inicio até a data mais recente existente na base, mensaliza esse volume e calcula solicitado, repassado/aplicado e saving da negociação.
        </div>

        <div className="hint-box compact" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <strong>Persistência:</strong> {fontePersistencia === 'supabase' ? 'Supabase ativo' : 'Local deste navegador'}
            {ultimoSyncSupabase ? <span> • último sync {ultimoSyncSupabase}</span> : null}
            {sincronizandoSupabase ? <span> • salvando...</span> : null}
          </div>
          <button type="button" className="btn-secondary" onClick={sincronizarSupabaseAgora} disabled={sincronizandoSupabase}>
            {sincronizandoSupabase ? 'Salvando...' : 'Salvar no Supabase agora'}
          </button>
        </div>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">1. Importar, atualizar ou incluir reajuste</div>
            <p>Importe a aba Final antiga ou use o modelo simples para atualizar apenas o que já está na tela.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={exportarPreenchimento} disabled={!itens.length || carregando}>
              Exportar preenchimento
            </button>
            <button className="btn-secondary" type="button" onClick={() => setMostrarManual((prev) => !prev)}>
              {mostrarManual ? 'Fechar inclusão manual' : 'Incluir reajuste manual'}
            </button>
            <button className="btn-secondary" type="button" onClick={() => carregarNomesRealizado(true)} disabled={carregando}>
              Atualizar nomes do Realizado
            </button>
            <button className="btn-danger" type="button" onClick={limparTudo} disabled={!itens.length || carregando}>
              Limpar controle
            </button>
          </div>
        </div>

        <div className="form-grid two">
          <label className="field">Planilha de reajustes
            <input type="file" accept=".xlsx,.xls,.xlsm" onChange={(event) => setArquivo(event.target.files?.[0] || null)} />
          </label>
          <div className="actions-right" style={{ alignItems: 'end' }}>
            <button className="btn-primary" type="button" onClick={importarArquivo} disabled={carregando || !arquivo}>
              {carregando ? 'Processando...' : 'Importar arquivo'}
            </button>
          </div>
        </div>

        <div className="hint-box compact" style={{ marginTop: 12 }}>
          <strong>Modelo simples:</strong> clique em <strong>Exportar preenchimento</strong>, altere status, data, percentual aplicado, vínculo ou observação e importe o mesmo arquivo. O sistema atualiza os registros pelo ID oculto, sem depender da planilha pesada anterior.
        </div>

        {mostrarManual && (
          <div className="hint-box" style={{ marginTop: 14 }}>
            <div className="form-grid three">
              <label className="field">Transportadora
                <input value={manual.transportadoraInformada} onChange={(event) => setManual((prev) => ({ ...prev, transportadoraInformada: event.target.value }))} placeholder="Ex.: ALFA" />
              </label>
              <label className="field">Canal
                <select value={manual.canal} onChange={(event) => setManual((prev) => ({ ...prev, canal: event.target.value }))}>
                  {CANAIS_OPTIONS.map((canal) => <option key={canal || 'todos'} value={canal}>{canal || 'Sem canal'}</option>)}
                </select>
              </label>
              <label className="field">Data início
                <input type="date" value={manual.dataInicio} onChange={(event) => setManual((prev) => ({ ...prev, dataInicio: event.target.value }))} />
              </label>
            </div>
            <div className="form-grid three">
              <label className="field">Solicitado %
                <input value={manual.reajusteSolicitado} onChange={(event) => setManual((prev) => ({ ...prev, reajusteSolicitado: event.target.value }))} placeholder="Ex.: 10%" />
              </label>
              <label className="field">Aplicado %
                <input value={manual.reajusteAplicado} onChange={(event) => setManual((prev) => ({ ...prev, reajusteAplicado: event.target.value }))} placeholder="Ex.: 5%" />
              </label>
              <label className="field">Status
                <select value={manual.status} onChange={(event) => setManual((prev) => ({ ...prev, status: event.target.value }))}>
                  {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
            </div>
            <label className="field">Observação
              <textarea value={manual.observacao} onChange={(event) => setManual((prev) => ({ ...prev, observacao: event.target.value }))} rows={2} placeholder="Ex.: negociação aprovada pela diretoria..." />
            </label>
            <div className="actions-right">
              <button type="button" className="btn-primary" onClick={adicionarManual}>Adicionar reajuste</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">2. Base automática, filtros e cálculo</div>
            <p>Informe a data de início em cada reajuste. O sistema busca automaticamente a base anterior e mede o realizado depois da vigência.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={tentarVincular} disabled={!itens.length || carregando}>Sugerir vínculos</button>
            <button className="btn-secondary" type="button" onClick={exportarRelatorio} disabled={!itens.length}>Exportar relatório</button>
            <button className="btn-primary" type="button" onClick={calcularImpacto} disabled={!itens.length || carregando}>
              {carregando ? 'Calculando...' : 'Calcular impacto'}
            </button>
          </div>
        </div>

        <div className="form-grid three">
          <label className="field">Base anterior para previsão
            <select value={String(config.mesesBaseImpacto || 3)} onChange={(event) => setConfig((prev) => ({ ...prev, mesesBaseImpacto: Number(event.target.value) }))}>
              <option value="1">1 mês anterior à vigência</option>
              <option value="2">2 meses anteriores à vigência</option>
              <option value="3">3 meses anteriores à vigência</option>
            </select>
          </label>
          <label className="field">Última data base CT-es
            <input
              value={resumo.ultimaDataRealizado ? formatDate(resumo.ultimaDataRealizado) : 'Sem cálculo ainda'}
              readOnly
              title="Data mais recente encontrada na base de CT-es durante o último cálculo de impacto. Não é editável — reflete o que há na base. Se anterior à data de início dos reajustes, o realizado ficará zerado."
            />
          </label>
          <label className="field">Busca
            <input value={filtroTexto} onChange={(event) => setFiltroTexto(event.target.value)} placeholder="Transportadora, vínculo, observação..." />
          </label>
        </div>

        <div className="form-grid three">
          <label className="field">Mês de referência (realizado)
            <select value={mesReferencia} onChange={(event) => setMesReferencia(event.target.value)}>
              <option value="">Todo o período (mensalizado)</option>
              {mesesRealizadoDisponiveis.map((mes) => (
                <option key={mes} value={mes}>{formatarMesReferencia(mes)}</option>
              ))}
            </select>
          </label>
          <label className="field">Status
            <select value={filtroStatus} onChange={(event) => setFiltroStatus(event.target.value)}>
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={somenteEfetivados} onChange={(event) => setSomenteEfetivados(event.target.checked)} />
            Mostrar apenas reajustes efetivados/vigentes
          </label>
        </div>

        <div className="hint-box compact" style={{ marginTop: 8 }}>
          {mesReferencia
            ? <>Filtrando o realizado pelo <strong>mês civil de {mesReferenciaLabel}</strong> (do dia 1 ao último dia do mês, a partir da Data_Inicio de cada reajuste). O valor exibido é o total do mês, sem mensalização. O previsto continua sendo a média mensal da base anterior, para comparação.</>
            : <>Sem período manual: cada linha usa sua própria Data_Inicio para formar a base anterior e medir o realizado. Selecione um <strong>mês de referência</strong> acima para isolar o impacto realizado de um mês civil específico.</>}
        </div>

        {resumo.ultimaDataRealizado && minDataInicioReajuste && resumo.ultimaDataRealizado < minDataInicioReajuste && (
          <div className="hint-box compact" style={{ marginTop: 10, background: '#fff3cd', borderColor: '#ffc107', color: '#856404' }}>
            <strong>Por que o realizado está zerado?</strong>{' '}
            A consulta retornou CT-es até <strong>{formatDate(resumo.ultimaDataRealizado)}</strong>,
            mas os reajustes iniciam a partir de <strong>{formatDate(minDataInicioReajuste)}</strong>.{' '}
            Possíveis causas: <strong>(1)</strong> O RPC <code>reajustes_realizado_diario_local</code> no Supabase ainda tem o filtro antigo de canal —
            aplique o arquivo <code>supabase/reajustes_realizado_local_rpc.sql</code> no SQL Editor do Supabase para corrigir.{' '}
            <strong>(2)</strong> A tabela <code>realizado_local_ctes</code> realmente não possui CT-es após {formatDate(minDataInicioReajuste)} — verifique no Supabase.{' '}
            Após aplicar o SQL, clique em <strong>Calcular impacto</strong> novamente.
          </div>
        )}

        {diagRealizado && (
          <div className="hint-box compact" style={{ marginTop: 8, background: '#e8f4fd', borderColor: '#2196f3', color: '#0d47a1', fontSize: '0.82em' }}>
            <strong>Diagnóstico da última consulta de CT-es</strong>{' '}
            (calculado em {new Date(diagRealizado.calculadoEm).toLocaleTimeString('pt-BR')}):
            {' '}<strong>{diagRealizado.totalCompativel.toLocaleString('pt-BR')}</strong> CT-e(s) encontrado(s)
            {diagRealizado.primeiraData && diagRealizado.ultimaData
              ? <> no período <strong>{formatDate(diagRealizado.primeiraData)}</strong> — <strong>{formatDate(diagRealizado.ultimaData)}</strong></>
              : ' (sem data identificada)'}
            {' '}· Fonte: <strong>{diagRealizado.origem}</strong>
            {' '}· Início consulta: <strong>{formatDate(diagRealizado.consultaInicio)}</strong>
            {diagRealizado.totalRows !== diagRealizado.totalCompativel
              ? <> · Linhas brutas: {diagRealizado.totalRows.toLocaleString('pt-BR')}</>
              : null}
          </div>
        )}
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Painel de impacto</div>
            <p className="compact">Evolução mensal do impacto, comparativo previsto × realizado e ranking dos reajustes com maior peso. Fonte única: série mensal usada também no relatório (aba Impacto_Mensal).</p>
          </div>
          {dashboard.melhorMes ? (
            <span className="pill-soft">Maior realizado: {dashboard.melhorMes.mesLabel} • {formatarMoedaReajuste(dashboard.melhorMes.impactoRealizadoRepassado)}</span>
          ) : null}
        </div>

        <div className="summary-strip lotacao-summary-mini">
          <div className="summary-card"><span>Reajustes vigentes</span><strong>{dashboard.reajustesVigentes.toLocaleString('pt-BR')}</strong><small>com início até hoje</small></div>
          <div className="summary-card"><span>Meses com realizado</span><strong>{dashboard.mesesComRealizado.toLocaleString('pt-BR')}</strong><small>{dashboard.ctesAcum.toLocaleString('pt-BR')} CT-es no total</small></div>
          <div className="summary-card"><span>Previsto repassado acumulado</span><strong>{formatarMoedaReajuste(dashboard.previstoRepassadoAcum)}</strong><small>referência mensal somada</small></div>
          <div className="summary-card"><span>Realizado repassado acumulado</span><strong>{formatarMoedaReajuste(dashboard.realizadoRepassadoAcum)}</strong><small>medido na base de CT-es</small></div>
          <div className="summary-card"><span>Aderência realizado × previsto</span><strong>{formatarPercentualReajuste(dashboard.aderencia)}</strong><small>realizado ÷ previsto</small></div>
          <div className="summary-card"><span>Saving realizado acumulado</span><strong>{formatarMoedaReajuste(dashboard.savingRealizadoAcum)}</strong><small>solicitado − repassado</small></div>
        </div>

        <div className="form-grid two" style={{ marginTop: 14, alignItems: 'start' }}>
          <div className="hint-box" style={{ margin: 0 }}>
            <div className="panel-title" style={{ fontSize: 15 }}>Evolução do impacto realizado por mês</div>
            <GraficoBarrasMensal
              dados={dashboard.meses}
              barras={[
                { key: 'impactoRealizadoRepassado', cor: '#0b1f52', nome: 'Realizado repassado' },
                { key: 'savingRealizado', cor: '#16a34a', nome: 'Saving realizado' },
              ]}
              formatar={formatarMoedaReajuste}
            />
          </div>
          <div className="hint-box" style={{ margin: 0 }}>
            <div className="panel-title" style={{ fontSize: 15 }}>Previsto × realizado (repassado) por mês</div>
            <GraficoBarrasMensal
              dados={dashboard.meses}
              barras={[
                { key: 'impactoPrevistoRepassado', cor: '#94a3b8', nome: 'Previsto (referência)' },
                { key: 'impactoRealizadoRepassado', cor: '#2563eb', nome: 'Realizado' },
              ]}
              formatar={formatarMoedaReajuste}
            />
          </div>
        </div>

        <div className="hint-box" style={{ marginTop: 14 }}>
          <div className="section-row compact-top">
            <div className="panel-title" style={{ fontSize: 15 }}>
              Classificação por impacto — top {ranking.linhas.length} ({ranking.usarRealizado ? 'realizado' : 'previsto'} repassado)
            </div>
          </div>
          {ranking.linhas.length ? (
            <div className="sim-analise-tabela-wrap" style={{ maxHeight: 320 }}>
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Transportadora</th>
                    <th>Previsto repassado/mês</th>
                    <th>Realizado repassado</th>
                    <th>Saving realizado</th>
                    <th>% do total</th>
                    <th>% acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.linhas.map((linha, indice) => (
                    <tr key={`${linha.nome}-${indice}`}>
                      <td>{indice + 1}</td>
                      <td>
                        <strong>{linha.nome}</strong>
                        <small style={{ display: 'block', color: '#64748b' }}>{linha.canal || 'Sem canal'}</small>
                      </td>
                      <td>{formatarMoedaReajuste(linha.previsto)}</td>
                      <td><strong>{formatarMoedaReajuste(linha.realizado)}</strong></td>
                      <td>{formatarMoedaReajuste(linha.savingRealizado)}</td>
                      <td>{formatarPercentualReajuste(linha.percentual)}</td>
                      <td>
                        {formatarPercentualReajuste(linha.percentualAcumulado)}
                        {linha.percentualAcumulado <= 0.8 ? <span className="pill-soft" style={{ marginLeft: 6, padding: '1px 6px' }}>Pareto</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="compact" style={{ color: '#64748b' }}>Nenhum reajuste com impacto calculado ainda. Informe a Data_Inicio, vincule a transportadora e calcule o impacto.</p>
          )}
        </div>
      </section>

      <PainelVinculo
        item={itemVinculoAtivo}
        opcoesRealizado={opcoesRealizado}
        busca={buscasVinculo[vinculoAtivoId] || ''}
        onBusca={(valor) => alterarBuscaVinculo(vinculoAtivoId, valor)}
        onToggle={(nome, checked) => toggleVinculo(vinculoAtivoId, nome, checked)}
        onMarcar={(nomes) => setVinculosItem(vinculoAtivoId, [...(itemVinculoAtivo?.transportadorasRealizado || []), ...nomes])}
        onLimpar={() => setVinculosItem(vinculoAtivoId, [])}
        onFechar={() => setVinculoAtivoId(null)}
      />

      <section className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">3. Gestão dos reajustes</div>
            <p className="compact">Edite percentuais em formato visual. Exemplo: digite 8, 8% ou 8,5. O sistema grava como percentual correto.</p>
          </div>
          <span className="pill-soft">{itensFiltrados.length.toLocaleString('pt-BR')} linha(s)</span>
        </div>

        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Transportadora</th>
                <th>Vínculo Realizado</th>
                <th>Status</th>
                <th>Início</th>
                <th>Solicitado %</th>
                <th>Aplicado %</th>
                <th>Período base</th>
                <th>CT-es base</th>
                <th>Frete base médio/mês</th>
                <th>Previsto solicitado/mês</th>
                <th>Previsto repassado/mês</th>
                <th>Saving previsto/mês</th>
                <th>{mesReferencia ? `Período realizado (${mesReferenciaLabel})` : 'Período realizado'}</th>
                <th>CT-es realizado</th>
                <th>{`Realizado solicitado${sufixoRealizado}`}</th>
                <th>{`Realizado repassado${sufixoRealizado}`}</th>
                <th>{`Saving realizado${sufixoRealizado}`}</th>
                <th>% base</th>
                <th>% realizado</th>
                <th>Dif. p.p.</th>
                <th>Obs.</th>
              </tr>
            </thead>
            <tbody>
              {itensFiltrados.map((item) => {
                const edit = percentuaisEditando[item.id] || {};
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.transportadoraInformada}</strong>
                      <small style={{ display: 'block', color: '#64748b' }}>{item.canal || 'Sem canal'}</small>
                    </td>
                    <td>
                      <ResumoVinculoLinha
                        item={item}
                        opcoesRealizado={opcoesRealizado}
                        onEditar={() => setVinculoAtivoId(item.id)}
                      />
                    </td>
                    <td>
                      <select value={item.status || ''} onChange={(event) => alterarItem(item.id, 'status', event.target.value)}>
                        <option value="">-</option>
                        {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </td>
                    <td>
                      <input type="date" value={String(item.dataInicio || '').slice(0, 10)} onChange={(event) => alterarItem(item.id, 'dataInicio', event.target.value, { recalcularImpacto: true })} />
                    </td>
                    <td>
                      <input
                        type="text"
                        style={{ minWidth: 90 }}
                        value={edit.reajusteSolicitado ?? percentualParaInput(item.reajusteSolicitado)}
                        onChange={(event) => atualizarPercentualTemporario(setPercentuaisEditando, item.id, 'reajusteSolicitado', event.target.value)}
                        onBlur={(event) => salvarPercentualItem(item.id, 'reajusteSolicitado', event.target.value)}
                        placeholder="Ex.: 10%"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        style={{ minWidth: 90, fontWeight: 700 }}
                        value={edit.reajusteAplicado ?? percentualParaInput(item.reajusteAplicado)}
                        onChange={(event) => atualizarPercentualTemporario(setPercentuaisEditando, item.id, 'reajusteAplicado', event.target.value)}
                        onBlur={(event) => salvarPercentualItem(item.id, 'reajusteAplicado', event.target.value)}
                        placeholder="Ex.: 5%"
                      />
                    </td>
                    <td>
                      {periodoLabel(item.inicioImpactoBase, item.fimImpactoBase)}
                      <small style={{ display: 'block', color: '#64748b' }}>{toNumber(item.mesesBaseImpacto || config.mesesBaseImpacto || 3)} mês(es)</small>
                    </td>
                    <td>{toNumber(item.ctesPeriodo).toLocaleString('pt-BR')}</td>
                    <td>{formatarMoedaReajuste(item.valorFretePeriodo)}</td>
                    <td>{formatarMoedaReajuste(item.impactoPrevistoSolicitado)}</td>
                    <td><strong>{formatarMoedaReajuste(item.impactoPrevistoRepassado || item.impactoPrevisto || item.impactoPeriodo)}</strong></td>
                    <td><strong>{formatarMoedaReajuste(item.reducaoImpactoPrevisto)}</strong></td>
                    <td>
                      {periodoLabel(item.inicioImpactoRealizado || item.dataInicio, item.fimImpactoRealizado)}
                      <small style={{ display: 'block', color: '#64748b' }}>{item.diasRealizadosImpacto ? `${toNumber(item.diasRealizadosImpacto).toLocaleString('pt-BR')} dia(s)` : ''}</small>
                      {item.semRealizadoAposInicio && item.motivoRealizadoIndisponivel ? (
                        <small style={{ display: 'block', color: '#b45309', maxWidth: 220 }}>{item.motivoRealizadoIndisponivel}</small>
                      ) : null}
                    </td>
                    <td>{toNumber(item.ctesRealizadoReajuste).toLocaleString('pt-BR')}</td>
                    <td>{formatarMoedaReajuste(item.impactoRealizadoSolicitado)}</td>
                    <td><strong>{formatarMoedaReajuste(item.impactoRealizadoRepassado || item.impactoRealizado)}</strong></td>
                    <td><strong>{formatarMoedaReajuste(item.reducaoImpactoRealizada)}</strong></td>
                    <td>{item.percentualFreteAtual ? formatarPercentualReajuste(item.percentualFreteAtual) : '-'}</td>
                    <td>{item.percentualFreteRealizadoReajuste ? formatarPercentualReajuste(item.percentualFreteRealizadoReajuste) : '-'}</td>
                    <td>{item.variacaoPercentualFreteRealizado ? formatarPercentualReajuste(item.variacaoPercentualFreteRealizado) : '-'}</td>
                    <td style={{ minWidth: 280 }}>
                      <textarea value={item.observacao || ''} onChange={(event) => alterarItem(item.id, 'observacao', event.target.value)} rows={2} />
                    </td>
                  </tr>
                );
              })}
              {!itensFiltrados.length && <tr><td colSpan="21">Nenhum reajuste carregado ou compatível com o filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
