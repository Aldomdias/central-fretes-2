import { isTomadorServicoValidoRealizado } from '../utils/realizadoCtes';
const DB_NAME = 'amd-realizado-local-db';
const DB_VERSION = 3;
const STORE_CTES = 'ctes_enxutos';
const STORE_META = 'meta';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_CTES)) {
        const store = db.createObjectStore(STORE_CTES, { keyPath: 'chaveCte' });
        store.createIndex('competencia', 'competencia', { unique: false });
        store.createIndex('dataEmissao', 'dataEmissao', { unique: false });
        store.createIndex('canal', 'canal', { unique: false });
        store.createIndex('transportadora', 'transportadora', { unique: false });
        store.createIndex('ufOrigem', 'ufOrigem', { unique: false });
        store.createIndex('ufDestino', 'ufDestino', { unique: false });
        store.createIndex('chaveRotaIbge', 'chaveRotaIbge', { unique: false });
        store.createIndex('tomadorServico', 'tomadorServico', { unique: false });
      } else {
        const store = req.transaction.objectStore(STORE_CTES);
        if (!store.indexNames.contains('competencia')) store.createIndex('competencia', 'competencia', { unique: false });
        if (!store.indexNames.contains('dataEmissao')) store.createIndex('dataEmissao', 'dataEmissao', { unique: false });
        if (!store.indexNames.contains('canal')) store.createIndex('canal', 'canal', { unique: false });
        if (!store.indexNames.contains('transportadora')) store.createIndex('transportadora', 'transportadora', { unique: false });
        if (!store.indexNames.contains('ufOrigem')) store.createIndex('ufOrigem', 'ufOrigem', { unique: false });
        if (!store.indexNames.contains('ufDestino')) store.createIndex('ufDestino', 'ufDestino', { unique: false });
        if (!store.indexNames.contains('chaveRotaIbge')) store.createIndex('chaveRotaIbge', 'chaveRotaIbge', { unique: false });
        if (!store.indexNames.contains('tomadorServico')) store.createIndex('tomadorServico', 'tomadorServico', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir base local.'));
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro na operação local.'));
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Erro na transação local.'));
    tx.onabort = () => reject(tx.error || new Error('Transação local cancelada.'));
  });
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function normalizeLoose(value) {
  return normalize(value).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isTransportadoraEbazar(value) {
  const nome = normalizeLoose(value);
  return nome.includes('EBAZAR');
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function matchesPeso(row, filtros = {}) {
  const peso = Math.max(toNumber(row.peso), toNumber(row.pesoDeclarado), toNumber(row.pesoCubado));
  const min = filtros.pesoMin !== '' && filtros.pesoMin !== null && filtros.pesoMin !== undefined ? Number(filtros.pesoMin) : null;
  const max = filtros.pesoMax !== '' && filtros.pesoMax !== null && filtros.pesoMax !== undefined ? Number(filtros.pesoMax) : null;
  if (Number.isFinite(min) && peso < min) return false;
  if (Number.isFinite(max) && peso > max) return false;
  return true;
}

export function filtrarCteLocal(row = {}, filtros = {}) {
  if (filtros.competencia && row.competencia !== filtros.competencia) return false;
  if (filtros.inicio && (!row.dataEmissao || row.dataEmissao.slice(0, 10) < filtros.inicio)) return false;
  if (filtros.fim && (!row.dataEmissao || row.dataEmissao.slice(0, 10) > filtros.fim)) return false;
  if (filtros.canal && normalize(row.canal) !== normalize(filtros.canal)) return false;
  if (filtros.excluirEbazar && isTransportadoraEbazar(row.transportadora)) return false;
  if (filtros.transportadoraRealizada && !normalizeLoose(row.transportadora).includes(normalizeLoose(filtros.transportadoraRealizada))) return false;
  if (filtros.ufOrigem && normalize(row.ufOrigem) !== normalize(filtros.ufOrigem)) return false;
  if (filtros.ufDestino && normalize(row.ufDestino) !== normalize(filtros.ufDestino)) return false;
  if (filtros.origem && !normalizeLoose(row.cidadeOrigem).includes(normalizeLoose(filtros.origem))) return false;
  if (filtros.destino && !normalizeLoose(row.cidadeDestino).includes(normalizeLoose(filtros.destino))) return false;
  if (filtros.somentePendenciasIbge && row.ibgeOk) return false;
  if (!matchesPeso(row, filtros)) return false;
  return true;
}

export async function salvarRealizadoLocal(registros = [], options = {}) {
  const db = await openDb();
  const chunkSize = options.chunkSize || 1000;
  let salvos = 0;

  for (let index = 0; index < registros.length; index += chunkSize) {
    const chunk = registros.slice(index, index + chunkSize);
    const tx = db.transaction([STORE_CTES, STORE_META], 'readwrite');
    const store = tx.objectStore(STORE_CTES);
    chunk.forEach((row) => store.put(row));
    tx.objectStore(STORE_META).put({
      key: 'ultimaAtualizacao',
      value: new Date().toISOString(),
    });
    await txComplete(tx);
    salvos += chunk.length;
    options.onProgress?.({ salvos, total: registros.length });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  db.close();
  return { salvos };
}

export async function listarRealizadoLocal(filtros = {}, options = {}) {
  const db = await openDb();
  const limit = Number(options.limit || 200);
  const rows = [];
  let avaliados = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CTES, 'readonly');
    const store = tx.objectStore(STORE_CTES);
    const req = store.openCursor(null, 'prev');
    req.onerror = () => reject(req.error || new Error('Erro ao listar base local.'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || rows.length >= limit) {
        resolve();
        return;
      }
      avaliados += 1;
      const row = cursor.value;
      if (filtrarCteLocal(row, filtros)) rows.push(row);
      cursor.continue();
    };
  });

  db.close();
  return { rows, avaliados };
}

function normalizeCanalParaMalha(value) {
  const canal = normalize(value);
  if (!canal) return '';
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  if (['ATACADO', 'B2B', 'CANTU', 'CANTU PNEUS'].some((item) => canal === item || canal.includes(item))) return 'ATACADO';
  if (['B2C', 'VIA VAREJO', 'MERCADO LIVRE', 'MERCADOR LIVRE', 'B2W', 'MAGAZINE LUIZA', 'CARREFOUR', 'GPA', 'COLOMBO', 'AMAZON', 'INTER', 'ANYMARKET', 'ANY MARKET', 'BRADESCO SHOP', 'ITAU SHOP', 'ITAÚ SHOP', 'SHOPEE', 'LIVELO', 'MARKETPLACE', 'MARKET PLACE', 'ECOMMERCE', 'E-COMMERCE'].some((item) => canal === item || canal.includes(item))) return 'B2C';
  return canal;
}

function chaveMalhaCte(row = {}) {
  const canal = normalizeCanalParaMalha(row.canal);
  const rota = String(row.chaveRotaIbge || '').trim();
  return canal && rota ? `${canal}|${rota}` : '';
}

export async function buscarRealizadoLocalPorMalha(filtros = {}, malhaKeys = [], options = {}) {
  const keys = malhaKeys instanceof Set ? malhaKeys : new Set(malhaKeys || []);
  if (!keys.size) return { rows: [], totalCompativel: 0, limit: Number(options.limit || 5000), malhaKeys: 0, avaliados: 0 };

  const db = await openDb();
  const limit = Number(options.limit || 5000);
  const rows = [];
  let totalCompativel = 0;
  let avaliados = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CTES, 'readonly');
    const store = tx.objectStore(STORE_CTES);
    const req = store.openCursor(null, 'prev');
    req.onerror = () => reject(req.error || new Error('Erro ao buscar base local pela malha da transportadora.'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      avaliados += 1;
      const row = cursor.value;
      if (keys.has(chaveMalhaCte(row)) && filtrarCteLocal(row, filtros)) {
        totalCompativel += 1;
        if (rows.length < limit) rows.push(row);
      }
      cursor.continue();
    };
  });

  db.close();
  return { rows, totalCompativel, limit, malhaKeys: keys.size, avaliados };
}

export async function buscarRealizadoLocalParaSimulacao(filtros = {}, options = {}) {
  const db = await openDb();
  const limit = Number(options.limit || 5000);
  const rows = [];
  let totalCompativel = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CTES, 'readonly');
    const store = tx.objectStore(STORE_CTES);
    const req = store.openCursor(null, 'prev');
    req.onerror = () => reject(req.error || new Error('Erro ao buscar base local para simulação.'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const row = cursor.value;
      if (filtrarCteLocal(row, filtros)) {
        totalCompativel += 1;
        if (rows.length < limit) rows.push(row);
      }
      cursor.continue();
    };
  });

  db.close();
  return { rows, totalCompativel, limit };
}

export async function resumirRealizadoLocal(filtros = {}, options = {}) {
  const db = await openDb();
  const resumo = {
    total: 0,
    comIbge: 0,
    pendenciasIbge: 0,
    valorCte: 0,
    valorNF: 0,
    peso: 0,
    cubagem: 0,
    volumes: 0,
    periodoInicio: '',
    periodoFim: '',
    porTransportadora: new Map(),
    porCanal: new Map(),
    porOrigem: new Map(),
    porDestino: new Map(),
    porUfDestino: new Map(),
    porMes: new Map(),
  };

  const addGroup = (map, key, row) => {
    const safeKey = key || 'Não informado';
    const atual = map.get(safeKey) || { chave: safeKey, ctes: 0, frete: 0, nf: 0, peso: 0 };
    atual.ctes += 1;
    atual.frete += toNumber(row.valorCte);
    atual.nf += toNumber(row.valorNF);
    atual.peso += toNumber(row.peso);
    map.set(safeKey, atual);
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CTES, 'readonly');
    const store = tx.objectStore(STORE_CTES);
    const req = store.openCursor();
    req.onerror = () => reject(req.error || new Error('Erro ao resumir base local.'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const row = cursor.value;
      if (filtrarCteLocal(row, filtros)) {
        resumo.total += 1;
        if (row.ibgeOk) resumo.comIbge += 1;
        else resumo.pendenciasIbge += 1;
        resumo.valorCte += toNumber(row.valorCte);
        resumo.valorNF += toNumber(row.valorNF);
        resumo.peso += toNumber(row.peso);
        resumo.cubagem += toNumber(row.cubagem);
        resumo.volumes += toNumber(row.qtdVolumes);
        const data = row.dataEmissao || '';
        if (data) {
          if (!resumo.periodoInicio || data < resumo.periodoInicio) resumo.periodoInicio = data;
          if (!resumo.periodoFim || data > resumo.periodoFim) resumo.periodoFim = data;
        }
        addGroup(resumo.porTransportadora, row.transportadora, row);
        addGroup(resumo.porCanal, row.canal, row);
        addGroup(resumo.porOrigem, `${row.cidadeOrigem}/${row.ufOrigem}`, row);
        addGroup(resumo.porDestino, `${row.cidadeDestino}/${row.ufDestino}`, row);
        addGroup(resumo.porUfDestino, row.ufDestino || 'Sem UF', row);
        addGroup(resumo.porMes, row.competencia || data.slice(0, 7), row);
      }
      cursor.continue();
    };
  });

  db.close();

  const finalize = (map) => [...map.values()]
    .map((item) => ({ ...item, percentual: item.nf > 0 ? (item.frete / item.nf) * 100 : 0 }))
    .sort((a, b) => b.frete - a.frete || b.ctes - a.ctes)
    .slice(0, options.top || 10);

  return {
    ...resumo,
    percentualFrete: resumo.valorNF > 0 ? (resumo.valorCte / resumo.valorNF) * 100 : 0,
    porTransportadora: finalize(resumo.porTransportadora),
    porCanal: finalize(resumo.porCanal),
    porOrigem: finalize(resumo.porOrigem),
    porDestino: finalize(resumo.porDestino),
    porUfDestino: finalize(resumo.porUfDestino),
    porMes: finalize(resumo.porMes),
  };
}

export async function exportarRealizadoLocal(filtros = {}, options = {}) {
  const db = await openDb();
  const limit = Number(options.limit || 100000);
  const rows = [];
  let totalCompativel = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CTES, 'readonly');
    const store = tx.objectStore(STORE_CTES);
    const req = store.openCursor(null, 'prev');
    req.onerror = () => reject(req.error || new Error('Erro ao exportar base local.'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const row = cursor.value;
      if (filtrarCteLocal(row, filtros)) {
        totalCompativel += 1;
        if (rows.length < limit) rows.push(row);
      }
      cursor.continue();
    };
  });

  db.close();
  return { rows, totalCompativel, limit };
}

export async function diagnosticarRealizadoLocal() {
  const db = await openDb();
  const tx = db.transaction([STORE_CTES, STORE_META], 'readonly');
  const count = await requestToPromise(tx.objectStore(STORE_CTES).count());
  const meta = await requestToPromise(tx.objectStore(STORE_META).get('ultimaAtualizacao')).catch(() => null);
  db.close();
  return { total: count || 0, ultimaAtualizacao: meta?.value || '' };
}

export async function limparNaoTomadoresRealizadoLocal(options = {}) {
  const db = await openDb();
  let avaliados = 0;
  let removidos = 0;
  let mantidos = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CTES, 'readwrite');
    const store = tx.objectStore(STORE_CTES);
    const req = store.openCursor();

    req.onerror = () => reject(req.error || new Error('Erro ao limpar tomadores da base local.'));
    tx.onerror = () => reject(tx.error || new Error('Erro na transação de limpeza de tomadores.'));
    tx.oncomplete = () => resolve();

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      avaliados += 1;
      const row = cursor.value || {};
      if (!isTomadorServicoValidoRealizado(row.tomadorServico)) {
        cursor.delete();
        removidos += 1;
      } else {
        mantidos += 1;
      }
      if (avaliados % 1000 === 0) options.onProgress?.({ avaliados, removidos, mantidos });
      cursor.continue();
    };
  });

  const txMeta = db.transaction(STORE_META, 'readwrite');
  txMeta.objectStore(STORE_META).put({
    key: 'ultimaLimpezaTomador',
    value: new Date().toISOString(),
    avaliados,
    removidos,
    mantidos,
  });
  await txComplete(txMeta);
  db.close();
  return { avaliados, removidos, mantidos };
}

export async function limparRealizadoLocal() {
  const db = await openDb();
  const tx = db.transaction([STORE_CTES, STORE_META], 'readwrite');
  tx.objectStore(STORE_CTES).clear();
  tx.objectStore(STORE_META).put({ key: 'ultimaAtualizacao', value: '' });
  await txComplete(tx);
  db.close();
  return { ok: true };
}
