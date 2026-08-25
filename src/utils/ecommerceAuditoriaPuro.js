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

// Estimativa contrafactual: assume que o desconto informado incidiu somente
// sobre a opcao efetivamente usada. A campanha e decisiva quando essa opcao
// perdia para a melhor alternativa antes do desconto e passa a empatar/ganhar
// depois dele. Valores monetarios usam tolerancia de um centavo.
export function calcularImpactoCampanhaNaEscolha({
  possuiCampanha = false,
  mesmaTransportadora = null,
  freteTabela = 0,
  descontoCampanha = 0,
  valorIdeal = 0,
  valorPago = 0,
} = {}) {
  const selecionadaSemDesconto = Number(freteTabela || 0);
  const desconto = Math.max(0, Number(descontoCampanha || 0));
  const alternativa = Number(valorIdeal || 0);
  const pago = Number(valorPago || 0);
  const base = {
    status: 'indeterminado',
    decisiva: false,
    selecionadaSemDesconto,
    selecionadaComDesconto: Math.max(0, selecionadaSemDesconto - desconto),
    valorAlternativa: alternativa,
    desconto,
    descontoMinimo: 0,
    margemAposDesconto: 0,
    custoLogisticoAdicional: 0,
  };

  if (!possuiCampanha) return { ...base, status: 'sem_campanha' };
  if (selecionadaSemDesconto <= 0 || alternativa <= 0) return base;
  if (mesmaTransportadora === true) return { ...base, status: 'nao_mudou' };
  if (mesmaTransportadora === null || mesmaTransportadora === undefined) return base;

  const descontoMinimo = Math.max(0, selecionadaSemDesconto - alternativa);
  const selecionadaComDesconto = base.selecionadaComDesconto;
  const perdiaAntes = selecionadaSemDesconto > alternativa + 0.009;
  const ganhouDepois = selecionadaComDesconto <= alternativa + 0.009;
  const decisiva = desconto > 0 && perdiaAntes && ganhouDepois;
  return {
    ...base,
    status: decisiva ? 'mudou' : 'nao_mudou',
    decisiva,
    descontoMinimo,
    margemAposDesconto: Number((alternativa - selecionadaComDesconto).toFixed(2)),
    custoLogisticoAdicional: decisiva ? Math.max(0, Number((pago - alternativa).toFixed(2))) : 0,
  };
}
