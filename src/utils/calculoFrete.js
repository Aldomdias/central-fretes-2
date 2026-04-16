function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function toPercent(value) {
  return toNumber(value) / 100;
}

function normalizeText(value) {
  return String(value || '').trim().toUpperCase();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function getDestinoLookup(destinoInput) {
  const digits = onlyDigits(destinoInput);
  if (!digits) return { kind: 'all', value: '' };
  if (digits.length === 7) return { kind: 'ibge', value: digits };
  if (digits.length === 8) return { kind: 'cep', value: digits };
  return { kind: 'text', value: normalizeText(destinoInput) };
}

function getRangeValue(item, keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null && item[key] !== '') return item[key];
  }
  return '';
}

function matchCepRange(rota, cepDigits) {
  const inicio = onlyDigits(getRangeValue(rota, ['cepInicial', 'cepInicio', 'cepDe', 'cepOrigemInicial', 'faixaCepInicial']));
  const fim = onlyDigits(getRangeValue(rota, ['cepFinal', 'cepFim', 'cepAte', 'cepOrigemFinal', 'faixaCepFinal']));
  if (!inicio || !fim || !cepDigits) return false;
  const cep = Number(cepDigits);
  return cep >= Number(inicio) && cep <= Number(fim);
}

function localizarRotas(origem, destinoLookup, canal) {
  return (origem.rotas || []).filter((rota) => {
    const canalOk = !canal || canal === 'TODOS' || rota.canal === canal;
    if (!canalOk) return false;

    if (destinoLookup.kind === 'all') return true;
    if (destinoLookup.kind === 'ibge') return String(rota.ibgeDestino) === destinoLookup.value;
    if (destinoLookup.kind === 'cep') return matchCepRange(rota, destinoLookup.value);

    const rotaNome = normalizeText(rota.nomeRota);
    return rotaNome.includes(destinoLookup.value) || String(rota.ibgeDestino) === onlyDigits(destinoLookup.value);
  });
}

function localizarCotacao(origem, rota, peso) {
  return (origem.cotacoes || []).find((cotacao) => {
    const mesmaRota = normalizeText(cotacao.rota) === normalizeText(rota.nomeRota);
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
      faixaUtilizada: `${toNumber(cotacao?.pesoMin)} a ${toNumber(cotacao?.pesoMax) || 'acima'}`,
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
    faixaUtilizada: `${toNumber(cotacao?.pesoMin)} a ${toNumber(cotacao?.pesoMax) || 'acima'}`,
  };
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

function calcularItem({ transportadora, origem, rota, cotacao, peso, nf }) {
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
  const tdr = toNumber(especial.tdr);
  const trt = toNumber(especial.trt);
  const suframa = toNumber(especial.suframa);
  const outras = toNumber(especial.outras);

  const subtotal = base.valorBase + adValorem + gris + pedagio + tas + ctrc + tda + tdr + trt + suframa + outras;
  const icms = g.incideIcms ? subtotal * toPercent(g.aliquotaIcms) : 0;
  const total = subtotal + icms;

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
    faixaUtilizada: base.faixaUtilizada,
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
    tdr,
    trt,
    suframa,
    outras,
    icms,
    total,
    pesoSimulado: peso,
    valorNfSimulado: nf,
  };
}

export function simularFretes({ transportadoras, modo, transportadoraId, origemCidade, destino, pesoKg, valorNf, canal }) {
  const peso = toNumber(pesoKg);
  const nf = toNumber(valorNf);
  if (!peso || !nf) return [];

  const destinoLookup = getDestinoLookup(destino);
  const resultados = [];

  transportadoras.forEach((transportadora) => {
    if (transportadoraId && String(transportadora.id) !== String(transportadoraId)) return;

    (transportadora.origens || []).forEach((origem) => {
      if (origemCidade && normalizeText(origem.cidade) !== normalizeText(origemCidade)) return;
      const rotas = localizarRotas(origem, destinoLookup, canal);
      rotas.forEach((rota) => {
        const cotacao = localizarCotacao(origem, rota, peso);
        if (!cotacao) return;
        resultados.push(calcularItem({ transportadora, origem, rota, cotacao, peso, nf }));
      });
    });
  });

  if (modo === 'destino' && destinoLookup.kind !== 'all') {
    return resultados.sort((a, b) => a.total - b.total);
  }

  return resultados.sort((a, b) => a.total - b.total || a.prazo - b.prazo);
}

function getGradePesos(canal) {
  if (canal === 'B2C') {
    return Array.from({ length: 100 }, (_, index) => index + 1);
  }
  return Array.from({ length: 10 }, (_, index) => (index + 1) * 50);
}

export function simularGradeTabela({ transportadoras, transportadoraId, origemCidade, destino, canal, valorNf }) {
  const canalSelecionado = canal && canal !== 'TODOS' ? canal : 'ATACADO';
  const pesos = getGradePesos(canalSelecionado);
  const nfUsada = canalSelecionado === 'B2C' ? 150 : toNumber(valorNf) || 5000;

  const rodadas = pesos.map((peso) => {
    const ranking = simularFretes({
      transportadoras,
      modo: 'destino',
      transportadoraId,
      origemCidade,
      destino,
      pesoKg: peso,
      valorNf: nfUsada,
      canal: canalSelecionado,
    });
    return { peso, ranking };
  }).filter((item) => item.ranking.length >= 2);

  const totalRodadas = rodadas.length;
  if (!totalRodadas) {
    return { canalUsado: canalSelecionado, nfUsada, rodadas: [], rankingTransportadoras: [] };
  }

  const mapa = new Map();

  rodadas.forEach(({ peso, ranking }) => {
    const vencedor = ranking[0];
    const segundo = ranking[1];
    const saving = Math.max(0, segundo.total - vencedor.total);

    ranking.forEach((item, index) => {
      const chave = `${item.transportadoraId}::${item.origem}`;
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          chave,
          transportadoraId: item.transportadoraId,
          transportadora: item.transportadora,
          origem: item.origem,
          vitorias: 0,
          savingTotal: 0,
          totalFrete: 0,
          participacoes: 0,
          detalhes: [],
        });
      }
      const atual = mapa.get(chave);
      atual.participacoes += 1;
      atual.totalFrete += item.total;
      atual.detalhes.push({ peso, posicao: index + 1, total: item.total, rota: item.rota, prazo: item.prazo });
      if (index === 0) {
        atual.vitorias += 1;
        atual.savingTotal += saving;
      }
    });
  });

  const rankingTransportadoras = Array.from(mapa.values())
    .map((item) => ({
      ...item,
      aderencia: totalRodadas ? (item.vitorias / totalRodadas) * 100 : 0,
      freteMedio: item.participacoes ? item.totalFrete / item.participacoes : 0,
    }))
    .sort((a, b) => b.vitorias - a.vitorias || b.savingTotal - a.savingTotal || a.freteMedio - b.freteMedio);

  return { canalUsado: canalSelecionado, nfUsada, rodadas, rankingTransportadoras };
}
