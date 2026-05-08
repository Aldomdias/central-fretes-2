import { isTomadorServicoValidoRealizado } from '../utils/realizadoCtes';
import { getSupabaseClient, getSupabaseInfo, isSupabaseConfigured } from '../lib/supabaseClient';
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

async function salvarRealizadoLocalIndexedDb(registros = [], options = {}) {
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

async function listarRealizadoLocalIndexedDb(filtros = {}, options = {}) {
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

async function buscarRealizadoLocalPorMalhaIndexedDb(filtros = {}, malhaKeys = [], options = {}) {
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

async function buscarRealizadoLocalParaSimulacaoIndexedDb(filtros = {}, options = {}) {
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

async function resumirRealizadoLocalIndexedDb(filtros = {}, options = {}) {
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

async function exportarRealizadoLocalIndexedDb(filtros = {}, options = {}) {
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

async function diagnosticarRealizadoLocalIndexedDb() {
  const db = await openDb();
  const tx = db.transaction([STORE_CTES, STORE_META], 'readonly');
  const count = await requestToPromise(tx.objectStore(STORE_CTES).count());
  const meta = await requestToPromise(tx.objectStore(STORE_META).get('ultimaAtualizacao')).catch(() => null);
  db.close();
  return { total: count || 0, ultimaAtualizacao: meta?.value || '' };
}

async function limparNaoTomadoresRealizadoLocalIndexedDb(options = {}) {
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

async function limparRealizadoLocalIndexedDb() {
  const db = await openDb();
  const tx = db.transaction([STORE_CTES, STORE_META], 'readwrite');
  tx.objectStore(STORE_CTES).clear();
  tx.objectStore(STORE_META).put({ key: 'ultimaAtualizacao', value: '' });
  await txComplete(tx);
  db.close();
  return { ok: true };
}


// -----------------------------------------------------------------------------
// Camada online do Realizado.
// Mantém as mesmas funções usadas pela tela RealizadoLocalPage, mas grava/consulta
// no Supabase. O IndexedDB acima fica apenas como fallback quando o Supabase não
// estiver configurado ou em caso de emergência.
// -----------------------------------------------------------------------------
const REALIZADO_ONLINE_TABLE = 'realizado_local_ctes';
const REALIZADO_ONLINE_SELECT = [
  'chave_cte', 'competencia', 'data_emissao', 'numero_cte', 'transportadora', 'cnpj_transportadora', 'tomador_servico',
  'cidade_origem', 'uf_origem', 'ibge_origem', 'cidade_destino', 'uf_destino', 'ibge_destino', 'chave_rota_ibge',
  'peso', 'peso_declarado', 'peso_cubado', 'cubagem', 'valor_nf', 'valor_cte', 'qtd_volumes', 'canal', 'canal_original',
  'arquivo_origem', 'ibge_ok', 'ibge_corrigido_origem', 'ibge_corrigido_destino', 'created_at', 'updated_at'
].join(',');

function supabaseRealizadoDisponivel() {
  return Boolean(isSupabaseConfigured() && getSupabaseClient());
}

function ensureRealizadoOnlineClient() {
  const client = getSupabaseClient();
  if (!client || !isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Vercel.');
  }
  return client;
}

function cleanTextOnline(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function cleanUfOnline(value) {
  return cleanTextOnline(value).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

function cleanDigitsOnline(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function toSafeNumberOnline(value, max = 999999999999) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  if (number > max) return max;
  if (number < -max) return -max;
  return number;
}

function dateOrNullOnline(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10) || null;
  return parsed.toISOString();
}

function montarChaveCteOnline(row = {}) {
  const chaveInformada = cleanTextOnline(row.chaveCte || row.chave_cte);
  if (chaveInformada) return chaveInformada;

  // Algumas bases vêm sem chave completa do CT-e. Para não descartar essas linhas
  // e ainda impedir duplicidade, criamos uma chave determinística com os campos
  // mais estáveis do arquivo. Reimportar o mesmo arquivo atualiza a mesma linha.
  const numeroCte = cleanTextOnline(row.numeroCte || row.numero_cte);
  const transportadora = cleanTextOnline(row.transportadora);
  const cnpj = cleanDigitsOnline(row.cnpjTransportadora || row.cnpj_transportadora);
  const emissao = cleanTextOnline(row.dataEmissao || row.data_emissao || row.emissao).slice(0, 10);
  const origem = cleanTextOnline(row.cidadeOrigem || row.cidade_origem);
  const destino = cleanTextOnline(row.cidadeDestino || row.cidade_destino);
  const valor = String(toSafeNumberOnline(row.valorCte ?? row.valor_cte, 999999999)).replace('.', ',');
  const fallback = [numeroCte, cnpj || transportadora, emissao, origem, destino, valor]
    .map((item) => normalizeLoose(item))
    .filter(Boolean)
    .join('|');

  return fallback ? `AUTO|${fallback}` : '';
}

function toDbRealizadoLocal(row = {}) {
  const chaveCte = montarChaveCteOnline(row);
  const dataEmissao = dateOrNullOnline(row.dataEmissao || row.data_emissao || row.emissao);
  return {
    chave_cte: chaveCte,
    competencia: cleanTextOnline(row.competencia),
    data_emissao: dataEmissao,
    numero_cte: cleanTextOnline(row.numeroCte || row.numero_cte),
    transportadora: cleanTextOnline(row.transportadora),
    cnpj_transportadora: cleanDigitsOnline(row.cnpjTransportadora || row.cnpj_transportadora),
    tomador_servico: cleanTextOnline(row.tomadorServico || row.tomador_servico),
    cidade_origem: cleanTextOnline(row.cidadeOrigem || row.cidade_origem),
    uf_origem: cleanUfOnline(row.ufOrigem || row.uf_origem),
    ibge_origem: cleanDigitsOnline(row.ibgeOrigem || row.ibge_origem).slice(0, 7),
    cidade_destino: cleanTextOnline(row.cidadeDestino || row.cidade_destino),
    uf_destino: cleanUfOnline(row.ufDestino || row.uf_destino),
    ibge_destino: cleanDigitsOnline(row.ibgeDestino || row.ibge_destino).slice(0, 7),
    chave_rota_ibge: cleanTextOnline(row.chaveRotaIbge || row.chave_rota_ibge),
    peso: toSafeNumberOnline(row.peso),
    peso_declarado: toSafeNumberOnline(row.pesoDeclarado ?? row.peso_declarado),
    peso_cubado: toSafeNumberOnline(row.pesoCubado ?? row.peso_cubado),
    cubagem: toSafeNumberOnline(row.cubagem),
    valor_nf: toSafeNumberOnline(row.valorNF ?? row.valor_nf),
    valor_cte: toSafeNumberOnline(row.valorCte ?? row.valor_cte),
    qtd_volumes: toSafeNumberOnline(row.qtdVolumes ?? row.qtd_volumes ?? row.volume),
    canal: cleanTextOnline(row.canal),
    canal_original: cleanTextOnline(row.canalOriginal || row.canal_original),
    arquivo_origem: cleanTextOnline(row.arquivoOrigem || row.arquivo_origem),
    ibge_ok: Boolean(row.ibgeOk || row.ibge_ok || ((row.ibgeOrigem || row.ibge_origem) && (row.ibgeDestino || row.ibge_destino))),
    ibge_corrigido_origem: Boolean(row.ibgeCorrigidoOrigem || row.ibge_corrigido_origem),
    ibge_corrigido_destino: Boolean(row.ibgeCorrigidoDestino || row.ibge_corrigido_destino),
  };
}

function fromDbRealizadoLocal(row = {}) {
  return {
    chaveCte: row.chave_cte || row.chaveCte || '',
    competencia: row.competencia || '',
    dataEmissao: row.data_emissao || row.dataEmissao || '',
    numeroCte: row.numero_cte || row.numeroCte || '',
    transportadora: row.transportadora || '',
    cnpjTransportadora: row.cnpj_transportadora || row.cnpjTransportadora || '',
    tomadorServico: row.tomador_servico || row.tomadorServico || '',
    cidadeOrigem: row.cidade_origem || row.cidadeOrigem || '',
    ufOrigem: row.uf_origem || row.ufOrigem || '',
    ibgeOrigem: row.ibge_origem || row.ibgeOrigem || '',
    cidadeDestino: row.cidade_destino || row.cidadeDestino || '',
    ufDestino: row.uf_destino || row.ufDestino || '',
    ibgeDestino: row.ibge_destino || row.ibgeDestino || '',
    chaveRotaIbge: row.chave_rota_ibge || row.chaveRotaIbge || '',
    peso: Number(row.peso || 0),
    pesoDeclarado: Number(row.peso_declarado ?? row.pesoDeclarado ?? 0),
    pesoCubado: Number(row.peso_cubado ?? row.pesoCubado ?? 0),
    cubagem: Number(row.cubagem || 0),
    valorNF: Number(row.valor_nf ?? row.valorNF ?? 0),
    valorCte: Number(row.valor_cte ?? row.valorCte ?? 0),
    qtdVolumes: Number(row.qtd_volumes ?? row.qtdVolumes ?? row.volume ?? 0),
    canal: row.canal || '',
    canalOriginal: row.canal_original || row.canalOriginal || '',
    arquivoOrigem: row.arquivo_origem || row.arquivoOrigem || '',
    ibgeOk: Boolean(row.ibge_ok ?? row.ibgeOk),
    ibgeCorrigidoOrigem: Boolean(row.ibge_corrigido_origem ?? row.ibgeCorrigidoOrigem),
    ibgeCorrigidoDestino: Boolean(row.ibge_corrigido_destino ?? row.ibgeCorrigidoDestino),
    createdAt: row.created_at || row.createdAt || '',
    updatedAt: row.updated_at || row.updatedAt || '',
  };
}

function aplicarFiltrosBasicosOnline(query, filtros = {}) {
  if (filtros.competencia) query = query.eq('competencia', filtros.competencia);
  if (filtros.inicio) query = query.gte('data_emissao', `${filtros.inicio}T00:00:00`);
  if (filtros.fim) query = query.lte('data_emissao', `${filtros.fim}T23:59:59`);
  if (filtros.canal) query = query.eq('canal', normalize(filtros.canal));
  if (filtros.transportadoraRealizada) query = query.ilike('transportadora', `%${cleanTextOnline(filtros.transportadoraRealizada)}%`);
  if (filtros.ufOrigem) query = query.eq('uf_origem', cleanUfOnline(filtros.ufOrigem));
  if (filtros.ufDestino) query = query.eq('uf_destino', cleanUfOnline(filtros.ufDestino));
  if (filtros.origem) query = query.ilike('cidade_origem', `%${cleanTextOnline(filtros.origem)}%`);
  if (filtros.destino) query = query.ilike('cidade_destino', `%${cleanTextOnline(filtros.destino)}%`);
  if (filtros.somentePendenciasIbge) query = query.eq('ibge_ok', false);
  if (filtros.excluirEbazar) query = query.not('transportadora', 'ilike', '%EBAZAR%');
  return query;
}

function sleepOnline(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deduplicarPayloadRealizadoOnline(payload = []) {
  const map = new Map();
  let semChave = 0;
  let duplicadosNoArquivo = 0;

  (payload || []).forEach((row) => {
    const chave = cleanTextOnline(row?.chave_cte);
    if (!chave) {
      semChave += 1;
      return;
    }
    if (map.has(chave)) duplicadosNoArquivo += 1;
    map.set(chave, row);
  });

  return { rows: [...map.values()], semChave, duplicadosNoArquivo };
}

export async function testarRealizadoOnlineSupabase() {
  const supabase = ensureRealizadoOnlineClient();
  const { count, error } = await supabase
    .from(REALIZADO_ONLINE_TABLE)
    .select('chave_cte', { count: 'planned', head: true });

  if (error) {
    throw new Error(`Não consegui acessar a tabela ${REALIZADO_ONLINE_TABLE} no Supabase. Rode o SQL supabase/realizado_local_online_schema.sql e confira as permissões. Detalhe: ${error.message}`);
  }

  return { ok: true, totalAtual: Number(count || 0), origem: 'supabase', projeto: getSupabaseInfo().host };
}

async function fetchRealizadoOnline(filtros = {}, options = {}) {
  const supabase = ensureRealizadoOnlineClient();
  const limit = Math.max(1, Number(options.limit || 1000));
  const pageSize = Math.max(50, Math.min(Number(options.pageSize || 1000), 1000));
  const rows = [];
  let avaliados = 0;

  for (let from = 0; rows.length < limit; from += pageSize) {
    let query = supabase
      .from(REALIZADO_ONLINE_TABLE)
      .select(REALIZADO_ONLINE_SELECT)
      .order('data_emissao', { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1);

    query = aplicarFiltrosBasicosOnline(query, filtros);
    const { data, error } = await query;
    if (error) {
      throw new Error(`Erro ao consultar realizado online. Rode supabase/realizado_local_online_schema.sql. Detalhe: ${error.message}`);
    }

    const mapped = (data || []).map(fromDbRealizadoLocal);
    avaliados += mapped.length;
    rows.push(...mapped.filter((row) => filtrarCteLocal(row, filtros)));
    if (!data || data.length < pageSize) break;
    await sleepOnline(0);
  }

  return { rows: rows.slice(0, limit), totalCompativel: rows.length, limit, avaliados, origem: 'supabase' };
}

function normalizeGroupOnline(item = {}) {
  const frete = Number(item.frete || 0);
  const nf = Number(item.nf || 0);
  return {
    chave: item.chave || 'Não informado',
    ctes: Number(item.ctes || 0),
    frete,
    nf,
    peso: Number(item.peso || 0),
    percentual: nf > 0 ? (frete / nf) * 100 : Number(item.percentual || 0),
  };
}

function resumoFromRowsOnline(rows = [], options = {}) {
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

  (rows || []).forEach((row) => {
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
  });

  const finalize = (map) => [...map.values()]
    .map(normalizeGroupOnline)
    .sort((a, b) => b.frete - a.frete || b.ctes - a.ctes)
    .slice(0, options.top || 10);

  return {
    ...resumo,
    percentualFrete: resumo.valorNF > 0 ? (resumo.valorCte / resumo.valorNF) * 100 : 0,
    periodoInicio: resumo.periodoInicio ? resumo.periodoInicio.slice(0, 10) : '',
    periodoFim: resumo.periodoFim ? resumo.periodoFim.slice(0, 10) : '',
    porTransportadora: finalize(resumo.porTransportadora),
    porCanal: finalize(resumo.porCanal),
    porOrigem: finalize(resumo.porOrigem),
    porDestino: finalize(resumo.porDestino),
    porUfDestino: finalize(resumo.porUfDestino),
    porMes: finalize(resumo.porMes),
    origem: 'supabase',
  };
}

async function resumirRealizadoOnline(filtros = {}, options = {}) {
  const supabase = ensureRealizadoOnlineClient();
  try {
    const { data, error } = await supabase.rpc('resumir_realizado_local_ctes', {
      p_competencia: filtros.competencia || null,
      p_inicio: filtros.inicio || null,
      p_fim: filtros.fim || null,
      p_canal: filtros.canal || null,
      p_transportadora: filtros.transportadoraRealizada || null,
      p_uf_origem: filtros.ufOrigem || null,
      p_uf_destino: filtros.ufDestino || null,
      p_origem: filtros.origem || null,
      p_destino: filtros.destino || null,
      p_excluir_ebazar: filtros.excluirEbazar !== false,
      p_somente_pendencias_ibge: filtros.somentePendenciasIbge === true,
      p_peso_min: filtros.pesoMin === '' || filtros.pesoMin === null || filtros.pesoMin === undefined ? null : Number(filtros.pesoMin),
      p_peso_max: filtros.pesoMax === '' || filtros.pesoMax === null || filtros.pesoMax === undefined ? null : Number(filtros.pesoMax),
      p_top: options.top || 10,
    });
    if (error) throw error;
    const raw = data || {};
    return {
      total: Number(raw.total || 0),
      comIbge: Number(raw.comIbge ?? raw.com_ibge ?? 0),
      pendenciasIbge: Number(raw.pendenciasIbge ?? raw.pendencias_ibge ?? 0),
      valorCte: Number(raw.valorCte ?? raw.valor_cte ?? 0),
      valorNF: Number(raw.valorNF ?? raw.valor_nf ?? 0),
      peso: Number(raw.peso || 0),
      cubagem: Number(raw.cubagem || 0),
      volumes: Number(raw.volumes || 0),
      percentualFrete: Number(raw.percentualFrete ?? raw.percentual_frete ?? 0),
      periodoInicio: raw.periodoInicio ?? raw.periodo_inicio ?? '',
      periodoFim: raw.periodoFim ?? raw.periodo_fim ?? '',
      porTransportadora: (raw.porTransportadora || raw.por_transportadora || []).map(normalizeGroupOnline),
      porCanal: (raw.porCanal || raw.por_canal || []).map(normalizeGroupOnline),
      porOrigem: (raw.porOrigem || raw.por_origem || []).map(normalizeGroupOnline),
      porDestino: (raw.porDestino || raw.por_destino || []).map(normalizeGroupOnline),
      porUfDestino: (raw.porUfDestino || raw.por_uf_destino || []).map(normalizeGroupOnline),
      porMes: (raw.porMes || raw.por_mes || []).map(normalizeGroupOnline),
      origem: 'supabase',
    };
  } catch (error) {
    const fallback = await fetchRealizadoOnline(filtros, { limit: options.fallbackLimit || 200000 });
    const resumo = resumoFromRowsOnline(fallback.rows, options);
    resumo.erroRpc = error.message || String(error);
    return resumo;
  }
}

export async function salvarRealizadoLocal(registros = [], options = {}) {
  if (options.forceLocal) {
    return salvarRealizadoLocalIndexedDb(registros, options);
  }

  if (!supabaseRealizadoDisponivel()) {
    if (options.exigirSupabase) {
      throw new Error('Realizado Online precisa do Supabase configurado. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Vercel.');
    }
    return salvarRealizadoLocalIndexedDb(registros, options);
  }

  const supabase = ensureRealizadoOnlineClient();
  const bruto = (registros || []).map(toDbRealizadoLocal);
  const dedupe = deduplicarPayloadRealizadoOnline(bruto);
  const payload = dedupe.rows;

  if (!payload.length) {
    return {
      salvos: 0,
      origem: 'supabase',
      projeto: getSupabaseInfo().host,
      semChave: dedupe.semChave,
      duplicadosNoArquivo: dedupe.duplicadosNoArquivo,
    };
  }

  const chunkSize = Math.max(25, Math.min(Number(options.chunkSize || 250), 500));
  let salvos = 0;

  for (let index = 0; index < payload.length; index += chunkSize) {
    const chunk = payload.slice(index, index + chunkSize);
    const { error } = await supabase
      .from(REALIZADO_ONLINE_TABLE)
      .upsert(chunk, { onConflict: 'chave_cte', ignoreDuplicates: false });

    if (error) {
      if (!options.exigirSupabase) {
        await salvarRealizadoLocalIndexedDb(registros, { ...options, forceLocal: true }).catch(() => null);
      }
      throw new Error(`Erro ao salvar realizado online no Supabase. Nenhum dado deve ser considerado importado enquanto este erro aparecer. Rode supabase/realizado_local_online_schema.sql e confira permissões. Detalhe: ${error.message}`);
    }

    salvos += chunk.length;
    options.onProgress?.({
      salvos,
      total: payload.length,
      origem: 'supabase',
      semChave: dedupe.semChave,
      duplicadosNoArquivo: dedupe.duplicadosNoArquivo,
    });
    await sleepOnline(0);
  }

  return {
    salvos,
    origem: 'supabase',
    projeto: getSupabaseInfo().host,
    semChave: dedupe.semChave,
    duplicadosNoArquivo: dedupe.duplicadosNoArquivo,
  };
}

export async function listarRealizadoLocal(filtros = {}, options = {}) {
  if (!supabaseRealizadoDisponivel() || options.forceLocal) {
    return listarRealizadoLocalIndexedDb(filtros, options);
  }
  const limit = Number(options.limit || 200);
  const result = await fetchRealizadoOnline(filtros, { limit, pageSize: options.pageSize || 1000 });
  return { rows: result.rows.slice(0, limit), avaliados: result.avaliados, origem: 'supabase' };
}

export async function buscarRealizadoLocalPorMalha(filtros = {}, malhaKeys = [], options = {}) {
  if (!supabaseRealizadoDisponivel() || options.forceLocal) {
    return buscarRealizadoLocalPorMalhaIndexedDb(filtros, malhaKeys, options);
  }
  const keys = malhaKeys instanceof Set ? malhaKeys : new Set(malhaKeys || []);
  if (!keys.size) return { rows: [], totalCompativel: 0, limit: Number(options.limit || 5000), malhaKeys: 0, avaliados: 0, origem: 'supabase' };
  const scan = await fetchRealizadoOnline(filtros, { limit: Number(options.scanLimit || 200000), pageSize: 1000 });
  const compativeis = scan.rows.filter((row) => keys.has(chaveMalhaCte(row)));
  const limit = Number(options.limit || 5000);
  return { rows: compativeis.slice(0, limit), totalCompativel: compativeis.length, limit, malhaKeys: keys.size, avaliados: scan.avaliados, origem: 'supabase' };
}

export async function buscarRealizadoLocalParaSimulacao(filtros = {}, options = {}) {
  if (!supabaseRealizadoDisponivel() || options.forceLocal) {
    return buscarRealizadoLocalParaSimulacaoIndexedDb(filtros, options);
  }
  const limit = Number(options.limit || 5000);
  const result = await fetchRealizadoOnline(filtros, { limit, pageSize: 1000 });
  return { rows: result.rows.slice(0, limit), totalCompativel: result.totalCompativel, limit, origem: 'supabase' };
}

export async function resumirRealizadoLocal(filtros = {}, options = {}) {
  if (!supabaseRealizadoDisponivel() || options.forceLocal) {
    return resumirRealizadoLocalIndexedDb(filtros, options);
  }
  return resumirRealizadoOnline(filtros, options);
}

export async function exportarRealizadoLocal(filtros = {}, options = {}) {
  if (!supabaseRealizadoDisponivel() || options.forceLocal) {
    return exportarRealizadoLocalIndexedDb(filtros, options);
  }
  const limit = Number(options.limit || 100000);
  const result = await fetchRealizadoOnline(filtros, { limit, pageSize: 1000 });
  return { rows: result.rows, totalCompativel: result.totalCompativel, limit, origem: 'supabase' };
}

export async function diagnosticarRealizadoLocal() {
  if (!supabaseRealizadoDisponivel()) {
    return diagnosticarRealizadoLocalIndexedDb();
  }
  const supabase = ensureRealizadoOnlineClient();
  try {
    const { data, error } = await supabase.rpc('diagnosticar_realizado_local_ctes');
    if (error) throw error;
    return {
      total: Number(data?.total || 0),
      ultimaAtualizacao: data?.ultimaAtualizacao || data?.ultima_atualizacao || '',
      origem: 'supabase',
      projeto: getSupabaseInfo().host,
    };
  } catch (error) {
    const { count, error: countError } = await supabase
      .from(REALIZADO_ONLINE_TABLE)
      .select('chave_cte', { count: 'planned', head: true });
    if (countError) {
      throw new Error(`Erro ao diagnosticar realizado online. Rode supabase/realizado_local_online_schema.sql. Detalhe: ${countError.message || error.message}`);
    }
    return { total: Number(count || 0), ultimaAtualizacao: '', origem: 'supabase', projeto: getSupabaseInfo().host };
  }
}

export async function limparNaoTomadoresRealizadoLocal(options = {}) {
  if (!supabaseRealizadoDisponivel() || options.forceLocal) {
    return limparNaoTomadoresRealizadoLocalIndexedDb(options);
  }
  const supabase = ensureRealizadoOnlineClient();
  const { data, error } = await supabase.rpc('limpar_nao_tomadores_realizado_local', {
    p_confirmacao: 'LIMPAR NAO TOMADORES',
  });
  if (error) throw new Error(`Erro ao limpar não tomadores no realizado online. Detalhe: ${error.message}`);
  return {
    avaliados: Number(data?.avaliados || 0),
    removidos: Number(data?.removidos || 0),
    mantidos: Number(data?.mantidos || 0),
    origem: 'supabase',
  };
}

export async function limparRealizadoLocal(options = {}) {
  if (!supabaseRealizadoDisponivel() || options.forceLocal) {
    return limparRealizadoLocalIndexedDb();
  }
  const supabase = ensureRealizadoOnlineClient();
  const { data, error } = await supabase.rpc('limpar_realizado_local_ctes', {
    p_confirmacao: 'APAGAR REALIZADO ONLINE',
  });
  if (error) throw new Error(`Erro ao limpar realizado online. Detalhe: ${error.message}`);
  return { ok: true, removidos: Number(data || 0), origem: 'supabase' };
}
