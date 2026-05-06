import * as XLSX from 'xlsx';

const STORAGE_KEY = 'central_fretes_reajustes_v1';
const CONFIG_KEY = 'central_fretes_reajustes_config_v1';

function uid(prefix = 'rj') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizarTextoReajuste(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text || /nao|não|sem|n\/a/i.test(text)) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercent(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return value > 1 ? value / 100 : value;
  }
  const text = String(value).trim();
  if (!text || /nao|não|sem|n\/a/i.test(text)) return 0;
  const numeric = toNumber(text);
  return numeric > 1 ? numeric / 100 : numeric;
}

function excelDateToIso(value) {
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
  return raw;
}

function pick(row = {}, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name];
  }
  return '';
}

function reajusteBase(row = {}) {
  return parsePercent(
    pick(
      row,
      'PROPOSTA FINAL',
      'Reajuste 1ª Parcela',
      'REAJUSTE SOLICITADO',
      'REAJUSTE INICIAL%',
      'REAJUSTE FINAL%',
      'REAJUSTE EMERGENCIAL',
      'REAJUSTE ANUAL'
    )
  );
}

function mapFinalRow(row = {}, index = 0) {
  const solicitadoRaw = pick(row, 'REAJUSTE SOLICITADO', 'REAJUSTE INICIAL%', 'REAJUSTE ANUAL', 'REAJUSTE EMERGENCIAL');
  const propostaRaw = pick(row, 'PROPOSTA FINAL', 'REAJUSTE FINAL%');
  const reajusteAplicado = parsePercent(propostaRaw) || parsePercent(pick(row, 'Reajuste 1ª Parcela')) || parsePercent(solicitadoRaw);
  const nome = String(pick(row, 'TRANSPORTADORA', 'Transportadora') || '').trim();

  return {
    id: uid('reajuste'),
    origemImportacao: 'Final',
    linhaOrigem: index + 2,
    emergencial: String(pick(row, 'EMERGENCIAL') || '').trim(),
    canal: String(pick(row, 'CANAL') || '').trim(),
    transportadoraInformada: nome,
    transportadoraSistema: '',
    dataInicio: excelDateToIso(pick(row, 'DATA INICIO', 'DATA DA SOLICITAÇÃO')),
    dataSolicitacao: excelDateToIso(pick(row, 'DATA DA SOLICITAÇÃO')),
    reajusteSolicitadoTexto: String(solicitadoRaw || '').trim(),
    reajusteSolicitado: parsePercent(solicitadoRaw),
    reajustePrimeiraParcela: parsePercent(pick(row, 'Reajuste 1ª Parcela')),
    dataPrimeiraParcela: excelDateToIso(pick(row, 'Data 1ª Parcela')),
    reajusteSegundaParcela: parsePercent(pick(row, 'Reajuste 2ª Parcela')),
    dataSegundaParcela: excelDateToIso(pick(row, 'Data 2ª Parcela')),
    propostaFinal: parsePercent(propostaRaw),
    reajusteAplicado,
    status: row['NEGOCIAÇÃO'] || (reajusteAplicado ? 'EM ANÁLISE' : 'PENDENTE'),
    representatividade: parsePercent(pick(row, 'Representatividade')),
    valorCtePlanilha: toNumber(pick(row, 'VALOR CTE')),
    faturamentoMedioPlanilha: toNumber(pick(row, 'Faturamento Médio', 'IMPACTO MÊS')),
    impactoEmergencialPlanilha: toNumber(pick(row, 'IMPACTO EMERGENCIAL')),
    impactoAnttPlanilha: toNumber(pick(row, 'IMPACTO ANTT')),
    impactoReajustePlanilha: toNumber(pick(row, 'IMPACTO REAJUSTE')),
    percentualAtualRealizado: parsePercent(pick(row, '% Atual Realizado')),
    percentualComReajuste: parsePercent(pick(row, '% Com Reajuste')),
    observacao: String(pick(row, 'OBSERVAÇÃO', 'OBSERVACAO') || '').trim(),
    ativo: Boolean(nome),
    criadoEm: new Date().toISOString(),
  };
}

export async function importarControleReajustes(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames.find((name) => normalizarTextoReajuste(name) === 'FINAL') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  const itens = rows
    .map(mapFinalRow)
    .filter((item) => item.transportadoraInformada);

  return {
    sheetName,
    total: itens.length,
    itens,
  };
}

export function carregarReajustes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function salvarReajustes(itens = []) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(itens || []));
  return itens;
}

export function carregarConfigReajustes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return {
    inicio: '',
    fim: '',
  };
}

export function salvarConfigReajustes(config = {}) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config || {}));
  return config;
}

export function mesAtualPadrao() {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  return {
    inicio: inicio.toISOString().slice(0, 10),
    fim: fim.toISOString().slice(0, 10),
  };
}

export function detectarMelhorVinculo(nome, transportadoras = []) {
  const nomeNorm = normalizarTextoReajuste(nome);
  if (!nomeNorm) return '';
  const opcoes = (transportadoras || []).map((item) => ({
    id: item.id,
    nome: item.nome,
    norm: normalizarTextoReajuste(item.nome),
  })).filter((item) => item.nome);

  const exato = opcoes.find((item) => item.norm === nomeNorm);
  if (exato) return exato.nome;

  const contem = opcoes
    .map((item) => {
      const a = item.norm;
      const b = nomeNorm;
      const score = a.includes(b) || b.includes(a)
        ? Math.min(a.length, b.length) / Math.max(a.length, b.length)
        : 0;
      return { ...item, score };
    })
    .filter((item) => item.score >= 0.45)
    .sort((a, b) => b.score - a.score)[0];

  if (contem) return contem.nome;

  const palavras = nomeNorm.split(' ').filter((p) => p.length >= 3);
  const fuzzy = opcoes
    .map((item) => {
      const score = palavras.length ? palavras.filter((p) => item.norm.includes(p)).length / palavras.length : 0;
      return { ...item, score };
    })
    .filter((item) => item.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.nome.localeCompare(b.nome))[0];

  return fuzzy?.nome || '';
}

export function aplicarVinculoAutomatico(itens = [], transportadoras = []) {
  return (itens || []).map((item) => {
    if (item.transportadoraSistema) return item;
    return {
      ...item,
      transportadoraSistema: detectarMelhorVinculo(item.transportadoraInformada, transportadoras),
    };
  });
}

function nomesPossiveis(item = {}) {
  return [item.transportadoraSistema, item.transportadoraInformada]
    .map(normalizarTextoReajuste)
    .filter(Boolean);
}

export function calcularImpactosReajustes(itens = [], realizados = []) {
  const realizadosNorm = (realizados || []).map((row) => ({
    ...row,
    transportadoraNorm: normalizarTextoReajuste(row.transportadora || row.nomeTransportadora || row.transportadoraRealizada),
    valorCteNum: toNumber(row.valorCte || row.valorCTe || row.valorFrete || row.freteRealizado),
    valorNfNum: toNumber(row.valorNF || row.valorNf || row.valorNota),
    pesoNum: toNumber(row.peso || row.pesoDeclarado || row.pesoConsiderado),
  }));

  return (itens || []).map((item) => {
    const nomes = nomesPossiveis(item);
    const linhas = realizadosNorm.filter((row) => nomes.some((nome) => row.transportadoraNorm === nome || row.transportadoraNorm.includes(nome) || nome.includes(row.transportadoraNorm)));
    const valorFretePeriodo = linhas.reduce((acc, row) => acc + row.valorCteNum, 0);
    const valorNFPeriodo = linhas.reduce((acc, row) => acc + row.valorNfNum, 0);
    const pesoPeriodo = linhas.reduce((acc, row) => acc + row.pesoNum, 0);
    const ctesPeriodo = linhas.length;
    const pct = toNumber(item.reajusteAplicado) || reajusteBase(item);
    const impactoPeriodo = valorFretePeriodo * pct;
    const freteComReajuste = valorFretePeriodo + impactoPeriodo;
    const percentualFreteAtual = valorNFPeriodo ? valorFretePeriodo / valorNFPeriodo : 0;
    const percentualFreteComReajuste = valorNFPeriodo ? freteComReajuste / valorNFPeriodo : 0;

    return {
      ...item,
      ctesPeriodo,
      valorFretePeriodo,
      valorNFPeriodo,
      pesoPeriodo,
      reajusteAplicado: pct,
      impactoPeriodo,
      freteComReajuste,
      percentualFreteAtual,
      percentualFreteComReajuste,
      vinculado: Boolean(item.transportadoraSistema || linhas.length),
    };
  });
}

export function isEfetivado(item = {}, fimPeriodo = '') {
  const status = normalizarTextoReajuste(item.status);
  const temStatus = ['APROVADO', 'EFETIVADO', 'APLICADO', 'VIGENTE'].some((s) => status.includes(s));
  const dataInicio = String(item.dataInicio || item.dataPrimeiraParcela || '').slice(0, 10);
  const dataOk = dataInicio && (!fimPeriodo || dataInicio <= fimPeriodo);
  return Boolean((temStatus || dataOk) && toNumber(item.reajusteAplicado) > 0);
}

export function resumoReajustes(itens = [], fimPeriodo = '') {
  const totalSolicitados = itens.length;
  const efetivados = itens.filter((item) => isEfetivado(item, fimPeriodo));
  const semVinculo = itens.filter((item) => !item.transportadoraSistema).length;
  const impactoTotal = itens.reduce((acc, item) => acc + toNumber(item.impactoPeriodo), 0);
  const impactoEfetivado = efetivados.reduce((acc, item) => acc + toNumber(item.impactoPeriodo), 0);
  const freteBase = itens.reduce((acc, item) => acc + toNumber(item.valorFretePeriodo), 0);
  return {
    totalSolicitados,
    totalEfetivados: efetivados.length,
    semVinculo,
    impactoTotal,
    impactoEfetivado,
    freteBase,
  };
}

export function formatarPercentualReajuste(value) {
  const n = toNumber(value);
  return `${(n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function formatarMoedaReajuste(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
