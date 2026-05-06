import * as XLSX from 'xlsx';

const DB_NAME = 'amd-tracking-local-db';
const DB_VERSION = 1;
const STORE_TRACKING = 'tracking_rows';
const STORE_META = 'meta';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRACKING)) {
        const store = db.createObjectStore(STORE_TRACKING, { keyPath: 'id' });
        store.createIndex('data', 'data', { unique: false });
        store.createIndex('canal', 'canal', { unique: false });
        store.createIndex('transportadora', 'transportadora', { unique: false });
        store.createIndex('ufOrigem', 'ufOrigem', { unique: false });
        store.createIndex('ufDestino', 'ufDestino', { unique: false });
        store.createIndex('chaveRotaIbge', 'chaveRotaIbge', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir base local de Tracking.'));
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Erro na transação local de Tracking.'));
    tx.onabort = () => reject(tx.error || new Error('Transação local de Tracking cancelada.'));
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro na leitura local de Tracking.'));
  });
}

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function normalizeLoose(value = '') {
  return normalize(value).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return Number(normalized.replace(/[^0-9.-]/g, '')) || 0;
}

function text(value) {
  return String(value ?? '').trim();
}

function parseDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/);
  if (br) return `${br[3]}-${String(br[2]).padStart(2, '0')}-${String(br[1]).padStart(2, '0')}`;
  return '';
}

function categoriaCanal(value) {
  const canal = normalize(value);
  if (!canal) return '';
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  if (['ATACADO', 'B2B', 'CANTU', 'CANTU PNEUS'].some((item) => canal === item || canal.includes(item))) return 'ATACADO';
  if (['B2C', 'ECOMMERCE', 'E-COMMERCE', 'MARKETPLACE', 'MARKET PLACE', 'MERCADO LIVRE', 'MAGAZINE LUIZA', 'SHOPEE', 'AMAZON'].some((item) => canal === item || canal.includes(item))) return 'B2C';
  return canal;
}

function headerKey(value) {
  return normalize(value).replace(/[^A-Z0-9]+/g, ' ').trim();
}

function findCol(headers, terms = []) {
  const normalized = headers.map(headerKey);
  return normalized.findIndex((h) => terms.some((term) => h === term || h.includes(term)));
}

function detectHeader(rows = []) {
  let best = { index: -1, score: -1 };
  rows.slice(0, 30).forEach((row, index) => {
    const h = row.map(headerKey).join(' | ');
    let score = 0;
    if (h.includes('NOTA') || h.includes('NF')) score += 3;
    if (h.includes('ORIGEM')) score += 3;
    if (h.includes('DESTINO')) score += 3;
    if (h.includes('PESO')) score += 2;
    if (h.includes('CUBAGEM') || h.includes('M3') || h.includes('METROS CUBICOS')) score += 2;
    if (h.includes('VALOR')) score += 1;
    if (score > best.score) best = { index, score };
  });
  return best.score >= 5 ? best.index : 0;
}

function get(row, col) {
  if (col === null || col === undefined || col < 0) return '';
  return row[col] ?? '';
}

function mapColumns(headers = []) {
  return {
    notaFiscal: findCol(headers, ['NOTA FISCAL', 'NF', 'NUMERO NF', 'NFE', 'DOCUMENTO']),
    chaveNfe: findCol(headers, ['CHAVE NFE', 'CHAVE NF', 'CHAVE NOTA', 'CHAVE ACESSO']),
    pedido: findCol(headers, ['PEDIDO', 'ORDER', 'ORDEM']),
    data: findCol(headers, ['DATA EMISSAO', 'EMISSAO', 'DATA NF', 'DATA PEDIDO', 'DATA']),
    canal: findCol(headers, ['CANAL', 'CANAL VENDA', 'CANAL VENDAS', 'TIPO CANAL']),
    transportadora: findCol(headers, ['TRANSPORTADORA', 'FORNECEDOR', 'OPERADOR', 'CARRIER']),
    origem: findCol(headers, ['CIDADE ORIGEM', 'ORIGEM', 'MUNICIPIO ORIGEM']),
    ufOrigem: findCol(headers, ['UF ORIGEM', 'UF ORIG', 'ESTADO ORIGEM']),
    ibgeOrigem: findCol(headers, ['IBGE ORIGEM', 'CODIGO IBGE ORIGEM', 'COD MUNICIPIO ORIGEM']),
    destino: findCol(headers, ['CIDADE DESTINO', 'DESTINO', 'MUNICIPIO DESTINO', 'CIDADE ENTREGA']),
    ufDestino: findCol(headers, ['UF DESTINO', 'UF DEST', 'ESTADO DESTINO', 'UF ENTREGA']),
    ibgeDestino: findCol(headers, ['IBGE DESTINO', 'CODIGO IBGE DESTINO', 'COD MUNICIPIO DESTINO']),
    peso: findCol(headers, ['PESO', 'PESO REAL', 'PESO TOTAL', 'PESO BRUTO', 'PESO KG']),
    cubagem: findCol(headers, ['CUBAGEM', 'M3', 'METROS CUBICOS', 'METRAGEM CUBICA']),
    valorNF: findCol(headers, ['VALOR NF', 'VALOR NOTA', 'VALOR DA NOTA', 'VALOR MERCADORIA', 'VLR NF']),
    volumes: findCol(headers, ['VOLUMES', 'VOLUME', 'QTD VOLUMES', 'QTDE VOLUMES', 'QUANTIDADE VOLUMES']),
    status: findCol(headers, ['STATUS', 'SITUACAO', 'SITUAÇÃO']),
    entrega: findCol(headers, ['DATA ENTREGA', 'ENTREGA', 'DT ENTREGA']),
  };
}

function rowHasValue(row = []) {
  return row.some((value) => String(value ?? '').trim() !== '');
}

async function parseFile(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dense: false });
  const rows = [];
  const abas = [];

  wb.SheetNames.forEach((sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const headerIndex = detectHeader(matriz);
    const headers = matriz[headerIndex] || [];
    const col = mapColumns(headers);
    let totalAba = 0;

    matriz.slice(headerIndex + 1).forEach((linha, index) => {
      if (!rowHasValue(linha)) return;
      const notaFiscal = text(get(linha, col.notaFiscal));
      const chaveNfe = onlyDigits(get(linha, col.chaveNfe));
      const pedido = text(get(linha, col.pedido));
      const origem = text(get(linha, col.origem));
      const destino = text(get(linha, col.destino));
      const data = parseDate(get(linha, col.data));
      const peso = toNumber(get(linha, col.peso));
      const valorNF = toNumber(get(linha, col.valorNF));
      if (!notaFiscal && !chaveNfe && !pedido && !origem && !destino) return;

      const ibgeOrigem = onlyDigits(get(linha, col.ibgeOrigem)).slice(0, 7);
      const ibgeDestino = onlyDigits(get(linha, col.ibgeDestino)).slice(0, 7);
      const row = {
        id: chaveNfe || `${normalizeLoose(notaFiscal || pedido || file.name)}-${sheetName}-${headerIndex + index + 2}`.slice(0, 240),
        notaFiscal,
        chaveNfe,
        pedido,
        data,
        competencia: data ? data.slice(0, 7) : '',
        canal: categoriaCanal(get(linha, col.canal)),
        canalOriginal: text(get(linha, col.canal)),
        transportadora: text(get(linha, col.transportadora)),
        cidadeOrigem: origem,
        ufOrigem: text(get(linha, col.ufOrigem)).toUpperCase().slice(0, 2),
        ibgeOrigem,
        cidadeDestino: destino,
        ufDestino: text(get(linha, col.ufDestino)).toUpperCase().slice(0, 2),
        ibgeDestino,
        chaveRotaIbge: ibgeOrigem && ibgeDestino ? `${ibgeOrigem}-${ibgeDestino}` : '',
        peso,
        cubagem: toNumber(get(linha, col.cubagem)),
        valorNF,
        qtdVolumes: toNumber(get(linha, col.volumes)),
        status: text(get(linha, col.status)),
        entrega: parseDate(get(linha, col.entrega)),
        arquivoOrigem: file.name || '',
        abaOrigem: sheetName,
        linhaExcel: headerIndex + index + 2,
        criadoEm: new Date().toISOString(),
      };
      rows.push(row);
      totalAba += 1;
    });
    abas.push({ nome: sheetName, linhas: totalAba });
  });

  return { rows, abas };
}

export async function importarTrackingLocal(files = [], options = {}) {
  const lista = Array.from(files || []);
  const db = await openDb();
  let total = 0;
  const detalhes = [];

  for (const file of lista) {
    const { rows, abas } = await parseFile(file);
    detalhes.push({ arquivo: file.name, linhas: rows.length, abas });
    for (let index = 0; index < rows.length; index += 1000) {
      const chunk = rows.slice(index, index + 1000);
      const tx = db.transaction([STORE_TRACKING, STORE_META], 'readwrite');
      const store = tx.objectStore(STORE_TRACKING);
      chunk.forEach((row) => store.put(row));
      tx.objectStore(STORE_META).put({ key: 'ultimaAtualizacao', value: new Date().toISOString() });
      await txComplete(tx);
      total += chunk.length;
      options.onProgress?.({ total, arquivo: file.name });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  db.close();
  return { total, detalhes };
}

function isEbazar(value) {
  return normalizeLoose(value).includes('EBAZAR');
}

export function filtrarTrackingLocal(row = {}, filtros = {}) {
  if (filtros.inicio && (!row.data || row.data < filtros.inicio)) return false;
  if (filtros.fim && (!row.data || row.data > filtros.fim)) return false;
  if (filtros.canal && normalize(row.canal) !== normalize(filtros.canal)) return false;
  if (filtros.excluirEbazar && isEbazar(row.transportadora)) return false;
  if (filtros.ufOrigem && normalize(row.ufOrigem) !== normalize(filtros.ufOrigem)) return false;
  if (filtros.ufDestino && normalize(row.ufDestino) !== normalize(filtros.ufDestino)) return false;
  if (filtros.origem && !normalizeLoose(row.cidadeOrigem).includes(normalizeLoose(filtros.origem))) return false;
  if (filtros.destino && !normalizeLoose(row.cidadeDestino).includes(normalizeLoose(filtros.destino))) return false;
  if (filtros.transportadora && !normalizeLoose(row.transportadora).includes(normalizeLoose(filtros.transportadora))) return false;
  return true;
}

export async function exportarTrackingLocal(filtros = {}, options = {}) {
  const db = await openDb();
  const limit = Number(options.limit || 500000);
  const rows = [];
  let totalCompativel = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKING, 'readonly');
    const store = tx.objectStore(STORE_TRACKING);
    const req = store.openCursor(null, 'prev');
    req.onerror = () => reject(req.error || new Error('Erro ao exportar Tracking local.'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      const row = cursor.value;
      if (filtrarTrackingLocal(row, filtros)) {
        totalCompativel += 1;
        if (rows.length < limit) rows.push(row);
      }
      cursor.continue();
    };
  });

  db.close();
  return { rows, totalCompativel, limit };
}

export async function listarTrackingLocal(filtros = {}, options = {}) {
  const { rows } = await exportarTrackingLocal(filtros, { limit: options.limit || 200 });
  return { rows };
}

export async function diagnosticarTrackingLocal() {
  const db = await openDb();
  const tx = db.transaction([STORE_TRACKING, STORE_META], 'readonly');
  const count = await requestToPromise(tx.objectStore(STORE_TRACKING).count());
  const meta = await requestToPromise(tx.objectStore(STORE_META).get('ultimaAtualizacao')).catch(() => null);
  db.close();
  return { total: count || 0, ultimaAtualizacao: meta?.value || '' };
}

export async function resumirTrackingLocal(filtros = {}) {
  const { rows, totalCompativel } = await exportarTrackingLocal(filtros, { limit: 500000 });
  const resumo = rows.reduce((acc, row) => {
    acc.notas += 1;
    acc.valorNF += toNumber(row.valorNF);
    acc.peso += toNumber(row.peso);
    acc.cubagem += toNumber(row.cubagem);
    acc.volumes += toNumber(row.qtdVolumes);
    if (row.data) {
      if (!acc.periodoInicio || row.data < acc.periodoInicio) acc.periodoInicio = row.data;
      if (!acc.periodoFim || row.data > acc.periodoFim) acc.periodoFim = row.data;
    }
    return acc;
  }, { notas: 0, valorNF: 0, peso: 0, cubagem: 0, volumes: 0, periodoInicio: '', periodoFim: '', totalCompativel });
  return resumo;
}

export async function limparTrackingLocal() {
  const db = await openDb();
  const tx = db.transaction([STORE_TRACKING, STORE_META], 'readwrite');
  tx.objectStore(STORE_TRACKING).clear();
  tx.objectStore(STORE_META).put({ key: 'ultimaAtualizacao', value: '' });
  await txComplete(tx);
  db.close();
  return { ok: true };
}
