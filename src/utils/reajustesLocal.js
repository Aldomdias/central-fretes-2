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
    transportadorasRealizado: [],
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
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      ...item,
      transportadorasRealizado: Array.isArray(item.transportadorasRealizado)
        ? item.transportadorasRealizado
        : item.transportadoraSistema
          ? [item.transportadoraSistema]
          : [],
    }));
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
  return { inicio: '', fim: '' };
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

function normalizarListaNomes(nomes = []) {
  return (nomes || [])
    .map((item) => (typeof item === 'string' ? item : item?.nome || item?.transportadora || item?.label || ''))
    .map((nome) => String(nome || '').trim())
    .filter(Boolean)
    .filter((nome, index, arr) => arr.findIndex((n) => normalizarTextoReajuste(n) === normalizarTextoReajuste(nome)) === index)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function detectarMelhoresVinculos(nome, nomesRealizado = [], limite = 8) {
  const nomeNorm = normalizarTextoReajuste(nome);
  if (!nomeNorm) return [];

  const opcoes = normalizarListaNomes(nomesRealizado).map((nomeOpcao) => ({
    nome: nomeOpcao,
    norm: normalizarTextoReajuste(nomeOpcao),
  }));

  const palavras = nomeNorm.split(' ').filter((p) => p.length >= 3);
  const scored = opcoes.map((item) => {
    const a = item.norm;
    const b = nomeNorm;
    let score = 0;

    if (a === b) score = 1;
    else if (a.includes(b) || b.includes(a)) score = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    else if (palavras.length) score = palavras.filter((p) => a.includes(p)).length / palavras.length;

    return { ...item, score };
  })
    .filter((item) => item.score >= 0.45)
    .sort((a, b) => b.score - a.score || a.nome.localeCompare(b.nome, 'pt-BR'));

  return scored.slice(0, limite).map((item) => item.nome);
}

export function detectarMelhorVinculo(nome, nomesRealizado = []) {
  return detectarMelhoresVinculos(nome, nomesRealizado, 1)[0] || '';
}

export function aplicarVinculoAutomatico(itens = [], nomesRealizado = []) {
  return (itens || []).map((item) => {
    const atuais = Array.isArray(item.transportadorasRealizado) ? item.transportadorasRealizado.filter(Boolean) : [];
    if (atuais.length) return item;
    const candidatos = detectarMelhoresVinculos(item.transportadoraInformada, nomesRealizado, 5);
    return {
      ...item,
      transportadorasRealizado: candidatos,
      transportadoraSistema: candidatos.join(' | '),
    };
  });
}

function nomesPossiveis(item = {}) {
  const selecionados = Array.isArray(item.transportadorasRealizado)
    ? item.transportadorasRealizado.map(normalizarTextoReajuste).filter(Boolean)
    : [];

  if (selecionados.length) return { nomes: selecionados, usarExato: true };

  return {
    nomes: [item.transportadoraSistema, item.transportadoraInformada]
      .map(normalizarTextoReajuste)
      .filter(Boolean),
    usarExato: false,
  };
}

function rowPertenceAoItem(rowNorm, nomes = [], usarExato = false) {
  if (!rowNorm || !nomes.length) return false;
  if (usarExato) return nomes.includes(rowNorm);
  return nomes.some((nome) => rowNorm === nome || rowNorm.includes(nome) || nome.includes(rowNorm));
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
    const { nomes, usarExato } = nomesPossiveis(item);
    const linhas = realizadosNorm.filter((row) => rowPertenceAoItem(row.transportadoraNorm, nomes, usarExato));
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
      vinculado: Boolean((item.transportadorasRealizado || []).length || item.transportadoraSistema || linhas.length),
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
  const semVinculo = itens.filter((item) => !(Array.isArray(item.transportadorasRealizado) && item.transportadorasRealizado.length) && !item.transportadoraSistema).length;
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
