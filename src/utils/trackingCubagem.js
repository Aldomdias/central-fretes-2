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
