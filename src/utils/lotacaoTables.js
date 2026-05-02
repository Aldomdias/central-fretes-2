import * as XLSX from 'xlsx';

const LOTACAO_STORAGE_KEY = 'central_fretes_lotacao_tabelas_v2';
const MAX_EXEMPLOS_COMPARATIVO = 500;
const TIPOS_ANTT = ['ANTT', 'NTT'];

function uid(prefix = 'lot') {
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
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function normalizarTipoTabela(tipo = '') {
  const normalized = normalizarTexto(tipo);
  if (normalized === 'NTT') return 'ANTT';
  if (normalized === 'ANTT') return 'ANTT';
  if (normalized === 'TARGET') return 'TARGET';
  return 'TRANSPORTADORA';
}

export function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  let raw = String(valor).trim();
  if (!raw) return null;

  raw = raw
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .replace(/\s+/g, '')
    .replace(/\((.*)\)/, '-$1');

  if (raw.includes(',') && raw.includes('.')) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',')) {
    raw = raw.replace(',', '.');
  }

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

function obterValor(row, col) {
  if (col === null || col === undefined || col < 0) return '';
  return row[col] ?? '';
}

function linhaTemValor(row = []) {
  return row.some((value) => limparTexto(value) !== '');
}

function normalizarHeader(valor) {
  return normalizarTexto(valor)
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function linhasDaPlanilha(sheet) {
  const rowsByIndex = new Map();

  Object.keys(sheet || {}).forEach((addr) => {
    if (addr.startsWith('!')) return;
    const decoded = XLSX.utils.decode_cell(addr);
    const value = sheet[addr]?.v;
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
  return headers.findIndex((header) => predicate(header));
}

function encontrarColunaDepois(headers, inicio, predicate) {
  return headers.findIndex((header, index) => index > inicio && predicate(header));
}

function detectarOrigemNoTopo(rows, sheetName = '') {
  const top = rows
    .slice(0, 8)
    .flatMap((item) => item.values || [])
    .map((value) => limparTexto(value))
    .filter(Boolean);

  const celulaOrigem = top.find((value) => normalizarTexto(value).includes('ORIGEM'));
  if (celulaOrigem) {
    const cleaned = celulaOrigem.replace(/origem/gi, '').replace(/[:\-]/g, ' ').trim();
    if (cleaned) return cleaned;
  }

  return limparTexto(sheetName);
}

function mapearCabecalho(headerRow) {
  const headers = (headerRow || []).map(normalizarHeader);

  const transportadora = encontrarColuna(headers, (h) =>
    contem(h, ['TRANSPORTADORA', 'FORNECEDOR', 'OPERADOR'])
  );

  let ufOrigem = encontrarColuna(headers, (h) =>
    contem(h, ['UF ORIGEM', 'UF DE ORIGEM', 'ESTADO ORIGEM'])
  );

  let origem = encontrarColuna(headers, (h) =>
    h.includes('ORIGEM') && !h.includes('UF') && !h.includes('ESTADO')
  );

  if (origem < 0 && ufOrigem > 0) origem = ufOrigem - 1;

  const destino = encontrarColuna(headers, (h) =>
    h === 'DESTINO' || contem(h, ['CIDADE DESTINO', 'CIDADE DE DESTINO', 'MUNICIPIO DESTINO'])
  );

  let ufDestino = encontrarColuna(headers, (h) =>
    contem(h, ['UF DESTINO', 'UF DE DESTINO', 'ESTADO DESTINO'])
  );
  if (ufDestino < 0 && destino >= 0) {
    ufDestino = encontrarColunaDepois(headers, destino, (h) => h === 'UF' || h === 'ESTADO');
  }

  const tipo = encontrarColuna(headers, (h) =>
    h === 'TIPO' || contem(h, ['TIPO VEICULO', 'TIPO DE VEICULO', 'VEICULO', 'CARRETA'])
  );
  const km = encontrarColuna(headers, (h) => h === 'KM' || contem(h, ['DISTANCIA']));
  const prazo = encontrarColuna(headers, (h) => contem(h, ['PRAZO']));
  const icms = encontrarColuna(headers, (h) => contem(h, ['ICMS']));
  const pedagio = encontrarColuna(headers, (h) => contem(h, ['PEDAGIO']));

  const freteAtual = encontrarColuna(headers, (h) =>
    h.includes('FRETE ATUAL') || h.includes('VALOR ATUAL') || h.includes('TABELA ATUAL')
  );

  const freteFinal = encontrarColuna(headers, (h) =>
    !h.includes('DIFERENCA') && (
      h.includes('FRETE FINAL') ||
      (h.includes('AJUSTADO') && h.includes('ANTT')) ||
      h.includes('VALOR FINAL')
    )
  );

  const freteAntt = encontrarColuna(headers, (h) =>
    h.includes('ANTT') && h.includes('FRETE') && !h.includes('FINAL') && !h.includes('AJUSTADO')
  );

  const freteValor = encontrarColuna(headers, (h) => {
    if (h.includes('ANTT')) return false;
    if (h.includes('DIFERENCA')) return false;
    if (h.includes('AJUSTADO')) return false;
    if (h.includes('FINAL')) return false;
    return (
      h.includes('FRETE VALOR') ||
      h.includes('VALOR FRETE') ||
      h.includes('FRETE KG') ||
      h === 'FRETE' ||
      h.includes('TARIFA')
    );
  });

  const diferenca = encontrarColuna(headers, (h) => contem(h, ['DIFERENCA']));

  return {
    transportadora,
    origem,
    ufOrigem,
    destino,
    ufDestino,
    tipo,
    km,
    prazo,
    icms,
    pedagio,
    freteAtual,
    freteValor,
    freteFinal,
    freteAntt,
    diferenca,
    headers,
  };
}

function pontuarCabecalho(headers) {
  const joined = headers.join(' | ');
  let score = 0;
  if (joined.includes('TRANSPORTADORA')) score += 2;
  if (joined.includes('ORIGEM')) score += 2;
  if (joined.includes('DESTINO')) score += 3;
  if (joined.includes('UF')) score += 2;
  if (joined.includes('FRETE')) score += 3;
  if (joined.includes('ANTT')) score += 1;
  if (joined.includes('KM')) score += 1;
  if (joined.includes('TIPO')) score += 1;
  return score;
}

function encontrarLinhaCabecalho(rows) {
  let melhor = null;
  rows.slice(0, 40).forEach((row) => {
    const headers = (row.values || []).map(normalizarHeader);
    const score = pontuarCabecalho(headers);
    if (!melhor || score > melhor.score) melhor = { rowIndex: row.rowIndex, score, values: row.values };
  });
  return melhor && melhor.score >= 7 ? melhor : null;
}

function chaveRota(row) {
  return [row.origem, row.ufOrigem, row.destino, row.ufDestino, row.tipo]
    .map((value) => normalizarTexto(value))
    .join('|');
}

function selecionarValorComparacao(values, col, tipoTabela) {
  const tipo = normalizarTipoTabela(tipoTabela);
  const candidatosComerciais = [
    ['freteFinal', 'Frete Final (Ajustado ANTT)'],
    ['freteAtual', 'Frete Atual'],
    ['freteValor', 'Frete Valor'],
    ['freteAntt', 'Frete ANTT'],
  ];
  const candidatosAntt = [
    ['freteAntt', 'Frete ANTT'],
    ['freteFinal', 'Frete Final (Ajustado ANTT)'],
    ['freteAtual', 'Frete Atual'],
    ['freteValor', 'Frete Valor'],
  ];

  const candidatos = tipo === 'ANTT' ? candidatosAntt : candidatosComerciais;
  for (const [campo, fonte] of candidatos) {
    const valor = paraNumero(obterValor(values, col[campo]));
    if (valor !== null) return { valor, fonte };
  }

  return { valor: null, fonte: '' };
}

function parseSheet(sheet, sheetName, options = {}) {
  const rows = linhasDaPlanilha(sheet);
  const headerInfo = encontrarLinhaCabecalho(rows);
  if (!headerInfo) return [];

  const tipoTabela = normalizarTipoTabela(options.tipo || 'TRANSPORTADORA');
  const nomePadrao = options.nomePadrao || '';
  const col = mapearCabecalho(headerInfo.values);
  if (col.destino < 0 || col.ufDestino < 0) return [];

  const origemTopo = detectarOrigemNoTopo(rows, sheetName);
  const dataRows = rows.filter((row) => row.rowIndex > headerInfo.rowIndex && linhaTemValor(row.values));
  const linhas = [];

  dataRows.forEach(({ rowIndex, values }) => {
    const destino = limparTexto(obterValor(values, col.destino));
    const ufDestino = limparTexto(obterValor(values, col.ufDestino)).toUpperCase();
    if (!destino || !ufDestino || normalizarTexto(destino).includes('TOTAL')) return;

    const origemLinha = limparTexto(obterValor(values, col.origem)) || origemTopo;
    const ufOrigem = limparTexto(obterValor(values, col.ufOrigem)).toUpperCase();
    const tipo = limparTexto(obterValor(values, col.tipo)) || 'GERAL';

    const valorAtual = paraNumero(obterValor(values, col.freteAtual));
    const valorFrete = paraNumero(obterValor(values, col.freteValor));
    const valorFinal = paraNumero(obterValor(values, col.freteFinal));
    const valorAntt = paraNumero(obterValor(values, col.freteAntt));
    const { valor: valorComparacao, fonte: valorFonte } = selecionarValorComparacao(values, col, tipoTabela);

    if (valorComparacao === null) return;

    const transportadoraLinha = limparTexto(obterValor(values, col.transportadora)) || nomePadrao || 'Sem nome';

    const item = {
      id: uid('rota'),
      sheetName,
      excelRow: rowIndex + 1,
      transportadora: transportadoraLinha,
      origem: origemLinha,
      ufOrigem,
      destino,
      ufDestino,
      tipo,
      km: paraNumero(obterValor(values, col.km)),
      prazo: limparTexto(obterValor(values, col.prazo)),
      icms: paraNumero(obterValor(values, col.icms)),
      pedagio: paraNumero(obterValor(values, col.pedagio)),
      freteAtual: valorAtual,
      freteValor: valorFrete,
      freteFinal: valorFinal,
      freteAntt: valorAntt,
      diferencaAntt: paraNumero(obterValor(values, col.diferenca)),
      valor: valorComparacao,
      valorFonte,
    };

    item.chave = chaveRota(item);
    linhas.push(item);
  });

  return linhas;
}

function resumirFontesValor(linhas = []) {
  return linhas.reduce((acc, linha) => {
    const fonte = linha.valorFonte || 'Não identificado';
    acc[fonte] = (acc[fonte] || 0) + 1;
    return acc;
  }, {});
}

function formatarResumoFontes(fontes = {}) {
  const entries = Object.entries(fontes);
  if (!entries.length) return '';
  return entries.map(([fonte, total]) => `${fonte}: ${total}`).join(' | ');
}

export async function importarTabelaLotacao(file, options = {}) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', dense: false, cellDates: false });
  const tipo = normalizarTipoTabela(options.tipo || 'TRANSPORTADORA');
  const nomePadrao = options.nomePadrao || '';
  const abasImportadas = [];
  const abasIgnoradas = [];
  const linhas = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const linhasAba = parseSheet(sheet, sheetName, { tipo, nomePadrao });
    if (linhasAba.length) {
      abasImportadas.push({ nome: sheetName, rotas: linhasAba.length });
      linhas.push(...linhasAba);
    } else {
      abasIgnoradas.push(sheetName);
    }
  });

  if (!linhas.length) {
    throw new Error('Não encontrei linhas válidas de lotação. Confira se a planilha tem colunas de Origem, UF Origem, Destino, UF Destino, Tipo e uma coluna de valor de frete. Use o bloco "Modelos aceitos" como referência.');
  }

  const nomeDetectado = nomePadrao || linhas.find((row) => row.transportadora)?.transportadora || file.name?.replace(/\.[^.]+$/, '') || 'Tabela sem nome';
  const fontesValor = resumirFontesValor(linhas);

  return {
    id: uid('tab'),
    nome: nomeDetectado,
    tipo,
    fileName: file.name || '',
    createdAt: new Date().toISOString(),
    linhas,
    totalLinhas: linhas.length,
    rotasUnicas: indexarPorChave({ linhas }).size,
    origens: [...new Set(linhas.map((item) => `${item.origem}/${item.ufOrigem}`).filter(Boolean))].length,
    destinos: [...new Set(linhas.map((item) => `${item.destino}/${item.ufDestino}`).filter(Boolean))].length,
    abasImportadas,
    abasIgnoradas,
    fontesValor,
    resumoFontesValor: formatarResumoFontes(fontesValor),
  };
}

export function carregarTabelasLotacao() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOTACAO_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((tabela) => ({ ...tabela, tipo: normalizarTipoTabela(tabela.tipo) }));
  } catch {
    return [];
  }
}

export function salvarTabelasLotacao(tabelas = []) {
  localStorage.setItem(LOTACAO_STORAGE_KEY, JSON.stringify(tabelas));
}

export function upsertTabelaLotacao(tabelas = [], tabelaNova) {
  const novoTipo = normalizarTipoTabela(tabelaNova.tipo);
  const tipoUnico = ['TARGET', 'ANTT'].includes(novoTipo);
  const tabelaNormalizada = { ...tabelaNova, tipo: novoTipo };

  const semConflito = tabelas.filter((tabela) => {
    const tipoAtual = normalizarTipoTabela(tabela.tipo);
    if (tipoUnico && tipoAtual === novoTipo) return false;
    if (!tipoUnico && tipoAtual === 'TRANSPORTADORA' && normalizarTexto(tabela.nome) === normalizarTexto(tabelaNormalizada.nome)) return false;
    return true;
  });

  return [tabelaNormalizada, ...semConflito];
}

export function removerTabelaLotacao(tabelas = [], tabelaId) {
  return tabelas.filter((tabela) => tabela.id !== tabelaId);
}

export function obterTabelasPorTipo(tabelas = [], tipo) {
  const tipoNormalizado = normalizarTipoTabela(tipo);
  return tabelas.filter((tabela) => normalizarTipoTabela(tabela.tipo) === tipoNormalizado);
}

export function obterReferencia(tabelas = [], tipo) {
  const tipoNormalizado = normalizarTipoTabela(tipo);
  if (tipoNormalizado === 'ANTT') {
    return tabelas.find((tabela) => TIPOS_ANTT.includes(normalizarTexto(tabela.tipo))) || null;
  }
  return tabelas.find((tabela) => normalizarTipoTabela(tabela.tipo) === tipoNormalizado) || null;
}

function indexarPorChave(tabela) {
  const mapa = new Map();
  (tabela?.linhas || []).forEach((linha) => {
    if (!linha.chave) return;
    if (!mapa.has(linha.chave)) {
      mapa.set(linha.chave, linha);
      return;
    }

    const atual = mapa.get(linha.chave);
    if ((linha.valor ?? Infinity) < (atual.valor ?? Infinity)) mapa.set(linha.chave, linha);
  });
  return mapa;
}

export function compararComReferencia(tabela, referencia) {
  if (!tabela || !referencia) return null;

  const mapaTabela = indexarPorChave(tabela);
  const mapaReferencia = indexarPorChave(referencia);
  const detalhes = [];
  let ganha = 0;
  let perde = 0;
  let empata = 0;
  let semReferencia = 0;
  let somaDiferenca = 0;
  let somaVariacao = 0;
  let comparadas = 0;

  mapaTabela.forEach((linha) => {
    const ref = mapaReferencia.get(linha.chave);
    if (!ref) {
      semReferencia += 1;
      return;
    }

    const diferenca = (linha.valor || 0) - (ref.valor || 0);
    const variacao = ref.valor ? (diferenca / ref.valor) * 100 : 0;
    let status = 'Empata';
    if (Math.abs(diferenca) > 0.01) status = diferenca < 0 ? 'Ganha' : 'Perde';

    if (status === 'Ganha') ganha += 1;
    if (status === 'Perde') perde += 1;
    if (status === 'Empata') empata += 1;

    comparadas += 1;
    somaDiferenca += diferenca;
    somaVariacao += variacao;

    detalhes.push({
      id: `${linha.id}-${ref.id}`,
      origem: linha.origem,
      ufOrigem: linha.ufOrigem,
      destino: linha.destino,
      ufDestino: linha.ufDestino,
      tipo: linha.tipo,
      valorTabela: linha.valor,
      valorReferencia: ref.valor,
      fonteTabela: linha.valorFonte,
      fonteReferencia: ref.valorFonte,
      diferenca,
      variacao,
      status,
      referenciaNome: referencia.nome,
    });
  });

  detalhes.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));

  const baseTotal = mapaTabela.size;
  const aderencia = comparadas ? ((ganha + empata) / comparadas) * 100 : 0;
  const cobertura = baseTotal ? (comparadas / baseTotal) * 100 : 0;
  const variacaoMedia = comparadas ? somaVariacao / comparadas : 0;

  return {
    tabelaNome: tabela.nome,
    referenciaNome: referencia.nome,
    baseTotal,
    referenciaTotal: mapaReferencia.size,
    comparadas,
    semReferencia,
    cobertura,
    ganha,
    perde,
    empata,
    aderencia,
    somaDiferenca,
    variacaoMedia,
    detalhes: detalhes.slice(0, MAX_EXEMPLOS_COMPARATIVO),
  };
}

function matchTexto(valor, filtro) {
  const needle = normalizarTexto(filtro);
  if (!needle) return true;
  return normalizarTexto(valor).includes(needle);
}

export function pesquisarRotaLotacao(tabelas = [], filtros = {}) {
  const origem = filtros.origem || '';
  const destino = filtros.destino || '';
  const tipo = filtros.tipo || '';
  const resultadosPorTabelaRota = new Map();

  tabelas.forEach((tabela) => {
    (tabela.linhas || []).forEach((linha) => {
      if (!matchTexto(linha.origem, origem)) return;
      if (!matchTexto(linha.destino, destino)) return;
      if (tipo && !matchTexto(linha.tipo, tipo)) return;

      const chaveResultado = `${tabela.id}|${linha.chave}`;
      const resultado = {
        ...linha,
        tabelaId: tabela.id,
        tabelaNome: tabela.nome,
        tabelaTipo: normalizarTipoTabela(tabela.tipo),
      };
      const atual = resultadosPorTabelaRota.get(chaveResultado);
      if (!atual || (resultado.valor ?? Infinity) < (atual.valor ?? Infinity)) {
        resultadosPorTabelaRota.set(chaveResultado, resultado);
      }
    });
  });

  return [...resultadosPorTabelaRota.values()].sort((a, b) => (a.valor ?? Infinity) - (b.valor ?? Infinity));
}

export function resumoLotacao(tabelas = []) {
  const target = obterReferencia(tabelas, 'TARGET');
  const antt = obterReferencia(tabelas, 'ANTT');
  const transportadoras = obterTabelasPorTipo(tabelas, 'TRANSPORTADORA');
  const totalRotas = tabelas.reduce((acc, tabela) => acc + (tabela.linhas?.length || 0), 0);

  return {
    target,
    antt,
    transportadoras,
    totalTabelas: tabelas.length,
    totalRotas,
    totalTransportadoras: transportadoras.length,
    rotasTarget: target?.linhas?.length || 0,
    rotasAntt: antt?.linhas?.length || 0,
  };
}

export function baixarModeloLotacao() {
  const exemplo = [
    ['Transportadora', 'Origem', 'UF Origem', 'Destino', 'UF Destino', 'KM', 'Tipo', 'Frete Valor', 'Frete Final (Ajustado ANTT)', 'Frete Atual', 'Frete ANTT', 'ICMS', 'Pedágio'],
    ['TRANSPORTADORA EXEMPLO', 'ITAJAÍ', 'SC', 'MACEIÓ', 'AL', 3024, 'CARRETA BAÚ', 19915.35, 23064.05, '', 23064.05, 0.07, 842],
    ['TRANSPORTADORA EXEMPLO', 'ITUPEVA', 'SP', 'FEIRA DE SANTANA', 'BA', 1873, 'CARRETA BAÚ', 13014.54, 14532.38, '', 14532.38, 0.07, 625.2],
  ];

  const ws = XLSX.utils.aoa_to_sheet(exemplo);
  ws['!cols'] = [
    { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 10 },
    { wch: 18 }, { wch: 14 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MODELO LOTACAO');
  XLSX.writeFile(wb, 'modelo_lotacao_antt_target_transportadora.xlsx');
}
