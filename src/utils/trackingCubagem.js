function numero(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolverCubagemTracking({
  cubagemUnitaria = 0,
  cubagemTotal = 0,
  volumes = 0,
  pesoFisico = 0,
  fatorCubagem = 300,
}) {
  const cubagemLinha = numero(cubagemUnitaria);
  const totalArmazenado = numero(cubagemTotal);
  const qtdVolumes = numero(volumes);
  const peso = numero(pesoFisico);
  const fator = numero(fatorCubagem) || 300;

  const totalFoiMultiplicadoPorVolumes =
    qtdVolumes > 1 &&
    cubagemLinha > 0 &&
    Math.abs(totalArmazenado - (cubagemLinha * qtdVolumes)) < 0.01;

  const cubagemCandidata = totalFoiMultiplicadoPorVolumes
    ? cubagemLinha
    : totalArmazenado || cubagemLinha;

  const pesoCubado = cubagemCandidata * fator;

  return {
    cubagemAplicada: cubagemCandidata,
    cubagemOriginal: cubagemLinha,
    cubagemTotalArmazenada: totalArmazenado,
    totalFoiMultiplicadoPorVolumes,
    pesoCubado,
    pesoConsiderado: Math.max(peso, pesoCubado),
  };
}

export function agregarCubagemLinhasTracking(linhas = [], fatorCubagem = 300) {
  return linhas.reduce((agregado, linha = {}) => {
    const resolvida = resolverCubagemTracking({
      cubagemUnitaria: linha.cubagem_unitaria ?? linha.cubagemUnitaria,
      cubagemTotal: linha.cubagem_total ?? linha.cubagemTotal,
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
    };
  }, {
    cubagemAplicada: 0,
    cubagemTotalArmazenada: 0,
    pesoCubado: 0,
    pesoFisico: 0,
    corrigiuMultiplicacao: false,
  });
}
