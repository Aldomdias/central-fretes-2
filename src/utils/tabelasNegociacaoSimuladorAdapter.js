function texto(value) {
  return String(value || '').trim();
}

function upper(value) {
  return texto(value).toUpperCase();
}

function numero(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const limpo = String(value)
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');

  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

function normalizarCanal(value) {
  const canal = upper(value);
  if (canal === 'B2B') return 'ATACADO';
  return canal || 'ATACADO';
}

function normalizarTipoCalculo(value) {
  const tipo = upper(value);
  if (tipo === 'FAIXA_DE_PESO' || tipo === 'FAIXA DE PESO') return 'FAIXA_DE_PESO';
  if (tipo === 'PESO_CUBADO') return 'PESO_CUBADO';
  return 'PERCENTUAL';
}

export function labelTabelaNegociacaoSimulador(tabela = {}) {
  const nome = texto(tabela.transportadora) || 'Tabela em negociação';
  return `${nome} (NEGOCIAÇÃO)`;
}

function montarGeneralidades(generalidades = {}) {
  return {
    incideIcms: Boolean(generalidades.incideIcms),
    aliquotaIcms: numero(generalidades.aliquotaIcms),
    adValorem: numero(generalidades.adValorem),
    adValoremMinimo: numero(generalidades.adValoremMinimo),
    pedagio: numero(generalidades.pedagio),
    gris: numero(generalidades.gris),
    grisMinimo: numero(generalidades.grisMinimo),
    tas: numero(generalidades.tas),
    ctrc: numero(generalidades.ctrc),
    cubagem: numero(generalidades.cubagem) || 300,
    tipoCalculo: normalizarTipoCalculo(generalidades.tipoCalculo),
    observacoes: texto(generalidades.observacoes),
  };
}

function montarTaxaDestino(taxa = {}) {
  return {
    ibgeDestino: texto(taxa.ibge_destino || taxa.ibgeDestino),
    ufDestino: upper(taxa.uf_destino || taxa.ufDestino),
    cidadeDestino: texto(taxa.cidade_destino || taxa.cidadeDestino),
    tda: numero(taxa.tda),
    tdr: numero(taxa.tdr),
    trt: numero(taxa.trt || taxa.tde),
    suframa: numero(taxa.suframa),
    outras: numero(taxa.outras_taxas || taxa.outras),
    gris: numero(taxa.gris),
    grisMinimo: numero(taxa.gris_minimo || taxa.grisMinimo),
    adVal: numero(taxa.advalorem || taxa.adVal),
    adValMinimo: numero(taxa.advalorem_minimo || taxa.adValMinimo),
    observacao: texto(taxa.observacao),
  };
}

function montarNomeRota({ origem, cidadeDestino, ufDestino, ibgeDestino }) {
  const destino = cidadeDestino
    ? `${cidadeDestino}${ufDestino ? `/${ufDestino}` : ''}`
    : `IBGE ${ibgeDestino}`;

  return `${origem || 'Origem'} → ${destino}`;
}

function getTipoItem(item = {}) {
  return (
    item?.dados_originais?.tipo_item ||
    item?.item_tipo ||
    (item?.faixa_peso === 'ROTA' ? 'ROTA' : 'COTACAO')
  );
}

function itemTemPreco(item = {}) {
  return (
    numero(item.frete_minimo) > 0 ||
    numero(item.taxa_aplicada) > 0 ||
    numero(item.frete_percentual) > 0 ||
    numero(item.excesso_kg) > 0 ||
    numero(item.valor_excedente) > 0 ||
    numero(item.valor_lotacao) > 0
  );
}

function montarCotacao({ item, nomeRota, generalidades, indice }) {
  const percentual = numero(item.frete_percentual);
  const taxaAplicada = numero(item.taxa_aplicada);
  const freteMinimo = numero(item.frete_minimo);
  const pesoInicial = numero(item.peso_inicial);
  const pesoFinalInformado = numero(item.peso_final);
  const excessoKg = numero(item.excesso_kg);
  const valorExcedente = numero(item.valor_excedente);

  const tipoCalculoItem = percentual > 0 && taxaAplicada <= 0
    ? 'PERCENTUAL'
    : normalizarTipoCalculo(generalidades.tipoCalculo);

  return {
    id: item.id || `cotacao-neg-${indice}`,
    rota: nomeRota,
    faixaPeso: texto(item.faixa_peso),
    pesoMin: pesoInicial,
    pesoMax: pesoFinalInformado > 0 ? pesoFinalInformado : 999999,
    pesoLimite: pesoFinalInformado > 0 ? pesoFinalInformado : 999999,
    taxaAplicada,
    valorFixo: taxaAplicada,
    percentual,
    fretePercentual: percentual,
    freteMinimo,
    excesso: valorExcedente || excessoKg,
    excessoPeso: valorExcedente || excessoKg,
    tipoCalculo: tipoCalculoItem,
    origemNegociacao: true,
  };
}

export function converterTabelaNegociacaoParaSimulador(tabela = {}) {
  const itens = tabela.tabelas_negociacao_itens || tabela.itens || [];
  const taxas = tabela.tabelas_negociacao_taxas_destino || tabela.taxasDestino || [];
  const generalidades = montarGeneralidades(tabela.generalidades || {});
  const nomeTransportadora = labelTabelaNegociacaoSimulador(tabela);
  const canalTabela = normalizarCanal(tabela.canal);

  const origensMap = new Map();

  itens.forEach((item, indice) => {
    if (getTipoItem(item) === 'ROTA' && !itemTemPreco(item)) return;

    const cidadeOrigem = texto(item.cidade_origem || item.origem || tabela.origem);
    const ufOrigem = upper(item.uf_origem || tabela.uf_origem);
    const ibgeOrigem = texto(item.ibge_origem);
    const cidadeDestino = texto(item.cidade_destino || item.destino);
    const ufDestino = upper(item.uf_destino || tabela.uf_destino);
    const ibgeDestino = texto(item.ibge_destino);

    if (!ibgeDestino && !cidadeDestino) return;

    const canal = normalizarCanal(item.canal || tabela.canal || canalTabela);
    const origemKey = [
      cidadeOrigem,
      ufOrigem,
      ibgeOrigem,
      canal,
    ].join('|');

    if (!origensMap.has(origemKey)) {
      origensMap.set(origemKey, {
        id: `neg-origem-${tabela.id || 'sem-id'}-${origensMap.size + 1}`,
        cidade: cidadeOrigem,
        uf: ufOrigem,
        ibgeOrigem,
        canal,
        generalidades,
        taxasEspeciais: taxas.map(montarTaxaDestino).filter((taxa) => taxa.ibgeDestino || taxa.cidadeDestino),
        rotas: [],
        cotacoes: [],
        origemNegociacao: true,
      });
    }

    const origem = origensMap.get(origemKey);
    const nomeRota = montarNomeRota({
      origem: cidadeOrigem,
      cidadeDestino,
      ufDestino,
      ibgeDestino,
    });

    const rotaKey = [
      ibgeDestino,
      cidadeDestino,
      ufDestino,
      nomeRota,
    ].join('|');

    if (!origem.rotas.some((rota) => rota.__rotaKey === rotaKey)) {
      origem.rotas.push({
        id: item.id ? `neg-rota-${item.id}` : `neg-rota-${indice + 1}`,
        __rotaKey: rotaKey,
        nomeRota,
        ibgeOrigem,
        cidadeOrigem,
        ufOrigem,
        ibgeDestino,
        cidadeDestino,
        ufDestino,
        prazoEntregaDias: numero(item.prazo),
        valorMinimoFrete: numero(item.frete_minimo),
        origemNegociacao: true,
      });
    }

    origem.cotacoes.push(montarCotacao({
      item,
      nomeRota,
      generalidades,
      indice,
    }));
  });

  const origens = Array.from(origensMap.values()).map((origem) => ({
    ...origem,
    rotas: origem.rotas.map(({ __rotaKey, ...rota }) => rota),
  })).filter((origem) => origem.rotas.length && origem.cotacoes.length);

  return {
    id: `neg-${tabela.id}`,
    negociacaoId: tabela.id,
    nome: nomeTransportadora,
    nomeOriginal: texto(tabela.transportadora),
    canal: canalTabela,
    tipoTabela: tabela.tipo_tabela || 'FRACIONADO',
    status: tabela.status,
    origemNegociacao: true,
    incluirSimulacao: Boolean(tabela.incluir_simulacao),
    origens,
  };
}

export function converterTabelasNegociacaoParaSimulador(tabelas = [], filtros = {}) {
  const canalFiltro = normalizarCanal(filtros.canal || '');

  return (tabelas || [])
    .filter((tabela) => tabela && tabela.incluir_simulacao)
    .filter((tabela) => !canalFiltro || normalizarCanal(tabela.canal) === canalFiltro)
    .map(converterTabelaNegociacaoParaSimulador)
    .filter((transportadora) => transportadora.origens.length);
}
