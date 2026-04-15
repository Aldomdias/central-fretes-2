import { ALIQUOTA_INTERNA_PADRAO_UF, REGIAO_POR_UF, UF_POR_IBGE_PREFIXO } from '../config/icmsBrasil';

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
    .trim()
    .toUpperCase();
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function getUfByIbge(ibge) {
  const prefixo = digitsOnly(ibge).slice(0, 2);
  return UF_POR_IBGE_PREFIXO[prefixo] || '';
}

function resolveTipoCalculo(origem, cotacao) {
  const tipoOrigem = normalizeText(origem.generalidades?.tipoCalculo);
  const temFaixa = toNumber(cotacao?.valorFixo) > 0 || toNumber(cotacao?.excesso) > 0 || toNumber(cotacao?.pesoMax) > 0;

  if (normalizeText(cotacao?.tipoCalculo) === 'FAIXA_DE_PESO') return 'FAIXA_DE_PESO';
  if (tipoOrigem === 'FAIXA_DE_PESO') return 'FAIXA_DE_PESO';
  if (temFaixa && toNumber(cotacao?.rsKg) === 0) return 'FAIXA_DE_PESO';
  return 'PERCENTUAL';
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

export function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
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

function matchOrigem(origem, origemBusca, origemIbge) {
  const buscaTexto = normalizeText(origemBusca);
  const buscaIbge = digitsOnly(origemIbge);

  if (!buscaTexto && !buscaIbge) return true;

  const cidade = normalizeText(origem.cidade);
  const ibges = new Set((origem.rotas || []).map((rota) => digitsOnly(rota.ibgeOrigem)).filter(Boolean));

  const textoOk = !buscaTexto || cidade.includes(buscaTexto);
  const ibgeOk = !buscaIbge || ibges.has(buscaIbge);

  return textoOk && ibgeOk;
}

function matchDestino(rota, destinoBusca, destinoIbge) {
  const buscaTexto = normalizeText(destinoBusca);
  const buscaIbge = digitsOnly(destinoIbge);

  if (!buscaTexto && !buscaIbge) return true;

  const rotaNome = normalizeText(rota.nomeRota);
  const ibgeDestino = digitsOnly(rota.ibgeDestino);

  const textoOk = !buscaTexto || rotaNome.includes(buscaTexto);
  const ibgeOk = !buscaIbge || ibgeDestino === buscaIbge;

  return textoOk && ibgeOk;
}

function localizarCotacao(origem, rota, peso) {
  const rotaAlvo = normalizeText(rota.nomeRota);
  return (origem.cotacoes || []).find((cotacao) => {
    const mesmaRota = normalizeText(cotacao.rota) === rotaAlvo;
    return mesmaRota && peso >= toNumber(cotacao.pesoMin) && peso <= toNumber(cotacao.pesoMax || 999999999);
  });
}

function localizarTaxaEspecial(origem, ibgeDestino) {
  return (origem.taxasEspeciais || []).find((item) => digitsOnly(item.ibgeDestino) === digitsOnly(ibgeDestino));
}

function calcularBase(origem, rota, cotacao, peso, valorNf) {
  const minimoRota = toNumber(rota.valorMinimoFrete);
  const percentual = toPercent(cotacao?.percentual);
  const valorPercentual = valorNf * percentual;
  const valorKg = toNumber(cotacao?.rsKg) * peso;
  const valorFixo = toNumber(cotacao?.valorFixo);
  const excessoPorKg = toNumber(cotacao?.excesso);
  const pesoMax = toNumber(cotacao?.pesoMax);
  const tipo = resolveTipoCalculo(origem, cotacao);

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
      faixaAplicada: `${toNumber(cotacao?.pesoMin)} até ${toNumber(cotacao?.pesoMax || 0)} kg`,
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
    faixaAplicada: `${toNumber(cotacao?.pesoMin)} até ${toNumber(cotacao?.pesoMax || 0)} kg`,
    criterio,
  };
}

function calcularAliquotaIcms(rota, generalidades) {
  if (!generalidades?.incideIcms) return 0;

  const aliquotaCustomizada = toNumber(generalidades?.aliquotaIcms);
  if (aliquotaCustomizada > 0) return aliquotaCustomizada;

  const ufOrigem = getUfByIbge(rota.ibgeOrigem);
  const ufDestino = getUfByIbge(rota.ibgeDestino);

  if (!ufOrigem || !ufDestino) return 0;
  if (ufOrigem === ufDestino) return ALIQUOTA_INTERNA_PADRAO_UF[ufOrigem] || 0;

  const regiaoOrigem = REGIAO_POR_UF[ufOrigem];
  const regiaoDestino = REGIAO_POR_UF[ufDestino];
  const origemSulSudesteSemEs = ['PR', 'SC', 'RS', 'SP', 'RJ', 'MG'].includes(ufOrigem);
  const destinoNorteNordesteCoEs = ['N', 'NE', 'CO'].includes(regiaoDestino) || ufDestino === 'ES';

  if (origemSulSudesteSemEs && destinoNorteNordesteCoEs) return 7;
  return 12;
}

function adicionarComparativos(resultados) {
  const liderPorTrecho = new Map();

  resultados.forEach((item) => {
    const chave = `${item.ibgeOrigem}-${item.ibgeDestino}`;
    const atual = liderPorTrecho.get(chave);
    if (!atual || item.total < atual.total) liderPorTrecho.set(chave, item);
  });

  return resultados.map((item) => {
    const lider = liderPorTrecho.get(`${item.ibgeOrigem}-${item.ibgeDestino}`);
    const diferenca = Math.max(0, item.total - (lider?.total || 0));
    const percentualReducaoNecessaria = item.total > 0 ? (diferenca / item.total) * 100 : 0;

    return {
      ...item,
      melhorTrecho: lider?.transportadora || item.transportadora,
      melhorTrechoValor: lider?.total || item.total,
      diferencaParaMelhor: diferenca,
      percentualReducaoNecessaria,
      perdeuTrecho: diferenca > 0.009,
    };
  });
}

export function simularFretes({
  transportadoras,
  modo,
  transportadoraId,
  origemBusca,
  origemIbge,
  destinoBusca,
  destinoIbge,
  pesoKg,
  valorNf,
  canal,
}) {
  const peso = toNumber(pesoKg);
  const nf = toNumber(valorNf);
  if (!peso || !nf) return [];

  const exigirDestino = modo !== 'transportadora';
  if (exigirDestino && !normalizeText(destinoBusca) && !digitsOnly(destinoIbge)) return [];

  const resultados = [];

  transportadoras.forEach((transportadora) => {
    if (transportadoraId && String(transportadora.id) !== String(transportadoraId)) return;

    (transportadora.origens || []).forEach((origem) => {
      if (!matchOrigem(origem, origemBusca, origemIbge)) return;

      const rotasElegiveis = (origem.rotas || []).filter((rota) => {
        const canalOk = !canal || canal === 'TODOS' || rota.canal === canal;
        const destinoOk = matchDestino(rota, destinoBusca, destinoIbge);
        return canalOk && destinoOk;
      });

      rotasElegiveis.forEach((rota) => {
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
        const tdr = toNumber(especial.tdr);
        const trt = toNumber(especial.trt);
        const suframa = toNumber(especial.suframa);
        const outras = toNumber(especial.outras);

        const subtotal = base.valorBase + adValorem + gris + pedagio + tas + ctrc + tda + tdr + trt + suframa + outras;
        const aliquotaIcmsAplicada = calcularAliquotaIcms(rota, g);
        const icms = aliquotaIcmsAplicada > 0 ? subtotal * (aliquotaIcmsAplicada / 100) : 0;
        const total = subtotal + icms;

        resultados.push({
          transportadoraId: transportadora.id,
          transportadora: transportadora.nome,
          origemId: origem.id,
          origem: origem.cidade,
          ibgeOrigem: digitsOnly(rota.ibgeOrigem),
          ufOrigem: getUfByIbge(rota.ibgeOrigem),
          rota: rota.nomeRota,
          ibgeDestino: digitsOnly(rota.ibgeDestino),
          ufDestino: getUfByIbge(rota.ibgeDestino),
          prazo: rota.prazoEntregaDias,
          canal: rota.canal,
          tipoCalculo: base.tipoCalculo,
          criterio: base.criterio,
          faixaAplicada: base.faixaAplicada,
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
          aliquotaIcmsAplicada,
          icms,
          total,
        });
      });
    });
  });

  return adicionarComparativos(resultados).sort((a, b) => a.total - b.total);
}
