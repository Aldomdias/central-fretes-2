function texto(value) {
  return String(value ?? '').trim();
}

function normalizarTaxasExtras(raw) {
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return arr
    .map((te) => ({
      nome: String(te.nome ?? '').trim(),
      valor: Number(te.valor) || 0,
      pct: Number(te.pct) || 0,
      min: Number(te.min) || 0,
      valorPorPeso: Number(te.valorPorPeso ?? te.valor_por_peso) || 0,
      pesoBase: Number(te.pesoBase ?? te.peso_base ?? te.baseKg ?? te.base_kg) || 0,
    }))
    .filter((te) => te.pct > 0 || te.valor > 0 || te.valorPorPeso > 0);
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

// Uma negociação combo ("ATACADO+B2C") ou "AMBOS"/"TODOS" atende os dois canais.
// filtroNorm já vem normalizado (ATACADO/B2C).
function canalNegociacaoAtende(canalTabela, filtroNorm) {
  if (!filtroNorm) return true;
  const base = normalizarCanal(canalTabela);
  if (!base) return true;
  if (base === filtroNorm) return true;
  if (base.includes('AMBOS') || base.includes('TODOS')) return true;
  const partes = base.split(/\+|\sE\s/).map((s) => s.trim()).filter(Boolean);
  return partes.length > 1 && partes.includes(filtroNorm);
}

function normalizarTipoCalculo(value) {
  const tipo = upper(value);
  if (tipo === 'FAIXA_DE_PESO' || tipo === 'FAIXA DE PESO') return 'FAIXA_DE_PESO';
  if (tipo === 'PESO_CUBADO') return 'PESO_CUBADO';
  return 'PERCENTUAL';
}

function tipoCalculoInformado(value) {
  const tipo = upper(value);
  if (!tipo) return '';
  if (tipo.includes('PERCENT')) return 'PERCENTUAL';
  if (tipo.includes('FAIXA')) return 'FAIXA_DE_PESO';
  if (tipo === 'PESO_CUBADO') return 'PESO_CUBADO';
  return '';
}

function normalizarPesoFaixaNegociacao(pesoInicialRaw, pesoFinalRaw) {
  let pesoInicial = numero(pesoInicialRaw);
  const pesoFinal = numero(pesoFinalRaw);

  // Alguns imports de negociação salvam limites decimais sem separador:
  // 50,001 kg vira 50001, enquanto o fim vem como 70 kg. Se mantiver assim,
  // a faixa fica invertida (50001 -> 70) e só pesos baixos encontram preço.
  const faixaAberta = pesoFinal >= 99998;
  if (pesoInicial >= 1000 && ((pesoInicial > pesoFinal && pesoFinal > 0 && pesoFinal < 1000) || faixaAberta)) {
    const reduzido = pesoInicial / 1000;
    if (faixaAberta || reduzido < pesoFinal) pesoInicial = reduzido;
  }

  return { pesoInicial, pesoFinal };
}

// Mesmo bug de "50,001 vira 50001" pode atingir a coluna de limiar do
// excedente (excesso_kg). Ela normalmente repete o peso_inicial da faixa
// aberta, então usamos o pesoInicial (já corrigido acima) como referência:
// se excessoKg destoa >=1000x dele, também sofreu o mesmo parsing errado.
function normalizarExcessoKgNegociacao(excessoKgRaw, pesoInicial = 0) {
  const excessoKg = numero(excessoKgRaw);
  if (excessoKg >= 1000 && pesoInicial > 0 && pesoInicial < 1000) {
    const reduzido = excessoKg / 1000;
    if (Math.abs(reduzido - pesoInicial) < 1) return reduzido;
  }
  return excessoKg;
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
  // Só marca o tipo quando não é o caso comum (negociação padrão) — o rótulo
  // ficava comprido demais repetindo "NEGOCIACAO" em toda tabela em rodada.
  const tag = tipo === 'REAJUSTE_TABELA_EXISTENTE' ? 'REAJUSTE ' : tipo === 'TABELA_LOTACAO' ? 'LOTACAO ' : '';
  return `${nome}${origem ? ` — ${origem}` : ''} (${tag}R${rodada})`;
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
    taxaEmergencial: numero(generalidades.taxaEmergencial),
  };
}

function montarTaxaDestino(taxa = {}) {
  return {
    ibgeDestino: pareceIbge(taxa.ibge_destino || taxa.ibgeDestino) || pareceIbge(taxa.cidade_destino || taxa.cidadeDestino),
    ufDestino: upper(taxa.uf_destino || taxa.ufDestino) || ufPorIbge(taxa.ibge_destino || taxa.ibgeDestino || taxa.cidade_destino || taxa.cidadeDestino),
    cidadeDestino: texto(taxa.cidade_destino || taxa.cidadeDestino),
    tda: numero(taxa.tda),
    tdr: 0,
    trt: numero(taxa.trt || taxa.tde),
    suframa: numero(taxa.suframa),
    outras: numero(taxa.outras_taxas || taxa.outras),
    gris: numero(taxa.gris),
    grisMinimo: numero(taxa.gris_minimo || taxa.grisMinimo),
    adVal: numero(taxa.advalorem || taxa.adVal),
    adValMinimo: numero(taxa.advalorem_minimo || taxa.adValMinimo),
    observacao: texto(taxa.observacao),
    taxasExtras: normalizarTaxasExtras(taxa.taxas_extras ?? taxa.taxasExtras),
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
  const { pesoInicial, pesoFinal: pesoFinalInformado } = normalizarPesoFaixaNegociacao(item.peso_inicial, item.peso_final);
  const excessoKg = normalizarExcessoKgNegociacao(item.excesso_kg, pesoInicial);
  const valorExcedente = numero(item.valor_excedente);
  const tipoCalculoTabela = normalizarTipoCalculo(generalidades.tipoCalculo);
  const tipoCalculoExplicito = tipoCalculoInformado(
    item.tipo_calculo || item.tipoCalculo || dados.tipoCalculo || dados.tipo_calculo
  );

  // Faixa de peso "real" = tem valor fixo de faixa (taxa aplicada) OU uma banda
  // de peso de verdade (peso inicial > 0, ou peso final que nao seja a faixa
  // aberta ~999999). So ter R$/kg de excedente numa faixa 0 -> aberta NAO e
  // faixa real: e o modelo "Maior valor" (compara percentual x R$/kg x minimo e
  // usa o maior), que roda no motor PERCENTUAL. A automacao de importacao ja
  // segue essa logica (percentual ganha do excedente isolado).
  const temBandaPesoReal =
    pesoInicial > 0 ||
    (pesoFinalInformado > 0 && pesoFinalInformado < 99998);
  const temComponentePercentual = percentual > 0 || freteMinimo > 0;
  const temFaixaReal = taxaAplicada > 0 || (temBandaPesoReal && !temComponentePercentual);

  const tipoCalculoItem = tipoCalculoExplicito || (temFaixaReal
    ? 'FAIXA_DE_PESO'
    : (percentual > 0 || valorExcedente > 0 || excessoKg > 0 || freteMinimo > 0)
      ? 'PERCENTUAL'
      : tipoCalculoTabela);

  // Em PERCENTUAL ("Maior valor"), o R$/kg incide sobre o peso total e entra na
  // comparacao do maior. O valor pode vir em dados.rsKg, no valor_excedente ou
  // no excesso_kg, conforme a tabela foi importada.
  const rsKgPercentual = numero(
    dados.rsKg ??
    dados.valorKgGarantia ??
    item.rs_kg ??
    item.rsKg ??
    dados.excedente ??
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

  // O nome do grupo de cotação vem do próprio item importado (ex.: "BA - FRETE 3% - MIN 60")
  // e é compartilhado por várias rotas/destinos. Só cai no nome "Origem → Cidade/UF"
  // (um por destino) quando o item não trouxe nome de grupo nenhum — senão a tabela
  // vira uma cotação isolada por destino em vez de reaproveitar o grupo, e fica pesada.
  const nomeGrupo = texto(nomeCotacaoItem(item)) || montarNomeRota({
    origem: origem.cidadeOrigem,
    cidadeDestino: destino.cidadeDestino,
    ufDestino: destino.ufDestino,
    ibgeDestino: destino.ibgeDestino,
  });

  return {
    id: item.id ? `neg-rota-${item.id}` : `neg-rota-${indice + 1}`,
    nomeRota: nomeGrupo,
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

  const nomeExato = Boolean(nomeCotacao) && Boolean(nomeRota) && nomeRota === nomeCotacao;
  const nomeBate = nomeExato || !nomeCotacao || !nomeRota || nomeRota.includes(nomeCotacao) || nomeCotacao.includes(nomeRota);
  // Import (Verum) às vezes grava na cotação o UF de UM destino de exemplo da faixa,
  // que pode nem ser o UF real da faixa (ex.: faixa "MG" salva com um destino em GO).
  // Nome idêntico já é sinal forte o suficiente; a checagem de UF só serve pra
  // desambiguar quando o nome bate só por substring.
  const ufBate = nomeExato || !ufCotacao || !rota.__ufDestino || ufCotacao === rota.__ufDestino;

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

  // Chave por grupo (nomeRota) + faixa de peso, não por destino/item: várias rotas do
  // mesmo grupo de tarifa (ex.: todas as cidades da BA a 3%) devem reaproveitar UMA
  // cotação só, como nas tabelas cadastradas manualmente — senão duplica uma linha
  // idêntica por destino e a tabela fica pesada pra simular.
  const cotacaoKey = [rota.nomeRota, numero(item.peso_inicial), numero(item.peso_final)].join('|');
  if (origem.cotacoes.some((cotacao) => cotacao.__cotacaoKey === cotacaoKey)) return;

  origem.cotacoes.push({
    ...montarCotacao({
    item,
    nomeRota: rota.nomeRota,
    generalidades,
    indice,
    }),
    __cotacaoKey: cotacaoKey,
  });
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
    cotacoes: origem.cotacoes.map(({ __cotacaoKey, ...cotacao }) => cotacao),
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
    .filter((tabela) => tabela)
    .filter((tabela) => canalNegociacaoAtende(tabela.canal, canalFiltro))
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
    .filter((tabela) => tabela)
    .filter((tabela) => canalNegociacaoAtende(tabela.canal, canalFiltro))
    .map((tabela) => labelTabelaNegociacaoSimulador(tabela))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// ─── CAMINHO INVERSO: BASE OFICIAL → ITENS DE NEGOCIAÇÃO ─────────────────────
// Usado quando uma tabela oficial volta para Negociações (revisão de
// competitividade / renegociação): a malha oficial é copiada como itens
// (rotas + cotações), taxas por destino e generalidades da negociação, para que
// a rodada já nasça com a tabela vigente carregada — o espelho de
// promoverTabelaNegociacaoParaOficialInterno.

function destinoDoNomeRota(nomeRota) {
  const match = texto(nomeRota).match(/^([^|/]+?)\s*\/\s*([A-Za-z]{2})$/);
  if (!match) return { cidadeDestino: '', ufDestino: '' };
  return { cidadeDestino: texto(match[1]), ufDestino: upper(match[2]) };
}

function contextoOrigemOficial(origem = {}) {
  const ibgeOrigem = pareceIbge(origem.ibgeOrigem || origem.ibge_origem)
    || pareceIbge((origem.rotas || []).find((rota) => pareceIbge(rota?.ibgeOrigem))?.ibgeOrigem);
  return {
    cidade: texto(origem.cidade),
    uf: upper(origem.uf || origem.ufOrigem) || ufPorIbge(ibgeOrigem),
    ibgeOrigem,
    canal: texto(origem.canal),
  };
}

function itemRotaDaBaseOficial(rota = {}, origem = {}, indice = 0) {
  const ibgeDestino = pareceIbge(rota.ibgeDestino || rota.ibge_destino);
  if (!ibgeDestino) return null;

  const nomeRota = texto(rota.nomeRota || rota.rota) || `IBGE ${ibgeDestino}`;
  const destino = destinoDoNomeRota(nomeRota);

  return {
    tipo_item: 'ROTA',
    cidade_origem: origem.cidade,
    uf_origem: origem.uf,
    ibge_origem: pareceIbge(rota.ibgeOrigem) || origem.ibgeOrigem,
    cidade_destino: destino.cidadeDestino,
    uf_destino: destino.ufDestino || ufPorIbge(ibgeDestino),
    ibge_destino: ibgeDestino,
    faixa_peso: 'ROTA',
    prazo: numero(rota.prazoEntregaDias),
    origem_importacao: 'BASE_OFICIAL_ROTAS',
    observacao: nomeRota,
    dados_originais: {
      tipo_item: 'ROTA',
      cotacaoFinal: nomeRota,
      nomeRota,
      ibgeDestino,
      ufDestino: destino.ufDestino || ufPorIbge(ibgeDestino),
      cidadeDestino: destino.cidadeDestino,
      valorMinimoFrete: numero(rota.valorMinimoFrete),
      canal: texto(rota.canal || origem.canal),
      rota_oficial_id: texto(rota.id) || `rota-${indice + 1}`,
      origem_copia: 'BASE_OFICIAL',
    },
  };
}

function itemCotacaoDaBaseOficial(cotacao = {}, origem = {}, indice = 0) {
  const nomeRota = texto(cotacao.rota);
  const pesoMin = numero(cotacao.pesoMin);
  const pesoMaxBruto = numero(cotacao.pesoMax ?? cotacao.pesoLimite);
  const pesoMax = pesoMaxBruto > 0 && pesoMaxBruto < 99999999 ? pesoMaxBruto : 0;
  const faixa = pesoMax > 0 ? `${pesoMin}-${pesoMax}kg` : `${pesoMin}kg+`;

  return {
    tipo_item: 'COTACAO',
    cidade_origem: origem.cidade,
    uf_origem: origem.uf,
    ibge_origem: origem.ibgeOrigem,
    faixa_peso: nomeRota ? `${nomeRota} | ${faixa}` : faixa,
    peso_inicial: pesoMin,
    peso_final: pesoMax,
    frete_minimo: numero(cotacao.freteMinimo),
    taxa_aplicada: numero(cotacao.valorFixo ?? cotacao.taxaAplicada),
    frete_percentual: numero(cotacao.percentual),
    valor_excedente: numero(cotacao.excesso),
    excesso_kg: numero(cotacao.excessoPeso),
    origem_importacao: 'BASE_OFICIAL_COTACOES',
    observacao: nomeRota,
    dados_originais: {
      tipo_item: 'COTACAO',
      cotacaoFinal: nomeRota,
      nomeRota,
      rsKg: numero(cotacao.rsKg),
      tipoCalculo: texto(cotacao.tipoCalculo),
      regraCalculo: texto(cotacao.regraCalculo),
      cotacao_oficial_id: texto(cotacao.id) || `cotacao-${indice + 1}`,
      origem_copia: 'BASE_OFICIAL',
    },
  };
}

function taxaDestinoDaBaseOficial(taxa = {}) {
  const ibgeDestino = pareceIbge(taxa.ibgeDestino || taxa.ibge_destino);
  if (!ibgeDestino) return null;
  return {
    ibge_destino: ibgeDestino,
    uf_destino: upper(taxa.ufDestino) || ufPorIbge(ibgeDestino),
    cidade_destino: texto(taxa.cidadeDestino),
    tda: numero(taxa.tda),
    tdr: numero(taxa.tdr),
    trt: numero(taxa.trt),
    suframa: numero(taxa.suframa),
    outras_taxas: numero(taxa.outras),
    gris: numero(taxa.gris),
    gris_minimo: numero(taxa.grisMinimo),
    advalorem: numero(taxa.adVal),
    advalorem_minimo: numero(taxa.adValMinimo),
    observacao: texto(taxa.observacao),
    taxas_extras: normalizarTaxasExtras(taxa.taxasExtras),
  };
}

export function converterTransportadoraOficialParaNegociacao(transportadora = {}, opcoes = {}) {
  const canalFiltro = normalizarCanal(opcoes.canal || '');
  const origemFiltro = normalizarChave(opcoes.origem || '');

  const todasOrigens = (transportadora.origens || []).filter(Boolean);
  let origens = todasOrigens.filter((origem) => canalNegociacaoAtende(origem.canal, canalFiltro));
  if (origemFiltro) {
    const porOrigem = origens.filter((origem) => normalizarChave(origem.cidade) === origemFiltro);
    if (porOrigem.length) origens = porOrigem;
  }
  if (!origens.length) origens = todasOrigens;

  const itens = [];
  const taxasPorIbge = new Map();
  let generalidades = null;

  origens.forEach((origem) => {
    if (!generalidades) generalidades = montarGeneralidades(origem.generalidades || {});
    const contexto = contextoOrigemOficial(origem);

    (origem.rotas || []).forEach((rota, indice) => {
      const item = itemRotaDaBaseOficial(rota, contexto, indice);
      if (item) itens.push(item);
    });

    (origem.cotacoes || []).forEach((cotacao, indice) => {
      itens.push(itemCotacaoDaBaseOficial(cotacao, contexto, indice));
    });

    (origem.taxasEspeciais || []).forEach((taxa) => {
      const linha = taxaDestinoDaBaseOficial(taxa);
      if (linha && !taxasPorIbge.has(linha.ibge_destino)) taxasPorIbge.set(linha.ibge_destino, linha);
    });
  });

  return {
    itens,
    taxasDestino: Array.from(taxasPorIbge.values()),
    generalidades: generalidades || montarGeneralidades({}),
    resumo: {
      origens: origens.length,
      rotas: itens.filter((item) => item.tipo_item === 'ROTA').length,
      cotacoes: itens.filter((item) => item.tipo_item === 'COTACAO').length,
      taxas: taxasPorIbge.size,
    },
  };
}
