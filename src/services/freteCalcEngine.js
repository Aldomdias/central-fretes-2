function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let text = String(value)
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .replace(/\s/g, '')
    .trim();

  if (!text) return 0;

  const negative = /^-/.test(text) || /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, '').replace(/^-/, '');

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    text = text.replace(',', '.');
  } else if (hasDot) {
    const parts = text.split('.');
    const looksThousands =
      parts.length > 1 &&
      parts.slice(1).every((part) => part.length === 3) &&
      parts[0].length <= 3;

    if (looksThousands) text = text.replace(/\./g, '');
  }

  const clean = text.replace(/[^0-9.]/g, '');
  if (!clean) return 0;
  const parsed = Number(`${negative ? '-' : ''}${clean}`);
  return Number.isFinite(parsed) ? parsed : 0;
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

function calcularIcmsPorDentro(subtotal, aliquotaPercentual) {
  const base = toNumber(subtotal);
  const aliquota = toPercent(aliquotaPercentual);
  if (base <= 0 || aliquota <= 0 || aliquota >= 1) return 0;
  return (base / (1 - aliquota)) - base;
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

function normalizarLimiteExcedentePorPesoMinimo(pesoMin = 0) {
  const minimo = toNumber(pesoMin);
  if (minimo <= 0) return 0;

  // Nas tabelas por faixa, a faixa final costuma vir como 300.001 até 999999999.
  // O excedente, operacionalmente, começa acima de 300 kg. Por isso usamos floor
  // quando o início da faixa é decimal.
  return Number.isInteger(minimo) ? minimo : Math.floor(minimo);
}

function resolverRegraExcedente({ cotacao = {}, pesoMin = 0, pesoLimite = 0, faixaAberta = false }) {
  const limiteInformado = toNumber(
    cotacao.excessoPeso ??
    cotacao.excesso_kg ??
    cotacao.pesoLimiteExcedente ??
    cotacao.limiteExcedente ??
    0
  );

  const valorInformado = toNumber(
    cotacao.excesso ??
    cotacao.valorExcedente ??
    cotacao.valor_excedente ??
    0
  );

  const limitePadraoFaixaAberta = normalizarLimiteExcedentePorPesoMinimo(pesoMin);

  // Existem dois formatos na base:
  // 1) formato correto: excesso_kg = limite, valor_excedente = R$/kg;
  // 2) formato importado de algumas tabelas: excesso_kg veio como R$/kg e valor_excedente veio zerado.
  //    Ex.: faixa 300.001 até 999999999, excesso_kg = 1,04. Nesse caso o limite correto é 300 kg
  //    e o valor do excedente é 1,04 por kg.
  const excessoKgPareceValorUnitario =
    faixaAberta &&
    valorInformado <= 0 &&
    limiteInformado > 0 &&
    limitePadraoFaixaAberta > 0 &&
    limiteInformado < limitePadraoFaixaAberta;

  if (excessoKgPareceValorUnitario) {
    return {
      pesoLimiteExcedente: limitePadraoFaixaAberta,
      excessoPorKg: limiteInformado,
      origemRegraExcedente: 'excesso_kg_como_valor_unitario',
    };
  }

  if (valorInformado > 0) {
    return {
      pesoLimiteExcedente:
        limiteInformado > 0
          ? limiteInformado
          : faixaAberta && limitePadraoFaixaAberta > 0
            ? limitePadraoFaixaAberta
            // Faixa aberta (0 → ~infinito) com R$/kg e sem limiar de excedente:
            // é o modelo "Maior valor" (R$/kg base), o excedente incide desde o
            // pesoMin (0). Sem isso o limite virava pesoLimite (~99.999.999) e o
            // R$/kg nunca era cobrado.
            : faixaAberta
              ? toNumber(pesoMin)
              : pesoLimite,
      excessoPorKg: valorInformado,
      origemRegraExcedente: 'valor_excedente',
    };
  }

  return {
    pesoLimiteExcedente:
      limiteInformado > 0
        ? limiteInformado
        : faixaAberta && limitePadraoFaixaAberta > 0
          ? limitePadraoFaixaAberta
          : pesoLimite,
    excessoPorKg: 0,
    origemRegraExcedente: 'sem_excedente',
  };
}

export function calcularFretePercentual({ rota = {}, cotacao = {}, generalidades = {}, taxaDestino = {}, pesoKg = 0, valorNf = 0 }) {
  const peso = toNumber(pesoKg);
  const nf = toNumber(valorNf);
  const { minimoRota, minimoCotacao, minimoGeneralidade, minimoAplicavel } = resolverMinimoFrete({ rota, cotacao, generalidades });
  const valorKg = toNumber(cotacao.rsKg) * peso;
  const valorPercentual = nf * toPercent(cotacao.percentual || cotacao.fretePercentual);

  const componenteBase = escolherComponenteBase({
    kgGarantia: valorKg,
    fretePercentual: valorPercentual,
    freteMinimo: minimoAplicavel,
  });
  const valorBase = componenteBase.valor;
  const taxas = resolverTaxas({ generalidades, taxaDestino, valorNf: nf, pesoKg: peso });
  const subtotal = valorBase + taxas.adValorem + taxas.gris + taxas.pedagio + taxas.tas + taxas.ctrc + taxas.tda + taxas.tdr + taxas.trt + taxas.suframa + taxas.outras;
  const icms = deveAplicarIcms(generalidades) ? calcularIcmsPorDentro(subtotal, generalidades.aliquotaIcms) : 0;

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
      valorFixo: 0,
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
  const pesoMin = toNumber(cotacao.pesoMin || cotacao.pesoInicial || cotacao.peso_inicial);
  const faixaAberta = pesoLimite >= 999998 || pesoLimite === 0;

  const {
    pesoLimiteExcedente,
    excessoPorKg,
    origemRegraExcedente,
  } = resolverRegraExcedente({ cotacao, pesoMin, pesoLimite, faixaAberta });

  const valorFaixa = toNumber(cotacao.valorFixo || cotacao.taxaAplicada);
  const valorPercentual = nf * toPercent(cotacao.percentual || cotacao.fretePercentual);
  // pesoLimiteExcedente pode ser 0 (R$/kg base aplicado desde o peso 0). O
  // Math.max já zera quando o peso não passa do limiar, então não exigimos > 0.
  const excedenteKg = excessoPorKg > 0
    ? Math.max(0, peso - pesoLimiteExcedente)
    : 0;
  const valorExcedente = excedenteKg * excessoPorKg;

  const { minimoRota, minimoCotacao, minimoGeneralidade, minimoAplicavel } = resolverMinimoFrete({ rota, cotacao, generalidades });
  const valorFaixaComExcedente = valorFaixa + valorExcedente + valorPercentual;
  // Regra de cálculo orientada pela TAXA de faixa (valor fixo), conforme a
  // métrica de negócio (igual à Verum):
  // - COM taxa de faixa (valorFaixa > 0) => "Sem regra": SOMA todos os valores,
  //   inclusive o frete mínimo: taxa + percentual + excedente + mínimo.
  // - SEM taxa de faixa (valorFaixa = 0) => "Maior valor": usa o MAIOR entre
  //   taxa, percentual, excedente e o frete mínimo (que age como piso natural).
  const ehSemRegra = valorFaixa > 0;
  const valorBase = ehSemRegra
    ? valorFaixaComExcedente + minimoAplicavel
    : Math.max(valorFaixa, valorPercentual, valorExcedente, minimoAplicavel);

  const taxas = resolverTaxas({ generalidades, taxaDestino, valorNf: nf, pesoKg: peso });
  const subtotal = valorBase + taxas.adValorem + taxas.gris + taxas.pedagio + taxas.tas + taxas.ctrc + taxas.tda + taxas.tdr + taxas.trt + taxas.suframa + taxas.outras;
  const icms = deveAplicarIcms(generalidades) ? calcularIcmsPorDentro(subtotal, generalidades.aliquotaIcms) : 0;

  return {
    tipoCalculo: 'FAIXA_DE_PESO',
    valorBase,
    subtotal,
    icms,
    total: subtotal + icms,
    valorExcedente,
    pesoLimiteExcedente,
    excedenteKg,
    regraCalculo: ehSemRegra ? 'SEM_REGRA' : 'MAIOR_VALOR',
    componenteBase: ehSemRegra ? 'semRegra' : 'maiorValor',
    componentesBase: {
      valorFaixa,
      valorExcedente,
      valorFaixaComExcedente,
      valorPercentual,
      valorKg: 0,
      minimoRota,
      minimoCotacao,
      minimoGeneralidade,
      minimoAplicavel,
      excessoPorKg,
      pesoLimiteExcedente,
      excedenteKg,
      origemRegraExcedente,
    },
    taxas,
  };
}
