// Pasta de rede dos boletos (Chrome/Edge): o usuario autoriza a pasta uma vez e o navegador lembra
// a escolha (IndexedDB). A permissao pode ser pedida de novo a cada sessao, sempre a partir de um clique.
const DB = 'central_fretes_pasta_rede';
const STORE = 'handles';
const CHAVE = 'boletos';

export const pastaRedeSuportada = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

function abrirDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function lerHandle() {
  try {
    const db = await abrirDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(CHAVE);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function gravarHandle(handle) {
  try {
    const db = await abrirDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, CHAVE);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch { /* sem IndexedDB: escolhe de novo na proxima vez */ }
}

// Devolve a pasta com permissao de escrita. Chamar a partir de um clique. { escolher: true } forca trocar a pasta.
export async function obterPastaBoletos({ escolher = false } = {}) {
  if (!pastaRedeSuportada()) throw new Error('Este navegador nao permite gravar na pasta. Use o Chrome ou o Edge.');
  let handle = escolher ? null : await lerHandle();
  if (handle) {
    let permissao = await handle.queryPermission({ mode: 'readwrite' });
    if (permissao !== 'granted') permissao = await handle.requestPermission({ mode: 'readwrite' });
    if (permissao !== 'granted') handle = null;
  }
  if (!handle) {
    handle = await window.showDirectoryPicker({ id: 'boletos-financeiro', mode: 'readwrite' });
    await gravarHandle(handle);
  }
  return handle;
}

export async function gravarArquivoNaPasta(pasta, nome, blob) {
  const arquivo = await pasta.getFileHandle(nome, { create: true });
  const escrita = await arquivo.createWritable();
  await escrita.write(blob);
  await escrita.close();
}

// "104682 - TRANSUL ENCOMENDAS LTDA.pdf": numero da fatura + transportadora, sem caracteres proibidos no Windows.
export function nomeArquivoBoleto(fatura) {
  const numero = String(fatura?.numero_fatura || '').replace(/\D/g, '').replace(/^0+/, '') || String(fatura?.numero_fatura || 'fatura');
  const transp = String(fatura?.transportadora || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `${numero}${transp ? ` - ${transp}` : ''}.pdf`;
}
