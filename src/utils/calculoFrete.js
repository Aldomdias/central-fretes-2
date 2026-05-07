import { calcularFreteFaixaPeso, calcularFretePercentual } from '../services/freteCalcEngine';

const UF_POR_CODIGO = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

const CIDADES_CONHECIDAS = {
  '3106200': 'Belo Horizonte',
  '3205002': 'Serra',
  '3505708': 'Barueri',
  '3506003': 'Bauru',
  '3549805': 'São José do Rio Preto',
  '3550308': 'São Paulo',
  '4200606': 'Águas Mornas',
  '4202008': 'Balneário Camboriú',
  '4202404': 'Blumenau',
  '4203204': 'Camboriú',
  '4205407': 'Florianópolis',
  '4208203': 'Itajaí',
  '4211306': 'Navegantes',
  '4212502': 'Penha',
  '4212809': 'Piçarras',
  '5208707': 'Goiás',
  '5300108': 'Brasília',
};

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  return Number(normalized.replace(/[^0-9.-]/g, '')) || 0;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[";,\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportarLinhasCsv(nomeArquivo, linhas) {
  const csv = linhas.map((linha) => linha.map(escapeCsv).join(';')).join('\n');
  return { nomeArquivo, csv };
}

export function buildLookupTables(transportadoras = []) {
  const cidadePorIbge = new Map(Object.entries(CIDADES_CONHECIDAS));
  const destinosSet = new Set();

  (transportadoras || []).forEach((transportadora) => {
    (transportadora.origens || []).forEach((origem) => {
      const origemIbge = String(origem?.rotas?.[0]?.ibgeOrigem || '').trim();
      if (origemIbge && origem.cidade) cidadePorIbge.set(origemIbge, origem.cidade);
      (origem.rotas || []).forEach((rota) => {
        const ibgeDestino = String(rota.ibgeDestino || '').trim();
        if (ibgeDestino) destinosSet.add(ibgeDestino);
      });
    });
  });

  return {
    cidadePorIbge,
    destinosDisponiveis: [...destinosSet].sort(),
  };
}

export function getUfByIbge(ibge) {
  const codigo = String(ibge || '').replace(/\D/g, '').slice(0, 2);
  return UF_POR_CODIGO[codigo] || '';
}

export function getCidadeByIbge(ibge, cidadePorIbge) {
  const codigo = String(ibge || '').trim();
  if (!codigo) return '';
  return cidadePorIbge?.get(codigo) || CIDADES_CONHECIDAS[codigo] || '';
}

function getUfOrigem(origem, cidadePorIbge) {
  const ibgeOrigem = String(origem?.rotas?.[0]?.ibgeOrigem || '').trim();
  if (ibgeOrigem) return getUfByIbge(ibgeOrigem);
  const entry = [...(cidadePorIbge?.entries?.() || [])].find(([, cidade]) => normalizeText(cidade) === normalizeText(origem?.cidade));
  return entry ? getUfByIbge(entry[0]) : '';
}

function inferirAliquotaIcms(origem, rota, cidadePorIbge) {
  const manual = toNumber(origem?.generalidades?.aliquotaIcms);
  if (manual > 0) return { aliquota: manual, origem: 'manual' };

  const ufOrigem = getUfOrigem(origem, cidadePorIbge);
  const ufDestino = getUfByIbge(rota?.ibgeDestino);
  if (!ufOrigem || !ufDestino) return { aliquota: 12, origem: 'legislacao' };
  if (ufOrigem === ufDestino) return { aliquota: 17, origem: 'legislacao' };

  const sulSudesteSemES = new Set(['PR', 'SC', 'RS', 'SP', 'RJ', 'MG']);
  const norteNordesteCentroOesteMaisES = new Set(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'PA', 'PB', 'PE', 'PI', 'RN', 'RO', 'RR', 'SE', 'TO']);
  if (sulSudesteSemES.has(ufOrigem) && norteNordesteCentroOesteMaisES.has(ufDestino)) {
    return { aliquota: 7, origem: 'legislacao' };
  }
  return { aliquota: 12, origem: 'legislacao' };
}

function getTaxaDestino(origem, ibgeDestino) {
  return (origem.taxasEspeciais || []).find((item) => String(item.ibgeDestino) === String(ibgeDestino)) || {};
}

function getCotacaoPorRota(origem, rotaNome, peso) {
  return (origem.cotacoes || []).find((item) => {
    const mesmaRota = normalizeText(item.rota) === normalizeText(rotaNome);
    const pesoMin = toNumber(item.pesoMin);
    const pesoMaxRaw = item.pesoMax ?? item.pesoLimite;
    const pesoMax = pesoMaxRaw === '' || pesoMaxRaw === null || pesoMaxRaw === undefined ? Number.POSITIVE_INFINITY : toNumber(pesoMaxRaw);
    return mesmaRota && peso >= pesoMin && peso <= pesoMax;
  });
}


function normalizarLinhaGrade(item = {}) {
  const peso = toNumber(item?.peso ?? item?.pesoMax ?? item?.pesoLimite);
  const pesoMin = toNumber(item?.pesoMin ?? item?.peso_min ?? item?.min);
  const pesoMaxRaw = item?.pesoMax ?? item?.pesoLimite ?? item?.peso_max ?? item?.max ?? item?.peso;
  const pesoMax = pesoMaxRaw === '' || pesoMaxRaw === null || pesoMaxRaw === undefined
    ? Number.POSITIVE_INFINITY
    : toNumber(pesoMaxRaw);

  return {
    ...item,
    peso,
    pesoMin,
    pesoMax: pesoMax || peso || Number.POSITIVE_INFINITY,
    valorNF: toNumber(item?.valorNF ?? item?.valorNf ?? item?.nf),
    cubagem: toNumber(item?.cubagem ?? item?.cubagemM3 ?? item?.metrosCubicos),
  };
}

function getLinhaGradeMaisProxima(gradeCanal = [], pesoInformado = 0) {
  const peso = toNumber(pesoInformado);
  const lista = (Array.isArray(gradeCanal) ? gradeCanal : [])
    .map(normalizarLinhaGrade)
    .filter((item) => item.peso > 0 || item.pesoMax > 0)
    .sort((a, b) => (a.pesoMax || a.peso) - (b.pesoMax || b.peso));

  if (!lista.length) return null;

  const porFaixa = lista.find((item) => {
    const min = toNumber(item.pesoMin);
    const max = item.pesoMax && Number.isFinite(item.pesoMax) ? item.pesoMax : item.peso;
    return peso >= min && peso <= max;
  });
  if (porFaixa) return porFaixa;

  // Quando a grade vem apenas com o peso final da faixa (ex.: 2, 5, 10, 20...),
  // usa a primeira faixa cujo teto seja maior ou igual ao peso real. Isso evita
  // escolher a faixa anterior por "proximidade" e ignorar a cubagem correta.
  const teto = lista.find((item) => peso <= (item.peso || item.pesoMax));
  if (teto) return teto;

  return lista[lista.length - 1];
}

function calcularPesosComCubagem({ pesoInformado, cubagemInformada = 0, gradeLinha, fatorCubagem }) {
  const cubagemReal = toNumber(cubagemInformada);
  const cubagemGrade = toNumber(gradeLinha?.cubagem);
  // Regra operacional: a cubagem informada no realizado/tracking pode vir inconsistente.
  // Para simulação, a cubagem considerada deve ser exclusivamente a da grade configurada.
  const cubagemAplicada = cubagemGrade;
  const origemCubagem = cubagemGrade > 0 ? 'grade' : 'sem cubagem';
  const pesoCubado = cubagemAplicada > 0 && fatorCubagem > 0 ? cubagemAplicada * fatorCubagem : 0;
  const pesoConsiderado = Math.max(toNumber(pesoInformado), pesoCubado);
  return {
    pesoGrade: toNumber(gradeLinha?.peso || gradeLinha?.pesoMax) || toNumber(pesoInformado),
    cubagemGrade,
    cubagemAplicada,
    origemCubagem,
    pesoCubado,
    pesoConsiderado,
  };
}

function buildDetalhes({ origem, rota, cotacao, taxaDestino, peso, valorNF, calculo, gradeLinha, fatorCubagem, pesosAplicados, valorNFManualInformado, valorNFOrigem, icmsInfo }) {
  const percentual = toNumber(cotacao?.percentual || cotacao?.fretePercentual || 0);
  const rsKg = toNumber(cotacao?.rsKg || 0);
  const valorFixo = toNumber(cotacao?.valorFixo || cotacao?.taxaAplicada || 0);
  const excesso = toNumber(cotacao?.excesso || cotacao?.excessoPeso || 0);
  const pesoMax = toNumber(cotacao?.pesoMax || cotacao?.pesoLimite || 0);
  const grisPct = taxaDestino?.gris ?? origem?.generalidades?.gris ?? 0;
  const adValPct = taxaDestino?.adVal ?? origem?.generalidades?.adValorem ?? 0;
  const grisMin = taxaDestino?.grisMinimo ?? origem?.generalidades?.grisMinimo ?? 0;
  const adValMin = taxaDestino?.adValMinimo ?? origem?.generalidades?.adValoremMinimo ?? 0;

  return {
    prazo: toNumber(rota?.prazoEntregaDias),
    frete: {
      tipoCalculo: calculo.tipoCalculo,
      faixaPeso: cotacao ? `${toNumber(cotacao.pesoMin)} até ${cotacao.pesoMax ?? cotacao.pesoLimite ?? 'sem limite'}` : 'Sem cotação',
      percentualAplicado: percentual,
      rsKgAplicado: rsKg,
      valorFixoAplicado: valorFixo,
      excessoKg: excesso,
      pesoLimite: pesoMax,
      pesoInformado: peso,
      pesoGrade: pesosAplicados?.pesoGrade || toNumber(gradeLinha?.peso) || peso,
      cubagemGrade: pesosAplicados?.cubagemGrade || toNumber(gradeLinha?.cubagem) || 0,
      cubagemRealizadaInformada: toNumber(pesosAplicados?.cubagemRealizadaInformada ?? pesosAplicados?.cubagemReal ?? 0),
      cubagemAplicada: pesosAplicados?.cubagemAplicada || pesosAplicados?.cubagemGrade || toNumber(gradeLinha?.cubagem) || 0,
      origemCubagem: pesosAplicados?.origemCubagem || 'sem cubagem',
      fatorCubagem,
      pesoCubado: pesosAplicados?.pesoCubado || 0,
      pesoConsiderado: pesosAplicados?.pesoConsiderado || peso,
      valorNFInformado: valorNF,
      valorNFManualInformado: toNumber(valorNFManualInformado),
      valorNFOrigem: valorNFOrigem || 'manual',
      pesoLimiteExcedente: toNumber(calculo.pesoLimiteExcedente),
      pesoExcedente: toNumber(calculo.excedenteKg),
      valorExcedente: toNumber(calculo.valorExcedente),
      minimoRota: toNumber(rota?.valorMinimoFrete),
      freteMinimoCotacao: toNumber(cotacao?.freteMinimo ?? cotacao?.frete_minimo ?? cotacao?.valorMinimoFrete ?? cotacao?.minimo),
      freteMinimoGeneralidade: toNumber(origem?.generalidades?.freteMinimo ?? origem?.generalidades?.frete_minimo ?? origem?.generalidades?.minimo),
      minimoAplicavel: toNumber(calculo.componentesBase?.minimoAplicavel),
      valorKgGarantia: toNumber(calculo.componentesBase?.valorKg),
      valorPercentualCalculado: toNumber(calculo.componentesBase?.valorPercentual),
      componenteBase: calculo.componenteBase || '',
      valorBase: calculo.valorBase,
      subtotal: calculo.subtotal,
      icms: calculo.icms,
      total: calculo.total,
      aliquotaIcms: toNumber(icmsInfo?.aliquota),
      origemAliquotaIcms: icmsInfo?.origem || (toNumber(origem?.generalidades?.aliquotaIcms) > 0 ? 'manual' : 'legislacao'),
      ufOrigem: icmsInfo?.ufOrigem || getUfOrigem(origem, null),
      ufDestino: icmsInfo?.ufDestino || getUfByIbge(rota?.ibgeDestino),
    },
    taxas: {
      adValPct,
      adValMin,
      adValorem: calculo.taxas.adValorem,
      grisPct,
      grisMin,
      gris: calculo.taxas.gris,
      pedagio: calculo.taxas.pedagio,
      tas: calculo.taxas.tas,
      ctrc: calculo.taxas.ctrc,
      tda: calculo.taxas.tda,
      tde: calculo.taxas.tde || 0,
      tdr: calculo.taxas.tdr,
      trt: calculo.taxas.trt,
      suframa: calculo.taxas.suframa,
      outras: calculo.taxas.outras,
      totalTaxas:
        calculo.taxas.adValorem +
        calculo.taxas.gris +
        calculo.taxas.pedagio +
        calculo.taxas.tas +
        calculo.taxas.ctrc +
        calculo.taxas.tda +
        (calculo.taxas.tde || 0) +
        calculo.taxas.tdr +
        calculo.taxas.trt +
        calculo.taxas.suframa +
        calculo.taxas.outras,
    },
  };
}

function calcularItem({ transportadora, origem, rota, peso, valorNF, cubagem = 0, cidadePorIbge, gradeCanal }) {
  const gradeLinha = getLinhaGradeMaisProxima(gradeCanal, peso);
  const fatorCubagem = toNumber(origem?.generalidades?.cubagem);
  const pesosAplicados = calcularPesosComCubagem({ pesoInformado: peso, cubagemInformada: cubagem, gradeLinha, fatorCubagem });
  const cotacao = getCotacaoPorRota(origem, rota.nomeRota, pesosAplicados.pesoConsiderado);
  if (!cotacao) return null;

  const valorNFManualInformado = toNumber(valorNF);
  const valorNFUtilizado = valorNFManualInformado > 0 ? valorNFManualInformado : toNumber(gradeLinha?.valorNF);
  const valorNFOrigem = valorNFManualInformado > 0 ? 'manual' : 'grade';

  const taxaDestino = getTaxaDestino(origem, rota.ibgeDestino);
  const tipoCalculo = String(origem.generalidades?.tipoCalculo || 'PERCENTUAL').toUpperCase();
  const icmsInfo = inferirAliquotaIcms(origem, rota, cidadePorIbge);
  const generalidadesCalculadas = {
    ...(origem.generalidades || {}),
    aliquotaIcms: icmsInfo.aliquota,
  };
  const engineInput = { rota, cotacao, generalidades: generalidadesCalculadas, taxaDestino, pesoKg: pesosAplicados.pesoConsiderado, valorNf: valorNFUtilizado };
  const calculo = tipoCalculo === 'FAIXA_DE_PESO'
    ? calcularFreteFaixaPeso(engineInput)
    : calcularFretePercentual(engineInput);

  const cidadeDestino = getCidadeByIbge(rota.ibgeDestino, cidadePorIbge);
  const ufDestino = getUfByIbge(rota.ibgeDestino);

  return {
    transportadora: transportadora.nome,
    transportadoraId: transportadora.id,
    origem: origem.cidade,
    origemId: origem.id,
    canal: origem.canal,
    rotaNome: rota.nomeRota,
    ibgeDestino: String(rota.ibgeDestino),
    cidadeDestino,
    ufDestino,
    prazo: toNumber(rota.prazoEntregaDias),
    total: calculo.total,
    percentualSobreNF: valorNFUtilizado > 0 ? (calculo.total / valorNFUtilizado) * 100 : 0,
    subtotal: calculo.subtotal,
    valorBase: calculo.valorBase,
    descricao: `Origem ${origem.cidade} • Destino ${cidadeDestino || `IBGE ${rota.ibgeDestino}`}`,
    detalhes: buildDetalhes({ origem, rota, cotacao, taxaDestino, peso, valorNF: valorNFUtilizado, calculo, gradeLinha, fatorCubagem, pesosAplicados, valorNFManualInformado, valorNFOrigem, icmsInfo: { ...icmsInfo, ufOrigem: getUfOrigem(origem, cidadePorIbge), ufDestino } }),
  };
}

function rankearPorChave(resultados = []) {
  const grupos = new Map();
  resultados.forEach((item) => {
    const chave = `${item.origem}|${item.ibgeDestino}|${item.canal}|${item.detalhes?.frete?.pesoInformado || 0}|${item.detalhes?.frete?.valorNFInformado || 0}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(item);
  });

  return [...grupos.values()].flatMap((grupo) => {
    const ordenados = [...grupo].sort((a, b) => a.total - b.total || a.prazo - b.prazo || a.transportadora.localeCompare(b.transportadora));
    const lider = ordenados[0]?.total || 0;
    const segundoItem = ordenados[1] || null;
    const segundo = segundoItem?.total || lider;
    return ordenados.map((item, idx) => ({
      ...item,
      ranking: idx + 1,
      liderTransportadora: ordenados[0]?.transportadora || '',
      perdeuPara: idx > 0 ? (ordenados[0]?.transportadora || '') : '',
      proximaSeBloquear: idx === 0 ? (segundoItem?.transportadora || '') : (ordenados[idx - 1]?.transportadora || ordenados[0]?.transportadora || ''),
      freteSubstituta: idx === 0 ? (segundoItem?.total || 0) : (ordenados[idx - 1]?.total || lider),
      savingSegundo: idx === 1 ? 0 : idx === 0 ? Math.max(segundo - item.total, 0) : 0,
      diferencaLider: Math.max(item.total - lider, 0),
      reducaoNecessariaPct: item.total > lider ? ((item.total - lider) / item.total) * 100 : 0,
    }));
  });
}

function listarCenarios(transportadoras = [], filtros = {}, cidadePorIbge) {
  const peso = toNumber(filtros.peso);
  const valorNF = toNumber(filtros.valorNF);
  const cubagem = toNumber(filtros.cubagem);
  const destinoNormalizado = normalizeText(filtros.destinoCodigo);

  return (transportadoras || []).flatMap((transportadora) =>
    (transportadora.origens || [])
      .filter((origem) => !filtros.canal || origem.canal === filtros.canal)
      .filter((origem) => !filtros.origem || origem.cidade === filtros.origem)
      .flatMap((origem) =>
        (origem.rotas || [])
          .filter((rota) => {
            if (!destinoNormalizado) return true;
            const cidade = normalizeText(getCidadeByIbge(rota.ibgeDestino, cidadePorIbge));
            return String(rota.ibgeDestino) === filtros.destinoCodigo || cidade === destinoNormalizado;
          })
          .map((rota) => calcularItem({ transportadora, origem, rota, peso, valorNF, cubagem, cidadePorIbge, gradeCanal: filtros.gradeCanal }))
          .filter(Boolean),
      ),
  );
}

export function simularSimples({ transportadoras, origem, canal, peso, valorNF, cubagem = 0, destinoCodigo, cidadePorIbge, gradeCanal = [] }) {
  const resultados = listarCenarios(transportadoras, { origem, canal, peso, valorNF, cubagem, destinoCodigo, gradeCanal }, cidadePorIbge);
  return rankearPorChave(resultados)
    .filter((item) => item.origem === origem && String(item.ibgeDestino) === String(destinoCodigo))
    .sort((a, b) => a.total - b.total || a.prazo - b.prazo);
}

export function simularPorTransportadora({ transportadoras, nomeTransportadora, canal, origem, destinoCodigos, peso, valorNF, cubagem = 0, cidadePorIbge, gradeCanal = [] }) {
  const resultados = listarCenarios(transportadoras, {
    origem,
    canal,
    peso,
    valorNF,
    cubagem,
    destinoCodigo: '',
    gradeCanal,
  }, cidadePorIbge).filter((item) => !destinoCodigos?.length || destinoCodigos.includes(String(item.ibgeDestino)) || destinoCodigos.includes(normalizeText(item.cidadeDestino)));

  return rankearPorChave(resultados)
    .filter((item) => item.transportadora === nomeTransportadora)
    .sort((a, b) => a.total - b.total || a.prazo - b.prazo);
}

export function analisarTransportadoraPorGrade({ transportadoras, nomeTransportadora, canal, origem = '', ufDestino = '', grade, cidadePorIbge }) {
  const pesoValorPairs = Array.isArray(grade) ? grade : [];
  const todosResultados = [];

  const origemFiltro = String(origem || '').trim();
  const ufFiltro = String(ufDestino || '').trim().toUpperCase();

  // Otimização importante:
  // Antes a análise calculava TODOS os destinos e só depois filtrava a transportadora.
  // Agora primeiro descobrimos quais destinos a transportadora analisada atende
  // na origem/canal selecionados. Depois calculamos concorrência apenas nesses destinos.
  const destinosDaTransportadora = new Set();

  (transportadoras || []).forEach((transportadora) => {
    if (transportadora.nome !== nomeTransportadora) return;

    (transportadora.origens || [])
      .filter((origemItem) => !canal || origemItem.canal === canal)
      .filter((origemItem) => !origemFiltro || origemItem.cidade === origemFiltro)
      .forEach((origemItem) => {
        (origemItem.rotas || []).forEach((rota) => {
          const ibge = String(rota.ibgeDestino || '');
          if (!ibge) return;
          if (ufFiltro && getUfByIbge(ibge) !== ufFiltro) return;
          destinosDaTransportadora.add(`${origemItem.cidade}|${ibge}`);
        });
      });
  });

  if (!destinosDaTransportadora.size) {
    return {
      rotasAvaliadas: 0,
      vitorias: 0,
      aderencia: 0,
      saving: 0,
      prazoMedio: 0,
      freteMedio: 0,
      percentualMedioSobreNF: 0,
      detalhes: [],
      porUf: [],
    };
  }

  pesoValorPairs.forEach((linha) => {
    const peso = toNumber(linha.peso);
    const valorNF = toNumber(linha.valorNF);
    const resultados = [];

    (transportadoras || []).forEach((transportadora) => {
      (transportadora.origens || [])
        .filter((origemItem) => !canal || origemItem.canal === canal)
        .filter((origemItem) => !origemFiltro || origemItem.cidade === origemFiltro)
        .forEach((origemItem) => {
          (origemItem.rotas || []).forEach((rota) => {
            const ibge = String(rota.ibgeDestino || '');
            if (!ibge) return;
            if (ufFiltro && getUfByIbge(ibge) !== ufFiltro) return;
            if (!destinosDaTransportadora.has(`${origemItem.cidade}|${ibge}`)) return;

            const item = calcularItem({
              transportadora,
              origem: origemItem,
              rota,
              peso,
              valorNF,
              cidadePorIbge,
              gradeCanal: [linha],
            });

            if (item) resultados.push(item);
          });
        });
    });

    rankearPorChave(resultados)
      .filter((item) => item.transportadora === nomeTransportadora)
      .forEach((item) => {
        todosResultados.push({
          ...item,
          gradePeso: peso,
          gradeValorNF: valorNF,
          gradeCubagem: toNumber(linha.cubagem),
          pesoCubado: toNumber(item?.detalhes?.frete?.pesoCubado),
          pesoConsiderado: toNumber(item?.detalhes?.frete?.pesoConsiderado),
        });
      });
  });

  const rotasAvaliadas = todosResultados.length;
  const vitorias = todosResultados.filter((item) => item.ranking === 1).length;
  const aderencia = rotasAvaliadas ? (vitorias / rotasAvaliadas) * 100 : 0;
  const saving = todosResultados.filter((item) => item.ranking === 1).reduce((acc, item) => acc + item.savingSegundo, 0);
  const prazoMedio = rotasAvaliadas ? todosResultados.reduce((acc, item) => acc + item.prazo, 0) / rotasAvaliadas : 0;
  const freteMedio = rotasAvaliadas ? todosResultados.reduce((acc, item) => acc + item.total, 0) / rotasAvaliadas : 0;
  const percentualMedioSobreNF = rotasAvaliadas ? todosResultados.reduce((acc, item) => acc + (item.percentualSobreNF || 0), 0) / rotasAvaliadas : 0;

  const porUfMap = new Map();
  todosResultados.forEach((item) => {
    const key = item.ufDestino || 'SEM UF';
    const atual = porUfMap.get(key) || { uf: key, total: 0, vitorias: 0, valor: 0 };
    atual.total += 1;
    atual.valor += item.total;
    if (item.ranking === 1) atual.vitorias += 1;
    porUfMap.set(key, atual);
  });

  const porUf = [...porUfMap.values()]
    .map((item) => ({
      ...item,
      aderencia: item.total ? (item.vitorias / item.total) * 100 : 0,
      freteMedio: item.total ? item.valor / item.total : 0,
    }))
    .sort((a, b) => b.total - a.total || a.uf.localeCompare(b.uf));

  return {
    rotasAvaliadas,
    vitorias,
    aderencia,
    saving,
    prazoMedio,
    freteMedio,
    percentualMedioSobreNF,
    detalhes: todosResultados.sort((a, b) => a.ranking - b.ranking || a.total - b.total),
    porUf,
  };
}


export function analisarOrigemPorGrade({ transportadoras, canal, origem = '', ufDestino = '', grade = [], cidadePorIbge }) {
  const pesoValorPairs = Array.isArray(grade) ? grade : [];
  const origemFiltro = String(origem || '').trim();
  const ufFiltro = String(ufDestino || '').trim().toUpperCase();
  const detalhes = [];

  pesoValorPairs.forEach((linha) => {
    const peso = toNumber(linha.peso);
    const valorNF = toNumber(linha.valorNF);
    const resultados = [];

    (transportadoras || []).forEach((transportadora) => {
      (transportadora.origens || [])
        .filter((origemItem) => !canal || origemItem.canal === canal)
        .filter((origemItem) => !origemFiltro || origemItem.cidade === origemFiltro)
        .forEach((origemItem) => {
          (origemItem.rotas || []).forEach((rota) => {
            const ibge = String(rota.ibgeDestino || '');
            if (!ibge) return;
            if (ufFiltro && getUfByIbge(ibge) !== ufFiltro) return;

            const item = calcularItem({
              transportadora,
              origem: origemItem,
              rota,
              peso,
              valorNF,
              cidadePorIbge,
              gradeCanal: [linha],
            });

            if (item) resultados.push(item);
          });
        });
    });

    rankearPorChave(resultados).forEach((item) => {
      detalhes.push({
        ...item,
        gradePeso: peso,
        gradeValorNF: valorNF,
        gradeCubagem: toNumber(linha.cubagem),
        pesoCubado: toNumber(item?.detalhes?.frete?.pesoCubado),
        pesoConsiderado: toNumber(item?.detalhes?.frete?.pesoConsiderado),
      });
    });
  });

  const gruposRota = new Map();
  detalhes.forEach((item) => {
    const chave = `${item.origem}|${item.ibgeDestino}|${item.gradePeso}|${item.gradeValorNF}`;
    if (!gruposRota.has(chave)) gruposRota.set(chave, []);
    gruposRota.get(chave).push(item);
  });

  const rotas = [...gruposRota.values()];
  const vencedores = rotas.map((grupo) => grupo.find((item) => item.ranking === 1) || grupo.sort((a, b) => a.total - b.total)[0]).filter(Boolean);
  const segundos = rotas.map((grupo) => [...grupo].sort((a, b) => a.ranking - b.ranking)[1]).filter(Boolean);

  const porTransportadoraMap = new Map();
  detalhes.forEach((item) => {
    const atual = porTransportadoraMap.get(item.transportadora) || {
      transportadora: item.transportadora,
      participacoes: 0,
      vitorias: 0,
      frete: 0,
      diferencaLider: 0,
      prazo: 0,
    };
    atual.participacoes += 1;
    atual.frete += Number(item.total || 0);
    atual.prazo += Number(item.prazo || 0);
    atual.diferencaLider += Number(item.diferencaLider || 0);
    if (Number(item.ranking) === 1) atual.vitorias += 1;
    porTransportadoraMap.set(item.transportadora, atual);
  });

  const porTransportadora = [...porTransportadoraMap.values()]
    .map((item) => ({
      ...item,
      aderencia: item.participacoes ? (item.vitorias / item.participacoes) * 100 : 0,
      freteMedio: item.participacoes ? item.frete / item.participacoes : 0,
      prazoMedio: item.participacoes ? item.prazo / item.participacoes : 0,
      diferencaMediaLider: item.participacoes ? item.diferencaLider / item.participacoes : 0,
    }))
    .sort((a, b) => b.vitorias - a.vitorias || b.aderencia - a.aderencia || a.freteMedio - b.freteMedio);

  const porUfMap = new Map();
  vencedores.forEach((item) => {
    const key = item.ufDestino || 'SEM UF';
    const atual = porUfMap.get(key) || { uf: key, rotas: 0, frete: 0, vencedores: new Map() };
    atual.rotas += 1;
    atual.frete += Number(item.total || 0);
    atual.vencedores.set(item.transportadora, (atual.vencedores.get(item.transportadora) || 0) + 1);
    porUfMap.set(key, atual);
  });

  const porUf = [...porUfMap.values()].map((item) => {
    const top = [...item.vencedores.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      uf: item.uf,
      rotas: item.rotas,
      freteMedio: item.rotas ? item.frete / item.rotas : 0,
      transportadoraDominante: top?.[0] || '',
      qtdDominante: top?.[1] || 0,
      pctDominante: item.rotas ? ((top?.[1] || 0) / item.rotas) * 100 : 0,
    };
  }).sort((a, b) => b.rotas - a.rotas || a.uf.localeCompare(b.uf));

  const coberturaMap = new Map();
  (transportadoras || []).forEach((transportadora) => {
    (transportadora.origens || [])
      .filter((origemItem) => !canal || origemItem.canal === canal)
      .filter((origemItem) => !origemFiltro || origemItem.cidade === origemFiltro)
      .forEach((origemItem) => {
        (origemItem.rotas || []).forEach((rota) => {
          const ibge = String(rota.ibgeDestino || '');
          if (!ibge) return;
          if (ufFiltro && getUfByIbge(ibge) !== ufFiltro) return;
          const key = `${origemItem.cidade}|${ibge}`;
          const atual = coberturaMap.get(key) || {
            origem: origemItem.cidade,
            ibgeDestino: ibge,
            cidadeDestino: getCidadeByIbge(ibge, cidadePorIbge),
            ufDestino: getUfByIbge(ibge),
            transportadoras: new Set(),
          };
          atual.transportadoras.add(transportadora.nome);
          coberturaMap.set(key, atual);
        });
      });
  });

  const coberturaRotas = [...coberturaMap.values()].map((item) => ({
    ...item,
    quantidadeTransportadoras: item.transportadoras.size,
    transportadoras: [...item.transportadoras].sort(),
  }));

  const rotasComUmaTransportadora = coberturaRotas.filter((item) => item.quantidadeTransportadoras === 1)
    .sort((a, b) => (a.ufDestino || '').localeCompare(b.ufDestino || '') || (a.cidadeDestino || '').localeCompare(b.cidadeDestino || ''));

  const savingVsSegundo = vencedores.reduce((acc, item) => acc + Number(item.savingSegundo || 0), 0);
  const freteVencedorTotal = vencedores.reduce((acc, item) => acc + Number(item.total || 0), 0);
  const freteSegundoTotal = segundos.reduce((acc, item) => acc + Number(item.total || 0), 0);

  return {
    origem: origemFiltro || 'Todas',
    canal,
    ufDestino: ufFiltro,
    cenariosAvaliados: detalhes.length,
    combinacoesRotaGrade: rotas.length,
    destinosCobertos: coberturaRotas.length,
    rotasComUmaTransportadora: rotasComUmaTransportadora.length,
    savingVsSegundo,
    freteVencedorTotal,
    freteSegundoTotal,
    freteMedioVencedor: vencedores.length ? freteVencedorTotal / vencedores.length : 0,
    porTransportadora,
    porUf,
    rotasCriticas: rotasComUmaTransportadora.slice(0, 150),
    detalhes: detalhes.sort((a, b) => a.ranking - b.ranking || a.total - b.total),
  };
}

export function analisarCoberturaTabela({ transportadoras, canal, origem, transportadora, ufDestino, cidadePorIbge }) {
  const baseTransportadoras = (transportadoras || []).filter((item) => !transportadora || item.nome === transportadora);
  const origensFiltradas = baseTransportadoras.flatMap((item) =>
    (item.origens || [])
      .filter((origemItem) => (!canal || origemItem.canal === canal) && (!origem || origemItem.cidade === origem))
      .map((origemItem) => ({ transportadora: item.nome, origem: origemItem })),
  );

  const universoDestinos = new Map();
  (transportadoras || []).forEach((item) => {
    (item.origens || []).forEach((origemItem) => {
      if (canal && origemItem.canal !== canal) return;
      (origemItem.rotas || []).forEach((rota) => {
        const uf = getUfByIbge(rota.ibgeDestino);
        if (ufDestino && uf !== ufDestino) return;
        const ibge = String(rota.ibgeDestino);
        if (!universoDestinos.has(ibge)) {
          universoDestinos.set(ibge, {
            ibge,
            cidade: getCidadeByIbge(ibge, cidadePorIbge),
            uf,
          });
        }
      });
    });
  });

  const destinosUniverso = [...universoDestinos.values()].sort((a, b) => (a.uf || '').localeCompare(b.uf || '') || (a.cidade || '').localeCompare(b.cidade || '') || a.ibge.localeCompare(b.ibge));

  const coberturaMap = new Map();
  origensFiltradas.forEach(({ transportadora: nomeTransportadora, origem: origemItem }) => {
    (origemItem.rotas || []).forEach((rota) => {
      const ibge = String(rota.ibgeDestino);
      const uf = getUfByIbge(ibge);
      if (ufDestino && uf !== ufDestino) return;
      const key = `${origemItem.cidade}|${ibge}`;
      coberturaMap.set(key, {
        origem: origemItem.cidade,
        transportadora: nomeTransportadora,
        ibge,
        cidade: getCidadeByIbge(ibge, cidadePorIbge),
        uf,
        rota: rota.nomeRota,
      });
    });
  });

  const faltantes = [];
  const cobertas = [];
  const origensSelecionadas = [...new Set(origensFiltradas.map((item) => item.origem.cidade))];

  origensSelecionadas.forEach((cidadeOrigem) => {
    destinosUniverso.forEach((destino) => {
      const key = `${cidadeOrigem}|${destino.ibge}`;
      if (coberturaMap.has(key)) {
        cobertas.push(coberturaMap.get(key));
      } else {
        faltantes.push({
          origem: cidadeOrigem,
          transportadora: transportadora || 'Todas',
          ibge: destino.ibge,
          cidade: destino.cidade,
          uf: destino.uf,
          rota: 'Sem tabela',
        });
      }
    });
  });

  const totalCombinacoes = origensSelecionadas.length * destinosUniverso.length;
  const totalCobertas = cobertas.length;
  const totalFaltantes = faltantes.length;

  const porUfMap = new Map();
  faltantes.forEach((item) => {
    const atual = porUfMap.get(item.uf || 'SEM UF') || { uf: item.uf || 'SEM UF', faltantes: 0 };
    atual.faltantes += 1;
    porUfMap.set(atual.uf, atual);
  });

  return {
    explicacao: `A cobertura cruza as origens filtradas com todos os destinos já existentes na malha do canal${ufDestino ? ` e da UF ${ufDestino}` : ''}. Assim você enxerga onde a origem ainda não tem tabela cadastrada.`,
    origensSelecionadas,
    destinosUniverso,
    totalCombinacoes,
    totalCobertas,
    totalFaltantes,
    percentualCobertura: totalCombinacoes ? (totalCobertas / totalCombinacoes) * 100 : 0,
    faltantes: faltantes.sort((a, b) => (a.uf || '').localeCompare(b.uf || '') || (a.cidade || '').localeCompare(b.cidade || '') || a.ibge.localeCompare(b.ibge)),
    cobertas: cobertas.sort((a, b) => (a.uf || '').localeCompare(b.uf || '') || (a.cidade || '').localeCompare(b.cidade || '') || a.ibge.localeCompare(b.ibge)),
    resumoPorUf: [...porUfMap.values()].sort((a, b) => b.faltantes - a.faltantes || a.uf.localeCompare(b.uf)),
  };
}

function normalizarComparacaoRealizado(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizarCidadeRotaRealizado(value) {
  return normalizarComparacaoRealizado(splitCidadeUfRealizado(value || '', '').cidade || value || '');
}

function keysCidadeRealizado(cidade = '', uf = '') {
  const parsed = splitCidadeUfRealizado(cidade, uf);
  const keys = new Set();
  const cidadeKey = normalizarComparacaoRealizado(parsed.cidade);
  const rawKey = normalizarComparacaoRealizado(cidade);
  if (cidadeKey) keys.add(cidadeKey);
  if (rawKey) keys.add(rawKey);
  if (cidadeKey && parsed.uf) {
    keys.add(normalizarComparacaoRealizado(`${parsed.cidade} ${parsed.uf}`));
    keys.add(normalizarComparacaoRealizado(`${parsed.cidade}/${parsed.uf}`));
  }
  return [...keys].filter(Boolean);
}
function normalizarCanalRealizadoTexto(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

const CANAIS_B2C_REALIZADO = [
  'B2C',
  'VIA VAREJO',
  'MERCADO LIVRE',
  'MERCADOR LIVRE',
  'B2W',
  'MAGAZINE LUIZA',
  'CARREFOUR',
  'CANTU PNEUS',
  'GPA',
  'COLOMBO',
  'AMAZON',
  'INTER',
  'ANYMARKET',
  'ANY MARKET',
  'BRADESCO SHOP',
  'ITAU SHOP',
  'ITAÚ SHOP',
  'SHOPEE',
  '99',
  'MUSTANG',
  'LIVELO',
  'COOPERA',
  'MARKETPLACE',
  'MARKET PLACE',
  'ECOMMERCE',
  'E-COMMERCE',
];

const CANAIS_ATACADO_REALIZADO = [
  'ATACADO',
  'B2B',
];

function contemCanalRealizado(canal, lista = []) {
  return lista.some((item) => canal === item || canal.includes(item));
}

function categoriaCanalRealizado(value) {
  const canal = normalizarCanalRealizadoTexto(value);
  if (!canal) return '';
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  if (contemCanalRealizado(canal, CANAIS_ATACADO_REALIZADO)) return 'ATACADO';
  if (contemCanalRealizado(canal, CANAIS_B2C_REALIZADO)) return 'B2C';
  return canal;
}

function canalCompativelRealizado(canalLinha, canalReferencia) {
  const referencia = normalizarCanalRealizadoTexto(canalReferencia);
  if (!referencia) return true;
  const linha = normalizarCanalRealizadoTexto(canalLinha);
  if (!linha) return false;
  if (linha === referencia) return true;

  const categoriaLinha = categoriaCanalRealizado(linha);
  const categoriaReferencia = categoriaCanalRealizado(referencia);
  return Boolean(categoriaLinha && categoriaReferencia && categoriaLinha === categoriaReferencia);
}

function canalRealizadoRaw(row = {}, canalPadrao = '') {
  return row.canal || row.canalVendas || row.canais || canalPadrao || '';
}

function canalRealizado(row = {}, canalPadrao = '') {
  return categoriaCanalRealizado(canalRealizadoRaw(row, canalPadrao)) || normalizarCanalRealizadoTexto(canalRealizadoRaw(row, canalPadrao));
}

function splitCidadeUfRealizado(cidadeRaw, ufRaw = '') {
  let cidade = String(cidadeRaw || '').trim();
  let uf = String(ufRaw || '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);

  const match = cidade.match(/^(.*?)(?:\s*\/\s*|\s*-\s*)([A-Za-z]{2})$/);
  if (match) {
    cidade = match[1].trim();
    if (!uf) uf = match[2].toUpperCase();
  }

  if (uf) {
    cidade = cidade.replace(new RegExp(`\\s*(?:/|-)\\s*${uf}\\s*$`, 'i'), '').trim();
  }

  return { cidade, uf };
}

function cidadeOrigemRealizado(row = {}) {
  return splitCidadeUfRealizado(row.cidadeOrigem || row.origem || '', row.ufOrigem || row.uf_origem || '').cidade;
}

function ufOrigemRealizado(row = {}) {
  return splitCidadeUfRealizado(row.cidadeOrigem || row.origem || '', row.ufOrigem || row.uf_origem || '').uf;
}

function destinoRealizadoInfo(row = {}) {
  const parsed = splitCidadeUfRealizado(row.cidadeDestino || row.destino || '', row.ufDestino || row.uf_destino || '');
  const ibge = String(row.ibgeDestino || row.codigoIbgeDestino || row.codigo_ibge_destino || '').replace(/\D/g, '');
  const keys = new Set(keysCidadeRealizado(parsed.cidade, parsed.uf));

  const rawKey = normalizarComparacaoRealizado(row.cidadeDestino || row.destino || '');
  if (rawKey) keys.add(rawKey);

  return {
    cidade: parsed.cidade,
    uf: parsed.uf,
    ibge,
    keys: [...keys].filter(Boolean),
  };
}
function valorRealizadoNumero(row = {}) {
  return toNumber(row.valorCte ?? row.valorFrete ?? row.valorRealizado ?? row.valorCalculado ?? 0);
}

function pesoRealizadoNumero(row = {}) {
  const pesoDeclarado = toNumber(row.pesoDeclarado ?? row.peso ?? 0);
  const pesoCubado = toNumber(row.pesoCubado ?? row.peso_cubado ?? 0);
  const pesoFinal = Math.max(pesoDeclarado, pesoCubado);
  return pesoFinal > 0 ? pesoFinal : pesoDeclarado;
}

function dentroPeriodoRealizado(row = {}, filtros = {}) {
  const inicio = filtros.inicio ? new Date(`${filtros.inicio}T00:00:00`) : null;
  const fim = filtros.fim ? new Date(`${filtros.fim}T23:59:59`) : null;
  if (!inicio && !fim) return true;

  const data = row.emissao ? new Date(row.emissao) : null;
  if (!data || Number.isNaN(data.getTime())) return false;
  if (inicio && data < inicio) return false;
  if (fim && data > fim) return false;
  return true;
}

function filtrarRealizadosBase(realizados = [], filtros = {}) {
  const origemFiltro = normalizarComparacaoRealizado(splitCidadeUfRealizado(filtros.origem || '').cidade);
  const ufDestinoFiltro = String(filtros.ufDestino || '').trim().toUpperCase();

  return (realizados || []).filter((row) => {
    const destino = destinoRealizadoInfo(row);
    if (!dentroPeriodoRealizado(row, filtros)) return false;
    if (!canalCompativelRealizado(canalRealizadoRaw(row), filtros.canal)) return false;
    if (origemFiltro && normalizarComparacaoRealizado(cidadeOrigemRealizado(row)) !== origemFiltro) return false;
    if (ufDestinoFiltro && String(destino.uf || '').trim().toUpperCase() !== ufDestinoFiltro) return false;
    return true;
  });
}

function rotaDestinoCompativel(rota = {}, destinoInfo = {}, cidadePorIbge) {
  const rotaIbge = String(rota.ibgeDestino || rota.ibge_destino || '').replace(/\D/g, '');

  // 1) Melhor cenário: IBGE do realizado bate exatamente com o IBGE da rota.
  if (rotaIbge && destinoInfo.ibge && rotaIbge === destinoInfo.ibge) return true;

  const ufRotaPorIbge = rotaIbge ? getUfByIbge(rotaIbge) : '';
  const rotaNomeOriginal = rota.nomeRota || rota.rota || rota.cidadeDestino || rota.nome_rota || '';
  const rotaNomeParsed = splitCidadeUfRealizado(rotaNomeOriginal, '');
  const rotaUfExplicita = rotaNomeParsed.uf || '';

  const cidadePorCodigo = normalizarComparacaoRealizado(getCidadeByIbge(rotaIbge, cidadePorIbge));
  const rotaNomeCidade = normalizarCidadeRotaRealizado(rotaNomeParsed.cidade || rotaNomeOriginal);
  const rotaNomeRaw = normalizarComparacaoRealizado(rotaNomeOriginal);
  const destinoKeys = Array.isArray(destinoInfo.keys) ? destinoInfo.keys : [];

  const rotaKeys = new Set([cidadePorCodigo, rotaNomeCidade, rotaNomeRaw].filter(Boolean));
  if (rotaNomeCidade && ufRotaPorIbge) rotaKeys.add(normalizarComparacaoRealizado(`${rotaNomeCidade} ${ufRotaPorIbge}`));
  if (rotaNomeCidade && rotaUfExplicita) rotaKeys.add(normalizarComparacaoRealizado(`${rotaNomeCidade} ${rotaUfExplicita}`));

  const nomeBate = destinoKeys.some((destinoKey) => {
    if (!destinoKey) return false;
    for (const rotaKey of rotaKeys) {
      if (!rotaKey) continue;
      if (rotaKey === destinoKey) return true;
      if (rotaKey.startsWith(`${destinoKey} `)) return true;
      if (destinoKey.startsWith(`${rotaKey} `)) return true;
      if (rotaKey.includes(destinoKey) && destinoKey.length >= 5) return true;
      if (destinoKey.includes(rotaKey) && rotaKey.length >= 5) return true;
    }
    return false;
  });

  if (!nomeBate) return false;

  // Só bloqueia por UF quando a UF está explícita no nome da rota.
  // Se a UF veio apenas do IBGE e o nome da cidade bateu, aceitamos para compensar
  // cadastros com IBGE divergente ou incompleto.
  if (destinoInfo.uf && rotaUfExplicita && rotaUfExplicita !== destinoInfo.uf) {
    return false;
  }

  return true;
}
function motivoForaMalha(row, contexto = {}) {
  const origem = cidadeOrigemRealizado(row);
  const destino = destinoRealizadoInfo(row);
  const canal = canalRealizado(row, contexto.filtroCanal);
  if (contexto.tipo === 'sem-dados') {
    return `Sem dados obrigatórios para simular: origem ${origem || 'vazia'}, destino ${destino.cidade || destino.ibge || 'vazio'}, peso ${contexto.peso || 0}.`;
  }
  if (contexto.tipo === 'sem-origem') {
    return `Origem/canal não encontrados na tabela: origem ${origem || 'vazia'}, canal ${canal || 'vazio'}.`;
  }
  if (contexto.tipo === 'sem-destino') {
    return `Destino não localizado na malha da origem: ${destino.cidade || 'vazio'}${destino.uf ? `/${destino.uf}` : ''}${destino.ibge ? ` • IBGE ${destino.ibge}` : ''}.`;
  }
  if (contexto.tipo === 'sem-cotacao') {
    return `Destino localizado, mas sem cotação/faixa válida para peso ${formatarNumeroMotivo(contexto.peso)} kg.`;
  }
  return 'Transportadora não participa da origem/destino/canal no período selecionado.';
}

function formatarNumeroMotivo(value) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function montarResumoRealizado(detalhes = [], foraMalha = [], totalSelecionado = 0) {
  const ctesComSimulacao = detalhes.length;
  const ctesGanharia = detalhes.filter((item) => item.ganharia).length;
  const valorRealizado = detalhes.reduce((acc, item) => acc + item.valorRealizado, 0);
  const valorNF = detalhes.reduce((acc, item) => acc + item.valorNF, 0);
  const valorSimulado = detalhes.reduce((acc, item) => acc + item.valorSimulado, 0);
  const faturamentoGanhador = detalhes
    .filter((item) => item.ganharia)
    .reduce((acc, item) => acc + item.valorSimulado, 0);
  const economiaGanhador = detalhes
    .filter((item) => item.ganharia)
    .reduce((acc, item) => acc + Math.max(item.impacto, 0), 0);
  const impactoLiquido = detalhes.reduce((acc, item) => acc + item.impacto, 0);
  const economiaPotencial = detalhes.reduce((acc, item) => acc + Math.max(item.impacto, 0), 0);
  const aumentoPotencial = detalhes.reduce((acc, item) => acc + Math.max(item.valorSimulado - item.valorRealizado, 0), 0);

  const porUfMap = new Map();
  detalhes.forEach((item) => {
    const key = item.ufDestino || 'SEM UF';
    const atual = porUfMap.get(key) || {
      uf: key,
      ctes: 0,
      ganharia: 0,
      valorRealizado: 0,
      valorSimulado: 0,
      economia: 0,
    };
    atual.ctes += 1;
    atual.valorRealizado += item.valorRealizado;
    atual.valorSimulado += item.valorSimulado;
    atual.economia += Math.max(item.impacto, 0);
    if (item.ganharia) atual.ganharia += 1;
    porUfMap.set(key, atual);
  });

  const porUf = [...porUfMap.values()]
    .map((item) => ({
      ...item,
      aderencia: item.ctes ? (item.ganharia / item.ctes) * 100 : 0,
      impacto: item.valorRealizado - item.valorSimulado,
    }))
    .sort((a, b) => b.ctes - a.ctes || a.uf.localeCompare(b.uf));

  return {
    totalSelecionado,
    ctesComSimulacao,
    ctesForaMalha: foraMalha.length,
    ctesGanharia,
    aderencia: ctesComSimulacao ? (ctesGanharia / ctesComSimulacao) * 100 : 0,
    valorRealizado,
    valorNF,
    valorSimulado,
    faturamentoGanhador,
    economiaGanhador,
    impactoLiquido,
    economiaPotencial,
    aumentoPotencial,
    percentualRealizado: valorNF > 0 ? (valorRealizado / valorNF) * 100 : 0,
    percentualSimulado: valorNF > 0 ? (valorSimulado / valorNF) * 100 : 0,
    percentualReducao: valorRealizado > 0 ? (impactoLiquido / valorRealizado) * 100 : 0,
    porUf,
  };
}


function adicionarOrigemIndiceRealizado(map, key, item) {
  const normalized = normalizarComparacaoRealizado(key);
  if (!normalized) return;
  const lista = map.get(normalized) || [];
  const jaExiste = lista.some((atual) => atual.transportadora === item.transportadora && atual.origem === item.origem);
  if (!jaExiste) lista.push(item);
  map.set(normalized, lista);
}

function criarIndiceOrigensRealizado(transportadoras = []) {
  const map = new Map();

  (transportadoras || []).forEach((transportadora) => {
    (transportadora.origens || []).forEach((origem) => {
      const item = { transportadora, origem };
      const cidadeRaw = origem?.cidade || '';
      const parsed = splitCidadeUfRealizado(cidadeRaw, '');
      adicionarOrigemIndiceRealizado(map, cidadeRaw, item);
      adicionarOrigemIndiceRealizado(map, parsed.cidade, item);
      if (parsed.uf) adicionarOrigemIndiceRealizado(map, `${parsed.cidade} ${parsed.uf}`, item);

      // Algumas origens vêm cadastradas como "CIDADE/UF" ou "CIDADE - UF".
      // O realizado geralmente vem separado em cidade + UF, então indexamos as variações.
      (origem.rotas || []).forEach((rota) => {
        const ufOrigem = getUfByIbge(rota?.ibgeOrigem);
        if (ufOrigem && parsed.cidade) adicionarOrigemIndiceRealizado(map, `${parsed.cidade} ${ufOrigem}`, item);
      });
    });
  });

  return map;
}

function buscarCandidatosOrigemRealizado(indiceOrigens, origemKey) {
  const direta = indiceOrigens?.get(origemKey) || [];
  if (direta.length) return direta;

  const candidatos = [];
  for (const [key, lista] of indiceOrigens?.entries?.() || []) {
    if (!key || !origemKey) continue;
    if (key === origemKey || key.includes(origemKey) || origemKey.includes(key)) {
      (lista || []).forEach((item) => {
        if (!candidatos.some((atual) => atual.transportadora === item.transportadora && atual.origem === item.origem)) {
          candidatos.push(item);
        }
      });
    }
  }
  return candidatos;
}

function simularLinhaRealizado({ row, detalhes, foraMalha, transportadoras, alvo, filtros, cidadePorIbge, indiceOrigens }) {
  const origemCidade = cidadeOrigemRealizado(row);
  const origemKey = normalizarComparacaoRealizado(origemCidade);
  const destinoInfo = destinoRealizadoInfo(row);
  const canalLinha = canalRealizado(row, filtros.canal);
  const canalRaw = canalRealizadoRaw(row, filtros.canal);
  const peso = pesoRealizadoNumero(row);
  const valorNF = toNumber(row.valorNF);
  const valorRealizado = valorRealizadoNumero(row);

  if (!origemKey || (!destinoInfo.ibge && !destinoInfo.keys.length) || peso <= 0) {
    foraMalha.push({ ...row, motivo: motivoForaMalha(row, { tipo: 'sem-dados', peso, filtroCanal: filtros.canal }) });
    return;
  }

  const cenarios = [];
  let encontrouOrigemCanal = false;
  let encontrouDestino = false;
  let encontrouDestinoSemCotacao = false;

  const candidatosOrigem = buscarCandidatosOrigemRealizado(indiceOrigens, origemKey);

  candidatosOrigem
    .filter(({ origem }) => canalCompativelRealizado(canalRaw, origem.canal))
    .forEach(({ transportadora, origem }) => {
      encontrouOrigemCanal = true;
      (origem.rotas || []).forEach((rota) => {
        if (!rotaDestinoCompativel(rota, destinoInfo, cidadePorIbge)) return;
        encontrouDestino = true;

        const item = calcularItem({
          transportadora,
          origem,
          rota,
          peso,
          valorNF,
          cidadePorIbge,
          gradeCanal: [],
        });

        if (item) {
          cenarios.push(item);
        } else {
          encontrouDestinoSemCotacao = true;
        }
      });
    });

  const rankeados = rankearPorChave(cenarios);
  const candidato = rankeados.find((item) => normalizarComparacaoRealizado(item.transportadora) === alvo);

  if (!candidato) {
    const tipo = !encontrouOrigemCanal
      ? 'sem-origem'
      : !encontrouDestino
        ? 'sem-destino'
        : encontrouDestinoSemCotacao
          ? 'sem-cotacao'
          : 'sem-destino';
    foraMalha.push({ ...row, motivo: motivoForaMalha(row, { tipo, peso, filtroCanal: filtros.canal }) });
    return;
  }

  const rankingAtual = rankeados.find(
    (item) => normalizarComparacaoRealizado(item.transportadora) === normalizarComparacaoRealizado(row.transportadora)
  );
  const impacto = valorRealizado - candidato.total;

  detalhes.push({
    id: row.id || row.chaveCte || `${row.numeroCte}-${detalhes.length}`,
    chaveCte: row.chaveCte || '',
    numeroCte: row.numeroCte || '',
    emissao: row.emissao || '',
    transportadoraRealizada: row.transportadora || '',
    transportadoraSimulada: candidato.transportadora,
    origem: origemCidade || candidato.origem,
    cidadeDestino: destinoInfo.cidade || candidato.cidadeDestino,
    ibgeDestino: destinoInfo.ibge || candidato.ibgeDestino,
    ufDestino: destinoInfo.uf || candidato.ufDestino,
    canal: canalLinha || candidato.canal,
    peso,
    valorNF,
    valorRealizado,
    valorSimulado: candidato.total,
    percentualRealizado: valorNF > 0 ? (valorRealizado / valorNF) * 100 : 0,
    percentualSimulado: candidato.percentualSobreNF || (valorNF > 0 ? (candidato.total / valorNF) * 100 : 0),
    impacto,
    economiaPositiva: Math.max(impacto, 0),
    aumentoPositivo: Math.max(candidato.total - valorRealizado, 0),
    ranking: candidato.ranking,
    ganharia: candidato.ranking === 1,
    liderTransportadora: candidato.liderTransportadora,
    perdeuPara: candidato.perdeuPara,
    freteSubstituta: candidato.freteSubstituta,
    rankingTransportadoraAtual: rankingAtual?.ranking || null,
    valorTabelaTransportadoraAtual: rankingAtual?.total || null,
    detalhes: candidato.detalhes,
  });
}

export function simularRealizadoPorTransportadora({
  transportadoras = [],
  realizados = [],
  nomeTransportadora = '',
  filtros = {},
  cidadePorIbge,
} = {}) {
  const alvo = normalizarComparacaoRealizado(nomeTransportadora);
  const selecionados = filtrarRealizadosBase(realizados, filtros);
  const detalhes = [];
  const foraMalha = [];
  const indiceOrigens = criarIndiceOrigensRealizado(transportadoras);

  if (!alvo) {
    return {
      resumo: montarResumoRealizado([], selecionados, selecionados.length),
      detalhes: [],
      foraMalha: selecionados,
    };
  }

  selecionados.forEach((row) => {
    simularLinhaRealizado({ row, detalhes, foraMalha, transportadoras, alvo, filtros, cidadePorIbge, indiceOrigens });
  });

  return {
    resumo: montarResumoRealizado(detalhes, foraMalha, selecionados.length),
    detalhes: detalhes.sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto)),
    foraMalha,
  };
}

function aguardarProximoFrameRealizado() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export async function simularRealizadoPorTransportadoraAsync({
  transportadoras = [],
  realizados = [],
  nomeTransportadora = '',
  filtros = {},
  cidadePorIbge,
  onProgress,
  chunkSize = 25,
} = {}) {
  const alvo = normalizarComparacaoRealizado(nomeTransportadora);
  const selecionados = filtrarRealizadosBase(realizados, filtros);
  const detalhes = [];
  const foraMalha = [];
  const total = selecionados.length;
  const indiceOrigens = criarIndiceOrigensRealizado(transportadoras);

  const informarProgresso = async (atual, etapa = 'Calculando fretes') => {
    if (typeof onProgress === 'function') {
      onProgress({
        etapa,
        atual,
        total,
        detalhes: detalhes.length,
        foraMalha: foraMalha.length,
      });
    }
    await aguardarProximoFrameRealizado();
  };

  if (!alvo) {
    await informarProgresso(total, 'Concluído');
    return {
      resumo: montarResumoRealizado([], selecionados, selecionados.length),
      detalhes: [],
      foraMalha: selecionados,
    };
  }

  await informarProgresso(0, 'Iniciando cálculo');

  for (let index = 0; index < selecionados.length; index += 1) {
    simularLinhaRealizado({
      row: selecionados[index],
      detalhes,
      foraMalha,
      transportadoras,
      alvo,
      filtros,
      cidadePorIbge,
      indiceOrigens,
    });

    if ((index + 1) % chunkSize === 0 || index === selecionados.length - 1) {
      await informarProgresso(index + 1, 'Calculando fretes');
    }
  }

  await informarProgresso(total, 'Montando resultado');

  return {
    resumo: montarResumoRealizado(detalhes, foraMalha, selecionados.length),
    detalhes: detalhes.sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto)),
    foraMalha,
  };
}
