function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function toPercent(value) {
  return toNumber(value) / 100;
}

function calcularPedagioFracao100Kg(pesoKg, valorPorFracao) {
  const peso = toNumber(pesoKg);
  const pedagioUnitario = toNumber(valorPorFracao);

  if (peso <= 0 || pedagioUnitario <= 0) return 0;

  // Regra operacional: pedágio é cobrado por fração iniciada de 100 kg.
  // Exemplos com R$ 7,50 por fração: 1 kg = R$ 7,50; 85 kg = R$ 7,50; 101 kg = R$ 15,00.
  return Math.ceil(peso / 100) * pedagioUnitario;
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
  const pedagio = calcularPedagioFracao100Kg(pesoKg, generalidades.pedagio);

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

  // pesoMax/pesoLimite é o teto da faixa selecionada. Em faixas finais abertas
  // normalmente vem 999999999, então ele NÃO pode ser usado como base para
  // calcular excedente. O limiar correto vem em excessoPeso/excesso_kg,
  // exemplo: faixa 300,001 a 999999999 com excesso_kg = 300 e valor excedente
  // R$/kg. Nesse caso, um CT-e de 699 kg precisa cobrar 399 kg excedentes.
  const pesoLimite = toNumber(cotacao.pesoMax || cotacao.pesoLimite);
  const pesoMin = toNumber(cotacao.pesoMin || cotacao.pesoInicial || cotacao.peso_inicial);
  const pesoLimiteExcedenteInformado = toNumber(
    cotacao.excessoPeso ??
    cotacao.excesso_kg ??
    cotacao.pesoLimiteExcedente ??
    cotacao.limiteExcedente ??
    0
  );

  // No cadastro oficial, cotacao.excesso já representa R$/kg do excedente.
  // Na negociação, o adapter converte valor_excedente para cotacao.excesso
  // e excesso_kg para cotacao.excessoPeso.
  const excessoPorKg = toNumber(
    cotacao.excesso ??
    cotacao.valorExcedente ??
    cotacao.valor_excedente ??
    0
  );

  const valorFaixa = toNumber(cotacao.valorFixo || cotacao.taxaAplicada);
  const valorPercentual = nf * toPercent(cotacao.percentual || cotacao.fretePercentual);
  const valorKg = toNumber(cotacao.rsKg) * peso;

  const faixaAberta = pesoLimite >= 999998 || pesoLimite === 0;
  const pesoLimiteExcedente = pesoLimiteExcedenteInformado > 0
    ? pesoLimiteExcedenteInformado
    : faixaAberta && pesoMin > 0
      ? pesoMin
      : pesoLimite;

  const excedenteKg = excessoPorKg > 0 && pesoLimiteExcedente > 0
    ? Math.max(0, peso - pesoLimiteExcedente)
    : 0;
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
    pesoLimiteExcedente,
    excedenteKg,
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
      excessoPorKg,
      pesoLimiteExcedente,
      excedenteKg,
    },
    taxas,
  };
}
