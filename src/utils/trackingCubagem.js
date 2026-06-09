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
