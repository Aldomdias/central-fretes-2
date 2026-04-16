import { calcularFreteFaixaPeso, calcularFretePercentual } from '../services/freteCalcEngine';

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function uniqueBy(arr, getKey) {
  const map = new Map();
  arr.forEach((item) => {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, item);
  });
  return Array.from(map.values());
}

export function buildKnownCitiesMap(transportadoras = []) {
  const base = new Map([
    ['1100015', "Alta Floresta D'Oeste"],
    ['3106200', 'Belo Horizonte'],
    ['3205002', 'Serra'],
    ['3505708', 'Barueri'],
    ['3506003', 'Bauru'],
    ['3549805', 'São José do Rio Preto'],
    ['3550308', 'São Paulo'],
    ['4200606', 'Águas Mornas'],
    ['4201109', 'Anitápolis'],
    ['4202404', 'Blumenau'],
    ['4205407', 'Florianópolis'],
    ['4208203', 'Itajaí'],
    ['4211306', 'Navegantes'],
    ['5300108', 'Brasília'],
    ['5208707', 'Goiás'],
  ]);

  (transportadoras || []).forEach((t) => {
    (t.origens || []).forEach((origem) => {
      if (origem.ibge || origem.ibgeOrigem) {
        base.set(String(origem.ibge || origem.ibgeOrigem), origem.cidade || String(origem.ibge || origem.ibgeOrigem));
      }
      (origem.rotas || []).forEach((rota) => {
        if (rota.cidadeDestino && rota.ibgeDestino) base.set(String(rota.ibgeDestino), rota.cidadeDestino);
      });
      (origem.taxasEspeciais || []).forEach((taxa) => {
        if (taxa.cidadeDestino && taxa.ibgeDestino) base.set(String(taxa.ibgeDestino), taxa.cidadeDestino);
      });
    });
  });

  return Object.fromEntries(base.entries());
}

export function formatDestinoLabel(codigo, citiesMap = {}) {
  const raw = String(codigo || '').trim();
  if (!raw) return '-';
  if (/^\d+$/.test(raw)) return citiesMap[raw] || `IBGE ${raw}`;
  return raw;
}

export function extrairCanais(transportadoras = []) {
  const set = new Set();
  transportadoras.forEach((t) => (t.origens || []).forEach((o) => set.add(String(o.canal || 'ATACADO').toUpperCase())));
  return Array.from(set).sort();
}

export function extrairOrigens(transportadoras = [], canal = '') {
  const rows = [];
  transportadoras.forEach((t) => {
    (t.origens || []).forEach((o) => {
      const canalOrigem = String(o.canal || 'ATACADO').toUpperCase();
      if (!canal || canalOrigem === String(canal).toUpperCase()) rows.push(o.cidade);
    });
  });
  return Array.from(new Set(rows)).sort((a, b) => a.localeCompare(b));
}

function encontrarCotacao(origem, rota, peso) {
  const cotacoes = (origem.cotacoes || []).filter((item) => normalizeText(item.rota) === normalizeText(rota.nomeRota));
  if (!cotacoes.length) return null;
  const pesoNum = toNumber(peso);
  return (
    cotacoes.find((item) => pesoNum >= toNumber(item.pesoMin) && pesoNum <= (toNumber(item.pesoMax) || Number.MAX_SAFE_INTEGER)) ||
    cotacoes[0]
  );
}

function encontrarTaxaDestino(origem, rota) {
  const ibge = String(rota.ibgeDestino || '').trim();
  return (origem.taxasEspeciais || []).find((item) => String(item.ibgeDestino || '').trim() === ibge) || {};
}

function montarDetalhes({ origem, rota, cotacao, calculo, taxaDestino, peso, valorNF }) {
  const taxas = calculo.taxas || {};
  return {
    tipoCalculo: calculo.tipoCalculo || origem.generalidades?.tipoCalculo || 'PERCENTUAL',
    faixa: `${toNumber(cotacao?.pesoMin)} até ${toNumber(cotacao?.pesoMax) || 'acima'}`,
    percentualAplicado: toNumber(cotacao?.percentual || cotacao?.fretePercentual || 0),
    valorKg: toNumber(cotacao?.rsKg || 0),
    freteTabela: calculo.valorBase || 0,
    fretePeso: toNumber(cotacao?.rsKg) * toNumber(peso),
    fretePercentual: toNumber(valorNF) * (toNumber(cotacao?.percentual || cotacao?.fretePercentual || 0) / 100),
    freteBase: calculo.valorBase || 0,
    valorExcedente: calculo.valorExcedente || 0,
    minimoRota: toNumber(rota?.valorMinimoFrete),
    pesoConsiderado: toNumber(peso),
    valorNF: toNumber(valorNF),
    observacoes: origem.generalidades?.observacoes || '',
    taxas: {
      grisPct: toNumber(taxaDestino?.gris ?? origem.generalidades?.gris ?? 0),
      grisMinimo: toNumber(taxaDestino?.grisMinimo ?? origem.generalidades?.grisMinimo ?? 0),
      gris: taxas.gris || 0,
      advPct: toNumber(taxaDestino?.adVal ?? origem.generalidades?.adValorem ?? 0),
      advMinimo: toNumber(taxaDestino?.adValMinimo ?? origem.generalidades?.adValoremMinimo ?? 0),
      adv: taxas.adValorem || 0,
      pedagio: taxas.pedagio || 0,
      tas: taxas.tas || 0,
      ctrc: taxas.ctrc || 0,
      tda: taxas.tda || 0,
      tde: taxas.tdr || 0,
      trt: taxas.trt || 0,
      suframa: taxas.suframa || 0,
      outras: taxas.outras || 0,
      totalTaxas:
        (taxas.adValorem || 0) +
        (taxas.gris || 0) +
        (taxas.pedagio || 0) +
        (taxas.tas || 0) +
        (taxas.ctrc || 0) +
        (taxas.tda || 0) +
        (taxas.tdr || 0) +
        (taxas.trt || 0) +
        (taxas.suframa || 0) +
        (taxas.outras || 0),
    },
  };
}

function calcularCenario({ transportadora, origem, rota, cotacao, peso, valorNF, citiesMap }) {
  const taxaDestino = encontrarTaxaDestino(origem, rota);
  const tipo = String(origem.generalidades?.tipoCalculo || 'PERCENTUAL').toUpperCase();
  const calculo = tipo === 'FAIXA_DE_PESO'
    ? calcularFreteFaixaPeso({ rota, cotacao, generalidades: origem.generalidades, taxaDestino, pesoKg: peso, valorNf: valorNF })
    : calcularFretePercentual({ rota, cotacao, generalidades: origem.generalidades, taxaDestino, pesoKg: peso, valorNf: valorNF });

  return {
    transportadora: transportadora.nome,
    transportadoraId: transportadora.id,
    origem: origem.cidade,
    canal: String(origem.canal || 'ATACADO').toUpperCase(),
    ibge: String(rota.ibgeDestino || ''),
    destino: formatDestinoLabel(rota.ibgeDestino, citiesMap),
    rotaNome: rota.nomeRota || '',
    prazo: toNumber(rota.prazoEntregaDias || rota.prazo || 0),
    peso: toNumber(peso),
    valorNF: toNumber(valorNF),
    total: calculo.total || 0,
    subtotal: calculo.subtotal || 0,
    icms: calculo.icms || 0,
    descricao: `Origem ${origem.cidade} • Destino ${formatDestinoLabel(rota.ibgeDestino, citiesMap)}`,
    detalhes: montarDetalhes({ origem, rota, cotacao, calculo, taxaDestino, peso, valorNF }),
  };
}

function rankearPorTotal(resultados) {
  const ordenados = [...resultados].sort((a, b) => a.total - b.total || a.prazo - b.prazo || a.transportadora.localeCompare(b.transportadora));
  const lider = ordenados[0]?.total || 0;
  const segundo = ordenados[1]?.total || lider;
  return ordenados.map((item, idx) => ({
    ...item,
    posicao: idx + 1,
    savingSegundo: idx === 0 ? Math.max(segundo - item.total, 0) : 0,
    diferencaLider: idx === 0 ? 0 : Math.max(item.total - lider, 0),
    reducaoNecessariaPct: idx === 0 || !item.total ? 0 : Math.max(((item.total - lider) / item.total) * 100, 0),
  }));
}

function buscarCenariosDoMercado({ transportadoras, origemNome, canal, destinoCodigo, peso, valorNF, citiesMap }) {
  const candidatos = [];
  (transportadoras || []).forEach((transportadora) => {
    (transportadora.origens || []).forEach((origem) => {
      const canalOrigem = String(origem.canal || 'ATACADO').toUpperCase();
      if (normalizeText(origem.cidade) !== normalizeText(origemNome)) return;
      if (canal && canalOrigem !== String(canal).toUpperCase()) return;
      (origem.rotas || []).forEach((rota) => {
        const rotaDestino = String(rota.ibgeDestino || '').trim();
        if (String(destinoCodigo).trim() !== rotaDestino) return;
        const cotacao = encontrarCotacao(origem, rota, peso);
        if (!cotacao) return;
        candidatos.push(calcularCenario({ transportadora, origem, rota, cotacao, peso, valorNF, citiesMap }));
      });
    });
  });
  return rankearPorTotal(candidatos);
}

export function simularSimples({ transportadoras, origem, canal, peso, valorNF, destinoCodigo, citiesMap }) {
  return buscarCenariosDoMercado({
    transportadoras,
    origemNome: origem,
    canal,
    destinoCodigo,
    peso,
    valorNF,
    citiesMap,
  });
}

export function simularPorTransportadora({ transportadoras, nomeTransportadora, canal, origem, destinoCodigos, peso, valorNF, citiesMap }) {
  const transportadora = (transportadoras || []).find((item) => item.nome === nomeTransportadora);
  if (!transportadora) return [];

  const resultados = [];
  (transportadora.origens || []).forEach((origemItem) => {
    const canalOrigem = String(origemItem.canal || 'ATACADO').toUpperCase();
    if (canal && canalOrigem !== String(canal).toUpperCase()) return;
    if (origem && normalizeText(origemItem.cidade) !== normalizeText(origem)) return;

    (origemItem.rotas || []).forEach((rota) => {
      const rotaDestino = String(rota.ibgeDestino || '').trim();
      if (destinoCodigos?.length && !destinoCodigos.includes(rotaDestino)) return;
      const rankingMercado = buscarCenariosDoMercado({
        transportadoras,
        origemNome: origemItem.cidade,
        canal: canalOrigem,
        destinoCodigo: rotaDestino,
        peso,
        valorNF,
        citiesMap,
      });
      const meu = rankingMercado.find((item) => item.transportadora === nomeTransportadora);
      if (meu) resultados.push(meu);
    });
  });

  return uniqueBy(resultados, (item) => `${item.origem}-${item.ibge}-${item.transportadora}`)
    .sort((a, b) => a.posicao - b.posicao || a.prazo - b.prazo || a.destino.localeCompare(b.destino));
}

export function analisarTransportadoraPorGrade({ transportadoras, nomeTransportadora, canal, grade, citiesMap }) {
  const transportadora = (transportadoras || []).find((item) => item.nome === nomeTransportadora);
  if (!transportadora) return { rotasAvaliadas: 0, vitorias: 0, aderencia: 0, saving: 0, detalhes: [] };

  const detalhes = [];
  (transportadora.origens || []).forEach((origem) => {
    const canalOrigem = String(origem.canal || 'ATACADO').toUpperCase();
    if (canal && canalOrigem !== String(canal).toUpperCase()) return;
    (origem.rotas || []).forEach((rota) => {
      grade.forEach((linha) => {
        const rankingMercado = buscarCenariosDoMercado({
          transportadoras,
          origemNome: origem.cidade,
          canal: canalOrigem,
          destinoCodigo: rota.ibgeDestino,
          peso: linha.peso,
          valorNF: linha.valorNF,
          citiesMap,
        });
        const meu = rankingMercado.find((item) => item.transportadora === nomeTransportadora);
        if (!meu) return;
        detalhes.push({
          ...meu,
          lider: rankingMercado[0]?.transportadora || '-',
          savingLinha: meu.posicao === 1 ? meu.savingSegundo : 0,
        });
      });
    });
  });

  const rotasAvaliadas = detalhes.length;
  const vitorias = detalhes.filter((item) => item.posicao === 1).length;
  const aderencia = rotasAvaliadas ? (vitorias / rotasAvaliadas) * 100 : 0;
  const saving = detalhes.reduce((acc, item) => acc + (item.savingLinha || 0), 0);

  return { rotasAvaliadas, vitorias, aderencia, saving, detalhes };
}

export function analisarCoberturaTabela({ transportadoras, canal, origem, transportadora, citiesMap }) {
  const base = (transportadoras || []).filter((t) => !transportadora || t.nome === transportadora);
  const origens = [];
  const destinosSet = new Set();
  const combinacoesCobertas = new Set();

  base.forEach((t) => {
    (t.origens || []).forEach((o) => {
      const canalOrigem = String(o.canal || 'ATACADO').toUpperCase();
      if (canal && canalOrigem !== String(canal).toUpperCase()) return;
      if (origem && normalizeText(o.cidade) !== normalizeText(origem)) return;
      origens.push({ transportadora: t.nome, origem: o.cidade, canal: canalOrigem });
      (o.rotas || []).forEach((rota) => {
        const destinoCodigo = String(rota.ibgeDestino || '').trim();
        if (!destinoCodigo) return;
        destinosSet.add(destinoCodigo);
        combinacoesCobertas.add(`${t.nome}|${o.cidade}|${destinoCodigo}`);
      });
    });
  });

  const destinos = Array.from(destinosSet);
  const faltantes = [];
  origens.forEach((item) => {
    destinos.forEach((destinoCodigo) => {
      const key = `${item.transportadora}|${item.origem}|${destinoCodigo}`;
      if (!combinacoesCobertas.has(key)) {
        faltantes.push({
          transportadora: item.transportadora,
          origem: item.origem,
          ibge: destinoCodigo,
          destino: formatDestinoLabel(destinoCodigo, citiesMap),
        });
      }
    });
  });

  const totalPossivel = origens.length * destinos.length;
  const cobertas = combinacoesCobertas.size;
  const semTabela = faltantes.length;
  const percentual = totalPossivel ? (cobertas / totalPossivel) * 100 : 0;

  return {
    totalPossivel,
    cobertas,
    semTabela,
    percentual,
    totalOrigens: origens.length,
    totalDestinos: destinos.length,
    exemplosCobertos: Array.from(combinacoesCobertas).slice(0, 20).map((key) => {
      const [transportadoraNome, origemNome, destinoCodigo] = key.split('|');
      return {
        transportadora: transportadoraNome,
        origem: origemNome,
        ibge: destinoCodigo,
        destino: formatDestinoLabel(destinoCodigo, citiesMap),
      };
    }),
    faltantes: faltantes.slice(0, 200),
  };
}
