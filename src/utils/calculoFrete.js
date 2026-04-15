function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function toPercent(value) {
  return toNumber(value) / 100;
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

function localizarRota(origem, destino, canal) {
  const alvo = String(destino || '').trim().toUpperCase();
  return (origem.rotas || []).find((rota) => {
    const canalOk = !canal || canal === 'TODOS' || rota.canal === canal;
    const destinoOk = String(rota.ibgeDestino) === alvo || String(rota.nomeRota).toUpperCase().includes(alvo);
    return canalOk && destinoOk;
  });
}

function localizarCotacao(origem, rota, peso) {
  return (origem.cotacoes || []).find((cotacao) => {
    const mesmaRota = String(cotacao.rota).toUpperCase() === String(rota.nomeRota).toUpperCase();
    return mesmaRota && peso >= toNumber(cotacao.pesoMin) && peso <= toNumber(cotacao.pesoMax || 999999999);
  });
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
  const tipo = origem.generalidades?.tipoCalculo;

  if (tipo === 'FAIXA_DE_PESO') {
    const excedenteKg = Math.max(0, peso - pesoMax);
    const valorExcedente = excedenteKg * excessoPorKg;
    const valorFaixa = valorFixo + valorExcedente + valorPercentual;
    return {
      tipoCalculo: 'FAIXA_DE_PESO',
      valorBase: Math.max(valorFaixa, minimoRota),
      valorFaixa,
      valorExcedente,
      valorPercentual,
      criterio: valorFaixa >= minimoRota ? 'Faixa + excedente + percentual' : 'Mínimo da rota',
    };
  }

  const valorBase = Math.max(valorKg, valorPercentual, minimoRota, valorFixo);
  let criterio = 'Valor por kg';
  if (valorBase === valorPercentual) criterio = 'Percentual sobre NF';
  if (valorBase === minimoRota) criterio = 'Mínimo da rota';
  if (valorBase === valorFixo) criterio = 'Valor fixo';

  return {
    tipoCalculo: 'PERCENTUAL',
    valorBase,
    valorKg,
    valorPercentual,
    criterio,
  };
}

export function simularFretes({ transportadoras, modo, transportadoraId, origemId, destino, pesoKg, valorNf, canal }) {
  const peso = toNumber(pesoKg);
  const nf = toNumber(valorNf);
  if (!peso || !nf) return [];

  const resultados = [];

  transportadoras.forEach((transportadora) => {
    if (transportadoraId && String(transportadora.id) !== String(transportadoraId)) return;

    (transportadora.origens || []).forEach((origem) => {
      if (origemId && String(origem.id) !== String(origemId)) return;
      const rota = localizarRota(origem, destino, canal);
      if (!rota) return;
      const cotacao = localizarCotacao(origem, rota, peso);
      if (!cotacao) return;

      const base = calcularBase(origem, rota, cotacao, peso, nf);
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
      const trt = toNumber(especial.trt);
      const suframa = toNumber(especial.suframa);
      const outras = toNumber(especial.outras);

      const subtotal = base.valorBase + adValorem + gris + pedagio + tas + ctrc + tda + trt + suframa + outras;
      const icms = g.incideIcms ? subtotal * toPercent(g.aliquotaIcms) : 0;
      const total = subtotal + icms;

      resultados.push({
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
        valorBase: base.valorBase,
        valorPeso: base.valorKg || 0,
        valorPercentual: base.valorPercentual || 0,
        valorFaixa: base.valorFaixa || 0,
        valorExcedente: base.valorExcedente || 0,
        minimoRota: toNumber(rota.valorMinimoFrete),
        adValorem,
        gris,
        pedagio,
        tas,
        ctrc,
        tda,
        trt,
        suframa,
        outras,
        icms,
        total,
      });
    });
  });

  if (modo === 'transportadora' && transportadoraId) {
    return resultados.sort((a, b) => a.total - b.total);
  }

  return resultados.sort((a, b) => a.total - b.total);
}
