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


function getLinhaGradeMaisProxima(gradeCanal = [], pesoInformado = 0) {
  const lista = (Array.isArray(gradeCanal) ? gradeCanal : [])
    .map((item) => ({
      peso: toNumber(item?.peso),
      valorNF: toNumber(item?.valorNF),
      cubagem: toNumber(item?.cubagem),
    }))
    .filter((item) => item.peso > 0)
    .sort((a, b) => a.peso - b.peso);

  if (!lista.length) return null;

  return lista.reduce((melhor, atual) => {
    if (!melhor) return atual;
    const diffMelhor = Math.abs(melhor.peso - pesoInformado);
    const diffAtual = Math.abs(atual.peso - pesoInformado);
    if (diffAtual < diffMelhor) return atual;
    if (diffAtual === diffMelhor) return atual.peso >= melhor.peso ? atual : melhor;
    return melhor;
  }, null);
}

function calcularPesosComCubagem({ pesoInformado, gradeLinha, fatorCubagem }) {
  const cubagemGrade = toNumber(gradeLinha?.cubagem);
  const pesoCubado = cubagemGrade > 0 && fatorCubagem > 0 ? cubagemGrade * fatorCubagem : 0;
  const pesoConsiderado = Math.max(toNumber(pesoInformado), pesoCubado);
  return {
    pesoGrade: toNumber(gradeLinha?.peso) || toNumber(pesoInformado),
    cubagemGrade,
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

function calcularItem({ transportadora, origem, rota, peso, valorNF, cidadePorIbge, gradeCanal }) {
  const gradeLinha = getLinhaGradeMaisProxima(gradeCanal, peso);
  const fatorCubagem = toNumber(origem?.generalidades?.cubagem);
  const pesosAplicados = calcularPesosComCubagem({ pesoInformado: peso, gradeLinha, fatorCubagem });
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
          .map((rota) => calcularItem({ transportadora, origem, rota, peso, valorNF, cidadePorIbge, gradeCanal: filtros.gradeCanal }))
          .filter(Boolean),
      ),
  );
}

export function simularSimples({ transportadoras, origem, canal, peso, valorNF, destinoCodigo, cidadePorIbge, gradeCanal = [] }) {
  const resultados = listarCenarios(transportadoras, { origem, canal, peso, valorNF, destinoCodigo, gradeCanal }, cidadePorIbge);
  return rankearPorChave(resultados)
    .filter((item) => item.origem === origem && String(item.ibgeDestino) === String(destinoCodigo))
    .sort((a, b) => a.total - b.total || a.prazo - b.prazo);
}

export function simularPorTransportadora({ transportadoras, nomeTransportadora, canal, origem, destinoCodigos, peso, valorNF, cidadePorIbge, gradeCanal = [] }) {
  const resultados = listarCenarios(transportadoras, {
    origem,
    canal,
    peso,
    valorNF,
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
              gradeCanal: [],
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
