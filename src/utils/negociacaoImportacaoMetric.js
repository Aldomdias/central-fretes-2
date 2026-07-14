function numeroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function textoLimpo(valor) {
  return String(valor ?? '').trim();
}

function upperLimpo(valor) {
  return textoLimpo(valor).toUpperCase();
}

function normalizarChave(valor) {
  return textoLimpo(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function getContextoTabelaNegociacao(tabela = {}) {
  return {
    transportadora: textoLimpo(tabela.transportadora),
    cidadeOrigem: textoLimpo(tabela.origem || tabela.cidade_origem),
    ufOrigem: upperLimpo(tabela.uf_origem || tabela.ufOrigem),
    ibgeOrigem: textoLimpo(tabela.ibge_origem || tabela.ibgeOrigem),
    canal: upperLimpo(tabela.canal),
  };
}

export function aplicarContextoTabelaNegociacaoItem(item = {}, tabelaNegociacao = null) {
  const contexto = getContextoTabelaNegociacao(tabelaNegociacao || {});

  if (!contexto.cidadeOrigem && !contexto.ufOrigem && !contexto.ibgeOrigem && !contexto.canal && !contexto.transportadora) {
    return item;
  }

  const dadosOriginais = item.dados_originais && typeof item.dados_originais === 'object'
    ? item.dados_originais
    : {};

  const origemArquivo = textoLimpo(
    dadosOriginais.origem_arquivo ||
    dadosOriginais.origemOriginal ||
    dadosOriginais.origem ||
    dadosOriginais.cidadeOrigem ||
    item.cidade_origem ||
    item.origem
  );

  const ufOrigemArquivo = upperLimpo(
    dadosOriginais.uf_origem_arquivo ||
    dadosOriginais.ufOrigemOriginal ||
    dadosOriginais.ufOrigem ||
    item.uf_origem
  );

  return {
    ...item,
    cidade_origem: contexto.cidadeOrigem || item.cidade_origem || item.origem || '',
    uf_origem: contexto.ufOrigem || item.uf_origem || '',
    ibge_origem: contexto.ibgeOrigem || item.ibge_origem || '',
    canal: contexto.canal || item.canal || dadosOriginais.canal || '',
    dados_originais: {
      ...dadosOriginais,
      transportadora: contexto.transportadora || dadosOriginais.transportadora || '',
      origem_arquivo: origemArquivo,
      uf_origem_arquivo: ufOrigemArquivo,
      origem_negociacao: contexto.cidadeOrigem || dadosOriginais.origem_negociacao || '',
      uf_origem_negociacao: contexto.ufOrigem || dadosOriginais.uf_origem_negociacao || '',
      ibge_origem_negociacao: contexto.ibgeOrigem || dadosOriginais.ibge_origem_negociacao || '',
      canal_negociacao: contexto.canal || dadosOriginais.canal_negociacao || '',
      origem: contexto.cidadeOrigem || dadosOriginais.origem || '',
      cidadeOrigem: contexto.cidadeOrigem || dadosOriginais.cidadeOrigem || '',
      ufOrigem: contexto.ufOrigem || dadosOriginais.ufOrigem || '',
      canal: contexto.canal || dadosOriginais.canal || '',
    },
  };
}

export function aplicarContextoTabelaNegociacaoItens(itens = [], tabelaNegociacao = null) {
  return (itens || []).map((item) => aplicarContextoTabelaNegociacaoItem(item, tabelaNegociacao));
}

function nomeAntesDaFaixa(valor) {
  return textoLimpo(valor).split('|')[0].trim();
}

export function getTipoItemNegociacao(item = {}) {
  return (
    item?.dados_originais?.tipo_item ||
    item?.item_tipo ||
    (item?.faixa_peso === 'ROTA' ? 'ROTA' : 'COTACAO')
  );
}

export function itemEhRotaNegociacao(item = {}) {
  return getTipoItemNegociacao(item) === 'ROTA';
}

export function itemEhCotacaoNegociacao(item = {}) {
  return getTipoItemNegociacao(item) !== 'ROTA';
}

function itemTemDestino(item = {}) {
  return Boolean(textoLimpo(item.ibge_destino) || textoLimpo(item.cidade_destino));
}

function nomeCotacaoDoItem(item = {}) {
  const dados = item.dados_originais || {};
  return (
    textoLimpo(dados.cotacaoFinal) ||
    textoLimpo(dados.cotacao) ||
    textoLimpo(dados.rota) ||
    textoLimpo(dados.nomeRota) ||
    nomeAntesDaFaixa(item.faixa_peso) ||
    textoLimpo(item.observacao)
  );
}

function ufDestinoDoItem(item = {}) {
  const dados = item.dados_originais || {};
  return upperLimpo(item.uf_destino || dados.ufDestino || dados.uf_destino);
}

function origemDoItem(item = {}) {
  const dados = item.dados_originais || {};
  return normalizarChave(item.cidade_origem || dados.origem || dados.cidadeOrigem);
}

function montarFaixaFretePronto(frete = {}) {
  const cotNome = upperLimpo(frete.cotacaoFinal || frete.cotacao || frete.rota || frete.nomeRota);
  const faixaRaw = textoLimpo(frete.faixaPeso || frete.faixa_peso);
  if (faixaRaw) return cotNome ? `${cotNome} | ${faixaRaw}` : faixaRaw;
  return cotNome || '';
}

export function montarItemRotaDeImportador(rota = {}) {
  return {
    cidade_origem: rota.origem || rota.cidadeOrigem || '',
    uf_origem: rota.ufOrigem || rota.uf_origem || '',
    ibge_origem: rota.ibgeOrigem || rota.ibge_origem || '',
    cidade_destino: rota.cidadeDestino || rota.cidade_destino || '',
    uf_destino: rota.ufDestino || rota.uf_destino || '',
    ibge_destino: rota.ibgeDestino || rota.ibge_destino || '',
    prazo: rota.prazo || rota.prazoEntregaDias || null,
    faixa_peso: rota.cotacaoFinal || rota.cotacao || rota.nomeRota || rota.faixa_peso || '',
    origem_importacao: 'IMPORTACAO_ROTAS',
    dados_originais: { tipo_item: 'ROTA', ...rota },
  };
}

export function montarItemFreteDeImportador(frete = {}) {
  return {
    cidade_origem: frete.origem || frete.cidadeOrigem || '',
    uf_origem: frete.ufOrigem || frete.uf_origem || '',
    ibge_origem: frete.ibgeOrigem || frete.ibge_origem || '',
    cidade_destino: frete.cidadeDestino || frete.cidade_destino || '',
    uf_destino: frete.ufDestino || frete.uf_destino || '',
    ibge_destino: frete.ibgeDestino || frete.ibge_destino || '',
    faixa_peso: montarFaixaFretePronto(frete),
    peso_inicial: frete.pesoInicial != null ? frete.pesoInicial : frete.peso_inicial ?? null,
    peso_final: frete.pesoFinal != null ? frete.pesoFinal : frete.peso_final ?? null,
    frete_minimo: frete.freteMinimo != null ? frete.freteMinimo : frete.frete_minimo ?? null,
    taxa_aplicada:
      frete.taxaAplicada != null
        ? frete.taxaAplicada
        : frete.freteValor != null
          ? frete.freteValor
          : frete.taxa_aplicada ?? null,
    frete_percentual: frete.fretePercentual != null ? frete.fretePercentual : frete.frete_percentual ?? null,
    excesso_kg:
      frete.excessoKg != null
        ? frete.excessoKg
        : frete.excedente != null
          ? frete.excedente
          : frete.excesso_kg ?? null,
    valor_excedente: frete.valorExcedente != null ? frete.valorExcedente : frete.valor_excedente ?? null,
    advalorem: frete.advalorem != null ? frete.advalorem : frete.adValorem ?? null,
    prazo: frete.prazo || null,
    origem_importacao: 'IMPORTACAO_FRETES',
    dados_originais: { tipo_item: 'COTACAO', ...frete },
  };
}

function encontrarRotasParaCotacao(cotacao = {}, rotas = []) {
  const nomeCotacao = normalizarChave(nomeCotacaoDoItem(cotacao));
  const ufCotacao = ufDestinoDoItem(cotacao);
  const origemCotacao = origemDoItem(cotacao);

  if (!nomeCotacao) return [];

  return (rotas || []).filter((rota) => {
    const nomeRota = normalizarChave(nomeCotacaoDoItem(rota));
    if (!nomeRota) return false;

    const ufRota = ufDestinoDoItem(rota);
    const origemRota = origemDoItem(rota);
    const nomeBate = nomeRota === nomeCotacao || nomeRota.includes(nomeCotacao) || nomeCotacao.includes(nomeRota);
    const ufBate = !ufCotacao || !ufRota || ufCotacao === ufRota;
    const origemBate = !origemCotacao || !origemRota || origemCotacao === origemRota;

    return nomeBate && ufBate && origemBate;
  });
}

function enriquecerCotacaoComRota(cotacao = {}, rota = {}, indice = 0) {
  const origemImportacao = textoLimpo(cotacao.origem_importacao) || 'IMPORTACAO_FRETES';
  return {
    ...cotacao,
    cidade_origem: cotacao.cidade_origem || rota.cidade_origem || '',
    uf_origem: cotacao.uf_origem || rota.uf_origem || '',
    ibge_origem: cotacao.ibge_origem || rota.ibge_origem || '',
    cidade_destino: rota.cidade_destino || cotacao.cidade_destino || '',
    uf_destino: rota.uf_destino || cotacao.uf_destino || '',
    ibge_destino: rota.ibge_destino || cotacao.ibge_destino || '',
    prazo: rota.prazo || cotacao.prazo || null,
    origem_importacao: origemImportacao.includes('COM_ROTAS') ? origemImportacao : `${origemImportacao}_COM_ROTAS`,
    dados_originais: {
      ...(cotacao.dados_originais || {}),
      tipo_item: 'COTACAO',
      rota_match_indice: indice,
      rota_match: rota.dados_originais || rota,
    },
  };
}

export function expandirCotacoesComRotas(cotacoes = [], rotas = []) {
  const rotasValidas = (rotas || []).filter(itemEhRotaNegociacao);

  return (cotacoes || []).flatMap((cotacao) => {
    if (!itemEhCotacaoNegociacao(cotacao)) return [];
    if (itemTemDestino(cotacao)) return [cotacao];

    const matches = encontrarRotasParaCotacao(cotacao, rotasValidas);
    if (!matches.length) return [cotacao];

    return matches.map((rota, indice) => enriquecerCotacaoComRota(cotacao, rota, indice));
  });
}

function chaveDeduplicacaoItem(item = {}) {
  return [
    getTipoItemNegociacao(item),
    normalizarChave(item.cidade_origem),
    upperLimpo(item.uf_origem),
    textoLimpo(item.ibge_origem),
    normalizarChave(item.cidade_destino),
    upperLimpo(item.uf_destino),
    textoLimpo(item.ibge_destino),
    normalizarChave(item.faixa_peso),
    Number(item.peso_inicial || 0),
    Number(item.peso_final || 0),
    Number(item.taxa_aplicada || 0),
    Number(item.frete_percentual || 0),
    Number(item.excesso_kg || 0),
    Number(item.valor_excedente || 0),
    Number(item.prazo || 0),
  ].join('|');
}

export function removerDuplicadosNegociacao(itens = []) {
  const vistos = new Set();
  const saida = [];

  (itens || []).forEach((item) => {
    const chave = chaveDeduplicacaoItem(item);
    if (vistos.has(chave)) return;
    vistos.add(chave);
    saida.push(item);
  });

  return saida;
}

export function montarItensParaNegociacao(resultado, tipoNegociacao = 'fretes', tabelaNegociacao = null) {
  const fretes = Array.isArray(resultado?.fretes) ? resultado.fretes : [];
  const rotas = Array.isArray(resultado?.rotas) ? resultado.rotas : [];
  const itensRotas = aplicarContextoTabelaNegociacaoItens(rotas.map(montarItemRotaDeImportador), tabelaNegociacao);
  const itensFretes = aplicarContextoTabelaNegociacaoItens(fretes.map(montarItemFreteDeImportador), tabelaNegociacao);

  if (tipoNegociacao === 'rotas') return removerDuplicadosNegociacao(itensRotas);
  if (tipoNegociacao === 'ambos') {
    return removerDuplicadosNegociacao(expandirCotacoesComRotas(itensFretes, itensRotas));
  }
  return removerDuplicadosNegociacao(itensFretes);
}

export function prepararItensNegociacaoParaSalvar({ tipoNegociacao, novosItens, itensExistentes, rotasReferencia = [] }) {
  const existentes = Array.isArray(itensExistentes) ? itensExistentes : [];
  const rotasExistentes = existentes.filter(itemEhRotaNegociacao);
  const cotacoesExistentes = existentes.filter(itemEhCotacaoNegociacao);
  const outrosExistentes = existentes.filter((item) => !itemEhRotaNegociacao(item) && !itemEhCotacaoNegociacao(item));
  const rotasReferenciaValidas = removerDuplicadosNegociacao((rotasReferencia || []).filter(itemEhRotaNegociacao));

  if (tipoNegociacao === 'ambos') {
    return removerDuplicadosNegociacao(novosItens);
  }

  if (tipoNegociacao === 'rotas') {
    const novasRotas = novosItens.filter(itemEhRotaNegociacao);
    const cotacoesPreservadas = expandirCotacoesComRotas(cotacoesExistentes, novasRotas);
    return removerDuplicadosNegociacao([...outrosExistentes, ...novasRotas, ...cotacoesPreservadas]);
  }

  const novasCotacoes = novosItens.filter(itemEhCotacaoNegociacao);
  const rotasBase = rotasExistentes.length ? rotasExistentes : rotasReferenciaValidas;
  const cotacoesComRotas = expandirCotacoesComRotas(novasCotacoes, rotasBase);
  return removerDuplicadosNegociacao([...outrosExistentes, ...rotasBase, ...cotacoesComRotas]);
}

