export function normalizarNomeCidade(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function isTransportadoraEbazarEcommerce(valor) {
  return normalizarNomeCidade(valor).includes('EBAZAR');
}

export function deduplicarCandidatosEcommerce(candidatos = []) {
  const unicos = new Map();
  (candidatos || []).filter(Boolean).forEach((candidato) => {
    const chave = [
      normalizarNomeCidade(candidato.transportadora),
      normalizarNomeCidade(candidato.origem),
      String(candidato.ibgeDestino || ''),
      normalizarNomeCidade(candidato.rotaNome),
      String(candidato.faixaPeso || ''),
      Number(candidato.total || 0).toFixed(6),
      Number(candidato.prazo || 0),
    ].join('|');
    if (!unicos.has(chave)) unicos.set(chave, candidato);
  });
  return [...unicos.values()];
}
