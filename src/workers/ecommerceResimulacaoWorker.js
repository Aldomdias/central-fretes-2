import { construirIndiceResimulacaoEcommerce, resimularLotePedidosEcommerce } from '../utils/ecommerceResimulacaoEngine';

let indiceCache = null;

self.onmessage = (event) => {
  const msg = event.data || {};

  if (msg.type === 'init-malha-ecommerce') {
    try {
      indiceCache = construirIndiceResimulacaoEcommerce(msg.transportadoras || [], msg.municipios || []);
      self.postMessage({ type: 'malha-pronta' });
    } catch (error) {
      self.postMessage({ type: 'error', message: error?.message || 'Erro ao montar malha de resimulacao.' });
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
      });
      self.postMessage({ type: 'done', resultados, loteId: msg.loteId });
    } catch (error) {
      self.postMessage({ type: 'error', message: error?.message || 'Erro ao resimular pedidos.' });
    }
  }
};
