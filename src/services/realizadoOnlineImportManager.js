import { carregarBaseCompletaDb } from './freteDatabaseService';
import { carregarMunicipiosIbgeComFallback } from './ibgeService';
import { testarRealizadoOnlineSupabase } from './realizadoLocalDb';
import { enriquecerMunicipiosComTabelas } from '../utils/realizadoLocalEngine';

const subscribers = new Set();

let activeWorker = null;
let activePromise = null;
let state = {
  id: null,
  status: 'idle',
  titulo: 'Importação Realizado Online',
  progress: null,
  result: null,
  error: '',
  startedAt: null,
  finishedAt: null,
  files: [],
};

function nowIso() {
  return new Date().toISOString();
}

function safeFilesInfo(files = []) {
  return Array.from(files || []).map((file) => ({
    name: file?.name || 'arquivo',
    size: file?.size || 0,
    type: file?.type || '',
  }));
}

function notify() {
  const snapshot = getRealizadoOnlineImportState();
  subscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch {
      // Mantém os demais assinantes ativos.
    }
  });
}

function setState(patch = {}) {
  state = {
    ...state,
    ...patch,
  };
  notify();
}

function setProgress(progress = {}) {
  setState({
    progress: {
      etapa: progress.etapa || 'Importando base online',
      atual: Number(progress.atual || 0),
      total: Number(progress.total || 0),
      percentual: Math.max(0, Math.min(100, Number(progress.percentual || 0))),
      mensagem: progress.mensagem || '',
      updatedAt: nowIso(),
    },
  });
}

function iniciarEstado(files = []) {
  const id = `realizado-online-${Date.now()}`;
  state = {
    id,
    status: 'running',
    titulo: 'Importação Realizado Online',
    progress: {
      etapa: 'Preparando importação',
      atual: 0,
      total: files.length,
      percentual: 1,
      mensagem: 'Preparando arquivo para subir na base online. Você pode navegar para outros módulos; o status ficará no topo da tela.',
      updatedAt: nowIso(),
    },
    result: null,
    error: '',
    startedAt: nowIso(),
    finishedAt: null,
    files: safeFilesInfo(files),
  };
  notify();
  return id;
}

async function prepararMunicipiosParaImportacao({ municipios = [], ibgeInfo = {}, transportadoras = [], transportadorasTabela = [] } = {}) {
  let baseMunicipios = Array.isArray(municipios) ? municipios : [];
  let fonte = baseMunicipios.length ? ibgeInfo?.fonte || 'memória da tela' : 'pendente';

  setProgress({
    etapa: 'Validando Realizado Online',
    percentual: 2,
    mensagem: 'Conferindo conexão com a tabela realizado_local_ctes no Supabase antes de processar o arquivo...',
  });
  await testarRealizadoOnlineSupabase();

  if (!baseMunicipios.length || baseMunicipios.length < 5000) {
    setProgress({
      etapa: 'Carregando referência IBGE',
      percentual: 5,
      mensagem: 'Carregando base IBGE para localizar origem/destino. Esta etapa acontece antes da gravação no Supabase.',
    });
    const ibgeRef = await carregarMunicipiosIbgeComFallback({ permitirOficial: true }).catch(() => ({ municipios: baseMunicipios, fonte }));
    if ((ibgeRef.municipios || []).length > baseMunicipios.length) {
      baseMunicipios = ibgeRef.municipios || [];
      fonte = ibgeRef.fonte || fonte;
    }
  }

  let referencia = baseMunicipios;
  if (baseMunicipios.length < 5000) {
    setProgress({
      etapa: 'Complementando IBGE pelas tabelas',
      percentual: 8,
      mensagem: 'Base IBGE incompleta; buscando cidades pelas tabelas cadastradas como apoio.',
    });
    let tabelas = Array.isArray(transportadorasTabela) ? transportadorasTabela : [];
    if (!tabelas.length) {
      const base = await carregarBaseCompletaDb().catch(() => []);
      tabelas = base?.length ? base : transportadoras;
    }
    referencia = enriquecerMunicipiosComTabelas(baseMunicipios, tabelas || transportadoras || []);
    fonte = referencia.length ? `${fonte} + tabelas` : fonte;
  }

  if (!referencia.length) {
    throw new Error('Não foi possível carregar nenhuma referência de IBGE. Sem IBGE, a base online não consegue simular. Confira a tela Consulta IBGE ou as rotas/tabelas cadastradas.');
  }

  setProgress({
    etapa: 'IBGE pronto',
    percentual: 10,
    mensagem: `Referência pronta com ${referencia.length.toLocaleString('pt-BR')} município(s). Iniciando leitura dos arquivos.`,
  });

  return { municipios: referencia, fonte };
}

function importarComWorker({ files = [], municipios = [], competencia = '' }) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('Este navegador não suporta processamento em segundo plano com Worker.'));
      return;
    }

    try {
      activeWorker = new Worker(new URL('../workers/realizadoLocalImportWorker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(new Error(error?.message || 'Não foi possível iniciar o processador em segundo plano da importação.'));
      return;
    }

    activeWorker.onmessage = (event) => {
      const msg = event.data || {};

      if (msg.type === 'progress') {
        setProgress({
          etapa: msg.etapa || 'Importando base online',
          atual: msg.atual || 0,
          total: msg.total || files.length,
          percentual: msg.percentual || 0,
          mensagem: msg.mensagem || 'Processando arquivo em segundo plano...',
        });
      }

      if (msg.type === 'done') {
        const result = msg.result || {};
        activeWorker?.terminate();
        activeWorker = null;
        setState({
          status: 'done',
          result,
          error: '',
          finishedAt: nowIso(),
          progress: {
            etapa: 'Importação concluída',
            atual: Number(result.totalSalvos || result.totalPreparados || 0),
            total: Number(result.totalPreparados || result.totalSalvos || 0),
            percentual: 100,
            mensagem: `${Number(result.totalSalvos || 0).toLocaleString('pt-BR')} CT-e(s) salvos/atualizados no Supabase.`,
            updatedAt: nowIso(),
          },
        });
        resolve(result);
      }

      if (msg.type === 'error') {
        activeWorker?.terminate();
        activeWorker = null;
        const error = new Error(msg.message || 'Erro ao processar arquivo local.');
        setState({
          status: 'error',
          error: error.message,
          finishedAt: nowIso(),
          progress: {
            ...(state.progress || {}),
            etapa: 'Erro na importação',
            mensagem: error.message,
            updatedAt: nowIso(),
          },
        });
        reject(error);
      }
    };

    activeWorker.onerror = (event) => {
      activeWorker?.terminate();
      activeWorker = null;
      const error = new Error(event?.message || 'Erro no processador local de arquivos.');
      setState({
        status: 'error',
        error: error.message,
        finishedAt: nowIso(),
        progress: {
          ...(state.progress || {}),
          etapa: 'Erro na importação',
          mensagem: error.message,
          updatedAt: nowIso(),
        },
      });
      reject(error);
    };

    activeWorker.postMessage({
      type: 'importar-realizado-local',
      files,
      municipios,
      competencia,
    });
  });
}

export function getRealizadoOnlineImportState() {
  return {
    ...state,
    files: [...(state.files || [])],
    progress: state.progress ? { ...state.progress } : null,
    result: state.result ? { ...state.result } : null,
  };
}

export function subscribeRealizadoOnlineImport(callback) {
  if (typeof callback !== 'function') return () => {};
  subscribers.add(callback);
  callback(getRealizadoOnlineImportState());
  return () => subscribers.delete(callback);
}

export function isRealizadoOnlineImportRunning() {
  return state.status === 'running';
}

export function clearRealizadoOnlineImportStatus() {
  if (state.status === 'running') return false;
  state = {
    id: null,
    status: 'idle',
    titulo: 'Importação Realizado Online',
    progress: null,
    result: null,
    error: '',
    startedAt: null,
    finishedAt: null,
    files: [],
  };
  notify();
  return true;
}

export function cancelarRealizadoOnlineImport() {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }
  activePromise = null;
  setState({
    status: 'error',
    error: 'Importação cancelada pelo usuário.',
    finishedAt: nowIso(),
    progress: {
      ...(state.progress || {}),
      etapa: 'Importação cancelada',
      mensagem: 'Importação cancelada pelo usuário.',
      updatedAt: nowIso(),
    },
  });
}

export function startRealizadoOnlineImport(payload = {}) {
  const files = Array.from(payload.files || []);
  if (!files.length) return Promise.resolve(null);

  if (state.status === 'running' && activePromise) {
    return Promise.reject(new Error('Já existe uma importação do Realizado Online em andamento. Aguarde concluir antes de subir outro arquivo.'));
  }

  iniciarEstado(files);

  activePromise = (async () => {
    try {
      const preparado = await prepararMunicipiosParaImportacao(payload);
      const result = await importarComWorker({
        files,
        municipios: preparado.municipios,
        competencia: payload.competencia || '',
      });
      return result;
    } catch (error) {
      if (state.status !== 'error') {
        setState({
          status: 'error',
          error: error?.message || 'Erro ao importar realizado online.',
          finishedAt: nowIso(),
          progress: {
            ...(state.progress || {}),
            etapa: 'Erro na importação',
            mensagem: error?.message || 'Erro ao importar realizado online.',
            updatedAt: nowIso(),
          },
        });
      }
      throw error;
    } finally {
      activePromise = null;
    }
  })();

  return activePromise;
}
