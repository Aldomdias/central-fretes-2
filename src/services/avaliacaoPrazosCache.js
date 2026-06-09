const DB_NAME = 'amd-avaliacao-prazos-cache';
const DB_VERSION = 1;
const STORE_RECORTES = 'recortes';
const CHUNK_LINHAS = 5000;
const MAX_SALVOS = 12;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível neste navegador.'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECORTES)) {
        const store = db.createObjectStore(STORE_RECORTES, { keyPath: 'id' });
        store.createIndex('salvoEm', 'salvoEm', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir cache local de recortes.'));
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro no cache local.'));
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Erro na transação do cache.'));
    tx.onabort = () => reject(tx.error || new Error('Transação do cache cancelada.'));
  });
}

function texto(valor = '') {
  return String(valor ?? '').trim();
}

function criarIdRecorte() {
  return `recorte-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function chunkArray(lista = [], tamanho = CHUNK_LINHAS) {
  const chunks = [];
  for (let i = 0; i < lista.length; i += tamanho) {
    chunks.push(lista.slice(i, i + tamanho));
  }
  return chunks;
}

export function gerarRotuloRecorte(filtros = {}) {
  const partes = [];
  if (filtros.canal) partes.push(filtros.canal);
  if (filtros.regiaoOrigem) partes.push(`Origem ${filtros.regiaoOrigem}`);
  if (filtros.ufOrigem) partes.push(`UF origem ${filtros.ufOrigem}`);
  if (filtros.regiaoDestino) partes.push(`Destino ${filtros.regiaoDestino}`);
  if (filtros.ufDestino) partes.push(`UF destino ${filtros.ufDestino}`);
  if (filtros.transportadora) partes.push(filtros.transportadora);
  if (filtros.fonteTabela && filtros.fonteTabela !== 'OFICIAL') partes.push(filtros.fonteTabela);
  if (filtros.busca) partes.push(`Busca "${filtros.busca}"`);
  return partes.join(' · ') || 'Recorte personalizado';
}

function montarResumoLista(item = {}) {
  return {
    id: item.id,
    nome: item.nome,
    rotulo: item.rotulo,
    salvoEm: item.salvoEm,
    totalLinhas: item.totalLinhas || 0,
    filtros: item.filtros || {},
  };
}

export async function listarRecortesSalvosAvaliacao() {
  const db = await openDb();
  const tx = db.transaction(STORE_RECORTES, 'readonly');
  const store = tx.objectStore(STORE_RECORTES);
  const todos = await requestToPromise(store.getAll());
  await txComplete(tx);
  db.close();

  return (todos || [])
    .map(montarResumoLista)
    .sort((a, b) => String(b.salvoEm).localeCompare(String(a.salvoEm)));
}

export async function salvarRecorteAvaliacao({
  nome,
  filtros = {},
  kpis = {},
  analise = {},
}) {
  const linhas = Array.isArray(analise.linhas) ? analise.linhas : [];
  if (!linhas.length) {
    throw new Error('Não há linhas carregadas para salvar. Conclua a análise antes de salvar.');
  }

  const id = criarIdRecorte();
  const rotulo = gerarRotuloRecorte(filtros);
  const registro = {
    id,
    nome: texto(nome) || rotulo,
    rotulo,
    salvoEm: new Date().toISOString(),
    filtros,
    kpis,
    totalLinhas: analise.totalLinhas || linhas.length,
    mapa: analise.mapa || [],
    melhoresPrazos: analise.melhoresPrazos || [],
    rotasCriticas: analise.rotasCriticas || [],
    lacunas: analise.lacunas || { resumo: {}, itens: [] },
    linhasChunks: chunkArray(linhas),
  };

  const db = await openDb();
  const tx = db.transaction(STORE_RECORTES, 'readwrite');
  const store = tx.objectStore(STORE_RECORTES);
  store.put(registro);

  const existentes = await requestToPromise(store.getAll());
  const ordenados = (existentes || []).sort((a, b) => String(a.salvoEm).localeCompare(String(b.salvoEm)));
  while (ordenados.length > MAX_SALVOS) {
    const removido = ordenados.shift();
    if (removido?.id) store.delete(removido.id);
  }

  await txComplete(tx);
  db.close();

  return montarResumoLista(registro);
}

export async function carregarRecorteSalvoAvaliacao(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_RECORTES, 'readonly');
  const registro = await requestToPromise(tx.objectStore(STORE_RECORTES).get(id));
  await txComplete(tx);
  db.close();

  if (!registro) throw new Error('Recorte salvo não encontrado.');

  const linhas = (registro.linhasChunks || []).flat();

  return {
    filtros: registro.filtros || {},
    kpis: registro.kpis || {},
    analise: {
      linhas,
      totalLinhas: registro.totalLinhas || linhas.length,
      mapa: registro.mapa || [],
      melhoresPrazos: registro.melhoresPrazos || [],
      rotasCriticas: registro.rotasCriticas || [],
      lacunas: registro.lacunas || { resumo: {}, itens: [] },
    },
    meta: montarResumoLista(registro),
  };
}

export async function excluirRecorteSalvoAvaliacao(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_RECORTES, 'readwrite');
  tx.objectStore(STORE_RECORTES).delete(id);
  await txComplete(tx);
  db.close();
}
