import { simularRealizadoLocalRapido } from '../utils/realizadoLocalEngine';

function postProgress(payload) {
  self.postMessage({ type: 'progress', ...payload });
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type !== 'simular-realizado-local') return;

  try {
    const result = await simularRealizadoLocalRapido({
      realizados: msg.realizados || [],
      transportadoras: msg.transportadoras || [],
      municipios: msg.municipios || [],
      nomeTransportadora: msg.nomeTransportadora || '',
      modoSimulacao: msg.modoSimulacao || 'rapido',
      onProgress: (payload) => postProgress(payload || {}),
    });
    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Erro ao simular realizado local.' });
  }
};
