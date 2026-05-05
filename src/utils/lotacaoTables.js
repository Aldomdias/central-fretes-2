import * as XLSX from 'xlsx';

const LOTACAO_STORAGE_KEY = 'central_fretes_lotacao_tabelas_v4_sem_target';
const MAX_EXEMPLOS_COMPARATIVO = 500;
const TOLERANCIA_EMPATE = 0.01;

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
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function normalizarTipoTabela(tipo = '') {
  const normalized = normalizarTexto(tipo);
  if (normalized === 'NTT' || normalized === 'ANTT') return 'ANTT';
  return 'TRANSPORTADORA';
}

export function nomeTipoLotacao(tipo = '') {
  const normalizado = normalizarTipoTabela(tipo);
  if (normalizado === 'ANTT') return 'ANTT';
  return 'Transportadora';
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
    .replace(/[\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const safeHeader = header || '';
  return termos.some((termo) => safeHeader.includes(termo));
}

function encontrarColuna(headers, predicate) {
  return headers.findIndex((header, index) => predicate(header || '', index));
}

function encontrarColunaDepois(headers, inicio, predicate) {
  return headers.findIndex((header, index) => index > inicio && predicate(header || '', index));
}

function detectarOrigemNoTopo(rows, sheetName = '') {
  const top = rows
    .slice(0, 10)
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

  const target = encontrarColuna(headers, (h) =>
    h === 'TARGET' || (h.includes('TARGET') && !h.includes('DIFERENCA'))
  );

  const freteAnttOficial = encontrarColuna(headers, (h) =>
    h.includes('FRETE') && h.includes('ANTT') && h.includes('OFICIAL')
  );

  const freteAntt = encontrarColuna(headers, (h) =>
    h.includes('FRETE') && h.includes('ANTT') && !h.includes('DIFERENCA')
  );

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
    target,
    freteAnttOficial,
    freteAntt,
    diferenca,
    headers,
  };
}

function pontuarCabecalho(headers, tipoTabela) {
  const tipo = normalizarTipoTabela(tipoTabela);
  const joined = headers.join(' | ');
  let score = 0;

  if (joined.includes('TRANSPORTADORA')) score += 2;
  if (joined.includes('ORIGEM')) score += 2;
  if (joined.includes('DESTINO')) score += 3;
  if (joined.includes('UF')) score += 2;
  if (joined.includes('KM')) score += 1;
  if (joined.includes('TIPO')) score += 1;

  if (tipo === 'ANTT') {
    if (joined.includes('ANTT')) score += 5;
    if (joined.includes('FRETE ANTT OFICIAL')) score += 6;
  } else {
    if (joined.includes('TARGET')) score += 8;
    if (joined.includes('PEDAGIO')) score += 1;
    if (joined.includes('ICMS')) score += 1;
  }

  return score;
}

function validarCabecalhoPorTipo(col, tipoTabela) {
  const tipo = normalizarTipoTabela(tipoTabela);
  const baseOk = col.destino >= 0 && col.ufDestino >= 0 && col.tipo >= 0;
  if (!baseOk) return false;

  if (tipo === 'ANTT') {
    return col.freteAnttOficial >= 0 || col.freteAntt >= 0;
  }

  return col.target >= 0;
}

function encontrarLinhaCabecalho(rows, tipoTabela) {
  let melhor = null;
  rows.slice(0, 50).forEach((row) => {
    const headers = (row.values || []).map(normalizarHeader);
    const col = mapearCabecalho(row.values || []);
    const score = pontuarCabecalho(headers, tipoTabela);
    const valido = validarCabecalhoPorTipo(col, tipoTabela);
    if (valido && (!melhor || score > melhor.score)) {
      melhor = { rowIndex: row.rowIndex, score, values: row.values, col };
    }
  });
  return melhor && melhor.score >= 8 ? melhor : null;
}

function chaveRota(row) {
  return [row.origem, row.ufOrigem, row.destino, row.ufDestino, row.tipo]
    .map((value) => normalizarTexto(value))
    .join('|');
}

function selecionarValorComparacao(values, col, tipoTabela) {
  const tipo = normalizarTipoTabela(tipoTabela);

  if (tipo === 'ANTT') {
    const candidatosAntt = [
      ['freteAnttOficial', 'Frete ANTT Oficial'],
      ['freteAntt', 'Frete ANTT'],
    ];
    for (const [campo, fonte] of candidatosAntt) {
      const valor = paraNumero(obterValor(values, col[campo]));
      if (valor !== null) return { valor, fonte };
    }
    return { valor: null, fonte: '' };
  }

  const valorTarget = paraNumero(obterValor(values, col.target));
  if (valorTarget !== null) return { valor: valorTarget, fonte: 'TARGET' };

  return { valor: null, fonte: '' };
}

function parseSheet(sheet, sheetName, options = {}) {
  const rows = linhasDaPlanilha(sheet);
  const tipoTabela = normalizarTipoTabela(options.tipo || 'TRANSPORTADORA');
  const headerInfo = encontrarLinhaCabecalho(rows, tipoTabela);
  if (!headerInfo) return { linhas: [], motivo: 'Cabeçalho do modelo não encontrado' };

  const nomePadrao = options.nomePadrao || '';
  const col = headerInfo.col || mapearCabecalho(headerInfo.values);
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
    const { valor: valorComparacao, fonte: valorFonte } = selecionarValorComparacao(values, col, tipoTabela);

    if (!origemLinha || !ufOrigem || valorComparacao === null) return;

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
      target: paraNumero(obterValor(values, col.target)),
      freteAnttOficial: paraNumero(obterValor(values, col.freteAnttOficial)),
      freteAntt: paraNumero(obterValor(values, col.freteAntt)),
      diferencaAntt: paraNumero(obterValor(values, col.diferenca)),
      valor: valorComparacao,
      valorFonte,
    };

    item.chave = chaveRota(item);
    linhas.push(item);
  });

  return { linhas, motivo: linhas.length ? '' : 'Nenhuma linha com valor válido no modelo' };
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

function nomeModeloEsperado(tipo) {
  const normalizado = normalizarTipoTabela(tipo);
  if (normalizado === 'ANTT') return 'ANTT BASE';
  return 'TRANSPORTADORA / LOTAÇÃO';
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
    const resultado = parseSheet(sheet, sheetName, { tipo, nomePadrao });
    if (resultado.linhas.length) {
      abasImportadas.push({ nome: sheetName, rotas: resultado.linhas.length });
      linhas.push(...resultado.linhas);
    } else {
      abasIgnoradas.push({ nome: sheetName, motivo: resultado.motivo || 'Sem linhas válidas' });
    }
  });

  if (!linhas.length) {
    const esperado = tipo === 'ANTT'
      ? 'Modelo ANTT: Transportadora, Origem, UF ORIGEM, Destino, UF DESTINO/UF, KM, TIPO e Frete ANTT Oficial.'
      : 'Modelo Transportadora: Transportadora, Origem, UF ORIGEM, Destino, UF DESTINO/UF, KM, TIPO, TARGET, ICMS e Pedágio.';
    throw new Error(`Não encontrei linhas válidas para o modelo ${nomeModeloEsperado(tipo)}. ${esperado}`);
  }

  const nomeDetectado = nomePadrao || linhas.find((row) => row.transportadora)?.transportadora || file.name?.replace(/\.[^.]+$/, '') || 'Tabela sem nome';
  const fontesValor = resumirFontesValor(linhas);

  return {
    id: uid('tab'),
    nome: nomeDetectado,
    tipo,
    modelo: nomeModeloEsperado(tipo),
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
    return parsed
      .filter((tabela) => tabela && typeof tabela === 'object')
      .map((tabela) => ({ ...tabela, tipo: normalizarTipoTabela(tabela.tipo), linhas: Array.isArray(tabela.linhas) ? tabela.linhas : [] }))
      .filter((tabela) => normalizarTipoTabela(tabela.tipo) === 'ANTT' || normalizarTipoTabela(tabela.tipo) === 'TRANSPORTADORA');
  } catch {
    return [];
  }
}

export function salvarTabelasLotacao(tabelas = []) {
  localStorage.setItem(LOTACAO_STORAGE_KEY, JSON.stringify(tabelas));
}

export function upsertTabelaLotacao(tabelas = [], tabelaNova) {
  const novoTipo = normalizarTipoTabela(tabelaNova.tipo);
  const tabelaNormalizada = { ...tabelaNova, tipo: novoTipo };

  const semConflito = tabelas.filter((tabela) => {
    if (!tabela || typeof tabela !== 'object') return false;
    const tipoAtual = normalizarTipoTabela(tabela.tipo);
    if (novoTipo === 'ANTT' && tipoAtual === 'ANTT') return false;
    if (novoTipo === 'TRANSPORTADORA' && tipoAtual === 'TRANSPORTADORA' && normalizarTexto(tabela.nome) === normalizarTexto(tabelaNormalizada.nome)) return false;
    return true;
  });

  return [tabelaNormalizada, ...semConflito];
}

export function removerTabelaLotacao(tabelas = [], tabelaId) {
  return tabelas.filter((tabela) => tabela && tabela.id !== tabelaId);
}

export function obterTabelasPorTipo(tabelas = [], tipo) {
  const tipoNormalizado = normalizarTipoTabela(tipo);
  return tabelas.filter((tabela) => tabela && typeof tabela === 'object' && normalizarTipoTabela(tabela.tipo) === tipoNormalizado);
}

export function obterAntt(tabelas = []) {
  return tabelas.find((tabela) => tabela && typeof tabela === 'object' && normalizarTipoTabela(tabela.tipo) === 'ANTT') || null;
}

function indexarPorChave(tabela) {
  const mapa = new Map();
  const linhas = Array.isArray(tabela?.linhas) ? tabela.linhas : [];
  linhas.forEach((linha) => {
    if (!linha || typeof linha !== 'object' || !linha.chave) return;
    if (!mapa.has(linha.chave)) {
      mapa.set(linha.chave, linha);
      return;
    }

    const atual = mapa.get(linha.chave);
    if ((linha.valor ?? Infinity) < (atual.valor ?? Infinity)) mapa.set(linha.chave, linha);
  });
  return mapa;
}

export function criarReferenciaMenorPreco(transportadoras = []) {
  const mapa = new Map();

  transportadoras.forEach((tabela) => {
    const linhasUnicas = indexarPorChave(tabela);
    linhasUnicas.forEach((linha) => {
      const atual = mapa.get(linha.chave);
      const candidato = {
        ...linha,
        id: `best-${linha.chave}`,
        tabelaOrigemId: tabela.id,
        melhorTabelaNome: tabela.nome,
        transportadora: tabela.nome,
        valorFonte: `Menor preço: ${tabela.nome}`,
        empateNomes: [tabela.nome],
      };

      if (!atual || (linha.valor ?? Infinity) < (atual.valor ?? Infinity) - TOLERANCIA_EMPATE) {
        mapa.set(linha.chave, candidato);
      } else if (Math.abs((linha.valor ?? 0) - (atual.valor ?? 0)) <= TOLERANCIA_EMPATE) {
        mapa.set(linha.chave, {
          ...atual,
          valorFonte: `Menor preço: ${[...(atual.empateNomes || []), tabela.nome].join(', ')}`,
          empateNomes: [...(atual.empateNomes || []), tabela.nome],
        });
      }
    });
  });

  return {
    id: 'benchmark-menor-preco',
    nome: 'Melhor preço entre transportadoras',
    tipo: 'BENCHMARK',
    linhas: [...mapa.values()],
    rotasUnicas: mapa.size,
  };
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
    if (Math.abs(diferenca) > TOLERANCIA_EMPATE) status = diferenca < 0 ? 'Ganha' : 'Perde';

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
      km: linha.km || ref.km,
      valorTabela: linha.valor,
      valorReferencia: ref.valor,
      fonteTabela: linha.valorFonte,
      fonteReferencia: ref.valorFonte,
      melhorTabelaNome: ref.melhorTabelaNome || ref.transportadora || referencia.nome,
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


function compararValorComAntt(valorTabela, refAntt) {
  if (!refAntt || refAntt.valor === null || refAntt.valor === undefined) {
    return {
      diferencaAntt: null,
      variacaoAntt: null,
      statusAntt: 'Sem NTT',
    };
  }

  const valorBase = Number(refAntt.valor || 0);
  const valor = Number(valorTabela || 0);
  const diferencaAntt = valor - valorBase;
  const variacaoAntt = valorBase ? (diferencaAntt / valorBase) * 100 : 0;
  let statusAntt = 'Igual NTT';

  if (diferencaAntt < -TOLERANCIA_EMPATE) statusAntt = 'Abaixo NTT';
  if (diferencaAntt > TOLERANCIA_EMPATE) statusAntt = 'Acima NTT';

  return { diferencaAntt, variacaoAntt, statusAntt };
}

export function compararTabelaReajuste(tabelaAntiga, tabelaReajuste, antt = null) {
  if (!tabelaAntiga || !tabelaReajuste) return null;

  const mapaAntigo = indexarPorChave(tabelaAntiga);
  const mapaNovo = indexarPorChave(tabelaReajuste);
  const mapaAntt = antt ? indexarPorChave(antt) : new Map();
  const detalhes = [];
  const rotasNovas = [];
  const rotasSemReajuste = [];

  let comparadas = 0;
  let comparadasAntt = 0;
  let aumentou = 0;
  let reduziu = 0;
  let manteve = 0;

  let antigoAbaixoAntt = 0;
  let antigoAcimaAntt = 0;
  let antigoIgualAntt = 0;
  let reajusteAbaixoAntt = 0;
  let reajusteAcimaAntt = 0;
  let reajusteIgualAntt = 0;
  let ajustadasAteAntt = 0;

  let somaValorAntigo = 0;
  let somaValorNovo = 0;
  let somaValorAntt = 0;
  let somaVariacao = 0;
  let somaDiferencaReajusteAntt = 0;
  let somaVariacaoReajusteAntt = 0;
  let somaVariacaoReajusteAcimaAntt = 0;
  let somaVariacaoReajusteAbaixoAntt = 0;
  let valorNecessarioAjustarAteAntt = 0;
  let maiorAumento = null;
  let maiorReducao = null;

  mapaNovo.forEach((linhaNova) => {
    const linhaAntiga = mapaAntigo.get(linhaNova.chave);
    if (!linhaAntiga) {
      rotasNovas.push({
        id: `nova-${linhaNova.id}`,
        origem: linhaNova.origem,
        ufOrigem: linhaNova.ufOrigem,
        destino: linhaNova.destino,
        ufDestino: linhaNova.ufDestino,
        tipo: linhaNova.tipo,
        km: linhaNova.km,
        valorNovo: linhaNova.valor,
        fonteNova: linhaNova.valorFonte,
        status: 'Rota nova',
      });
      return;
    }

    const valorAntigo = Number(linhaAntiga.valor || 0);
    const valorNovo = Number(linhaNova.valor || 0);
    const diferenca = valorNovo - valorAntigo;
    const variacao = valorAntigo ? (diferenca / valorAntigo) * 100 : 0;
    let status = 'Sem alteração';

    if (diferenca > TOLERANCIA_EMPATE) {
      status = 'Aumentou';
      aumentou += 1;
    } else if (diferenca < -TOLERANCIA_EMPATE) {
      status = 'Reduziu';
      reduziu += 1;
    } else {
      manteve += 1;
    }

    comparadas += 1;
    somaValorAntigo += valorAntigo;
    somaValorNovo += valorNovo;
    somaVariacao += variacao;

    const refAntt = mapaAntt.get(linhaNova.chave) || mapaAntt.get(linhaAntiga.chave) || null;
    const comparacaoAntigoAntt = compararValorComAntt(valorAntigo, refAntt);
    const comparacaoNovoAntt = compararValorComAntt(valorNovo, refAntt);

    if (refAntt) {
      const valorAntt = Number(refAntt.valor || 0);
      comparadasAntt += 1;
      somaValorAntt += valorAntt;
      somaDiferencaReajusteAntt += comparacaoNovoAntt.diferencaAntt || 0;
      somaVariacaoReajusteAntt += comparacaoNovoAntt.variacaoAntt || 0;

      if (comparacaoAntigoAntt.statusAntt === 'Abaixo NTT') {
        antigoAbaixoAntt += 1;
        valorNecessarioAjustarAteAntt += Math.max(0, valorAntt - valorAntigo);
        if (valorNovo + TOLERANCIA_EMPATE >= valorAntt) ajustadasAteAntt += 1;
      }
      if (comparacaoAntigoAntt.statusAntt === 'Acima NTT') antigoAcimaAntt += 1;
      if (comparacaoAntigoAntt.statusAntt === 'Igual NTT') antigoIgualAntt += 1;

      if (comparacaoNovoAntt.statusAntt === 'Abaixo NTT') {
        reajusteAbaixoAntt += 1;
        somaVariacaoReajusteAbaixoAntt += comparacaoNovoAntt.variacaoAntt || 0;
      }
      if (comparacaoNovoAntt.statusAntt === 'Acima NTT') {
        reajusteAcimaAntt += 1;
        somaVariacaoReajusteAcimaAntt += comparacaoNovoAntt.variacaoAntt || 0;
      }
      if (comparacaoNovoAntt.statusAntt === 'Igual NTT') reajusteIgualAntt += 1;
    }

    const detalhe = {
      id: `reajuste-${linhaAntiga.id}-${linhaNova.id}`,
      origem: linhaAntiga.origem || linhaNova.origem,
      ufOrigem: linhaAntiga.ufOrigem || linhaNova.ufOrigem,
      destino: linhaAntiga.destino || linhaNova.destino,
      ufDestino: linhaAntiga.ufDestino || linhaNova.ufDestino,
      tipo: linhaAntiga.tipo || linhaNova.tipo,
      km: linhaNova.km || linhaAntiga.km,
      valorAntigo,
      valorNovo,
      valorAntt: refAntt?.valor ?? null,
      fonteAntiga: linhaAntiga.valorFonte,
      fonteNova: linhaNova.valorFonte,
      fonteAntt: refAntt?.valorFonte || '',
      diferenca,
      variacao,
      diferencaAntigoAntt: comparacaoAntigoAntt.diferencaAntt,
      variacaoAntigoAntt: comparacaoAntigoAntt.variacaoAntt,
      statusAntigoAntt: comparacaoAntigoAntt.statusAntt,
      diferencaNovoAntt: comparacaoNovoAntt.diferencaAntt,
      variacaoNovoAntt: comparacaoNovoAntt.variacaoAntt,
      statusNovoAntt: comparacaoNovoAntt.statusAntt,
      status,
    };

    if (!maiorAumento || variacao > maiorAumento.variacao) maiorAumento = detalhe;
    if (!maiorReducao || variacao < maiorReducao.variacao) maiorReducao = detalhe;
    detalhes.push(detalhe);
  });

  mapaAntigo.forEach((linhaAntiga) => {
    if (mapaNovo.has(linhaAntiga.chave)) return;
    rotasSemReajuste.push({
      id: `sem-reajuste-${linhaAntiga.id}`,
      origem: linhaAntiga.origem,
      ufOrigem: linhaAntiga.ufOrigem,
      destino: linhaAntiga.destino,
      ufDestino: linhaAntiga.ufDestino,
      tipo: linhaAntiga.tipo,
      km: linhaAntiga.km,
      valorAntigo: linhaAntiga.valor,
      fonteAntiga: linhaAntiga.valorFonte,
      status: 'Sem rota na reajustada',
    });
  });

  detalhes.sort((a, b) => Math.abs(b.variacao) - Math.abs(a.variacao));
  rotasNovas.sort((a, b) => (b.valorNovo || 0) - (a.valorNovo || 0));
  rotasSemReajuste.sort((a, b) => (b.valorAntigo || 0) - (a.valorAntigo || 0));

  const diferencaTotal = somaValorNovo - somaValorAntigo;
  const variacaoPonderada = somaValorAntigo ? (diferencaTotal / somaValorAntigo) * 100 : 0;
  const variacaoMedia = comparadas ? somaVariacao / comparadas : 0;
  const coberturaAntiga = mapaAntigo.size ? (comparadas / mapaAntigo.size) * 100 : 0;
  const coberturaNova = mapaNovo.size ? (comparadas / mapaNovo.size) * 100 : 0;

  return {
    tabelaAntigaNome: tabelaAntiga.nome,
    tabelaReajusteNome: tabelaReajuste.nome,
    baseAntiga: mapaAntigo.size,
    baseNova: mapaNovo.size,
    comparadas,
    comparadasAntt,
    semAntt: comparadas - comparadasAntt,
    aumentou,
    reduziu,
    manteve,
    rotasNovas: rotasNovas.length,
    rotasSemReajuste: rotasSemReajuste.length,
    somaValorAntigo,
    somaValorNovo,
    somaValorAntt,
    antigoAbaixoAntt,
    antigoAcimaAntt,
    antigoIgualAntt,
    reajusteAbaixoAntt,
    reajusteAcimaAntt,
    reajusteIgualAntt,
    ajustadasAteAntt,
    rotasQuePrecisamAjusteAntt: antigoAbaixoAntt,
    valorNecessarioAjustarAteAntt,
    pctAntigoAbaixoAntt: comparadasAntt ? (antigoAbaixoAntt / comparadasAntt) * 100 : 0,
    pctAntigoAcimaAntt: comparadasAntt ? (antigoAcimaAntt / comparadasAntt) * 100 : 0,
    pctAntigoIgualAntt: comparadasAntt ? (antigoIgualAntt / comparadasAntt) * 100 : 0,
    pctReajusteAbaixoAntt: comparadasAntt ? (reajusteAbaixoAntt / comparadasAntt) * 100 : 0,
    pctReajusteAcimaAntt: comparadasAntt ? (reajusteAcimaAntt / comparadasAntt) * 100 : 0,
    pctReajusteIgualAntt: comparadasAntt ? (reajusteIgualAntt / comparadasAntt) * 100 : 0,
    diferencaTotal,
    variacaoPonderada,
    variacaoMedia,
    diferencaTotalReajusteAntt: somaDiferencaReajusteAntt,
    variacaoMediaReajusteAntt: comparadasAntt ? somaVariacaoReajusteAntt / comparadasAntt : 0,
    variacaoMediaReajusteAcimaAntt: reajusteAcimaAntt ? somaVariacaoReajusteAcimaAntt / reajusteAcimaAntt : 0,
    variacaoMediaReajusteAbaixoAntt: reajusteAbaixoAntt ? somaVariacaoReajusteAbaixoAntt / reajusteAbaixoAntt : 0,
    coberturaAntiga,
    coberturaNova,
    maiorAumento,
    maiorReducao,
    detalhes: detalhes.slice(0, MAX_EXEMPLOS_COMPARATIVO),
    detalhesRotasNovas: rotasNovas.slice(0, 100),
    detalhesRotasSemReajuste: rotasSemReajuste.slice(0, 100),
  };
}

function nomeArquivoSeguro(valor = '') {
  return normalizarTexto(valor)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'comparativo';
}

export function exportarComparativoReajusteXlsx(comparativo) {
  if (!comparativo?.detalhes?.length) return;

  const resumo = [
    ['Tabela antiga', comparativo.tabelaAntigaNome],
    ['Tabela reajustada', comparativo.tabelaReajusteNome],
    ['Rotas comparadas', comparativo.comparadas],
    ['Aumento ponderado %', comparativo.variacaoPonderada],
    ['Diferença total R$', comparativo.diferencaTotal],
    ['Rotas com aumento', comparativo.aumentou],
    ['Rotas com redução', comparativo.reduziu],
    ['Rotas sem alteração', comparativo.manteve],
    ['Rotas com NTT', comparativo.comparadasAntt || 0],
    ['Antiga abaixo NTT', comparativo.antigoAbaixoAntt || 0],
    ['Antiga acima NTT', comparativo.antigoAcimaAntt || 0],
    ['Reajuste abaixo NTT', comparativo.reajusteAbaixoAntt || 0],
    ['Reajuste acima NTT', comparativo.reajusteAcimaAntt || 0],
    ['% reajuste acima NTT', comparativo.pctReajusteAcimaAntt || 0],
    ['% médio reajuste acima NTT', comparativo.variacaoMediaReajusteAcimaAntt || 0],
    ['Rotas que teriam reajuste até NTT', comparativo.rotasQuePrecisamAjusteAntt || 0],
    ['Valor necessário para ajustar até NTT', comparativo.valorNecessarioAjustarAteAntt || 0],
    ['Rotas antigas ajustadas até NTT pela nova tabela', comparativo.ajustadasAteAntt || 0],
  ];

  const linhas = comparativo.detalhes.map((item) => ({
    Origem: `${item.origem}/${item.ufOrigem}`,
    Destino: `${item.destino}/${item.ufDestino}`,
    Tipo: item.tipo,
    KM: item.km || '',
    'Valor antigo': item.valorAntigo,
    NTT: item.valorAntt ?? '',
    'Valor reajuste': item.valorNovo,
    'Diferença reajuste': item.diferenca,
    '% aumento': item.variacao,
    'Antigo x NTT R$': item.diferencaAntigoAntt ?? '',
    'Antigo x NTT %': item.variacaoAntigoAntt ?? '',
    'Reajuste x NTT R$': item.diferencaNovoAntt ?? '',
    'Reajuste x NTT %': item.variacaoNovoAntt ?? '',
    'Status reajuste': item.status,
    'Status antigo x NTT': item.statusAntigoAntt || '',
    'Status reajuste x NTT': item.statusNovoAntt || '',
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(resumo), 'Resumo');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(linhas), 'Rotas');

  const nome = nomeArquivoSeguro(`${comparativo.tabelaAntigaNome}-${comparativo.tabelaReajusteNome}`);
  XLSX.writeFile(workbook, `comparativo-reajuste-lotacao-${nome}.xlsx`);
}

export function analisarTabelaVersusAntt(tabela, antt) {
  if (!tabela || !antt) return null;

  const mapaTabela = indexarPorChave(tabela);
  const mapaAntt = indexarPorChave(antt);
  const detalhes = [];
  let abaixo = 0;
  let acima = 0;
  let igual = 0;
  let semReferencia = 0;
  let comparadas = 0;
  let somaDiferenca = 0;
  let somaVariacao = 0;
  let somaVariacaoAcima = 0;
  let somaVariacaoAbaixo = 0;

  mapaTabela.forEach((linha) => {
    const ref = mapaAntt.get(linha.chave);
    if (!ref) {
      semReferencia += 1;
      return;
    }

    const diferenca = (linha.valor || 0) - (ref.valor || 0);
    const variacao = ref.valor ? (diferenca / ref.valor) * 100 : 0;
    let status = 'Igual ANTT';

    if (diferenca < -TOLERANCIA_EMPATE) {
      status = 'Abaixo ANTT';
      abaixo += 1;
      somaVariacaoAbaixo += variacao;
    } else if (diferenca > TOLERANCIA_EMPATE) {
      status = 'Acima ANTT';
      acima += 1;
      somaVariacaoAcima += variacao;
    } else {
      igual += 1;
    }

    comparadas += 1;
    somaDiferenca += diferenca;
    somaVariacao += variacao;

    detalhes.push({
      id: `antt-${tabela.id}-${linha.id}-${ref.id}`,
      tabelaNome: tabela.nome,
      origem: linha.origem,
      ufOrigem: linha.ufOrigem,
      destino: linha.destino,
      ufDestino: linha.ufDestino,
      tipo: linha.tipo,
      km: linha.km || ref.km,
      valorTabela: linha.valor,
      valorAntt: ref.valor,
      diferenca,
      variacao,
      status,
      fonteTabela: linha.valorFonte,
      fonteAntt: ref.valorFonte,
    });
  });

  detalhes.sort((a, b) => Math.abs(b.variacao) - Math.abs(a.variacao));

  const baseTotal = mapaTabela.size;
  const cobertura = baseTotal ? (comparadas / baseTotal) * 100 : 0;
  const pctAbaixo = comparadas ? (abaixo / comparadas) * 100 : 0;
  const pctAcima = comparadas ? (acima / comparadas) * 100 : 0;
  const pctIgual = comparadas ? (igual / comparadas) * 100 : 0;

  return {
    tabelaNome: tabela.nome,
    referenciaNome: antt.nome,
    baseTotal,
    comparadas,
    semReferencia,
    cobertura,
    abaixo,
    acima,
    igual,
    pctAbaixo,
    pctAcima,
    pctIgual,
    somaDiferenca,
    variacaoMedia: comparadas ? somaVariacao / comparadas : 0,
    variacaoMediaAcima: acima ? somaVariacaoAcima / acima : 0,
    variacaoMediaAbaixo: abaixo ? somaVariacaoAbaixo / abaixo : 0,
    detalhes: detalhes.slice(0, MAX_EXEMPLOS_COMPARATIVO),
  };
}

export function analisarAnttTodasTransportadoras(transportadoras = [], antt) {
  if (!antt || !transportadoras.length) return null;

  const individuais = transportadoras
    .map((tabela) => analisarTabelaVersusAntt(tabela, antt))
    .filter(Boolean);

  const acumulado = individuais.reduce((acc, item) => {
    acc.baseTotal += item.baseTotal;
    acc.comparadas += item.comparadas;
    acc.semReferencia += item.semReferencia;
    acc.abaixo += item.abaixo;
    acc.acima += item.acima;
    acc.igual += item.igual;
    acc.somaDiferenca += item.somaDiferenca;
    acc.somaVariacaoPonderada += item.variacaoMedia * item.comparadas;
    acc.detalhes.push(...(item.detalhes || []));
    acc.porTransportadora.push(item);
    return acc;
  }, {
    baseTotal: 0,
    comparadas: 0,
    semReferencia: 0,
    abaixo: 0,
    acima: 0,
    igual: 0,
    somaDiferenca: 0,
    somaVariacaoPonderada: 0,
    detalhes: [],
    porTransportadora: [],
  });

  acumulado.detalhes.sort((a, b) => Math.abs(b.variacao) - Math.abs(a.variacao));
  acumulado.porTransportadora.sort((a, b) => b.pctAbaixo - a.pctAbaixo || b.comparadas - a.comparadas);

  return {
    tabelaNome: 'Todas as transportadoras',
    referenciaNome: antt.nome,
    baseTotal: acumulado.baseTotal,
    comparadas: acumulado.comparadas,
    semReferencia: acumulado.semReferencia,
    cobertura: acumulado.baseTotal ? (acumulado.comparadas / acumulado.baseTotal) * 100 : 0,
    abaixo: acumulado.abaixo,
    acima: acumulado.acima,
    igual: acumulado.igual,
    pctAbaixo: acumulado.comparadas ? (acumulado.abaixo / acumulado.comparadas) * 100 : 0,
    pctAcima: acumulado.comparadas ? (acumulado.acima / acumulado.comparadas) * 100 : 0,
    pctIgual: acumulado.comparadas ? (acumulado.igual / acumulado.comparadas) * 100 : 0,
    somaDiferenca: acumulado.somaDiferenca,
    variacaoMedia: acumulado.comparadas ? acumulado.somaVariacaoPonderada / acumulado.comparadas : 0,
    detalhes: acumulado.detalhes.slice(0, MAX_EXEMPLOS_COMPARATIVO),
    porTransportadora: acumulado.porTransportadora,
  };
}

export function rankingMelhoresPorRota(transportadoras = []) {
  const opcoesPorChave = new Map();
  const stats = new Map();

  transportadoras.forEach((tabela) => {
    const linhasUnicas = indexarPorChave(tabela);
    if (!stats.has(tabela.nome)) {
      stats.set(tabela.nome, { nome: tabela.nome, melhores: 0, participacoes: 0, valorTotalParticipando: 0 });
    }

    linhasUnicas.forEach((linha) => {
      const stat = stats.get(tabela.nome);
      stat.participacoes += 1;
      stat.valorTotalParticipando += linha.valor || 0;

      const lista = opcoesPorChave.get(linha.chave) || [];
      lista.push({ tabela, linha });
      opcoesPorChave.set(linha.chave, lista);
    });
  });

  const detalhes = [];
  opcoesPorChave.forEach((opcoes, chave) => {
    const ordenadas = [...opcoes].sort((a, b) => (a.linha.valor ?? Infinity) - (b.linha.valor ?? Infinity));
    const melhor = ordenadas[0];
    if (!melhor) return;
    const maior = ordenadas[ordenadas.length - 1];
    const vencedores = ordenadas.filter((item) => Math.abs((item.linha.valor || 0) - (melhor.linha.valor || 0)) <= TOLERANCIA_EMPATE);

    vencedores.forEach((item) => {
      const stat = stats.get(item.tabela.nome);
      if (stat) stat.melhores += 1;
    });

    detalhes.push({
      id: `best-route-${chave}`,
      origem: melhor.linha.origem,
      ufOrigem: melhor.linha.ufOrigem,
      destino: melhor.linha.destino,
      ufDestino: melhor.linha.ufDestino,
      tipo: melhor.linha.tipo,
      melhorTabela: vencedores.map((item) => item.tabela.nome).join(', '),
      melhorValor: melhor.linha.valor,
      maiorTabela: maior?.tabela?.nome || '',
      maiorValor: maior?.linha?.valor || 0,
      diferencaMenorMaior: (maior?.linha?.valor || 0) - (melhor.linha.valor || 0),
      opcoes: opcoes.length,
    });
  });

  const ranking = [...stats.values()]
    .map((item) => ({
      ...item,
      melhores: Number(item.melhores.toFixed(2)),
      percentualMelhor: item.participacoes ? (item.melhores / item.participacoes) * 100 : 0,
      ticketMedio: item.participacoes ? item.valorTotalParticipando / item.participacoes : 0,
    }))
    .sort((a, b) => b.melhores - a.melhores || b.percentualMelhor - a.percentualMelhor);

  detalhes.sort((a, b) => b.diferencaMenorMaior - a.diferencaMenorMaior);

  return {
    rotasMapeadas: opcoesPorChave.size,
    ranking,
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

  tabelas
    .filter((tabela) => normalizarTipoTabela(tabela.tipo) === 'TRANSPORTADORA')
    .forEach((tabela) => {
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
  const tabelasValidas = Array.isArray(tabelas) ? tabelas.filter((tabela) => tabela && typeof tabela === 'object') : [];
  const antt = obterAntt(tabelasValidas);
  const transportadoras = obterTabelasPorTipo(tabelasValidas, 'TRANSPORTADORA');
  const totalRotasTransportadoras = transportadoras.reduce((acc, tabela) => acc + (Array.isArray(tabela.linhas) ? tabela.linhas.length : 0), 0);
  const totalRotas = tabelasValidas.reduce((acc, tabela) => acc + (Array.isArray(tabela.linhas) ? tabela.linhas.length : 0), 0);
  const referenciaMenorPreco = criarReferenciaMenorPreco(transportadoras);

  return {
    antt,
    transportadoras,
    referenciaMenorPreco,
    totalTabelas: tabelasValidas.length,
    totalRotas,
    totalRotasTransportadoras,
    totalTransportadoras: transportadoras.length,
    rotasMelhorPreco: referenciaMenorPreco.rotasUnicas || 0,
    rotasAntt: antt?.linhas?.length || 0,
    rotasUnicasAntt: antt?.rotasUnicas || 0,
  };
}

export function baixarModeloTransportadora() {
  const exemplo = [
    ['Transportadora', 'Origem', 'UF ORIGEM', 'Destino', 'UF DESTINO', 'KM', 'TIPO', 'TARGET', 'ICMS', 'Pedágio'],
    ['TRANSPORTADORA EXEMPLO', 'ITAJAÍ', 'SC', 'MACEIÓ', 'AL', 3024, 'CARRETA BÁU', 23064.05, 0.07, 842],
    ['TRANSPORTADORA EXEMPLO', 'ITUPEVA', 'SP', 'FEIRA DE SANTANA', 'BA', 1873, 'CARRETA BÁU', 14532.38, 0.07, 625.2],
    ['TRANSPORTADORA EXEMPLO', 'JABOATÃO', 'PE', 'FORTALEZA', 'CE', 807, 'CARRETA BÁU', 6824.99664, 0.12, 0],
  ];

  const ws = XLSX.utils.aoa_to_sheet(exemplo);
  ws['!cols'] = [
    { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 26 }, { wch: 12 },
    { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MODELO TRANSPORTADORA');
  XLSX.writeFile(wb, 'modelo_lotacao_transportadora.xlsx');
}

export function baixarModeloAntt() {
  const exemplo = [
    ['Transportadora', 'Origem', 'UF ORIGEM', 'Destino', 'UF DESTINO', 'KM', 'TIPO', 'Frete ANTT Oficial'],
    ['ANTT', 'ITAJAÍ', 'SC', 'MACEIÓ', 'AL', 3024, 'CARRETA BÁU', 23064.05],
    ['ANTT', 'ITUPEVA', 'SP', 'FEIRA DE SANTANA', 'BA', 1873, 'CARRETA BÁU', 14532.38],
    ['ANTT', 'JABOATÃO', 'PE', 'FORTALEZA', 'CE', 807, 'CARRETA BÁU', 6630.7568],
  ];

  const ws = XLSX.utils.aoa_to_sheet(exemplo);
  ws['!cols'] = [
    { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 26 },
    { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 20 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MODELO ANTT');
  XLSX.writeFile(wb, 'modelo_lotacao_antt.xlsx');
}
