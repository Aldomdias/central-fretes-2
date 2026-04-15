function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function toPercent(value) {
  return toNumber(value) / 100;
}

export function resolverTaxas({ generalidades = {}, taxaDestino = {}, valorNf = 0, pesoKg = 0 }) {
  const adValPercentual = taxaDestino.adVal ?? generalidades.adValorem ?? 0;
  const adValMinimo = taxaDestino.adValMinimo ?? generalidades.adValoremMinimo ?? 0;
  const grisPercentual = taxaDestino.gris ?? generalidades.gris ?? 0;
  const grisMinimo = taxaDestino.grisMinimo ?? generalidades.grisMinimo ?? 0;

  const adValorem = Math.max(toNumber(valorNf) * toPercent(adValPercentual), toNumber(adValMinimo));
  const gris = Math.max(toNumber(valorNf) * toPercent(grisPercentual), toNumber(grisMinimo));
  const pedagio = (toNumber(pesoKg) / 100) * toNumber(generalidades.pedagio);

  return {
    adValorem,
    gris,
    pedagio,
    tas: toNumber(generalidades.tas),
    ctrc: toNumber(generalidades.ctrc),
    tda: toNumber(taxaDestino.tda),
    tdr: toNumber(taxaDestino.tdr),
    trt: toNumber(taxaDestino.trt),
    suframa: toNumber(taxaDestino.suframa),
    outras: toNumber(taxaDestino.outras),
  };
}

export function calcularFretePercentual({ rota = {}, cotacao = {}, generalidades = {}, taxaDestino = {}, pesoKg = 0, valorNf = 0 }) {
  const peso = toNumber(pesoKg);
  const nf = toNumber(valorNf);
  const minimoRota = toNumber(rota.valorMinimoFrete);
  const valorKg = toNumber(cotacao.rsKg) * peso;
  const valorPercentual = nf * toPercent(cotacao.percentual);
  const valorFixo = toNumber(cotacao.valorFixo);

  const valorBase = Math.max(valorKg, valorPercentual, valorFixo, minimoRota);
  const taxas = resolverTaxas({ generalidades, taxaDestino, valorNf: nf, pesoKg: peso });
  const subtotal = valorBase + taxas.adValorem + taxas.gris + taxas.pedagio + taxas.tas + taxas.ctrc + taxas.tda + taxas.tdr + taxas.trt + taxas.suframa + taxas.outras;
  const icms = generalidades.incideIcms ? subtotal * toPercent(generalidades.aliquotaIcms) : 0;

  return {
    tipoCalculo: 'PERCENTUAL',
    valorBase,
    subtotal,
    icms,
    total: subtotal + icms,
    taxas,
  };
}

export function calcularFreteFaixaPeso({ rota = {}, cotacao = {}, generalidades = {}, taxaDestino = {}, pesoKg = 0, valorNf = 0 }) {
  const peso = toNumber(pesoKg);
  const nf = toNumber(valorNf);
  const pesoLimite = toNumber(cotacao.pesoMax || cotacao.pesoLimite);
  const excessoPorKg = toNumber(cotacao.excesso || cotacao.excessoPeso);
  const valorFaixa = toNumber(cotacao.valorFixo || cotacao.taxaAplicada);
  const valorPercentual = nf * toPercent(cotacao.percentual || cotacao.fretePercentual);
  const excedenteKg = Math.max(0, peso - pesoLimite);
  const valorExcedente = excedenteKg * excessoPorKg;
  const minimoRota = toNumber(rota.valorMinimoFrete);
  const valorBase = Math.max(valorFaixa + valorExcedente + valorPercentual, minimoRota);

  const taxas = resolverTaxas({ generalidades, taxaDestino, valorNf: nf, pesoKg: peso });
  const subtotal = valorBase + taxas.adValorem + taxas.gris + taxas.pedagio + taxas.tas + taxas.ctrc + taxas.tda + taxas.tdr + taxas.trt + taxas.suframa + taxas.outras;
  const icms = generalidades.incideIcms ? subtotal * toPercent(generalidades.aliquotaIcms) : 0;

  return {
    tipoCalculo: 'FAIXA_DE_PESO',
    valorBase,
    subtotal,
    icms,
    total: subtotal + icms,
    valorExcedente,
    taxas,
  };
}
