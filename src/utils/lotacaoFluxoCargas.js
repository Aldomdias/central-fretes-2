import * as XLSX from 'xlsx';

const FLUXO_STORAGE_KEY = 'central_fretes_lotacao_fluxo_cargas_v1';
const AUDITORIA_STORAGE_KEY = 'central_fretes_lotacao_auditoria_v1';
const SOLICITACOES_STORAGE_KEY = 'central_fretes_lotacao_solicitacoes_pagamento_v1';
const MAX_RESULTADOS = 300;

function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function limparTexto(valor = '') {
  return String(valor ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizarTexto(valor = '') {
  return limparTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizarHeader(valor = '') {
  return normalizarTexto(valor)
    .replace(/[\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  let raw = String(valor).trim();
  if (!raw || raw === '-' || normalizarTexto(raw).includes('SEM PEDAGIO')) return null;

  raw = raw
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .replace(/\s+/g, '')
    .replace(/\((.*)\)/, '-$1');

  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  if (hasComma && hasDot) raw = raw.replace(/\./g, '').replace(',', '.');
  else if (hasComma) raw = raw.replace(',', '.');

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatarMoeda(valor) {
  const numero = paraNumero(valor);
  if (numero === null) return '-';
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarPercentual(valor, casas = 1) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '-';
  return `${numero.toFixed(casas).replace('.', ',')}%`;
}

export function formatarDataCurta(valor) {
  if (!valor) return '-';
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return limparTexto(valor) || '-';
  return data.toLocaleDateString('pt-BR');
}

function valorCelula(row, index) {
  if (index === null || index === undefined || index < 0) return '';
  return row[index] ?? '';
}

function textoCelula(row, index) {
  return limparTexto(valorCelula(row, index));
}

function linhaTemValor(row = []) {
  return row.some((value) => limparTexto(value) !== '');
}


function linhasDaPlanilha(sheet) {
  const rowsByIndex = new Map();
  Object.keys(sheet || {}).forEach((addr) => {
    if (addr.startsWith('!')) return;
    const decoded = XLSX.utils.decode_cell(addr);
    const cell = sheet[addr];
    const value = cell?.v ?? cell?.w;
    if (value === undefined || value === null || value === '') return;
    const row = rowsByIndex.get(decoded.r) || [];
    row[decoded.c] = value;
    rowsByIndex.set(decoded.r, row);
  });

  return [...rowsByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowIndex, values]) => ({ rowIndex, values }));
}

function contem(header, termos = []) {
  return termos.some((termo) => header.includes(termo));
}

function encontrarColuna(headers, predicate) {
  return headers.findIndex((header, index) => predicate(header || '', index));
}

function mapearCabecalho(headerRow = []) {
  const headers = headerRow.map(normalizarHeader);

  return {
    operacao: encontrarColuna(headers, (h) => h === 'OPERACAO'),
    dist: encontrarColuna(headers, (h) => h === 'PEDIDO' || h === 'DIST' || h.includes('DIST')),
    referencia: encontrarColuna(headers, (h) => contem(h, ['REF', 'CNTR', 'SENHA', 'NF'])),
    origem: encontrarColuna(headers, (h) => h === 'ORIGEM' || h.includes('ORIGEM')),
    destino: encontrarColuna(headers, (h) => h === 'DESTINO' || h.includes('DESTINO')),
    status: encontrarColuna(headers, (h) => h === 'STATUS'),
    coletaPlanejada: encontrarColuna(headers, (h) => contem(h, ['COLETA PLANEJADA'])),
    coletaRealizada: encontrarColuna(headers, (h) => contem(h, ['COLETA REALIZADA'])),
    transportadora: encontrarColuna(headers, (h) => contem(h, ['TRANSPORTADORA'])),
    placaCavalo: encontrarColuna(headers, (h) => contem(h, ['PLACA CAVALO'])),
    placaCarreta: encontrarColuna(headers, (h) => contem(h, ['PLACA CARRETA'])),
    tipoVeiculo: encontrarColuna(headers, (h) => contem(h, ['TIPO VEICULO', 'TIPO DE VEICULO', 'VEICULO'])),
    eixos: encontrarColuna(headers, (h) => h === 'EIXOS' || h === 'EIXOS '),
    cubagem: encontrarColuna(headers, (h) => h === 'CUB' || h.includes('CUBAGEM')),
    emissaoNf: encontrarColuna(headers, (h) => contem(h, ['EMISSAO NF'])),
    freteCantu: encontrarColuna(headers, (h) => contem(h, ['FRETE CANTU'])),
    freteTransp: encontrarColuna(headers, (h) => contem(h, ['FRETE TRANSP', 'FRETE TRANSPORTADORA'])),
    pedagio: encontrarColuna(headers, (h) => h.includes('PEDAGIO')),
    protocoloPedagio: encontrarColuna(headers, (h) => contem(h, ['PROTOCOLO PEDAGIO'])),
    seguro: encontrarColuna(headers, (h) => h === 'SEGURO' || h === 'RESPONSAVEL ICMS' || h.includes('RESPONSAVEL ICMS')),
    cte: encontrarColuna(headers, (h) => contem(h, ['CTE TRANSP', 'CT-E TRANSP', 'CTE', 'CT-E'])),
    liberado: encontrarColuna(headers, (h) => h === 'LIBERADO'),
    descarga: encontrarColuna(headers, (h) => h === 'DESCARGA'),
    finalizado: encontrarColuna(headers, (h) => h === 'FINALIZADO'),
    ocorrencia: encontrarColuna(headers, (h) => h.includes('OCORRENCIA')),
    headers,
  };
}

function cabecalhoValido(col) {
  return col.dist >= 0 && col.origem >= 0 && col.destino >= 0 && col.transportadora >= 0 && col.freteTransp >= 0;
}

function encontrarLinhaCabecalho(rows = []) {
  let melhor = null;
  rows.slice(0, 30).forEach((rowItem, position) => {
    const values = Array.isArray(rowItem) ? rowItem : rowItem?.values || [];
    const rowIndex = Array.isArray(rowItem) ? position : rowItem?.rowIndex ?? position;
    const col = mapearCabecalho(values || []);
    const joined = col.headers.join(' | ');
    let score = 0;
    if (joined.includes('PEDIDO')) score += 2;
    if (joined.includes('ORIGEM')) score += 2;
    if (joined.includes('DESTINO')) score += 2;
    if (joined.includes('TRANSPORTADORA')) score += 3;
    if (joined.includes('FRETE TRANSP')) score += 4;
    if (joined.includes('CTE')) score += 2;
    if (cabecalhoValido(col) && (!melhor || score > melhor.score)) melhor = { position, rowIndex, col, score };
  });
  return melhor;
}

function dataParaIso(valor) {
  if (!valor) return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString();
  if (typeof valor === 'number') {
    const parsed = XLSX.SSF.parse_date_code(valor);
    if (parsed) {
      const data = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0)));
      return data.toISOString();
    }
  }
  const texto = limparTexto(valor);
  if (!texto) return '';
  const tentativa = new Date(texto);
  if (!Number.isNaN(tentativa.getTime())) return tentativa.toISOString();
  return texto;
}

export function separarCtes(valor = '') {
  const texto = limparTexto(valor);
  if (!texto) return [];
  return texto
    .split(/[\/;,]+/g)
    .map((item) => limparTexto(item))
    .filter(Boolean);
}

function calcularFreteLiquido({ freteCantu, freteTransp, pedagio, seguro }, aliquotaIcmsPadrao = 12) {
  const cantu = paraNumero(freteCantu);
  const transp = paraNumero(freteTransp);
  const pedagioNumero = paraNumero(pedagio) || 0;
  const taxa = Math.max(0, Number(aliquotaIcmsPadrao) || 0) / 100;
  const seguroNorm = normalizarTexto(seguro);
  const temBaseTransp = transp !== null;
  const temBaseCantu = cantu !== null;
  const valoresDiferentes = temBaseTransp && temBaseCantu && Math.abs(transp - cantu) > 0.01;
  let valorComparacao = temBaseTransp ? transp : cantu;
  let valorBaseInformado = valorComparacao;
  let icmsRemovido = 0;
  let regra = 'Valor lido do Frete Transportadora';
  let icmsEstimado = false;

  if (valoresDiferentes) {
    if (cantu > transp) {
      valorComparacao = transp;
      valorBaseInformado = transp;
      icmsRemovido = cantu - transp;
      regra = 'V maior que W: usando Frete Transportadora como valor sem ICMS';
    } else {
      valorComparacao = cantu;
      valorBaseInformado = cantu;
      regra = 'W maior que V: usando menor valor informado para comparação';
    }
  } else if (valorComparacao !== null) {
    const pareceTerIcms = seguroNorm.includes('CANTU') || seguroNorm.includes('PROPRIO') || seguroNorm.includes('PRÓPRIO') || temBaseTransp || temBaseCantu;
    if (pareceTerIcms && taxa > 0) {
      valorBaseInformado = valorComparacao;
      valorComparacao = valorComparacao * (1 - taxa);
      icmsRemovido = valorBaseInformado - valorComparacao;
      icmsEstimado = true;
      regra = 'V e W iguais: ICMS removido pela alíquota padrão';
    }
  }

  return {
    valorComparacao: valorComparacao === null ? null : Number(valorComparacao.toFixed(2)),
    valorBaseInformado: valorBaseInformado === null ? null : Number(valorBaseInformado.toFixed(2)),
    pedagio: pedagioNumero,
    icmsRemovido: Number((icmsRemovido || 0).toFixed(2)),
    icmsEstimado,
    regraCalculo: regra,
    aliquotaIcmsUsada: icmsEstimado ? Number(aliquotaIcmsPadrao) || 0 : null,
  };
}

function chaveCarga(dist, cte) {
  return `${normalizarTexto(dist)}|${normalizarTexto(cte)}`;
}

function chaveDist(dist) {
  return normalizarTexto(dist);
}

function montarCarga(row, col, sheetName, excelRow, fileName, aliquotaIcmsPadrao) {
  const dist = textoCelula(row, col.dist);
  const origem = textoCelula(row, col.origem);
  const destino = textoCelula(row, col.destino);
  const transportadora = textoCelula(row, col.transportadora);
  if (!dist || !origem || !destino || !transportadora) return null;

  const freteCantu = valorCelula(row, col.freteCantu);
  const freteTransp = valorCelula(row, col.freteTransp);
  const pedagio = valorCelula(row, col.pedagio);
  const seguro = textoCelula(row, col.seguro);
  const calc = calcularFreteLiquido({ freteCantu, freteTransp, pedagio, seguro }, aliquotaIcmsPadrao);
  if (calc.valorComparacao === null) return null;

  const cteRaw = textoCelula(row, col.cte);
  const ctes = separarCtes(cteRaw);
  const idBase = chaveCarga(dist, cteRaw || 'SEM_CTE');

  const item = {
    id: idBase,
    dist,
    distKey: chaveDist(dist),
    cteRaw,
    ctes,
    cteKeys: ctes.map(normalizarTexto),
    operacao: textoCelula(row, col.operacao),
    referencia: textoCelula(row, col.referencia),
    origem,
    origemKey: normalizarTexto(origem),
    destino,
    destinoKey: normalizarTexto(destino),
    status: textoCelula(row, col.status),
    coletaPlanejada: dataParaIso(valorCelula(row, col.coletaPlanejada)),
    coletaRealizada: dataParaIso(valorCelula(row, col.coletaRealizada)),
    emissaoNf: dataParaIso(valorCelula(row, col.emissaoNf)),
    liberado: dataParaIso(valorCelula(row, col.liberado)),
    descarga: dataParaIso(valorCelula(row, col.descarga)),
    finalizado: dataParaIso(valorCelula(row, col.finalizado)),
    transportadora,
    transportadoraKey: normalizarTexto(transportadora),
    placaCavalo: textoCelula(row, col.placaCavalo),
    placaCarreta: textoCelula(row, col.placaCarreta),
    tipoVeiculo: textoCelula(row, col.tipoVeiculo) || 'GERAL',
    tipoKey: normalizarTexto(textoCelula(row, col.tipoVeiculo) || 'GERAL'),
    eixos: paraNumero(valorCelula(row, col.eixos)),
    cubagem: paraNumero(valorCelula(row, col.cubagem)),
    freteCantu: paraNumero(freteCantu),
    freteTransp: paraNumero(freteTransp),
    pedagio: calc.pedagio,
    protocoloPedagio: textoCelula(row, col.protocoloPedagio),
    seguro,
    valorComparacao: calc.valorComparacao,
    valorBaseInformado: calc.valorBaseInformado,
    icmsRemovido: calc.icmsRemovido,
    icmsEstimado: calc.icmsEstimado,
    aliquotaIcmsUsada: calc.aliquotaIcmsUsada,
    regraCalculo: calc.regraCalculo,
    ocorrencia: textoCelula(row, col.ocorrencia),
    sheetName,
    excelRow,
    fileName,
    importadoEm: new Date().toISOString(),
  };

  item.rotaKey = [item.origemKey, item.destinoKey, item.tipoKey].join('|');
  return item;
}

function parseWorkbook(workbook, fileName, options = {}) {
  const aliquotaIcmsPadrao = Number(options.aliquotaIcmsPadrao ?? 12);
  const cargas = [];
  const abas = [];
  const ignoradas = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = linhasDaPlanilha(sheet);
    const headerInfo = encontrarLinhaCabecalho(rows);
    if (!headerInfo) {
      ignoradas.push({ nome: sheetName, motivo: 'Cabeçalho do fluxo de carga não encontrado' });
      return;
    }

    let totalAba = 0;
    rows.slice(headerInfo.position + 1).forEach(({ rowIndex, values }) => {
      if (!linhaTemValor(values)) return;
      const item = montarCarga(values, headerInfo.col, sheetName, rowIndex + 1, fileName, aliquotaIcmsPadrao);
      if (item) {
        cargas.push(item);
        totalAba += 1;
      }
    });

    if (totalAba) abas.push({ nome: sheetName, cargas: totalAba });
    else ignoradas.push({ nome: sheetName, motivo: 'Sem cargas válidas com frete' });
  });

  return { cargas, abas, ignoradas };
}

export async function importarFluxoCargasLotacao(file, options = {}) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true });
  const resultado = parseWorkbook(workbook, file.name || 'arquivo.xlsx', options);
  if (!resultado.cargas.length) {
    throw new Error('Não encontrei cargas válidas. Confira se o arquivo tem as colunas PEDIDO/DIST, ORIGEM, DESTINO, TRANSPORTADORA, FRETE CANTU, FRETE TRANSP, SEGURO e CTE TRANSP.');
  }
  return {
    id: uid('fluxo'),
    fileName: file.name || 'arquivo.xlsx',
    criadoEm: new Date().toISOString(),
    aliquotaIcmsPadrao: Number(options.aliquotaIcmsPadrao ?? 12),
    ...resultado,
  };
}

export async function importarMultiplosFluxos(files = [], options = {}) {
  const lista = Array.from(files || []).filter((file) => /\.xls[xm]?$/i.test(file.name || ''));
  const resultados = [];
  const erros = [];

  for (const file of lista) {
    try {
      resultados.push(await importarFluxoCargasLotacao(file, options));
    } catch (error) {
      erros.push({ fileName: file.name, erro: error.message || String(error) });
    }
  }

  return { resultados, erros };
}

export function carregarFluxoCargasLotacao() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FLUXO_STORAGE_KEY) || '{}');
    return {
      cargas: Array.isArray(parsed.cargas) ? parsed.cargas : [],
      lotes: Array.isArray(parsed.lotes) ? parsed.lotes : [],
      atualizadoEm: parsed.atualizadoEm || '',
      aliquotaIcmsPadrao: parsed.aliquotaIcmsPadrao ?? 12,
    };
  } catch {
    return { cargas: [], lotes: [], atualizadoEm: '', aliquotaIcmsPadrao: 12 };
  }
}

export function salvarFluxoCargasLotacao(base) {
  localStorage.setItem(FLUXO_STORAGE_KEY, JSON.stringify(base));
}

export function mesclarFluxoCargas(baseAtual, importacoes = [], options = {}) {
  const modo = options.modo || 'atualizar';
  const mapa = new Map();
  const cargasAtuais = modo === 'substituir' ? [] : (baseAtual?.cargas || []);
  cargasAtuais.forEach((carga) => mapa.set(chaveCarga(carga.dist, carga.cteRaw || carga.ctes?.join('/') || 'SEM_CTE'), carga));

  importacoes.forEach((importacao) => {
    (importacao.cargas || []).forEach((carga) => {
      mapa.set(chaveCarga(carga.dist, carga.cteRaw || carga.ctes?.join('/') || 'SEM_CTE'), carga);
    });
  });

  const lotesNovos = importacoes.map((importacao) => ({
    id: importacao.id,
    fileName: importacao.fileName,
    criadoEm: importacao.criadoEm,
    totalCargas: importacao.cargas?.length || 0,
    abas: importacao.abas || [],
    ignoradas: importacao.ignoradas || [],
  }));

  const cargas = [...mapa.values()].sort((a, b) => {
    const dataA = new Date(a.coletaRealizada || a.coletaPlanejada || a.liberado || a.importadoEm || 0).getTime();
    const dataB = new Date(b.coletaRealizada || b.coletaPlanejada || b.liberado || b.importadoEm || 0).getTime();
    return dataB - dataA;
  });

  return {
    cargas,
    lotes: [...lotesNovos, ...(modo === 'substituir' ? [] : baseAtual?.lotes || [])].slice(0, 80),
    atualizadoEm: new Date().toISOString(),
    aliquotaIcmsPadrao: Number(options.aliquotaIcmsPadrao ?? baseAtual?.aliquotaIcmsPadrao ?? 12),
  };
}

export function limparFluxoCargasLotacao() {
  localStorage.removeItem(FLUXO_STORAGE_KEY);
}

export function resumirFluxoCargas(base) {
  const cargas = base?.cargas || [];
  const transportadoras = new Set(cargas.map((item) => item.transportadoraKey).filter(Boolean));
  const rotas = new Set(cargas.map((item) => item.rotaKey).filter(Boolean));
  const origens = new Set(cargas.map((item) => item.origemKey).filter(Boolean));
  const destinos = new Set(cargas.map((item) => item.destinoKey).filter(Boolean));
  const valorTotal = cargas.reduce((acc, item) => acc + (Number(item.valorComparacao) || 0), 0);
  const comMultiplosCtes = cargas.filter((item) => (item.ctes || []).length > 1).length;
  return {
    totalCargas: cargas.length,
    transportadoras: transportadoras.size,
    rotas: rotas.size,
    origens: origens.size,
    destinos: destinos.size,
    valorTotal,
    comMultiplosCtes,
    atualizadoEm: base?.atualizadoEm || '',
  };
}

function passaFiltro(valor, filtro) {
  const filtroNorm = normalizarTexto(filtro);
  if (!filtroNorm) return true;
  return normalizarTexto(valor).includes(filtroNorm);
}

export function buscarHistoricoLotacao(cargas = [], filtros = {}) {
  const origem = filtros.origem || '';
  const destino = filtros.destino || '';
  const tipo = filtros.tipo || '';
  const transportadora = filtros.transportadora || '';

  return (cargas || [])
    .filter((item) => passaFiltro(item.origem, origem))
    .filter((item) => passaFiltro(item.destino, destino))
    .filter((item) => passaFiltro(item.tipoVeiculo, tipo))
    .filter((item) => passaFiltro(item.transportadora, transportadora))
    .sort((a, b) => {
      const dataA = new Date(a.coletaRealizada || a.coletaPlanejada || a.liberado || a.importadoEm || 0).getTime();
      const dataB = new Date(b.coletaRealizada || b.coletaPlanejada || b.liberado || b.importadoEm || 0).getTime();
      return dataB - dataA;
    })
    .slice(0, MAX_RESULTADOS);
}

export function rankingHistoricoPorTransportadora(cargas = []) {
  const mapa = new Map();
  cargas.forEach((item) => {
    const key = item.transportadoraKey || normalizarTexto(item.transportadora);
    if (!key) return;
    const atual = mapa.get(key) || {
      nome: item.transportadora,
      cargas: 0,
      valorTotal: 0,
      menor: null,
      maior: null,
      ultimo: null,
    };
    const valor = Number(item.valorComparacao) || 0;
    atual.cargas += 1;
    atual.valorTotal += valor;
    atual.menor = atual.menor === null ? valor : Math.min(atual.menor, valor);
    atual.maior = atual.maior === null ? valor : Math.max(atual.maior, valor);
    const dataAtual = new Date(atual.ultimo?.coletaRealizada || atual.ultimo?.coletaPlanejada || atual.ultimo?.importadoEm || 0).getTime();
    const dataItem = new Date(item.coletaRealizada || item.coletaPlanejada || item.importadoEm || 0).getTime();
    if (!atual.ultimo || dataItem > dataAtual) atual.ultimo = item;
    mapa.set(key, atual);
  });

  return [...mapa.values()]
    .map((item) => ({ ...item, media: item.cargas ? item.valorTotal / item.cargas : 0 }))
    .sort((a, b) => b.cargas - a.cargas || a.media - b.media);
}

export function buscarCargaPorDistOuCte(cargas = [], termo = '') {
  const busca = normalizarTexto(termo);
  if (!busca) return [];
  return (cargas || [])
    .filter((item) => {
      if (normalizarTexto(item.dist).includes(busca)) return true;
      if (normalizarTexto(item.cteRaw).includes(busca)) return true;
      return (item.cteKeys || []).some((cte) => cte.includes(busca));
    })
    .slice(0, 40);
}

export function carregarLancamentosAuditoria() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUDITORIA_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function salvarLancamentosAuditoria(lancamentos = []) {
  localStorage.setItem(AUDITORIA_STORAGE_KEY, JSON.stringify(lancamentos));
}

export function carregarSolicitacoesPagamento() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SOLICITACOES_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function salvarSolicitacoesPagamento(solicitacoes = []) {
  localStorage.setItem(SOLICITACOES_STORAGE_KEY, JSON.stringify(solicitacoes));
}

function normalizarCte(valor = '') {
  const texto = normalizarTexto(valor);
  if (!texto || texto === 'OUTRO' || texto === 'DIST' || texto === 'SEM CTE') return '';
  return texto;
}

export function cteJaLancado(lancamentos = [], carga, cte) {
  if (!carga) return false;
  const cteKey = normalizarCte(cte);
  if (!cteKey) return false;
  const distKey = chaveDist(carga.dist);
  return (lancamentos || []).some((item) => item.distKey === distKey && normalizarCte(item.cte || item.cteKey) === cteKey);
}

export function ctesLancadosCarga(lancamentos = [], carga) {
  if (!carga) return [];
  const distKey = chaveDist(carga.dist);
  return (lancamentos || [])
    .filter((item) => item.distKey === distKey)
    .map((item) => item.cte || '')
    .filter(Boolean);
}

export function totalLancadoCarga(lancamentos = [], carga) {
  if (!carga) return 0;
  const distKey = chaveDist(carga.dist);
  return (lancamentos || [])
    .filter((item) => item.distKey === distKey)
    .reduce((acc, item) => acc + (Number(item.valorLancado) || 0), 0);
}

export function totalAdicionalAutorizadoCarga(solicitacoes = [], carga) {
  if (!carga) return 0;
  const distKey = chaveDist(carga.dist);
  return (solicitacoes || [])
    .filter((item) => item.distKey === distKey && item.status === 'APROVADO')
    .reduce((acc, item) => {
      if (item.tipo === 'CUSTO_ADICIONAL') return acc + (Number(item.valorAdicional) || Number(item.valorLancado) || 0);
      return acc + (Number(item.excedente) || 0);
    }, 0);
}

export function totalAutorizadoCarga(solicitacoes = [], carga) {
  if (!carga) return 0;
  return (Number(carga.valorComparacao) || 0) + totalAdicionalAutorizadoCarga(solicitacoes, carga);
}

export function saldoDisponivelCarga(lancamentos = [], solicitacoes = [], carga) {
  if (!carga) return 0;
  return totalAutorizadoCarga(solicitacoes, carga) - totalLancadoCarga(lancamentos, carga);
}

export function lancamentosDaCarga(lancamentos = [], carga) {
  if (!carga) return [];
  const distKey = chaveDist(carga.dist);
  return (lancamentos || [])
    .filter((item) => item.distKey === distKey)
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());
}

export function solicitacoesDaCarga(solicitacoes = [], carga) {
  if (!carga) return [];
  const distKey = chaveDist(carga.dist);
  return (solicitacoes || [])
    .filter((item) => item.distKey === distKey)
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());
}

export function criarLancamentoAuditoria(carga, dados, lancamentosAtuais = [], solicitacoesAtuais = []) {
  const valorLancado = paraNumero(dados.valorLancado) || 0;
  const cte = limparTexto(dados.cte || '');
  if (cteJaLancado(lancamentosAtuais, carga, cte)) {
    throw new Error(`O CT-e ${cte} já foi lançado para a DIST ${carga.dist}. Escolha outro CT-e.`);
  }

  const totalAnterior = totalLancadoCarga(lancamentosAtuais, carga);
  const saldoDisponivel = Math.max(0, saldoDisponivelCarga(lancamentosAtuais, solicitacoesAtuais, carga));
  const excedente = Number(Math.max(0, valorLancado - saldoDisponivel).toFixed(2));

  return {
    id: uid('aud'),
    cargaId: carga.id,
    dist: carga.dist,
    distKey: chaveDist(carga.dist),
    cte,
    cteKey: normalizarCte(cte),
    fatura: limparTexto(dados.fatura || ''),
    valorLancado,
    valorAutorizadoCarga: Number(carga.valorComparacao) || 0,
    totalAutorizadoNoMomento: Number(totalAutorizadoCarga(solicitacoesAtuais, carga).toFixed(2)),
    totalAnterior: Number(totalAnterior.toFixed(2)),
    saldoAnterior: Number(saldoDisponivel.toFixed(2)),
    excedente,
    status: excedente > 0 ? 'EXCEDEU' : 'OK',
    observacao: limparTexto(dados.observacao || ''),
    criadoEm: new Date().toISOString(),
  };
}

export function criarSolicitacaoPagamento(carga, lancamento) {
  return {
    id: uid('sol'),
    tipo: 'EXCEDENTE_AUDITORIA',
    origemSolicitacao: 'AUDITORIA',
    cargaId: carga.id,
    dist: carga.dist,
    distKey: chaveDist(carga.dist),
    cte: lancamento.cte,
    fatura: lancamento.fatura,
    transportadora: carga.transportadora,
    origem: carga.origem,
    destino: carga.destino,
    tipoVeiculo: carga.tipoVeiculo,
    valorAutorizadoCarga: Number(carga.valorComparacao) || 0,
    totalAnterior: lancamento.totalAnterior,
    saldoAnterior: lancamento.saldoAnterior,
    valorLancado: lancamento.valorLancado,
    excedente: lancamento.excedente,
    valorAdicional: lancamento.excedente,
    status: 'PENDENTE',
    observacao: lancamento.observacao,
    criadoEm: new Date().toISOString(),
    atualizadoEm: '',
  };
}

export function criarCustoAdicionalLotacao(carga, dados = {}) {
  const valorAdicional = paraNumero(dados.valorAdicional) || 0;
  if (!valorAdicional || valorAdicional <= 0) throw new Error('Informe o valor do custo adicional.');
  const tipoCusto = limparTexto(dados.tipoCusto || 'Custo adicional');
  return {
    id: uid('sol'),
    tipo: 'CUSTO_ADICIONAL',
    origemSolicitacao: 'OPERACAO',
    cargaId: carga.id,
    dist: carga.dist,
    distKey: chaveDist(carga.dist),
    cte: limparTexto(dados.cte || ''),
    fatura: limparTexto(dados.fatura || ''),
    transportadora: carga.transportadora,
    origem: carga.origem,
    destino: carga.destino,
    tipoVeiculo: carga.tipoVeiculo,
    valorAutorizadoCarga: Number(carga.valorComparacao) || 0,
    totalAnterior: 0,
    saldoAnterior: 0,
    valorLancado: valorAdicional,
    excedente: 0,
    valorAdicional,
    tipoCusto,
    status: 'APROVADO',
    observacao: limparTexto(dados.observacao || ''),
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
}

export function atualizarStatusSolicitacao(solicitacoes = [], id, status, observacao = '') {
  return solicitacoes.map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      status,
      resposta: limparTexto(observacao),
      atualizadoEm: new Date().toISOString(),
    };
  });
}

export function textoSolicitacaoPagamento(solicitacao) {
  if (!solicitacao) return '';
  const tipo = solicitacao.tipo === 'CUSTO_ADICIONAL' ? `Custo adicional - ${solicitacao.tipoCusto || 'Operação'}` : 'Excedente de auditoria';
  return [
    `Solicitação de autorização de pagamento - ${solicitacao.dist}`,
    '',
    `Tipo: ${tipo}`,
    `Transportadora: ${solicitacao.transportadora}`,
    `Rota: ${solicitacao.origem} x ${solicitacao.destino}`,
    `Tipo de veículo: ${solicitacao.tipoVeiculo}`,
    `CT-e auditado: ${solicitacao.cte || '-'}`,
    `Fatura: ${solicitacao.fatura || '-'}`,
    `Valor base autorizado da carga: ${formatarMoeda(solicitacao.valorAutorizadoCarga)}`,
    `Total já lançado antes: ${formatarMoeda(solicitacao.totalAnterior)}`,
    `Saldo antes: ${formatarMoeda(solicitacao.saldoAnterior)}`,
    `Valor lançado/custo: ${formatarMoeda(solicitacao.valorLancado || solicitacao.valorAdicional)}`,
    `Excedente solicitado: ${formatarMoeda(solicitacao.excedente || solicitacao.valorAdicional)}`,
    '',
    `Observação: ${solicitacao.observacao || '-'}`,
    solicitacao.resposta ? `Resposta operação: ${solicitacao.resposta}` : '',
  ].filter(Boolean).join('\n');
}
