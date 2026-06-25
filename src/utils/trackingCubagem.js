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

  // Regra (validada com notas reais): a cubagem do tracking e POR VOLUME, entao
  // a cubagem da linha = unitaria x volumes. Ex.: 0,048/volume x 4 = 0,192 (= a
  // NUMERACAO da NF). Quando o tracking ja traz um total agregado MAIOR que
  // unitaria x volumes, respeita o maior (piso de seguranca). Volumes<=1 mantem
  // a unitaria. Valores absurdos sao barrados depois por validarCubagemTracking.
  const porVolume = qtdVolumes > 0 ? cubagemLinha * qtdVolumes : cubagemLinha;
  const cubagemCandidata = Math.max(porVolume, totalArmazenado);

  // Informativo: houve multiplicacao pelos volumes nesta linha.
  const totalFoiMultiplicadoPorVolumes = qtdVolumes > 1 && cubagemLinha > 0 && porVolume >= totalArmazenado;

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
