// Cache local dos indicadores da auditoria de e-commerce, gravado por COMPETENCIA
// (mes de data_criacao) e cenario de peso. Antes o painel guardava um unico
// snapshot por recorte de datas no localStorage: trocar o periodo jogava fora o
// anterior e obrigava a varrer a base de novo, e a lista de itens de mais de um
// mes nao cabia na cota do localStorage. Aqui cada competencia vira um registro
// independente no IndexedDB - carrega uma vez, analisa quantas vezes quiser, e da
// pra somar varios meses sem tocar no banco.

const NOME_DB = 'amd-auditoria-ecommerce';
const NOME_STORE = 'indicadores-competencia';
const VERSAO_DB = 1;

// Formato dos itens guardados. Quando o painel passa a usar um campo novo (ex.:
// adicional tributario), competencias salvas antes nao tem esse campo e mostrariam
// zero - subir a versao faz a tela marcar essas competencias como desatualizadas
// em vez de exibir numero errado.
export const VERSAO_ITENS = 3;

function abrirDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponivel neste navegador.'));
      return;
    }
    const req = indexedDB.open(NOME_DB, VERSAO_DB);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOME_STORE)) {
        db.createObjectStore(NOME_STORE, { keyPath: 'chave' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir o cache local.'));
  });
}

function executar(store, modo, acao) {
  return abrirDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, modo);
    const req = acao(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro no cache local.'));
    tx.oncomplete = () => db.close();
  }));
}

export function chaveCompetencia(cenarioPeso, competencia) {
  return `${cenarioPeso}|${competencia}`;
}

// Competencia = 'YYYY-MM' de data_criacao. Recortes que nao fecham no mes cheio
// nao viram cache (nao dariam pra somar com os outros sem risco de dupla contagem).
export function competenciasDoIntervalo(dataInicio, dataFim) {
  if (!dataInicio || !dataFim) return [];
  const competencias = [];
  let [ano, mes] = dataInicio.slice(0, 7).split('-').map(Number);
  const limite = dataFim.slice(0, 7);
  while (competencias.length < 60) {
    const atual = `${ano}-${String(mes).padStart(2, '0')}`;
    if (atual > limite) break;
    competencias.push(atual);
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return competencias;
}

export function intervaloDaCompetencia(competencia) {
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(mes === 12 ? ano + 1 : ano, mes === 12 ? 0 : mes, 0)).getUTCDate();
  return { dataInicio: `${competencia}-01`, dataFim: `${competencia}-${String(ultimoDia).padStart(2, '0')}` };
}

export async function salvarCompetenciaIndicadores(cenarioPeso, competencia, resumo) {
  const registro = {
    chave: chaveCompetencia(cenarioPeso, competencia),
    cenarioPeso,
    competencia,
    resumo,
    total: resumo?.itens?.length || 0,
    versao: VERSAO_ITENS,
    atualizadoEm: new Date().toISOString(),
  };
  await executar(NOME_STORE, 'readwrite', (store) => store.put(registro));
  return registro;
}

export async function lerCompetenciaIndicadores(cenarioPeso, competencia) {
  try {
    const registro = await executar(NOME_STORE, 'readonly', (store) => store.get(chaveCompetencia(cenarioPeso, competencia)));
    if (!registro || registro.versao !== VERSAO_ITENS) return null;
    return registro;
  } catch {
    return null;
  }
}

// Metadados de tudo que ja esta em cache (sem carregar os itens), pra montar a
// lista de competencias disponiveis na tela.
export async function listarCompetenciasIndicadores() {
  try {
    const registros = await executar(NOME_STORE, 'readonly', (store) => store.getAll());
    return (registros || [])
      .map(({ chave, cenarioPeso, competencia, total, atualizadoEm, versao }) => ({ chave, cenarioPeso, competencia, total, atualizadoEm, desatualizada: versao !== VERSAO_ITENS }))
      .sort((a, b) => b.competencia.localeCompare(a.competencia));
  } catch {
    return [];
  }
}

export async function excluirCompetenciaIndicadores(cenarioPeso, competencia) {
  await executar(NOME_STORE, 'readwrite', (store) => store.delete(chaveCompetencia(cenarioPeso, competencia)));
}

// Junta varias competencias num unico conjunto de itens. Os agregados do painel
// sao todos recalculados a partir dos itens (consolidarItensBi), entao somar meses
// e so concatenar - nao existe agregado "pre-somado" que possa ficar inconsistente.
export function mesclarResumosIndicadores(resumos = []) {
  const itens = [];
  for (const resumo of resumos) {
    if (resumo?.itens?.length) itens.push(...resumo.itens);
  }
  return { itens };
}
