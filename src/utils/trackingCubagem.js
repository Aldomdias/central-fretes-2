function numero(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolverCubagemTracking({
  cubagemUnitaria = 0,
  cubagemTotal = 0,
  pesoCubadoOriginal = 0,
  volumes = 0,
  pesoFisico = 0,
  fatorCubagem = 300,
}) {
  const cubagemLinha = numero(cubagemUnitaria);
  const totalArmazenado = numero(cubagemTotal);
  const pesoCubadoFonte = numero(pesoCubadoOriginal);
  const qtdVolumes = numero(volumes);
  const peso = numero(pesoFisico);
  const fator = numero(fatorCubagem) || 300;

  // Regra do Tracking: quando cubagem_total vem preenchida, ela ja representa a
  // cubagem total da NF/linha. So multiplicamos cubagem_unitaria por volumes
  // quando o total nao veio no arquivo/base.
  const porVolume = qtdVolumes > 0 ? cubagemLinha * qtdVolumes : cubagemLinha;
  const cubagemCandidata = totalArmazenado > 0 ? totalArmazenado : porVolume;

  // Informativo: houve multiplicacao pelos volumes nesta linha.
  const totalPareceUnitarioMultiplicado =
    qtdVolumes > 1 &&
    cubagemLinha > 0 &&
    pesoCubadoFonte > 0 &&
    Math.abs(pesoCubadoFonte - cubagemLinha) < 0.000001 &&
    Math.abs(totalArmazenado - porVolume) < 0.000001;

  const cubagemCandidataFinal = totalPareceUnitarioMultiplicado ? pesoCubadoFonte : cubagemCandidata;
  const totalFoiMultiplicadoPorVolumes = !totalPareceUnitarioMultiplicado && qtdVolumes > 1 && cubagemLinha > 0 && porVolume >= totalArmazenado;

  const pesoCubado = cubagemCandidataFinal * fator;

  return {
    cubagemAplicada: cubagemCandidataFinal,
    cubagemOriginal: cubagemLinha,
    cubagemTotalArmazenada: totalArmazenado,
    totalFoiMultiplicadoPorVolumes,
    totalPareceUnitarioMultiplicado,
    pesoCubado,
    pesoConsiderado: Math.max(peso, pesoCubado),
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

export function criarTrackingAgregado(item = {}, origem = '') {
  const origemVinculo = origem || item.origem_vinculo_tracking || 'raw';
  const qtdVolumes = numero(item.qtd_volumes ?? item.volumes ?? item.volume ?? 0);
  const cubagemUnitaria = numero(item.cubagem_unitaria ?? 0);
  const cubagemTotalDireta = numero(item.cubagem_total ?? item.cubagem ?? 0);
  const cubagemResolvida = resolverCubagemTracking({
    cubagemUnitaria,
    cubagemTotal: cubagemTotalDireta,
    pesoCubadoOriginal: numero(item.peso_cubado ?? item.pesoCubado ?? 0),
    volumes: qtdVolumes,
    pesoFisico: numero(item.peso ?? item.peso_tracking ?? 0),
  });
  const cubagemTotal = cubagemResolvida.cubagemAplicada;

  return {
    ...item,
    origem_vinculo_tracking: origemVinculo,
    linhas_tracking: Number(item.linhas_tracking || 1),
    qtd_volumes: qtdVolumes,
    cubagem_unitaria: cubagemTotal,
    cubagem_total: cubagemTotal,
    cubagem_total_armazenada: cubagemTotalDireta,
    cubagem_corrigida: cubagemResolvida.totalFoiMultiplicadoPorVolumes,
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
    cubagem_unitaria: cubagemRepetida ? Math.max(numero(atual.cubagem_unitaria), numero(item.cubagem_unitaria)) : numero(atual.cubagem_unitaria) + numero(item.cubagem_unitaria),
    cubagem_total: cubagemRepetida ? Math.max(numero(atual.cubagem_total), numero(item.cubagem_total)) : numero(atual.cubagem_total) + numero(item.cubagem_total),
    cubagem_total_armazenada: cubagemRepetida ? Math.max(numero(atual.cubagem_total_armazenada), numero(item.cubagem_total_armazenada)) : numero(atual.cubagem_total_armazenada) + numero(item.cubagem_total_armazenada),
    cubagem_corrigida: Boolean(atual.cubagem_corrigida || item.cubagem_corrigida),
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
