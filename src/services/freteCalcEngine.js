function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function toPercent(value) {
  return toNumber(value) / 100;
}

function toBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (['true', '1', 'sim', 's', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'nao', 'n', 'no'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function deveAplicarIcms(generalidades = {}) {
  return toBooleanFlag(
    generalidades.incideIcms ??
    generalidades.incide_icms ??
    generalidades.icms ??
    generalidades.aplicaIcms ??
    generalidades.aplica_icms
  );
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

function resolverMinimoFrete({ rota = {}, cotacao = {}, generalidades = {} }) {
  const minimoRota = toNumber(rota.valorMinimoFrete);
  const minimoCotacao = toNumber(
    cotacao.freteMinimo ??
    cotacao.frete_minimo ??
    cotacao.valorMinimoFrete ??
    cotacao.minimo
  );
  const minimoGeneralidade = toNumber(
    generalidades.freteMinimo ??
    generalidades.frete_minimo ??
    generalidades.minimo
  );

  return {
    minimoRota,
    minimoCotacao,
    minimoGeneralidade,
    minimoAplicavel: Math.max(minimoRota, minimoCotacao, minimoGeneralidade),
  };
}

function escolherComponenteBase(componentes = {}) {
  const pares = Object.entries(componentes)
    .map(([nome, valor]) => [nome, toNumber(valor)])
    .filter(([, valor]) => Number.isFinite(valor));

  return pares.reduce(
    (melhor, [nome, valor]) => (valor > melhor.valor ? { nome, valor } : melhor),
    { nome: '', valor: 0 }
  );
}

export function calcularFretePercentual({ rota = {}, cotacao = {}, generalidades = {}, taxaDestino = {}, pesoKg = 0, valorNf = 0 }) {
  const peso = toNumber(pesoKg);
  const nf = toNumber(valorNf);
  const { minimoRota, minimoCotacao, minimoGeneralidade, minimoAplicavel } = resolverMinimoFrete({ rota, cotacao, generalidades });
  const valorKg = toNumber(cotacao.rsKg) * peso;
  const valorPercentual = nf * toPercent(cotacao.percentual || cotacao.fretePercentual);
  const valorFixo = toNumber(cotacao.valorFixo || cotacao.taxaAplicada);

  const componenteBase = escolherComponenteBase({
    valorKg,
    valorPercentual,
    valorFixo,
    minimoAplicavel,
  });
  const valorBase = componenteBase.valor;
  const taxas = resolverTaxas({ generalidades, taxaDestino, valorNf: nf, pesoKg: peso });
  const subtotal = valorBase + taxas.adValorem + taxas.gris + taxas.pedagio + taxas.tas + taxas.ctrc + taxas.tda + taxas.tdr + taxas.trt + taxas.suframa + taxas.outras;
  const icms = deveAplicarIcms(generalidades) ? subtotal * toPercent(generalidades.aliquotaIcms) : 0;

  return {
    tipoCalculo: 'PERCENTUAL',
    valorBase,
    subtotal,
    icms,
    total: subtotal + icms,
    componenteBase: componenteBase.nome,
    componentesBase: {
      valorKg,
      valorPercentual,
      valorFixo,
      minimoRota,
      minimoCotacao,
      minimoGeneralidade,
      minimoAplicavel,
    },
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
  const valorKg = toNumber(cotacao.rsKg) * peso;
  const excedenteKg = Math.max(0, peso - pesoLimite);
  const valorExcedente = excedenteKg * excessoPorKg;
  const { minimoRota, minimoCotacao, minimoGeneralidade, minimoAplicavel } = resolverMinimoFrete({ rota, cotacao, generalidades });
  const valorFaixaComExcedente = valorFaixa + valorExcedente + valorPercentual;
  const componenteBase = escolherComponenteBase({
    valorFaixaComExcedente,
    valorKg,
    minimoAplicavel,
  });
  const valorBase = componenteBase.valor;

  const taxas = resolverTaxas({ generalidades, taxaDestino, valorNf: nf, pesoKg: peso });
  const subtotal = valorBase + taxas.adValorem + taxas.gris + taxas.pedagio + taxas.tas + taxas.ctrc + taxas.tda + taxas.tdr + taxas.trt + taxas.suframa + taxas.outras;
  const icms = deveAplicarIcms(generalidades) ? subtotal * toPercent(generalidades.aliquotaIcms) : 0;

  return {
    tipoCalculo: 'FAIXA_DE_PESO',
    valorBase,
    subtotal,
    icms,
    total: subtotal + icms,
    valorExcedente,
    componenteBase: componenteBase.nome,
    componentesBase: {
      valorFaixa,
      valorExcedente,
      valorFaixaComExcedente,
      valorPercentual,
      valorKg,
      minimoRota,
      minimoCotacao,
      minimoGeneralidade,
      minimoAplicavel,
    },
    taxas,
  };
}
