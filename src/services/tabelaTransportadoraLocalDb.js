const DB_NAME = 'amd-tabelas-transportadora-local-db';
const DB_VERSION = 2;
const STORE_SNAPSHOTS = 'snapshots_transportadora';

function normalizeNome(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const store = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'nomeNormalizado' });
        store.createIndex('nome', 'nome', { unique: false });
        store.createIndex('atualizadoEm', 'atualizadoEm', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir base local de tabelas.'));
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro na operação local de tabela.'));
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Erro na transação local de tabela.'));
    tx.onabort = () => reject(tx.error || new Error('Transação local de tabela cancelada.'));
  });
}

function contarEstrutura(transportadora = {}) {
  const origens = Array.isArray(transportadora.origens) ? transportadora.origens : [];
  let rotas = 0;
  let cotacoes = 0;
  let taxas = 0;
  let generalidades = 0;

  origens.forEach((origem) => {
    rotas += Array.isArray(origem.rotas) ? origem.rotas.length : 0;
    cotacoes += Array.isArray(origem.cotacoes) ? origem.cotacoes.length : 0;
    taxas += Array.isArray(origem.taxasEspeciais) ? origem.taxasEspeciais.length : Array.isArray(origem.taxas) ? origem.taxas.length : 0;
    generalidades += origem.generalidades ? 1 : 0;
  });

  return { origens: origens.length, rotas, cotacoes, taxas, generalidades };
}

function serializarSnapshot(transportadora = {}) {
  try {
    return new Blob([JSON.stringify(transportadora)]).size;
  } catch {
    try { return JSON.stringify(transportadora).length; } catch { return 0; }
  }
}

function limparTransportadora(transportadora = {}) {
  return JSON.parse(JSON.stringify(transportadora || {}));
}

function criarRegistro(transportadora = {}) {
  const nome = String(transportadora?.nome || '').trim();
  if (!nome) throw new Error('Não foi possível salvar localmente: transportadora sem nome.');

  const payload = limparTransportadora(transportadora);
  const nomeNormalizado = normalizeNome(nome);
  return {
    nome,
    nomeNormalizado,
    atualizadoEm: new Date().toISOString(),
    contagem: contarEstrutura(payload),
    tamanhoBytes: serializarSnapshot(payload),
    payload,
  };
}

export async function salvarTabelaTransportadoraLocal(transportadora = {}) {
  const registro = criarRegistro(transportadora);

  const db = await openDb();
  const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
  tx.objectStore(STORE_SNAPSHOTS).put(registro);
  await txComplete(tx);
  db.close();
  return registro;
}

export async function salvarTabelasTransportadoraLocal(transportadoras = []) {
  const registros = (transportadoras || []).filter(Boolean).map(criarRegistro);
  if (!registros.length) throw new Error('Nenhuma transportadora válida para salvar localmente.');

  const db = await openDb();
  const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
  const store = tx.objectStore(STORE_SNAPSHOTS);
  registros.forEach((registro) => store.put(registro));
  await txComplete(tx);
  db.close();
  return registros;
}

export async function buscarTabelaTransportadoraLocal(nomeTransportadora = '') {
  const nomeNormalizado = normalizeNome(nomeTransportadora);
  if (!nomeNormalizado) return null;

  const db = await openDb();
  const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
  const registro = await requestToPromise(tx.objectStore(STORE_SNAPSHOTS).get(nomeNormalizado));
  db.close();
  return registro || null;
}

export async function buscarTodasTabelasTransportadoraLocal() {
  const db = await openDb();
  const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
  const rows = await requestToPromise(tx.objectStore(STORE_SNAPSHOTS).getAll());
  db.close();
  return (rows || []).filter((item) => item?.payload?.nome);
}

export async function listarTabelasTransportadoraLocal() {
  const rows = await buscarTodasTabelasTransportadoraLocal();
  return (rows || [])
    .map((item) => ({
      nome: item.nome,
      nomeNormalizado: item.nomeNormalizado,
      atualizadoEm: item.atualizadoEm,
      contagem: item.contagem || {},
      tamanhoBytes: item.tamanhoBytes || 0,
    }))
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}

export async function excluirTabelaTransportadoraLocal(nomeTransportadora = '') {
  const nomeNormalizado = normalizeNome(nomeTransportadora);
  if (!nomeNormalizado) return false;

  const db = await openDb();
  const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
  tx.objectStore(STORE_SNAPSHOTS).delete(nomeNormalizado);
  await txComplete(tx);
  db.close();
  return true;
}

export function montarArquivoTabelaLocal(transportadora = {}) {
  const nome = String(transportadora?.nome || 'transportadora').trim();
  return {
    tipo: 'AMD_LOG_TABELA_TRANSPORTADORA_LOCAL',
    versao: 2,
    exportadoEm: new Date().toISOString(),
    nome,
    contagem: contarEstrutura(transportadora),
    payload: limparTransportadora(transportadora),
  };
}

export function montarArquivoTabelasLocais(transportadoras = []) {
  const payload = (transportadoras || []).filter((item) => item?.nome).map(limparTransportadora);
  const totais = payload.reduce((acc, item) => {
    const contagem = contarEstrutura(item);
    acc.transportadoras += 1;
    acc.origens += contagem.origens || 0;
    acc.rotas += contagem.rotas || 0;
    acc.cotacoes += contagem.cotacoes || 0;
    acc.taxas += contagem.taxas || 0;
    return acc;
  }, { transportadoras: 0, origens: 0, rotas: 0, cotacoes: 0, taxas: 0 });

  return {
    tipo: 'AMD_LOG_TABELAS_TRANSPORTADORAS_LOCAL',
    versao: 2,
    exportadoEm: new Date().toISOString(),
    contagem: totais,
    payload: {
      transportadoras: payload,
    },
  };
}

export function extrairTransportadorasDeArquivoLocal(json = {}) {
  if (json?.tipo === 'AMD_LOG_TABELA_TRANSPORTADORA_LOCAL' && json?.payload?.nome) return [json.payload];
  if (json?.tipo === 'AMD_LOG_TABELAS_TRANSPORTADORAS_LOCAL' && Array.isArray(json?.payload?.transportadoras)) return json.payload.transportadoras;
  if (Array.isArray(json?.payload?.transportadoras)) return json.payload.transportadoras;
  if (Array.isArray(json?.transportadoras)) return json.transportadoras;
  if (Array.isArray(json)) return json;
  if (json?.payload?.nome && Array.isArray(json.payload.origens)) return [json.payload];
  if (json?.nome && Array.isArray(json.origens)) return [json];
  throw new Error('Arquivo inválido. Importe um JSON de tabela local, um pacote de transportadoras ou um snapshot com payload.transportadoras.');
}

export function extrairTransportadoraDeArquivoLocal(json = {}) {
  const lista = extrairTransportadorasDeArquivoLocal(json);
  if (lista.length !== 1) {
    throw new Error(`O arquivo possui ${lista.length} transportadora(s). Use a importação de pacote local para salvar todas.`);
  }
  return lista[0];
}
