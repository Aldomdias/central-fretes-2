function texto(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return texto(value).toUpperCase();
}

function semAcento(value) {
  return texto(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizarChave(value) {
  return semAcento(value)
    .toUpperCase()
    .replace(/\s*[/\-]\s*[A-Z]{2}\s*$/i, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function numero(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let str = String(value)
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .trim();

  if (!str) return 0;

  str = str.replace(/\s/g, '');

  const temVirgula = str.includes(',');
  const temPonto = str.includes('.');

  if (temVirgula && temPonto) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    str = str.replace(',', '.');
  } else if (temPonto) {
    const partes = str.split('.');
    const pareceMilhar =
      partes.length > 1 &&
      partes.slice(1).every((p) => p.length === 3) &&
      partes[0].length <= 3 &&
      Number(partes[0]) >= 1;

    if (pareceMilhar) str = str.replace(/\./g, '');
  }

  const limpo = str.replace(/[^\d.-]/g, '');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

function apenasDigitos(value) {
  return texto(value).replace(/\D/g, '');
}

function pareceIbge(value) {
  const digitos = apenasDigitos(value);
  return digitos.length === 7 ? digitos : '';
}

const UF_POR_CODIGO_IBGE = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

function ufPorIbge(ibge) {
  const codigo = apenasDigitos(ibge).slice(0, 2);
  return UF_POR_CODIGO_IBGE[codigo] || '';
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

function parseDadosOriginais(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function getRodadaTabelaNegociacao(tabela = {}) {
  const resumo = tabela.resumo_simulacao && typeof tabela.resumo_simulacao === 'object'
    ? tabela.resumo_simulacao
    : {};
  const rodada = Number(resumo.rodada_atual || tabela.rodada_atual || 1);
  return Number.isFinite(rodada) && rodada > 0 ? rodada : 1;
}

function origemTabelaNegociacaoLabel(tabela = {}) {
  const origem = texto(tabela.origem || tabela.cidade_origem);
  const ufOrigem = upper(tabela.uf_origem || tabela.ufOrigem);

  if (origem && ufOrigem) return `${origem}/${ufOrigem}`;
  if (origem) return origem;
  if (ufOrigem) return `UF ${ufOrigem}`;
  return '';
}

export function labelTabelaNegociacaoSimulador(tabela = {}) {
  const nome = texto(tabela.transportadora) || 'Tabela em negociação';
  const origem = origemTabelaNegociacaoLabel(tabela);
  const rodada = getRodadaTabelaNegociacao(tabela);
  const tipo = upper(tabela.tipo_negociacao || tabela.tipoNegociacao);
  const tag = tipo === 'REAJUSTE_TABELA_EXISTENTE' ? 'REAJUSTE' : tipo === 'TABELA_LOTACAO' ? 'LOTACAO' : 'NEGOCIACAO';
  return `${nome}${origem ? ` — ${origem}` : ''} (${tag} R${rodada})`;
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
    ibgeDestino: pareceIbge(taxa.ibge_destino || taxa.ibgeDestino) || pareceIbge(taxa.cidade_destino || taxa.cidadeDestino),
    ufDestino: upper(taxa.uf_destino || taxa.ufDestino) || ufPorIbge(taxa.ibge_destino || taxa.ibgeDestino || taxa.cidade_destino || taxa.cidadeDestino),
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

function getTipoItem(item = {}) {
  const dados = parseDadosOriginais(item.dados_originais);
  const origemImportacao = upper(item.origem_importacao);
  const tipo = upper(dados.tipo_item || item.item_tipo);

  if (tipo === 'ROTA' || origemImportacao.includes('ROTAS') || item.faixa_peso === 'ROTA') return 'ROTA';
  return 'COTACAO';
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

function getContextoOrigemTabela(tabela = {}) {
  return {
    cidadeOrigem: texto(tabela.origem || tabela.cidade_origem),
    ufOrigem: upper(tabela.uf_origem || tabela.ufOrigem),
    ibgeOrigem: pareceIbge(tabela.ibge_origem || tabela.ibgeOrigem),
  };
}

function nomeAntesDaFaixa(value) {
  const textoFaixa = texto(value);
  if (!textoFaixa) return '';
  return texto(textoFaixa.split('|')[0]);
}

function nomeCotacaoItem(item = {}) {
  const dados = parseDadosOriginais(item.dados_originais);
  return (
    texto(dados.cotacaoFinal) ||
    texto(dados.cotacaoBase) ||
    texto(dados.cotacao_base) ||
    texto(dados.cotacao) ||
    texto(dados.rota) ||
    texto(dados.nomeRota) ||
    nomeAntesDaFaixa(item.faixa_peso) ||
    texto(item.observacao)
  );
}

function normalizarDestinoItem(item = {}) {
  const dados = parseDadosOriginais(item.dados_originais);

  // Em alguns arquivos/importações o IBGE veio salvo em cidade_destino.
  // Para o motor do simulador funcionar, rota.ibgeDestino precisa ser o código IBGE.
  const ibge =
    pareceIbge(item.ibge_destino) ||
    pareceIbge(item.ibgeDestino) ||
    pareceIbge(dados.ibgeDestino) ||
    pareceIbge(dados.ibge_destino) ||
    pareceIbge(item.cidade_destino) ||
    pareceIbge(item.cidadeDestino) ||
    pareceIbge(dados.cidadeDestino) ||
    pareceIbge(dados.destino);

  const cidadeRaw = texto(item.cidade_destino || item.cidadeDestino || dados.cidadeDestino || dados.destino);
  const cidadeDestino = pareceIbge(cidadeRaw) ? '' : cidadeRaw;
  const ufDestino = upper(item.uf_destino || item.ufDestino || dados.ufDestino || dados.uf_destino) || ufPorIbge(ibge);

  return { ibgeDestino: ibge, cidadeDestino, ufDestino };
}

function normalizarOrigemItem(item = {}, tabela = {}) {
  const dados = parseDadosOriginais(item.dados_originais);
  const contexto = getContextoOrigemTabela(tabela);
  const cidade = contexto.cidadeOrigem || texto(item.cidade_origem || item.origem || dados.origem || dados.cidadeOrigem);
  const uf = contexto.ufOrigem || upper(item.uf_origem || item.ufOrigem || dados.ufOrigem || dados.uf_origem);
  const ibge = contexto.ibgeOrigem || pareceIbge(item.ibge_origem || item.ibgeOrigem || dados.ibgeOrigem || dados.ibge_origem);

  return {
    cidadeOrigem: cidade,
    ufOrigem: uf,
    ibgeOrigem: ibge,
  };
}

function montarNomeRota({ origem, cidadeDestino, ufDestino, ibgeDestino }) {
  const destino = cidadeDestino
    ? `${cidadeDestino}${ufDestino ? `/${ufDestino}` : ''}`
    : `IBGE ${ibgeDestino}`;

  return `${origem || 'Origem'} → ${destino}`;
}

function montarCotacao({ item, nomeRota, generalidades, indice }) {
  const dados = parseDadosOriginais(item.dados_originais);
  const percentual = numero(item.frete_percentual);
  const taxaAplicada = numero(item.taxa_aplicada);
  const freteMinimo = numero(item.frete_minimo);
  const pesoInicial = numero(item.peso_inicial);
  const pesoFinalInformado = numero(item.peso_final);
  const excessoKg = numero(item.excesso_kg);
  const valorExcedente = numero(item.valor_excedente);
  const tipoCalculoTabela = normalizarTipoCalculo(generalidades.tipoCalculo);

  // Faixa de peso "real" = tem valor fixo de faixa (taxa aplicada) OU uma banda
  // de peso de verdade (peso inicial > 0, ou peso final que nao seja a faixa
  // aberta ~999999). So ter R$/kg de excedente numa faixa 0 -> aberta NAO e
  // faixa real: e o modelo "Maior valor" (compara percentual x R$/kg x minimo e
  // usa o maior), que roda no motor PERCENTUAL. A automacao de importacao ja
  // segue essa logica (percentual ganha do excedente isolado).
  const temBandaPesoReal =
    pesoInicial > 0 ||
    (pesoFinalInformado > 0 && pesoFinalInformado < 999998);
  const temFaixaReal = taxaAplicada > 0 || temBandaPesoReal;

  const tipoCalculoItem = temFaixaReal
    ? 'FAIXA_DE_PESO'
    : (percentual > 0 || valorExcedente > 0 || excessoKg > 0 || freteMinimo > 0)
      ? 'PERCENTUAL'
      : tipoCalculoTabela;

  // Em PERCENTUAL ("Maior valor"), o R$/kg incide sobre o peso total e entra na
  // comparacao do maior. O valor pode vir em dados.rsKg, no valor_excedente ou
  // no excesso_kg, conforme a tabela foi importada.
  const rsKgPercentual = numero(
    dados.rsKg ??
    dados.valorKgGarantia ??
    item.rs_kg ??
    item.rsKg ??
    0
  ) || valorExcedente || excessoKg;

  return {
    id: item.id || `cotacao-neg-${indice}`,
    rota: nomeRota,
    faixaPeso: texto(item.faixa_peso),
    pesoMin: pesoInicial,
    pesoMax: pesoFinalInformado > 0 ? pesoFinalInformado : 999999999,
    pesoLimite: pesoFinalInformado > 0 ? pesoFinalInformado : 999999999,
    taxaAplicada,
    valorFixo: taxaAplicada,
    rsKg: tipoCalculoItem === 'PERCENTUAL' ? rsKgPercentual : numero(dados.rsKg),
    percentual,
    fretePercentual: percentual,
    freteMinimo,
    excesso: tipoCalculoItem === 'FAIXA_DE_PESO' ? valorExcedente : 0,
    excessoPeso: tipoCalculoItem === 'FAIXA_DE_PESO' ? excessoKg : 0,
    tipoCalculo: tipoCalculoItem,
    origemNegociacao: true,
  };
}

function criarRotaDeItem(item = {}, tabela = {}, indice = 0) {
  const origem = normalizarOrigemItem(item, tabela);
  const destino = normalizarDestinoItem(item);

  if (!destino.ibgeDestino) return null;

  const nomeRota = montarNomeRota({
    origem: origem.cidadeOrigem,
    cidadeDestino: destino.cidadeDestino,
    ufDestino: destino.ufDestino,
    ibgeDestino: destino.ibgeDestino,
  });

  return {
    id: item.id ? `neg-rota-${item.id}` : `neg-rota-${indice + 1}`,
    nomeRota,
    ibgeOrigem: origem.ibgeOrigem,
    cidadeOrigem: origem.cidadeOrigem,
    ufOrigem: origem.ufOrigem,
    ibgeDestino: destino.ibgeDestino,
    cidadeDestino: destino.cidadeDestino,
    ufDestino: destino.ufDestino,
    prazoEntregaDias: numero(item.prazo),
    valorMinimoFrete: numero(item.frete_minimo),
    origemNegociacao: true,
    __nomeCotacao: normalizarChave(nomeCotacaoItem(item)),
    __ufDestino: destino.ufDestino,
  };
}

function rotaCombinaComCotacao(rota = {}, cotacao = {}) {
  const nomeCotacao = normalizarChave(nomeCotacaoItem(cotacao));
  const ufCotacao = upper(cotacao.uf_destino || parseDadosOriginais(cotacao.dados_originais).ufDestino || parseDadosOriginais(cotacao.dados_originais).uf_destino);
  const nomeRota = normalizarChave(rota.__nomeCotacao || rota.nomeRota);

  const nomeBate = !nomeCotacao || !nomeRota || nomeRota === nomeCotacao || nomeRota.includes(nomeCotacao) || nomeCotacao.includes(nomeRota);
  const ufBate = !ufCotacao || !rota.__ufDestino || ufCotacao === rota.__ufDestino;

  return nomeBate && ufBate;
}

function getChaveOrigem(origem) {
  return [
    normalizarChave(origem.cidade),
    upper(origem.uf),
    texto(origem.ibgeOrigem),
    normalizarCanal(origem.canal),
  ].join('|');
}

function adicionarOrigem(origensMap, tabela, origemInfo, generalidades, taxas) {
  const canal = normalizarCanal(tabela.canal);
  const origemBase = {
    id: `neg-origem-${tabela.id || 'sem-id'}-${origensMap.size + 1}`,
    cidade: origemInfo.cidadeOrigem,
    uf: origemInfo.ufOrigem,
    ibgeOrigem: origemInfo.ibgeOrigem,
    canal,
    generalidades,
    taxasEspeciais: taxas.map(montarTaxaDestino).filter((taxa) => taxa.ibgeDestino || taxa.cidadeDestino),
    rotas: [],
    cotacoes: [],
    origemNegociacao: true,
  };

  const chave = getChaveOrigem(origemBase);
  if (!origensMap.has(chave)) origensMap.set(chave, origemBase);
  return origensMap.get(chave);
}

function adicionarRotaECotacao({ origensMap, tabela, item, rota, generalidades, taxas, indice }) {
  if (!rota?.ibgeDestino) return;
  const origemInfo = {
    cidadeOrigem: rota.cidadeOrigem,
    ufOrigem: rota.ufOrigem,
    ibgeOrigem: rota.ibgeOrigem,
  };
  const origem = adicionarOrigem(origensMap, tabela, origemInfo, generalidades, taxas);

  const rotaKey = [rota.ibgeDestino, rota.nomeRota].join('|');
  if (!origem.rotas.some((r) => r.__rotaKey === rotaKey)) {
    origem.rotas.push({
      ...rota,
      __rotaKey: rotaKey,
    });
  }

  origem.cotacoes.push(montarCotacao({
    item,
    nomeRota: rota.nomeRota,
    generalidades,
    indice,
  }));
}

export function converterTabelaNegociacaoParaSimulador(tabela = {}) {
  const itens = tabela.tabelas_negociacao_itens || tabela.itens || [];
  const taxas = tabela.tabelas_negociacao_taxas_destino || tabela.taxasDestino || [];
  const generalidades = montarGeneralidades(tabela.generalidades || {});
  const nomeTransportadora = labelTabelaNegociacaoSimulador(tabela);
  const canalTabela = normalizarCanal(tabela.canal);

  const rotasTecnicas = [];
  const cotacoes = [];

  (itens || []).forEach((item, indice) => {
    const tipo = getTipoItem(item);
    if (tipo === 'ROTA' && !itemTemPreco(item)) {
      const rota = criarRotaDeItem(item, tabela, indice);
      if (rota) rotasTecnicas.push(rota);
      return;
    }

    if (itemTemPreco(item)) cotacoes.push({ item, indice });
  });

  const origensMap = new Map();

  cotacoes.forEach(({ item, indice }) => {
    const matches = rotasTecnicas.filter((rota) => rotaCombinaComCotacao(rota, item));
    if (matches.length) {
      matches.forEach((rota, idx) => {
        adicionarRotaECotacao({
          origensMap,
          tabela,
          item,
          rota,
          generalidades,
          taxas,
          indice: `${indice}-${idx}`,
        });
      });
      return;
    }

    const rotaDireta = criarRotaDeItem(item, tabela, indice);

    if (rotaDireta?.ibgeDestino) {
      adicionarRotaECotacao({ origensMap, tabela, item, rota: rotaDireta, generalidades, taxas, indice });
    }
  });

  const origens = Array.from(origensMap.values()).map((origem) => ({
    ...origem,
    rotas: origem.rotas.map(({ __rotaKey, __nomeCotacao, __ufDestino, ...rota }) => rota),
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

// Versão LEVE: gera apenas os rótulos de seleção a partir das capas das
// negociações, sem depender de itens/rotas/taxas. Usa exatamente o mesmo
// filtro de canal de converterTabelasNegociacaoParaSimulador, para que a lista
// de seleção apareça mesmo antes de a negociação ter os detalhes carregados.
export function nomesTabelasNegociacaoSimulador(tabelas = [], filtros = {}) {
  const canalFiltro = normalizarCanal(filtros.canal || '');

  return (tabelas || [])
    .filter((tabela) => tabela && tabela.incluir_simulacao)
    .filter((tabela) => !canalFiltro || normalizarCanal(tabela.canal) === canalFiltro)
    .map((tabela) => labelTabelaNegociacaoSimulador(tabela))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
