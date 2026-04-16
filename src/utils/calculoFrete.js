function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function toPercent(value) {
  const num = toNumber(value);
  return num > 1 ? num / 100 : num;
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

export function getDashboardMetrics(transportadoras) {
  const origens = transportadoras.flatMap((t) => t.origens || []);
  return {
    totalTransportadoras: transportadoras.length,
    totalOrigens: origens.length,
    totalRotas: origens.reduce((sum, o) => sum + (o.rotas?.length || 0), 0),
    totalCotacoes: origens.reduce((sum, o) => sum + (o.cotacoes?.length || 0), 0),
  };
}

function normalizarTexto(value) {
  return String(value || '').trim().toUpperCase();
}

function limparCep(value) {
  return String(value || '').replace(/\D/g, '');
}

function rotaAtendeCep(rota, cep) {
  const cepLimpo = limparCep(cep);
  if (!cepLimpo) return false;

  const inicio = limparCep(rota.cepInicial || rota.cepInicio || rota.faixaCepInicial);
  const fim = limparCep(rota.cepFinal || rota.cepFim || rota.faixaCepFinal);

  if (inicio && fim) {
    return Number(cepLimpo) >= Number(inicio) && Number(cepLimpo) <= Number(fim);
  }

  if (Array.isArray(rota.ceps) && rota.ceps.length) {
    return rota.ceps.map(limparCep).includes(cepLimpo);
  }

  if (rota.cepDestino) {
    return limparCep(rota.cepDestino) === cepLimpo;
  }

  return false;
}

function localizarRota(origem, destinoBusca, canal) {
  const alvoTexto = normalizarTexto(destinoBusca);
  const alvoNumerico = limparCep(destinoBusca);

  return (origem.rotas || []).find((rota) => {
    const canalOk = !canal || canal === 'TODOS' || rota.canal === canal;
    if (!canalOk) return false;

    if (alvoNumerico && rotaAtendeCep(rota, alvoNumerico)) return true;
    if (alvoTexto && normalizarTexto(rota.ibgeDestino) === alvoTexto) return true;
    if (alvoTexto && normalizarTexto(rota.nomeRota).includes(alvoTexto)) return true;
    return false;
  });
}

function localizarCotacao(origem, rota, peso) {
  const cotacoesDaRota = (origem.cotacoes || []).filter((cotacao) => {
    return normalizarTexto(cotacao.rota) === normalizarTexto(rota.nomeRota);
  });

  return cotacoesDaRota.find((cotacao) => {
    const pesoMin = toNumber(cotacao.pesoMin);
    const pesoMax = toNumber(cotacao.pesoMax || 999999999);
    return peso >= pesoMin && peso <= pesoMax;
  }) || cotacoesDaRota[0] || null;
}

function localizarTaxaEspecial(origem, ibgeDestino) {
  return (origem.taxasEspeciais || []).find((item) => String(item.ibgeDestino) === String(ibgeDestino));
}

function calcularBase(origem, rota, cotacao, peso, valorNf) {
  const minimoRota = toNumber(rota.valorMinimoFrete);
  const percentual = toPercent(cotacao?.percentual);
  const valorPercentual = valorNf * percentual;
  const valorKg = toNumber(cotacao?.rsKg) * peso;
  const valorFixo = toNumber(cotacao?.valorFixo);
  const excessoPorKg = toNumber(cotacao?.excesso);
  const pesoMax = toNumber(cotacao?.pesoMax);
  const tipo = origem.generalidades?.tipoCalculo || 'PERCENTUAL';

  if (tipo === 'PERCENTUAL') {
    const valorBase = Math.max(valorPercentual, minimoRota, valorFixo || 0);
    return {
      tipoCalculo: 'PERCENTUAL',
      criterio: valorBase === minimoRota ? 'Mínimo da rota' : 'Percentual sobre NF',
      valorBase,
      valorPercentual,
      valorKg,
      valorFaixa: valorFixo,
      valorExcedente: 0,
    };
  }

  const faixaBase = Math.max(valorFixo, minimoRota);
  let valorExcedente = 0;
  if (pesoMax && peso > pesoMax && excessoPorKg) {
    valorExcedente = (peso - pesoMax) * excessoPorKg;
  }

  const valorBase = faixaBase + valorExcedente;
  return {
    tipoCalculo: 'FAIXA_DE_PESO',
    criterio: valorExcedente > 0 ? 'Faixa + excedente' : 'Faixa de peso',
    valorBase,
    valorPercentual,
    valorKg,
    valorFaixa: faixaBase,
    valorExcedente,
  };
}

function calcularAdicionais(origem, rota, base, nf, peso) {
  const g = origem.generalidades || {};
  const especial = localizarTaxaEspecial(origem, rota.ibgeDestino) || {};

  const adValPercentual = especial.adVal === null || especial.adVal === undefined ? toPercent(g.adValorem) : toPercent(especial.adVal);
  const grisPercentual = especial.gris === null || especial.gris === undefined ? toPercent(g.gris) : toPercent(especial.gris);
  const adValMinimo = especial.adValMinimo === null || especial.adValMinimo === undefined ? toNumber(g.adValoremMinimo) : toNumber(especial.adValMinimo);
  const grisMinimo = especial.grisMinimo === null || especial.grisMinimo === undefined ? toNumber(g.grisMinimo) : toNumber(especial.grisMinimo);

  const adValorem = Math.max(nf * adValPercentual, adValMinimo);
  const gris = Math.max(nf * grisPercentual, grisMinimo);
  const pedagio = (peso / 100) * toNumber(g.pedagio);
  const tas = toNumber(g.tas);
  const ctrc = toNumber(g.ctrc);
  const tda = toNumber(especial.tda);
  const tdr = toNumber(especial.tdr);
  const trt = toNumber(especial.trt);
  const suframa = toNumber(especial.suframa);
  const outras = toNumber(especial.outras);

  const subtotal = base.valorBase + adValorem + gris + pedagio + tas + ctrc + tda + tdr + trt + suframa + outras;
  const aliquota = g.incideIcms ? toPercent(g.aliquotaIcms) : 0;
  const icms = aliquota ? subtotal * aliquota : 0;
  const total = subtotal + icms;

  return {
    adValorem,
    gris,
    pedagio,
    tas,
    ctrc,
    tda,
    tdr,
    trt,
    suframa,
    outras,
    icms,
    total,
  };
}

function construirResultado({ transportadora, origem, rota, base, adicionais, peso, nf }) {
  return {
    transportadoraId: transportadora.id,
    transportadora: transportadora.nome,
    origemId: origem.id,
    origem: origem.cidade,
    rota: rota.nomeRota,
    ibgeDestino: rota.ibgeDestino,
    prazo: rota.prazoEntregaDias,
    canal: rota.canal,
    tipoCalculo: base.tipoCalculo,
    criterio: base.criterio,
    peso,
    valorNf: nf,
    valorBase: base.valorBase,
    valorPeso: base.valorKg || 0,
    valorPercentual: base.valorPercentual || 0,
    valorFaixa: base.valorFaixa || 0,
    valorExcedente: base.valorExcedente || 0,
    minimoRota: toNumber(rota.valorMinimoFrete),
    ...adicionais,
  };
}

export function simularFretes({ transportadoras, modo = 'destino', transportadoraId, origemId, destino, pesoKg, valorNf, canal }) {
  const peso = toNumber(pesoKg);
  const nf = toNumber(valorNf);
  if (!peso || !destino) return [];

  const resultados = [];
  const baseTransportadoras = transportadoraId
    ? transportadoras.filter((item) => String(item.id) === String(transportadoraId))
    : transportadoras;

  baseTransportadoras.forEach((transportadora) => {
    const origensFiltradas = (transportadora.origens || []).filter((origem) => {
      if (origemId && String(origem.id) !== String(origemId)) return false;
      if (canal && canal !== 'TODOS') {
        const possuiCanal = (origem.rotas || []).some((rota) => rota.canal === canal);
        if (!possuiCanal) return false;
      }
      return true;
    });

    origensFiltradas.forEach((origem) => {
      const rota = localizarRota(origem, destino, canal);
      if (!rota) return;
      const cotacao = localizarCotacao(origem, rota, peso);
      if (!cotacao) return;
      const base = calcularBase(origem, rota, cotacao, peso, nf);
      const adicionais = calcularAdicionais(origem, rota, base, nf, peso);
      resultados.push(construirResultado({ transportadora, origem, rota, base, adicionais, peso, nf }));
    });
  });

  const ordenados = resultados.sort((a, b) => a.total - b.total);
  if (modo === 'transportadora' && transportadoraId) return ordenados;
  return ordenados;
}

export function simularGradePorCanal({ transportadoras, canal, origemId, transportadoraId, destino, faixas = [] }) {
  const linhas = faixas.map((faixa) => {
    const resultados = simularFretes({
      transportadoras,
      modo: 'destino',
      transportadoraId,
      origemId,
      destino,
      pesoKg: faixa.peso,
      valorNf: faixa.valorNf,
      canal,
    });

    if (!resultados.length) {
      return {
        peso: faixa.peso,
        valorNf: faixa.valorNf,
        canal,
        vencedor: null,
        segundo: null,
        diferencaSegundo: 0,
        savingSegundo: 0,
        resultados: [],
      };
    }

    const vencedor = resultados[0];
    const segundo = resultados[1] || null;
    const diferencaSegundo = segundo ? segundo.total - vencedor.total : 0;
    const savingSegundo = segundo ? diferencaSegundo : 0;

    return {
      peso: faixa.peso,
      valorNf: faixa.valorNf,
      canal,
      vencedor,
      segundo,
      diferencaSegundo,
      savingSegundo,
      resultados,
    };
  });

  const validas = linhas.filter((item) => item.vencedor);
  const totalSaving = validas.reduce((acc, item) => acc + item.savingSegundo, 0);

  const vitorias = validas.reduce((acc, item) => {
    const nome = item.vencedor.transportadora;
    acc[nome] = (acc[nome] || 0) + 1;
    return acc;
  }, {});

  return {
    linhas,
    totalSaving,
    vitorias,
    aderencia: validas.length / (faixas.length || 1),
  };
}
