function numero(value) {
  if (typeof value === 'string') {
    const texto = value.trim();
    if (!texto) return 0;
    const normalizado = texto.includes(',')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto;
    const parsedString = Number(normalizado);
    return Number.isFinite(parsedString) ? parsedString : 0;
  }

  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolverCubagemTracking({
  cubagemUnitaria = 0,
  cubagemTotal = 0,
  pesoCubadoOriginal = 0,
  volumes = 0,
  quantidadeItens = 0,
  pesoFisico = 0,
  fatorCubagem = 300,
}) {
  const cubagemLinha = numero(cubagemUnitaria);
  const totalArmazenado = numero(cubagemTotal);
  const pesoCubadoFonte = numero(pesoCubadoOriginal);
  const qtdVolumes = numero(volumes);
  const qtdItens = numero(quantidadeItens);
  const peso = numero(pesoFisico);
  const fator = numero(fatorCubagem) || 300;

  // Regra do Tracking: quando cubagem_total vem preenchida, ela ja representa a
  // cubagem total da NF/linha. So multiplicamos cubagem_unitaria por volumes
  // quando o total nao veio no arquivo/base.
  const porVolume = qtdVolumes > 0 ? cubagemLinha * qtdVolumes : cubagemLinha;
  const porItemPorVolume = qtdItens > 1 && qtdVolumes > 0 && cubagemLinha > 0
    ? (cubagemLinha / qtdItens) * qtdVolumes
    : 0;
  const dividiuCubagemPorItens = porItemPorVolume > 0;

  // cubagem_total gravado tambem pode carregar o bug antigo de importacao
  // (valor igual a unitaria, nao multiplicado pelas unidades). So confiamos
  // nele quando nao tem essa assinatura; senao usamos a multiplicacao pura.
  const totalArmazenadoPareceNaoMultiplicado = totalArmazenado > 0
    && cubagemLinha > 0
    && qtdVolumes > 1
    && qtdItens <= 1
    && Math.abs(totalArmazenado - cubagemLinha) < 0.000001;
  const totalArmazenadoConfiavel = totalArmazenadoPareceNaoMultiplicado ? 0 : totalArmazenado;

  const cubagemCandidata = dividiuCubagemPorItens
    ? porItemPorVolume
    : totalArmazenadoConfiavel > 0
      ? totalArmazenadoConfiavel
      : porVolume;

  // Informativo: houve multiplicacao pelos volumes nesta linha.
  const totalPareceUnitarioMultiplicado =
    qtdVolumes > 1 &&
    cubagemLinha > 0 &&
    pesoCubadoFonte > 0 &&
    Math.abs(pesoCubadoFonte - cubagemLinha) < 0.000001 &&
    Math.abs(totalArmazenado - porVolume) < 0.000001;

  const cubagemCandidataFinal = dividiuCubagemPorItens
    ? cubagemCandidata
    : totalPareceUnitarioMultiplicado
      ? pesoCubadoFonte
      : cubagemCandidata;
  const totalFoiMultiplicadoPorVolumes = !totalPareceUnitarioMultiplicado && qtdVolumes > 1 && cubagemLinha > 0 && porVolume >= totalArmazenado;

  const pesoCubado = cubagemCandidataFinal * fator;

  return {
    cubagemAplicada: cubagemCandidataFinal,
    cubagemOriginal: cubagemLinha,
    cubagemTotalArmazenada: totalArmazenado,
    totalFoiMultiplicadoPorVolumes,
    totalPareceUnitarioMultiplicado,
    dividiuCubagemPorItens,
    quantidadeItensCubagem: qtdItens,
    pesoCubado,
    pesoConsiderado: Math.max(peso, pesoCubado),
  };
}

// Ponto unico de decisao "confio no cubagem_final gravado ou recalculo?".
// Existe porque um bug de importacao antigo (corrigido em trackingLocal.js/
// trackingSupabaseService.js) gravou cubagem_final IGUAL a cubagem_unitaria
// em NFs de 1 item so com mais de 1 unidade, sem multiplicar pelas unidades.
// Enquanto essas linhas nao forem reimportadas, essa assinatura identifica o
// valor salvo como nao confiavel e recalcula na hora em vez de usa-lo.
export function resolverCubagemFinal({
  cubagemFinalInformada = 0,
  cubagemUnitaria = 0,
  cubagemTotal = 0,
  pesoCubadoOriginal = 0,
  volumes = 0,
  quantidadeItens = 0,
  pesoFisico = 0,
  fatorCubagem = 300,
}) {
  const resolvida = resolverCubagemTracking({
    cubagemUnitaria,
    cubagemTotal,
    pesoCubadoOriginal,
    volumes,
    quantidadeItens,
    pesoFisico,
    fatorCubagem,
  });

  const final = numero(cubagemFinalInformada);
  const unitaria = numero(cubagemUnitaria);
  const qtdVolumes = numero(volumes);
  const qtdItens = numero(quantidadeItens);
  const pareceNaoMultiplicado = final > 0
    && unitaria > 0
    && qtdVolumes > 1
    && qtdItens <= 1
    && Math.abs(final - unitaria) < 0.000001;

  const cubagemAplicada = final > 0 && !pareceNaoMultiplicado ? final : resolvida.cubagemAplicada;

  return {
    ...resolvida,
    cubagemAplicada,
    cubagemFinalIgnorada: pareceNaoMultiplicado,
  };
}

export function validarCubagemOperacional({
  cubagemTotal = 0,
  qtdVolumes = 0,
  peso = 0,
}) {
  const cubagem = numero(cubagemTotal);
  const volumes = numero(qtdVolumes);
  const pesoRef = numero(peso);

  if (cubagem <= 0) {
    return { cubagemTotal: 0, cubagemOriginal: 0, outlier: false, limiteCubagem: 0 };
  }

  const limitePorPeso = pesoRef > 0 ? Math.min(18, Math.max(8, (pesoRef / 250) * 4)) : 0;
  const limitePorVolume = volumes > 0 ? Math.max(5, volumes * 0.35) : 0;
  let limiteCubagem = Math.max(12, limitePorPeso, limitePorVolume);

  // Corte por densidade: cargas com muitos volumes ganham limite alto pela regra
  // por volume (0,35 m³/vol), mas cubagem que implica densidade < 35 kg/m³ é
  // outlier em fracionado (ex.: 72 pneus/663 kg com 20,16 m³ = 33 kg/m³; pneu
  // real fica ~140 kg/m³). Calibrado para manter o caso validado de 68 vol/
  // 508,8 kg/12,978 m³ (39,2 kg/m³). O piso de 12 m³ preserva remessas pequenas.
  if (pesoRef > 0) {
    limiteCubagem = Math.min(limiteCubagem, Math.max(12, pesoRef / 35));
  }

  const outlier = cubagem > limiteCubagem;

  return {
    cubagemTotal: outlier ? 0 : cubagem,
    cubagemOriginal: cubagem,
    outlier,
    limiteCubagem,
  };
}

function apenasDigitosCubagem(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function documentoTrackingKeyCubagem(item = {}) {
  const chaveNfe = apenasDigitosCubagem(item.chave_nfe || item.chaveNfe);
  if (chaveNfe) return `nfe:${chaveNfe}`;
  const nota = apenasDigitosCubagem(item.nota_fiscal || item.notaFiscal);
  return nota ? `nota:${nota}` : '';
}

function valoresProximosCubagem(a, b, tolerancia = 0.000001) {
  return Math.abs(numero(a) - numero(b)) <= tolerancia;
}

function normalizarChaveRawTracking(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function rawTrackingObjeto(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function valorRawTracking(item = {}, chaves = []) {
  const raw = rawTrackingObjeto(item.raw);
  const rawNormalizado = Object.fromEntries(
    Object.entries(raw).map(([chave, valor]) => [normalizarChaveRawTracking(chave), valor])
  );

  for (const chave of chaves) {
    if (item[chave] !== undefined && item[chave] !== null && item[chave] !== '') return item[chave];
    if (raw[chave] !== undefined && raw[chave] !== null && raw[chave] !== '') return raw[chave];
    const chaveNormalizada = normalizarChaveRawTracking(chave);
    if (rawNormalizado[chaveNormalizada] !== undefined && rawNormalizado[chaveNormalizada] !== null && rawNormalizado[chaveNormalizada] !== '') {
      return rawNormalizado[chaveNormalizada];
    }
  }
  return 0;
}

function quantidadeItensTracking(item = {}) {
  return numero(valorRawTracking(item, [
    'quantidade_itens',
    'quantidadeItens',
    'qtd_itens',
    'qtdItens',
    'itens',
    'total_itens',
    'Quantidade de itens',
    'QUANTIDADE DE ITENS',
    'QTD ITENS',
  ]));
}

function volumesTracking(item = {}) {
  return numero(valorRawTracking(item, [
    'qtd_volumes',
    'qtdVolumes',
    'volumes',
    'volume',
    'totalUnidades',
    'total_unidades',
    'Total de unidades',
    'TOTAL DE UNIDADES',
    'Quantidade volumes',
    'QUANTIDADE VOLUMES',
    'QTDE VOLUMES',
  ]));
}

export function criarTrackingAgregado(item = {}, origem = '') {
  const origemVinculo = origem || item.origem_vinculo_tracking || 'raw';
  const qtdVolumes = volumesTracking(item);
  const cubagemUnitaria = numero(item.cubagem_unitaria ?? 0);
  const cubagemTotalDireta = numero(item.cubagem_total ?? item.cubagem ?? 0);
  const quantidadeItens = numero(item.quantidade_itens) || quantidadeItensTracking(item);
  // cubagem_final ja vem calculada (cubagem/itens*unidades) desde a importacao
  // do Tracking (ver trackingSupabaseService.toDbRow); preferir ela evita
  // recalcular sem os itens quando a consulta nao traz o raw da NF. Mas
  // resolverCubagemFinal ignora esse valor gravado se ele tiver a assinatura
  // do bug antigo (nao multiplicado pelas unidades) e recalcula na hora.
  const cubagemResolvida = resolverCubagemFinal({
    cubagemFinalInformada: numero(item.cubagem_final ?? item.cubagemFinal ?? 0),
    cubagemUnitaria,
    cubagemTotal: cubagemTotalDireta,
    pesoCubadoOriginal: numero(item.peso_cubado ?? item.pesoCubado ?? 0),
    volumes: qtdVolumes,
    quantidadeItens,
    pesoFisico: numero(item.peso ?? item.peso_tracking ?? 0),
  });
  const cubagemTotal = cubagemResolvida.cubagemAplicada;

  return {
    ...item,
    origem_vinculo_tracking: origemVinculo,
    linhas_tracking: Number(item.linhas_tracking || 1),
    qtd_volumes: qtdVolumes,
    quantidade_itens: quantidadeItens,
    cubagem_unitaria: cubagemTotal,
    cubagem_total: cubagemTotal,
    cubagem_total_armazenada: cubagemTotalDireta,
    cubagem_corrigida: cubagemResolvida.totalFoiMultiplicadoPorVolumes,
    cubagem_dividida_por_itens: cubagemResolvida.dividiuCubagemPorItens,
    peso: numero(item.peso ?? item.peso_tracking ?? 0),
    peso_declarado: numero(item.peso_declarado ?? 0),
    peso_cubado: cubagemResolvida.pesoCubado,
    valor_nf: numero(item.valor_nf ?? 0),
  };
}

// Agrega linhas do tracking do MESMO CT-e. NFs com vários itens de produto vêm
// como uma linha por item; nelas os campos de NF (cubagem total, peso) chegam
// REPETIDOS em cada linha, enquanto volumes podem vir por item. A regra é por
// métrica: valor idêntico ao acumulado no mesmo documento = repetição de NF
// (mantém uma vez, via max); valor diferente = rateio por item (soma).
// Ex.: NF com 4 itens (20+8+20+24 volumes), cubagem 5,04 repetida em cada
// linha -> volumes 72 e cubagem 5,04 (antes somava 4x5,04 = 20,16 e o peso
// cubado explodia).
export function somarTrackingAgregado(atual, proximo) {
  if (!atual) return criarTrackingAgregado(proximo);
  const item = criarTrackingAgregado(proximo);

  const mesmoDocumento = (() => {
    const keyAtual = documentoTrackingKeyCubagem(atual);
    const keyItem = documentoTrackingKeyCubagem(item);
    return Boolean(keyAtual && keyAtual === keyItem);
  })();

  const cubagemRepetida = mesmoDocumento && (
    valoresProximosCubagem(atual.cubagem_total, item.cubagem_total)
    || valoresProximosCubagem(atual.cubagem_unitaria, item.cubagem_unitaria)
  );
  const volumesRepetidos = mesmoDocumento && cubagemRepetida && valoresProximosCubagem(atual.qtd_volumes, item.qtd_volumes);
  const pesoRepetido = mesmoDocumento && valoresProximosCubagem(atual.peso, item.peso);

  return {
    ...atual,
    ...Object.fromEntries(
      Object.entries(atual).filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    ),
    linhas_tracking: numero(atual.linhas_tracking) + numero(item.linhas_tracking || 1),
    qtd_volumes: volumesRepetidos ? Math.max(numero(atual.qtd_volumes), numero(item.qtd_volumes)) : numero(atual.qtd_volumes) + numero(item.qtd_volumes),
    quantidade_itens: Math.max(numero(atual.quantidade_itens), numero(item.quantidade_itens)),
    cubagem_unitaria: cubagemRepetida ? Math.max(numero(atual.cubagem_unitaria), numero(item.cubagem_unitaria)) : numero(atual.cubagem_unitaria) + numero(item.cubagem_unitaria),
    cubagem_total: cubagemRepetida ? Math.max(numero(atual.cubagem_total), numero(item.cubagem_total)) : numero(atual.cubagem_total) + numero(item.cubagem_total),
    cubagem_total_armazenada: cubagemRepetida ? Math.max(numero(atual.cubagem_total_armazenada), numero(item.cubagem_total_armazenada)) : numero(atual.cubagem_total_armazenada) + numero(item.cubagem_total_armazenada),
    cubagem_corrigida: Boolean(atual.cubagem_corrigida || item.cubagem_corrigida),
    cubagem_dividida_por_itens: Boolean(atual.cubagem_dividida_por_itens || item.cubagem_dividida_por_itens),
    peso: pesoRepetido ? Math.max(numero(atual.peso), numero(item.peso)) : numero(atual.peso) + numero(item.peso),
    peso_declarado: numero(atual.peso_declarado) || numero(item.peso_declarado),
    peso_cubado: cubagemRepetida ? Math.max(numero(atual.peso_cubado), numero(item.peso_cubado)) : numero(atual.peso_cubado) + numero(item.peso_cubado),
    valor_nf: numero(atual.valor_nf) || numero(item.valor_nf),
    origem_vinculo_tracking: atual.origem_vinculo_tracking || item.origem_vinculo_tracking || 'raw',
  };
}

export function agregarCubagemLinhasTracking(linhas = [], fatorCubagem = 300) {
  return linhas.reduce((agregado, linha = {}) => {
    const resolvida = resolverCubagemTracking({
      cubagemUnitaria: linha.cubagem_unitaria ?? linha.cubagemUnitaria,
      cubagemTotal: linha.cubagem_total ?? linha.cubagemTotal,
      pesoCubadoOriginal: linha.peso_cubado ?? linha.pesoCubado,
      volumes: linha.qtd_volumes ?? linha.volumes,
      quantidadeItens: linha.quantidade_itens ?? linha.quantidadeItens,
      pesoFisico: linha.peso ?? linha.pesoFisico,
      fatorCubagem,
    });

    return {
      cubagemAplicada: agregado.cubagemAplicada + resolvida.cubagemAplicada,
      cubagemTotalArmazenada: agregado.cubagemTotalArmazenada + resolvida.cubagemTotalArmazenada,
      pesoCubado: agregado.pesoCubado + resolvida.pesoCubado,
      pesoFisico: agregado.pesoFisico + numero(linha.peso ?? linha.pesoFisico),
      corrigiuMultiplicacao: agregado.corrigiuMultiplicacao || resolvida.totalFoiMultiplicadoPorVolumes,
      corrigiuTotalUnitario: agregado.corrigiuTotalUnitario || resolvida.totalPareceUnitarioMultiplicado,
    };
  }, {
    cubagemAplicada: 0,
    cubagemTotalArmazenada: 0,
    pesoCubado: 0,
    pesoFisico: 0,
    corrigiuMultiplicacao: false,
    corrigiuTotalUnitario: false,
  });
}
