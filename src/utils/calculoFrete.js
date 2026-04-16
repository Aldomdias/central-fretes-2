import { calcularFreteFaixaPeso, calcularFretePercentual } from '../services/freteCalcEngine.js';

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function normalizeString(value) {
  return String(value || '').trim().toLowerCase();
}

function findCotacao(origem, rota, peso) {
  const cotacoes = Array.isArray(origem?.cotacoes) ? origem.cotacoes : [];
  return (
    cotacoes.find((item) => {
      const rotaOk = normalizeString(item.rota) === normalizeString(rota.nomeRota);
      const min = toNumber(item.pesoMin);
      const maxRaw = item.pesoMax ?? item.pesoLimite;
      const max = maxRaw === '' || maxRaw === null || maxRaw === undefined ? Number.MAX_SAFE_INTEGER : toNumber(maxRaw);
      return rotaOk && peso >= min && peso <= max;
    }) ||
    cotacoes.find((item) => normalizeString(item.rota) === normalizeString(rota.nomeRota)) ||
    null
  );
}

function findTaxaDestino(origem, ibgeDestino) {
  return (
    (origem?.taxasEspeciais || []).find((item) => String(item.ibgeDestino || '') === String(ibgeDestino || '')) ||
    {}
  );
}

function buildDetalhes({ origem, rota, cotacao, taxaDestino, peso, valorNF, calculo }) {
  const taxas = calculo.taxas || {};
  const pesoMaxFaixa = cotacao ? (cotacao.pesoMax ?? cotacao.pesoLimite ?? '') : '';
  const faixaPeso = cotacao
    ? `${toNumber(cotacao.pesoMin)} até ${pesoMaxFaixa === '' ? 'acima' : toNumber(pesoMaxFaixa)}`
    : 'Não identificada';

  return {
    tipoCalculo: calculo.tipoCalculo || origem?.generalidades?.tipoCalculo || 'PERCENTUAL',
    faixaPeso,
    nomeRota: rota?.nomeRota || '-',
    freteBase: toNumber(calculo.valorBase),
    subtotal: toNumber(calculo.subtotal),
    icms: toNumber(calculo.icms),
    total: toNumber(calculo.total),
    peso,
    valorNF,
    prazo: toNumber(rota?.prazoEntregaDias),
    minimoFrete: toNumber(rota?.valorMinimoFrete),
    valorKg: toNumber(cotacao?.rsKg),
    percentual: toNumber(cotacao?.percentual),
    valorFixo: toNumber(cotacao?.valorFixo ?? cotacao?.taxaAplicada),
    excessoKg: Math.max(0, peso - toNumber(cotacao?.pesoMax ?? cotacao?.pesoLimite)),
    valorExcedente: toNumber(calculo.valorExcedente),
    taxas: {
      gris: toNumber(taxas.gris),
      adValorem: toNumber(taxas.adValorem),
      pedagio: toNumber(taxas.pedagio),
      tas: toNumber(taxas.tas),
      ctrc: toNumber(taxas.ctrc),
      tda: toNumber(taxas.tda),
      tdr: toNumber(taxas.tdr),
      trt: toNumber(taxas.trt),
      suframa: toNumber(taxas.suframa),
      outras: toNumber(taxas.outras),
    },
    observacoes: origem?.generalidades?.observacoes || '',
    taxaDestinoAplicada: Object.keys(taxaDestino || {}).length > 0,
  };
}

function calcularCenarioTransportadora({ transportadora, origem, rota, peso, valorNF }) {
  const cotacao = findCotacao(origem, rota, peso);
  if (!cotacao) return null;

  const taxaDestino = findTaxaDestino(origem, rota.ibgeDestino);
  const tipoCalculo = String(origem?.generalidades?.tipoCalculo || 'PERCENTUAL').toUpperCase();
  const commonArgs = {
    rota,
    cotacao,
    generalidades: origem?.generalidades || {},
    taxaDestino,
    pesoKg: peso,
    valorNf: valorNF,
  };

  const calculo = tipoCalculo === 'FAIXA_DE_PESO'
    ? calcularFreteFaixaPeso(commonArgs)
    : calcularFretePercentual(commonArgs);

  const detalhes = buildDetalhes({ origem, rota, cotacao, taxaDestino, peso, valorNF, calculo });

  return {
    transportadora: transportadora.nome,
    transportadoraId: transportadora.id,
    origem: origem.cidade,
    canal: origem.canal || rota.canal || 'ATACADO',
    destinoCodigo: String(rota.ibgeDestino || ''),
    destinoCidade: rota.cidadeDestino || rota.nomeDestino || rota.ibgeDestino,
    rotaNome: rota.nomeRota,
    prazo: toNumber(rota.prazoEntregaDias),
    total: toNumber(calculo.total),
    detalhes,
  };
}

function collectScenarios(transportadoras) {
  const scenarios = [];
  (transportadoras || []).forEach((transportadora) => {
    (transportadora.origens || []).forEach((origem) => {
      (origem.rotas || []).forEach((rota) => {
        scenarios.push({ transportadora, origem, rota });
      });
    });
  });
  return scenarios;
}

function rankear(resultados) {
  const ordenados = [...resultados].sort((a, b) => a.total - b.total || a.prazo - b.prazo || a.transportadora.localeCompare(b.transportadora));
  const lider = ordenados[0];
  const segundo = ordenados[1];

  return ordenados.map((item, index) => {
    const diferencaLider = item.total - (lider?.total || 0);
    const reducaoNecessariaPct = item.total > 0 && diferencaLider > 0 ? (diferencaLider / item.total) * 100 : 0;

    return {
      ...item,
      posicao: index + 1,
      melhorConcorrente: lider ? { transportadora: lider.transportadora, total: lider.total } : null,
      segundoColocado: segundo ? { transportadora: segundo.transportadora, total: segundo.total } : null,
      savingSegundo: index === 0 && segundo ? Math.max(segundo.total - item.total, 0) : 0,
      diferencaLider,
      reducaoNecessariaPct,
    };
  });
}

function resolveDestino(destinosBase, destinoCodigo) {
  return (destinosBase || []).find(
    (item) => String(item.codigo) === String(destinoCodigo) || normalizeString(item.cidade) === normalizeString(destinoCodigo),
  );
}

function gerarResultadoCenario({ transportadoras, origemNome, canal, destinoCodigo, peso, valorNF, destinosBase }) {
  const destinoInfo = resolveDestino(destinosBase, destinoCodigo);

  const resultados = collectScenarios(transportadoras)
    .filter(({ origem, rota }) => normalizeString(origem.cidade) === normalizeString(origemNome))
    .filter(({ origem, rota }) => normalizeString(origem.canal || rota.canal || 'ATACADO') === normalizeString(canal))
    .filter(({ rota }) => String(rota.ibgeDestino || '') === String(destinoCodigo || destinoInfo?.codigo || ''))
    .map(({ transportadora, origem, rota }) => calcularCenarioTransportadora({ transportadora, origem, rota, peso, valorNF }))
    .filter(Boolean)
    .map((item) => ({
      ...item,
      destinoCidade: destinoInfo?.cidade || item.destinoCidade,
      destinoUf: destinoInfo?.uf || '',
      descricao: `Origem ${item.origem} • Destino ${destinoInfo?.cidade || item.destinoCidade}`,
      chaveComparacao: `${normalizeString(item.origem)}|${String(item.destinoCodigo)}|${normalizeString(item.canal)}|${peso}|${valorNF}`,
    }));

  return rankear(resultados);
}

export function simularSimples({ transportadoras, origem, canal, peso, valorNF, destinoCodigo, destinosBase }) {
  return gerarResultadoCenario({ transportadoras, origemNome: origem, canal, destinoCodigo, peso, valorNF, destinosBase });
}

export function simularPorTransportadora({ transportadoras, nomeTransportadora, canal, origem, destinoCodigos, peso, valorNF, destinosBase }) {
  const transportadora = (transportadoras || []).find((item) => item.nome === nomeTransportadora);
  if (!transportadora) return { erro: 'Transportadora não encontrada.', resultados: [] };

  const origensValidas = (transportadora.origens || []).filter(
    (item) => normalizeString(item.canal || 'ATACADO') === normalizeString(canal) && (!origem || normalizeString(item.cidade) === normalizeString(origem)),
  );

  if (!origensValidas.length) {
    return { erro: 'Transportadora sem tabela para este canal.', resultados: [] };
  }

  const destinosFiltrados = [];
  origensValidas.forEach((origemItem) => {
    (origemItem.rotas || []).forEach((rota) => {
      const destinoOk = !destinoCodigos?.length || destinoCodigos.includes(String(rota.ibgeDestino || ''));
      if (destinoOk) {
        destinosFiltrados.push({ origemNome: origemItem.cidade, destinoCodigo: String(rota.ibgeDestino || '') });
      }
    });
  });

  const cenariosUnicos = Array.from(new Map(destinosFiltrados.map((item) => [`${item.origemNome}|${item.destinoCodigo}`, item])).values());

  const resultados = cenariosUnicos
    .flatMap((cenario) => gerarResultadoCenario({
      transportadoras,
      origemNome: cenario.origemNome,
      canal,
      destinoCodigo: cenario.destinoCodigo,
      peso,
      valorNF,
      destinosBase,
    }))
    .filter((item) => item.transportadora === nomeTransportadora)
    .sort((a, b) => a.total - b.total || a.origem.localeCompare(b.origem));

  return { erro: resultados.length ? '' : 'Nenhum cenário encontrado para os filtros selecionados.', resultados };
}

export function analisarTransportadoraPorGrade({ transportadoras, nomeTransportadora, canal, grade, destinosBase }) {
  const transportadora = (transportadoras || []).find((item) => item.nome === nomeTransportadora);
  if (!transportadora) {
    return {
      erro: 'Transportadora não encontrada.',
      resumo: { rotasAvaliadas: 0, vitorias: 0, perdas: 0, aderencia: 0, saving: 0, freteMedio: 0, custoMedio: 0 },
      itens: [],
    };
  }

  const origensValidas = (transportadora.origens || []).filter((item) => normalizeString(item.canal || 'ATACADO') === normalizeString(canal));
  if (!origensValidas.length) {
    return {
      erro: 'Transportadora sem tabela para este canal.',
      resumo: { rotasAvaliadas: 0, vitorias: 0, perdas: 0, aderencia: 0, saving: 0, freteMedio: 0, custoMedio: 0 },
      itens: [],
    };
  }

  const cenarios = [];
  origensValidas.forEach((origem) => {
    (origem.rotas || []).forEach((rota) => {
      (grade || []).forEach((linha) => {
        cenarios.push({ origemNome: origem.cidade, destinoCodigo: String(rota.ibgeDestino || ''), peso: toNumber(linha.peso), valorNF: toNumber(linha.valorNF) });
      });
    });
  });

  const itens = cenarios
    .flatMap((cenario) => gerarResultadoCenario({
      transportadoras,
      origemNome: cenario.origemNome,
      canal,
      destinoCodigo: cenario.destinoCodigo,
      peso: cenario.peso,
      valorNF: cenario.valorNF,
      destinosBase,
    }))
    .filter((item) => item.transportadora === nomeTransportadora)
    .map((item) => ({
      ...item,
      peso: item.detalhes.peso,
      valorNF: item.detalhes.valorNF,
      diferencaSegundo: item.posicao === 1 ? item.savingSegundo : Math.max(item.total - (item.segundoColocado?.total || item.total), 0),
    }));

  const rotasAvaliadas = itens.length;
  const vitorias = itens.filter((item) => item.posicao === 1).length;
  const perdas = rotasAvaliadas - vitorias;
  const aderencia = rotasAvaliadas ? (vitorias / rotasAvaliadas) * 100 : 0;
  const saving = itens.reduce((acc, item) => acc + (item.posicao === 1 ? item.savingSegundo : 0), 0);
  const freteMedio = rotasAvaliadas ? itens.reduce((acc, item) => acc + item.total, 0) / rotasAvaliadas : 0;
  const custoMedio = freteMedio;

  return {
    erro: '',
    resumo: { rotasAvaliadas, vitorias, perdas, aderencia, saving, freteMedio, custoMedio },
    itens,
  };
}

export function analisarCoberturaTabela({ transportadoras, ibges, canal, origem, transportadora }) {
  const base = (transportadoras || []).filter((t) => !transportadora || t.nome === transportadora);

  const origensElegiveis = base
    .flatMap((item) => item.origens || [])
    .filter((origemItem) => normalizeString(origemItem.canal || 'ATACADO') === normalizeString(canal))
    .filter((origemItem) => !origem || normalizeString(origemItem.cidade) === normalizeString(origem));

  const nomesOrigens = Array.from(new Set(origensElegiveis.map((item) => item.cidade)));
  const listaFaltantes = [];
  const resumoPorOrigem = [];

  nomesOrigens.forEach((origemNome) => {
    const rotasCobertas = new Set(
      origensElegiveis
        .filter((item) => normalizeString(item.cidade) === normalizeString(origemNome))
        .flatMap((item) => (item.rotas || []).map((rota) => String(rota.ibgeDestino || ''))),
    );

    const faltantesOrigem = (ibges || []).filter((item) => !rotasCobertas.has(String(item.codigo)));
    const totalOrigem = (ibges || []).length;
    const cobertasOrigem = totalOrigem - faltantesOrigem.length;
    const percentualOrigem = totalOrigem ? (cobertasOrigem / totalOrigem) * 100 : 0;

    resumoPorOrigem.push({
      origem: origemNome,
      total: totalOrigem,
      cobertas: cobertasOrigem,
      faltantes: faltantesOrigem.length,
      percentual: percentualOrigem,
    });

    faltantesOrigem.forEach((item) => {
      listaFaltantes.push({ origem: origemNome, ...item, status: 'Sem tabela' });
    });
  });

  const total = resumoPorOrigem.reduce((acc, item) => acc + item.total, 0);
  const cobertas = resumoPorOrigem.reduce((acc, item) => acc + item.cobertas, 0);
  const faltantes = resumoPorOrigem.reduce((acc, item) => acc + item.faltantes, 0);
  const percentual = total ? (cobertas / total) * 100 : 0;

  return { total, cobertas, faltantes, percentual, listaFaltantes, resumoPorOrigem };
}
