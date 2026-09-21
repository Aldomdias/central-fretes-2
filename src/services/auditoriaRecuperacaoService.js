// IndexedDB suporta recortes grandes sem o limite pequeno do localStorage.
async function acessar(modo, operacao) {
  const db = await new Promise((resolve, reject) => {
    const pedido = indexedDB.open('auditoria-recuperacao', 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore('pontos');
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('pontos', modo);
      const pedido = operacao(tx.objectStore('pontos'));
      tx.oncomplete = () => resolve(pedido.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Recuperação local interrompida.'));
    });
  } finally { db.close(); }
}
export function salvarPontoAuditoria(ponto) {
  return acessar('readwrite', (store) => store.put({ ...ponto, salvoEm: new Date().toISOString() }, 'ultimo'));
}
export function carregarPontoAuditoria() {
  return acessar('readonly', (store) => store.get('ultimo'));
}
