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
