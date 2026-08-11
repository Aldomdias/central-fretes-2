export function normalizarCnpj(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 14);
}

export function cnpjPreenchidoValido(valor) {
  return normalizarCnpj(valor).length === 14;
}

export function obterRaizCnpj(valor) {
  return normalizarCnpj(valor).slice(0, 8);
}

export function raizCnpjValida(valor) {
  return String(valor || '').replace(/\D/g, '').length === 8;
}

export function formatarCnpj(valor) {
  const cnpj = normalizarCnpj(valor);
  if (cnpj.length !== 14) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export function criarIndicePorRaizCnpj(registros = [], obterCnpj = (item) => item?.cnpj) {
  const indice = new Map();
  (registros || []).forEach((item) => {
    const raiz = obterRaizCnpj(obterCnpj(item));
    if (!raizCnpjValida(raiz)) return;
    indice.set(raiz, [...(indice.get(raiz) || []), item]);
  });
  return indice;
}

export function resolverPorCnpjRaiz(cnpj = '', indice = new Map()) {
  const raiz = obterRaizCnpj(cnpj);
  if (!raizCnpjValida(raiz)) return null;
  const candidatos = indice.get(raiz) || [];
  return candidatos.length === 1 ? candidatos[0] : null;
}
