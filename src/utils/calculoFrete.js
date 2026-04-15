function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function toPercent(value) {
  return toNumber(value) / 100;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function extractUfFromRouteName(nomeRota) {
  const match = String(nomeRota || '').toUpperCase().match(/-\s*([A-Z]{2})$/);
  return match ? match[1] : '';
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

export function buildSimuladorOptions(transportadoras) {
  const origemMap = new Map();
  const destinoMap = new Map();

  (transportadoras || []).forEach((transportadora) => {
    (transportadora.origens || []).forEach((origem) => {
      const origemIbge = onlyDigits((origem.rotas || [])[0]?.ibgeOrigem);
      const origemKey = `${normalizeText(origem.cidade)}|${origemIbge}`;
      if (!origemMap.has(origemKey)) {
        origemMap.set(origemKey, {
          key: origemKey,
          cidade: origem.cidade || '',
          ibge: origemIbge,
          label: origemIbge ? `${origem.cidade} • IBGE ${origemIbge}` : String(origem.cidade || ''),
        });
      }

      (origem.rotas || []).forEach((rota) => {
        const destinoIbge = onlyDigits(rota.ibgeDestino);
        const destinoNome = rota.nomeRota || destinoIbge;
        const uf = extractUfFromRouteName(rota.nomeRota);
        const destinoKey = `${normalizeText(destinoNome)}|${destinoIbge}`;
        if (!destinoMap.has(destinoKey)) {
          destinoMap.set(destinoKey, {
            key: destinoKey,
            nome: destinoNome,
            ibge: destinoIbge,
            uf,
            label: destinoIbge ? `${destinoNome} • IBGE ${destinoIbge}` : destinoNome,
          });
        }
      });
    });
  });

  return {
    origens: Array.from(origemMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    destinos: Array.from(destinoMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
  };
}

function routeMatchesDestination(rota, filtroDestino) {
  if (!filtroDestino) return true;
  const alvoTexto = normalizeText(filtroDestino.texto);
  const alvoIbge = onlyDigits(filtroDestino.ibge || filtroDestino.texto);
  const destinoIbge = onlyDigits(rota.ibgeDestino);
  const nomeRota = normalizeText(rota.nomeRota);

  return Boolean(
    (alvoIbge && destinoIbge === alvoIbge) ||
      (alvoTexto && (nomeRota.includes(alvoTexto) || normalizeText(destinoIbge).includes(alvoTexto)))
  );
}

function routeMatchesOrigin(origem, filtroOrigem) {
  if (!filtroOrigem) return true;
  const origemIbge = onlyDigits((origem.rotas || [])[0]?.ibgeOrigem);
  const filtroIbge = onlyDigits(filtroOrigem.ibge || filtroOrigem.texto);
  const filtroTexto = normalizeText(filtroOrigem.texto);

  return Boolean(
    (filtroIbge && origemIbge === filtroIbge) ||
      (filtroTexto && normalizeText(origem.cidade).includes(filtroTexto))
  );
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
  const tipo = origem.generalidades?.tipoCalculo || 'PERCENTUAL';

  if (tipo === 'FAIXA_DE_PESO') {
    const dentroFaixa = peso <= pesoMax || !pesoMax;
    const valorFaixa = valorFixo;
    const valorExcedente = !dentroFaixa ? (peso - pesoMax) * excessoPorKg : 0;
    const bruto = valorFaixa + valorExcedente;
    return {
      tipoCalculo: 'FAIXA_DE_PESO',
      criterio: dentroFaixa ? `Faixa ${cotacao?.pesoMin ?? 0} a ${cotacao?.pesoMax ?? 'acima'}` : `Faixa + excedente`,
      valorBase: Math.max(bruto, minimoRota),
      valorFaixa,
      valorExcedente,
      valorKg,
      valorPercentual,
    };
  }

  const maiorBase = Math.max(valorPercentual, valorKg, valorFixo, minimoRota);
  let criterio = 'Valor mínimo da rota';
  if (maiorBase === valorPercentual && maiorBase > 0) criterio = 'Percentual sobre NF';
  else if (maiorBase === valorKg && maiorBase > 0) criterio = 'R$/kg';
  else if (maiorBase === valorFixo && maiorBase > 0) criterio = 'Valor fixo';

  return {
    tipoCalculo: 'PERCENTUAL',
    criterio,
    valorBase: maiorBase,
    valorKg,
    valorPercentual,
    valorFaixa: valorFixo,
    valorExcedente: 0,
  };
}

export function simularFretes({
  transportadoras,
  modo,
  transportadoraId,
  origemId,
  origemFiltro,
  destino,
  destinoFiltro,
  pesoKg,
  valorNf,
  canal,
}) {
  const peso = toNumber(pesoKg);
  const nf = toNumber(valorNf);
  const origemBusca = origemFiltro?.texto || origemFiltro?.ibge || '';
  const destinoBusca = destinoFiltro?.texto || destinoFiltro?.ibge || destino || '';

  if ((!origemId && !origemBusca) || !destinoBusca || !peso) return [];

  const filtroOrigem = origemId ? null : { texto: origemFiltro?.texto || origemBusca, ibge: origemFiltro?.ibge || origemBusca };
  const filtroDestino = { texto: destinoFiltro?.texto || destinoBusca, ibge: destinoFiltro?.ibge || destinoBusca };

  const listaTransportadoras = transportadoraId
    ? transportadoras.filter((item) => String(item.id) === String(transportadoraId))
    : transportadoras;

  const resultados = [];

  listaTransportadoras.forEach((transportadora) => {
    (transportadora.origens || []).forEach((origem) => {
      const origemSelecionada = origemId ? String(origem.id) === String(origemId) : routeMatchesOrigin(origem, filtroOrigem);
      if (!origemSelecionada) return;

      (origem.rotas || []).forEach((rota) => {
        const canalOk = !canal || canal === 'TODOS' || rota.canal === canal;
        if (!canalOk || !routeMatchesDestination(rota, filtroDestino)) return;

        const cotacao = localizarCotacao(origem, rota, peso);
        if (!cotacao) return;
        const especial = localizarTaxaEspecial(origem, rota.ibgeDestino) || {};
        const base = calcularBase(origem, rota, cotacao, peso, nf);
        const g = origem.generalidades || {};

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
        const origemIbge = onlyDigits(rota.ibgeOrigem || (origem.rotas || [])[0]?.ibgeOrigem);

        resultados.push({
          transportadoraId: transportadora.id,
          transportadora: transportadora.nome,
          origemId: origem.id,
          origem: origem.cidade,
          ibgeOrigem: origemIbge,
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
  });

  return resultados.sort((a, b) => a.total - b.total);
}
