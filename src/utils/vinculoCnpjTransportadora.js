import { obterRaizCnpj, raizCnpjValida } from './cnpj.js';

// Vinculo por raiz de CNPJ (8 primeiros digitos): so vale a raiz cadastrada
// (principal, origens ou CNPJ adicional). Nunca por aproximacao de nome.

export function raizesDaTransportadora(transportadora = {}) {
  const raizes = new Set();
  const adicionar = (valor) => {
    const raiz = obterRaizCnpj(valor);
    if (raizCnpjValida(raiz)) raizes.add(raiz);
  };
  adicionar(transportadora.cnpjRaiz || transportadora.cnpj);
  (transportadora.origens || []).forEach((origem) => adicionar(origem.cnpjRaiz || origem.cnpj));
  (transportadora.raizesAdicionais || []).forEach(adicionar);
  return Array.from(raizes);
}

export function transportadoraTemRaiz(transportadora = {}, cnpjOuRaiz = '') {
  const raiz = obterRaizCnpj(cnpjOuRaiz);
  if (!raizCnpjValida(raiz)) return false;
  return raizesDaTransportadora(transportadora).includes(raiz);
}

// Raiz -> ids de transportadora que a usam. Mais de um id = conflito.
export function indicePorRaiz(transportadoras = []) {
  const indice = new Map();
  (transportadoras || []).forEach((transportadora) => {
    raizesDaTransportadora(transportadora).forEach((raiz) => {
      const ids = indice.get(raiz) || new Set();
      ids.add(transportadora.id ?? transportadora.nome);
      indice.set(raiz, ids);
    });
  });
  return indice;
}

// Retorna a transportadora (!= atual) que ja usa a raiz, ou null.
export function conflitoDeRaiz(transportadoras = [], transportadoraId, cnpjOuRaiz = '') {
  const raiz = obterRaizCnpj(cnpjOuRaiz);
  if (!raizCnpjValida(raiz)) return null;
  return (transportadoras || []).find((item) => item.id !== transportadoraId && raizesDaTransportadora(item).includes(raiz)) || null;
}
