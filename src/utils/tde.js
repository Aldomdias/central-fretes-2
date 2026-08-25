export function normalizarDocumentoTde(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 14);
}

export function normalizarRegraTde(item, valorPadrao = 0) {
  if (typeof item === 'string' || typeof item === 'number') {
    const cnpj = normalizarDocumentoTde(item);
    return cnpj ? { cnpj, nomeCliente: '', valor: Number(valorPadrao) || 0 } : null;
  }

  if (!item || typeof item !== 'object') return null;
  const cnpj = normalizarDocumentoTde(item.cnpj ?? item.documento);
  if (!cnpj) return null;
  return {
    cnpj,
    nomeCliente: String(item.nomeCliente ?? item.nome_cliente ?? item.cliente ?? '').trim(),
    valor: Number(item.valor ?? item.tde ?? valorPadrao) || 0,
  };
}

export function normalizarRegrasTde(lista, valorPadrao = 0) {
  const porCnpj = new Map();
  (Array.isArray(lista) ? lista : []).forEach((item) => {
    const regra = normalizarRegraTde(item, valorPadrao);
    if (regra) porCnpj.set(regra.cnpj, regra);
  });
  return [...porCnpj.values()];
}
