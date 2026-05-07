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

export function parsePercentReajuste(value) {
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
  return parsePercentReajuste(
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
  const reajusteAplicado = parsePercentReajuste(propostaRaw) || parsePercentReajuste(pick(row, 'Reajuste 1ª Parcela')) || parsePercentReajuste(solicitadoRaw);
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
    reajusteSolicitado: parsePercentReajuste(solicitadoRaw),
    reajustePrimeiraParcela: parsePercentReajuste(pick(row, 'Reajuste 1ª Parcela')),
    dataPrimeiraParcela: excelDateToIso(pick(row, 'Data 1ª Parcela')),
    reajusteSegundaParcela: parsePercentReajuste(pick(row, 'Reajuste 2ª Parcela')),
    dataSegundaParcela: excelDateToIso(pick(row, 'Data 2ª Parcela')),
    propostaFinal: parsePercentReajuste(propostaRaw),
    reajusteAplicado,
    status: row['NEGOCIAÇÃO'] || (reajusteAplicado ? 'EM ANÁLISE' : 'PENDENTE'),
    representatividade: parsePercentReajuste(pick(row, 'Representatividade')),
    valorCtePlanilha: toNumber(pick(row, 'VALOR CTE')),
    faturamentoMedioPlanilha: toNumber(pick(row, 'Faturamento Médio', 'IMPACTO MÊS')),
    impactoEmergencialPlanilha: toNumber(pick(row, 'IMPACTO EMERGENCIAL')),
    impactoAnttPlanilha: toNumber(pick(row, 'IMPACTO ANTT')),
    impactoReajustePlanilha: toNumber(pick(row, 'IMPACTO REAJUSTE')),
    percentualAtualRealizado: parsePercentReajuste(pick(row, '% Atual Realizado')),
    percentualComReajuste: parsePercentReajuste(pick(row, '% Com Reajuste')),
    observacao: String(pick(row, 'OBSERVAÇÃO', 'OBSERVACAO') || '').trim(),
    ativo: Boolean(nome),
    criadoEm: new Date().toISOString(),
  };
}

export function criarReajusteManual(dados = {}) {
  const nome = String(dados.transportadoraInformada || dados.transportadora || '').trim();
  if (!nome) throw new Error('Informe a transportadora do reajuste.');
  const solicitado = parsePercentReajuste(dados.reajusteSolicitado);
  const aplicado = parsePercentReajuste(dados.reajusteAplicado || dados.reajusteSolicitado);
  return {
    id: uid('reajuste'),
    origemImportacao: 'Manual',
    linhaOrigem: '',
    emergencial: '',
    canal: String(dados.canal || '').trim(),
    transportadoraInformada: nome,
    transportadoraSistema: '',
    transportadorasRealizado: [],
    dataInicio: excelDateToIso(dados.dataInicio),
    dataSolicitacao: excelDateToIso(dados.dataSolicitacao) || new Date().toISOString().slice(0, 10),
    reajusteSolicitadoTexto: solicitado ? `${(solicitado * 100).toLocaleString('pt-BR')}%` : '',
    reajusteSolicitado: solicitado,
    reajustePrimeiraParcela: 0,
    dataPrimeiraParcela: '',
    reajusteSegundaParcela: 0,
    dataSegundaParcela: '',
    propostaFinal: aplicado,
    reajusteAplicado: aplicado,
    status: dados.status || 'EM ANÁLISE',
    representatividade: 0,
    valorCtePlanilha: 0,
    faturamentoMedioPlanilha: 0,
    impactoEmergencialPlanilha: 0,
    impactoAnttPlanilha: 0,
    impactoReajustePlanilha: 0,
    percentualAtualRealizado: 0,
    percentualComReajuste: 0,
    observacao: String(dados.observacao || '').trim(),
    ativo: true,
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
  return { mesesBaseImpacto: 3 };
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
    mesesBaseImpacto: 3,
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


function dataRealizadoRow(row = {}) {
  const value = row.data || row.dataEmissao || row.dataEmissaoCte || row.emissao || row.competencia || row.mes;
  const raw = String(value || '').slice(0, 10);
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^20\d{2}-\d{2}$/.test(raw)) return `${raw}-01`;
  return '';
}

function filtrarPorData(rows = [], inicio = '', fim = '') {
  const inicioIso = String(inicio || '').slice(0, 10);
  const fimIso = String(fim || '').slice(0, 10);
  if (!inicioIso && !fimIso) return rows;
  return rows.filter((row) => {
    const data = dataRealizadoRow(row);
    if (!data) return true;
    if (inicioIso && data < inicioIso) return false;
    if (fimIso && data > fimIso) return false;
    return true;
  });
}


function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  return '';
}

function dateFromIso(value) {
  const iso = isoDate(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function addDaysIso(value, days) {
  const date = dateFromIso(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return toIsoDate(date);
}

function mesesBaseImpacto(periodo = {}) {
  const raw = Number(periodo.mesesBaseImpacto || periodo.mesesBase || 3);
  if (!Number.isFinite(raw) || raw <= 0) return 3;
  return Math.min(Math.max(1, Math.round(raw)), 12);
}

function dataInicioItem(item = {}) {
  return isoDate(item.dataInicio || item.dataPrimeiraParcela || '');
}

function addMonthsIso(value, months) {
  const date = dateFromIso(value);
  if (!date) return '';
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

function diffDaysInclusive(inicio = '', fim = '') {
  const start = dateFromIso(inicio);
  const end = dateFromIso(fim);
  if (!start || !end || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function mesesEquivalentes(inicio = '', fim = '') {
  const dias = diffDaysInclusive(inicio, fim);
  if (!dias) return 0;
  return dias / 30;
}

function calcularJanelaItem(item = {}, periodo = {}, ultimaDataRealizado = '') {
  const inicio = dataInicioItem(item);
  const meses = mesesBaseImpacto(periodo);

  if (!inicio) {
    return {
      inicioBase: '',
      fimBase: '',
      inicioRealizado: '',
      fimRealizado: '',
      meses,
      temDataInicio: false,
      diasRealizados: 0,
      mesesRealizados: 0,
    };
  }

  const fimRealizado = ultimaDataRealizado && ultimaDataRealizado >= inicio ? ultimaDataRealizado : '';
  const diasRealizados = fimRealizado ? diffDaysInclusive(inicio, fimRealizado) : 0;

  return {
    inicioBase: addMonthsIso(inicio, -meses),
    fimBase: addDaysIso(inicio, -1),
    inicioRealizado: inicio,
    fimRealizado,
    meses,
    temDataInicio: true,
    diasRealizados,
    mesesRealizados: mesesEquivalentes(inicio, fimRealizado),
  };
}

export function obterPeriodoConsultaImpactoReajustes(itens = [], periodo = {}) {
  const inicios = [];

  (itens || []).forEach((item) => {
    const janela = calcularJanelaItem(item, periodo);
    if (janela.inicioBase) inicios.push(janela.inicioBase);
  });

  return {
    inicio: inicios.length ? inicios.sort()[0] : '',
    fim: '',
  };
}

export function calcularImpactosReajustes(itens = [], realizados = [], periodo = {}) {
  const realizadosNorm = (realizados || []).map((row) => ({
    ...row,
    dataRealizado: dataRealizadoRow(row),
    transportadoraNorm: normalizarTextoReajuste(row.transportadora || row.nomeTransportadora || row.transportadoraRealizada),
    valorCteNum: toNumber(row.valorCte || row.valorCTe || row.valorFrete || row.freteRealizado),
    valorNfNum: toNumber(row.valorNF || row.valorNf || row.valorNota),
    pesoNum: toNumber(row.peso || row.pesoDeclarado || row.pesoConsiderado),
  })).filter((row) => row.dataRealizado);

  const ultimaDataRealizado = realizadosNorm
    .map((row) => row.dataRealizado)
    .filter(Boolean)
    .sort()
    .at(-1) || '';

  return (itens || []).map((item) => {
    const { nomes, usarExato } = nomesPossiveis(item);
    const linhasTransportadora = realizadosNorm.filter((row) => rowPertenceAoItem(row.transportadoraNorm, nomes, usarExato));
    const janela = calcularJanelaItem(item, periodo, ultimaDataRealizado);

    const linhasBase = janela.temDataInicio ? filtrarPorData(linhasTransportadora, janela.inicioBase, janela.fimBase) : [];
    const linhasRealizadoReajuste = janela.inicioRealizado && janela.fimRealizado
      ? filtrarPorData(linhasTransportadora, janela.inicioRealizado, janela.fimRealizado)
      : [];

    const valorFreteBaseTotal = linhasBase.reduce((acc, row) => acc + row.valorCteNum, 0);
    const valorNFBaseTotal = linhasBase.reduce((acc, row) => acc + row.valorNfNum, 0);
    const pesoBaseTotal = linhasBase.reduce((acc, row) => acc + row.pesoNum, 0);
    const ctesPeriodo = linhasBase.length;

    const mesesBase = Math.max(Number(janela.meses || mesesBaseImpacto(periodo)), 1);
    const valorFretePeriodo = valorFreteBaseTotal / mesesBase;
    const valorNFPeriodo = valorNFBaseTotal / mesesBase;
    const pesoPeriodo = pesoBaseTotal / mesesBase;

    const valorFreteRealizadoTotal = linhasRealizadoReajuste.reduce((acc, row) => acc + row.valorCteNum, 0);
    const valorNFRealizadoTotal = linhasRealizadoReajuste.reduce((acc, row) => acc + row.valorNfNum, 0);
    const pesoRealizadoTotal = linhasRealizadoReajuste.reduce((acc, row) => acc + row.pesoNum, 0);
    const ctesRealizadoReajuste = linhasRealizadoReajuste.length;

    const mesesRealizados = janela.mesesRealizados > 0 ? janela.mesesRealizados : 0;
    const valorFreteRealizadoReajuste = mesesRealizados ? valorFreteRealizadoTotal / mesesRealizados : 0;
    const valorNFRealizadoReajuste = mesesRealizados ? valorNFRealizadoTotal / mesesRealizados : 0;
    const pesoRealizadoReajuste = mesesRealizados ? pesoRealizadoTotal / mesesRealizados : 0;

    const pctSolicitado = toNumber(item.reajusteSolicitado) || reajusteBase(item);
    const pctRepassado = toNumber(item.reajusteAplicado) || toNumber(item.propostaFinal) || pctSolicitado;
    const pctReducao = Math.max(pctSolicitado - pctRepassado, 0);

    const impactoPrevistoSolicitado = valorFretePeriodo * pctSolicitado;
    const impactoPrevistoRepassado = valorFretePeriodo * pctRepassado;
    const reducaoImpactoPrevisto = Math.max(impactoPrevistoSolicitado - impactoPrevistoRepassado, 0);

    const impactoRealizadoSolicitado = valorFreteRealizadoReajuste * pctSolicitado;
    const impactoRealizadoRepassado = valorFreteRealizadoReajuste * pctRepassado;
    const reducaoImpactoRealizada = Math.max(impactoRealizadoSolicitado - impactoRealizadoRepassado, 0);

    const impactoRealizadoTotalSolicitado = valorFreteRealizadoTotal * pctSolicitado;
    const impactoRealizadoTotalRepassado = valorFreteRealizadoTotal * pctRepassado;
    const reducaoImpactoRealizadaTotal = Math.max(impactoRealizadoTotalSolicitado - impactoRealizadoTotalRepassado, 0);

    const freteComReajuste = valorFretePeriodo + impactoPrevistoRepassado;
    const freteRealizadoComReajuste = valorFreteRealizadoReajuste + impactoRealizadoRepassado;
    const percentualFreteAtual = valorNFPeriodo ? valorFretePeriodo / valorNFPeriodo : 0;
    const percentualFreteComReajuste = valorNFPeriodo ? freteComReajuste / valorNFPeriodo : 0;
    const percentualFreteRealizadoReajuste = valorNFRealizadoReajuste ? valorFreteRealizadoReajuste / valorNFRealizadoReajuste : 0;
    const percentualFreteRealizadoComReajuste = valorNFRealizadoReajuste ? freteRealizadoComReajuste / valorNFRealizadoReajuste : 0;
    const variacaoPercentualFreteRealizado = percentualFreteRealizadoReajuste - percentualFreteAtual;

    return {
      ...item,
      ctesPeriodo,
      valorFretePeriodo,
      valorNFPeriodo,
      pesoPeriodo,
      valorFreteBaseTotal,
      valorNFBaseTotal,
      pesoBaseTotal,
      reajusteSolicitado: pctSolicitado,
      reajusteAplicado: pctRepassado,
      percentualReducaoReajuste: pctReducao,
      impactoPrevistoSolicitado,
      impactoPrevistoRepassado,
      reducaoImpactoPrevisto,
      impactoPrevisto: impactoPrevistoRepassado,
      impactoPeriodo: impactoPrevistoRepassado,
      freteComReajuste,
      percentualFreteAtual,
      percentualFreteComReajuste,
      ctesRealizadoReajuste,
      valorFreteRealizadoReajuste,
      valorNFRealizadoReajuste,
      pesoRealizadoReajuste,
      valorFreteRealizadoTotal,
      valorNFRealizadoTotal,
      pesoRealizadoTotal,
      impactoRealizadoSolicitado,
      impactoRealizadoRepassado,
      reducaoImpactoRealizada,
      impactoRealizado: impactoRealizadoRepassado,
      impactoRealizadoTotalSolicitado,
      impactoRealizadoTotalRepassado,
      reducaoImpactoRealizadaTotal,
      percentualFreteRealizadoReajuste,
      percentualFreteRealizadoComReajuste,
      variacaoPercentualFreteRealizado,
      inicioImpactoBase: janela.inicioBase,
      fimImpactoBase: janela.fimBase,
      inicioImpactoRealizado: janela.inicioRealizado,
      fimImpactoRealizado: janela.fimRealizado,
      mesesBaseImpacto: janela.meses,
      diasRealizadosImpacto: janela.diasRealizados,
      mesesRealizadosImpacto: janela.mesesRealizados,
      ultimaDataRealizadoImpacto: ultimaDataRealizado,
      semDataInicioImpacto: !janela.temDataInicio,
      vinculado: Boolean((item.transportadorasRealizado || []).length || item.transportadoraSistema || linhasTransportadora.length),
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
  const impactoPrevistoSolicitado = itens.reduce((acc, item) => acc + toNumber(item.impactoPrevistoSolicitado), 0);
  const impactoTotal = itens.reduce((acc, item) => acc + toNumber(item.impactoPrevistoRepassado || item.impactoPrevisto || item.impactoPeriodo), 0);
  const reducaoImpactoPrevisto = itens.reduce((acc, item) => acc + toNumber(item.reducaoImpactoPrevisto), 0);
  const impactoEfetivado = efetivados.reduce((acc, item) => acc + toNumber(item.impactoPrevistoRepassado || item.impactoPrevisto || item.impactoPeriodo), 0);
  const reducaoImpactoPrevistoEfetivado = efetivados.reduce((acc, item) => acc + toNumber(item.reducaoImpactoPrevisto), 0);
  const impactoRealizadoSolicitado = itens.reduce((acc, item) => acc + toNumber(item.impactoRealizadoSolicitado), 0);
  const impactoRealizado = itens.reduce((acc, item) => acc + toNumber(item.impactoRealizadoRepassado || item.impactoRealizado), 0);
  const reducaoImpactoRealizada = itens.reduce((acc, item) => acc + toNumber(item.reducaoImpactoRealizada), 0);
  const impactoRealizadoEfetivado = efetivados.reduce((acc, item) => acc + toNumber(item.impactoRealizadoRepassado || item.impactoRealizado), 0);
  const reducaoImpactoRealizadaEfetivada = efetivados.reduce((acc, item) => acc + toNumber(item.reducaoImpactoRealizada), 0);
  const freteBase = itens.reduce((acc, item) => acc + toNumber(item.valorFretePeriodo), 0);
  const freteBaseTotal = itens.reduce((acc, item) => acc + toNumber(item.valorFreteBaseTotal), 0);
  const freteRealizadoReajuste = itens.reduce((acc, item) => acc + toNumber(item.valorFreteRealizadoReajuste), 0);
  const freteRealizadoTotal = itens.reduce((acc, item) => acc + toNumber(item.valorFreteRealizadoTotal), 0);
  const ultimaDataRealizado = itens
    .map((item) => String(item.ultimaDataRealizadoImpacto || item.fimImpactoRealizado || '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1) || '';
  return {
    totalSolicitados,
    totalEfetivados: efetivados.length,
    semVinculo,
    impactoPrevistoSolicitado,
    impactoTotal,
    reducaoImpactoPrevisto,
    impactoEfetivado,
    reducaoImpactoPrevistoEfetivado,
    impactoRealizadoSolicitado,
    impactoRealizado,
    reducaoImpactoRealizada,
    impactoRealizadoEfetivado,
    reducaoImpactoRealizadaEfetivada,
    freteBase,
    freteBaseTotal,
    freteRealizadoReajuste,
    freteRealizadoTotal,
    ultimaDataRealizado,
  };
}

export function formatarPercentualReajuste(value) {
  const n = toNumber(value);
  return `${(n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function formatarMoedaReajuste(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
