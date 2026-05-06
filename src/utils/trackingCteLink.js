function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function pushKey(keys, tipo, value) {
  const raw = String(value || '').trim();
  if (!raw) return;

  if (tipo === 'chave_cte' || tipo === 'chave_nf') {
    const digits = onlyDigits(raw);
    if (digits.length >= 20) keys.push(`${tipo}:${digits}`);
    return;
  }

  if (tipo === 'numero_cte') {
    const digits = onlyDigits(raw).replace(/^0+/, '');
    if (digits) keys.push(`${tipo}:${digits}`);
    return;
  }

  if (tipo === 'numero_nf') {
    const digits = onlyDigits(raw).replace(/^0+/, '');
    if (digits) keys.push(`${tipo}:${digits}`);
    return;
  }

  const normalized = normalizeText(raw);
  if (normalized) keys.push(`${tipo}:${normalized}`);
}

function keysFromCte(row = {}) {
  const keys = [];

  pushKey(keys, 'chave_cte', pickFirst(
    row.chaveCte,
    row.chave_cte,
    row.chaveCTe,
    row.chaveConhecimento,
    row.chaveConhecimentoTransporte,
    row.raw?.chaveCte,
    row.raw?.chave_cte,
    row.raw?.chaveCTe
  ));

  pushKey(keys, 'numero_cte', pickFirst(
    row.numeroCte,
    row.numero_cte,
    row.cteNumero,
    row.cte,
    row.nroCte,
    row.raw?.numeroCte,
    row.raw?.numero_cte,
    row.raw?.cte,
    row.raw?.ctrc
  ));

  pushKey(keys, 'chave_nf', pickFirst(
    row.chaveNf,
    row.chaveNF,
    row.chaveNfe,
    row.chaveNFe,
    row.nfChave,
    row.chaveNota,
    row.chaveNotaFiscal,
    row.raw?.chaveNf,
    row.raw?.chaveNF,
    row.raw?.chaveNfe,
    row.raw?.nfChave,
    row.raw?.chaveNotaFiscal
  ));

  pushKey(keys, 'numero_nf', pickFirst(
    row.numeroNf,
    row.numeroNF,
    row.nfNumero,
    row.notaFiscal,
    row.notaFiscalNumero,
    row.raw?.numeroNf,
    row.raw?.numeroNF,
    row.raw?.nfNumero,
    row.raw?.notaFiscal
  ));

  return [...new Set(keys)];
}

function keysFromTracking(row = {}) {
  const keys = [];

  pushKey(keys, 'chave_cte', pickFirst(
    row.chaveCte,
    row.chave_cte,
    row.cteChave,
    row.chaveCTe,
    row.raw?.chaveCte,
    row.raw?.chave_cte,
    row.raw?.cteChave
  ));

  pushKey(keys, 'numero_cte', pickFirst(
    row.numeroCte,
    row.numero_cte,
    row.cteNumero,
    row.cte,
    row.raw?.numeroCte,
    row.raw?.numero_cte,
    row.raw?.cteNumero,
    row.raw?.cte
  ));

  pushKey(keys, 'chave_nf', pickFirst(
    row.chaveNf,
    row.chaveNF,
    row.chaveNfe,
    row.chaveNFe,
    row.nfChave,
    row.chaveNota,
    row.chaveNotaFiscal,
    row.raw?.['NF Chave'],
    row.raw?.nfChave,
    row.raw?.chaveNf,
    row.raw?.chaveNF,
    row.raw?.chaveNfe,
    row.raw?.chaveNotaFiscal
  ));

  pushKey(keys, 'numero_nf', pickFirst(
    row.numeroNf,
    row.numeroNF,
    row.nfNumero,
    row.notaFiscal,
    row.notaFiscalNumero,
    row.raw?.['NF Numero'],
    row.raw?.numeroNf,
    row.raw?.numeroNF,
    row.raw?.nfNumero,
    row.raw?.notaFiscal
  ));

  return [...new Set(keys)];
}

function cteIdentity(row = {}) {
  const chave = onlyDigits(pickFirst(row.chaveCte, row.chave_cte, row.chaveCTe, row.raw?.chaveCte, row.raw?.chave_cte));
  if (chave) return `chave:${chave}`;

  const numero = onlyDigits(pickFirst(row.numeroCte, row.numero_cte, row.cteNumero, row.cte, row.raw?.numeroCte, row.raw?.cte)).replace(/^0+/, '');
  if (numero) return `numero:${numero}`;

  return `row:${normalizeText(JSON.stringify(row)).slice(0, 200)}`;
}

function buildCteIndex(ctes = []) {
  const index = new Map();

  (ctes || []).forEach((cte) => {
    keysFromCte(cte).forEach((key) => {
      const list = index.get(key) || [];
      list.push(cte);
      index.set(key, list);
    });
  });

  return index;
}

function findMatches(row = {}, index) {
  const keys = keysFromTracking(row);
  const matches = [];
  const seen = new Set();
  let keyUsada = '';

  for (const key of keys) {
    const list = index.get(key) || [];
    if (!list.length) continue;
    keyUsada = keyUsada || key;
    list.forEach((cte) => {
      const id = cteIdentity(cte);
      if (seen.has(id)) return;
      seen.add(id);
      matches.push(cte);
    });
  }

  return { matches, keyUsada };
}

function cteNumero(row = {}) {
  return String(pickFirst(row.numeroCte, row.numero_cte, row.cteNumero, row.cte, row.raw?.numeroCte, row.raw?.cte) || '').trim();
}

function cteTransportadora(row = {}) {
  return String(pickFirst(row.transportadora, row.nomeTransportadora, row.transportadoraNome, row.raw?.transportadora) || '').trim();
}

function cteValor(row = {}) {
  return toNumber(pickFirst(row.valorCte, row.valorCTe, row.valorFrete, row.freteRealizado, row.raw?.valorCte, row.raw?.valorFrete));
}

export function relacionarTrackingComCtes(trackingRows = [], cteRows = []) {
  const index = buildCteIndex(cteRows || []);
  let vinculadas = 0;
  let semVinculo = 0;
  let valorCteVinculadoTotal = 0;

  const rows = (trackingRows || []).map((row) => {
    const { matches, keyUsada } = findMatches(row, index);
    const valorCteVinculado = matches.reduce((acc, item) => acc + cteValor(item), 0);
    const valorNf = toNumber(row.valorNF || row.valorNf || row.valorNota || row.raw?.['Valor da NF']);
    const qtd = matches.length;

    if (qtd) vinculadas += 1;
    else semVinculo += 1;
    valorCteVinculadoTotal += valorCteVinculado;

    return {
      ...row,
      qtdCtesVinculados: qtd,
      valorCteVinculado,
      percentualFreteCteVinculado: valorNf > 0 ? (valorCteVinculado / valorNf) * 100 : 0,
      transportadorasCte: [...new Set(matches.map(cteTransportadora).filter(Boolean))].join(' | '),
      numerosCteVinculados: [...new Set(matches.map(cteNumero).filter(Boolean))].join(' | '),
      chaveRelacaoUsada: keyUsada || '',
      ctesVinculados: matches,
    };
  });

  return {
    rows,
    resumo: {
      totalTracking: trackingRows.length,
      totalCtes: cteRows.length,
      vinculadas,
      semVinculo,
      percentualVinculado: trackingRows.length ? (vinculadas / trackingRows.length) * 100 : 0,
      valorCteVinculadoTotal,
    },
  };
}

export default relacionarTrackingComCtes;
