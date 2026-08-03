import { construirIndiceResimulacaoEcommerce, resimularLotePedidosEcommerce } from '../utils/ecommerceResimulacaoEngine';

let indiceCache = null;

self.onmessage = (event) => {
  const msg = event.data || {};

  if (msg.type === 'init-malha-ecommerce') {
    try {
      indiceCache = construirIndiceResimulacaoEcommerce(msg.transportadoras || [], msg.municipios || []);
      self.postMessage({ type: 'malha-pronta' });
    } catch (error) {
      console.error('[ecommerceResimulacaoWorker] erro ao montar malha:', error);
      self.postMessage({ type: 'error', message: `Erro ao montar malha: ${error?.message || String(error)}`, stack: error?.stack || null });
    }
    return;
  }

  if (msg.type === 'resimular-lote-ecommerce') {
    if (!indiceCache) {
      self.postMessage({ type: 'error', message: 'Malha ainda nao carregada no worker.' });
      return;
    }
    try {
      const resultados = resimularLotePedidosEcommerce({
        pedidos: msg.pedidos || [],
        mapasIbge: indiceCache.mapasIbge,
        index: indiceCache.index,
        criterioB2c: msg.criterioB2c,
        pesoBase: msg.pesoBase,
        cdsPermitidos: msg.cdsPermitidos,
      });
      self.postMessage({ type: 'done', resultados, loteId: msg.loteId });
    } catch (error) {
      console.error('[ecommerceResimulacaoWorker] erro ao resimular lote:', error);
      self.postMessage({ type: 'error', message: `Erro ao resimular pedidos: ${error?.message || String(error)}`, stack: error?.stack || null });
    }
  }
};
