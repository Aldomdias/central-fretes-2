function round2(value) {
  return Number((value || 0).toFixed(2));
}

function formatarFaixa(peso) {
  if (peso <= 30) return 'Até 30 kg';
  if (peso <= 100) return '31 a 100 kg';
  if (peso <= 300) return '101 a 300 kg';
  if (peso <= 1000) return '301 a 1.000 kg';
  return 'Acima de 1.000 kg';
}

function montarDetalhamento({ destino, peso, valorNF, canal }) {
  const tipoCalculo = canal === 'B2C' || destino.preco <= 250 ? 'PERCENTUAL' : 'PESO';
  const faixa = formatarFaixa(peso);

  const percentualAplicado = tipoCalculo === 'PERCENTUAL'
    ? (canal === 'B2C' ? 2.15 : 1.8)
    : 0;

  const valorKg = tipoCalculo === 'PESO'
    ? (canal === 'ATACADO' ? 0.32 : 0.24)
    : 0;

  const freteTabela = round2(destino.preco);
  const fretePeso = round2(valorKg * peso);
  const fretePercentual = round2((valorNF * percentualAplicado) / 100);
  const freteBase = round2(freteTabela + fretePeso + fretePercentual);

  const grisPct = destino.ibge === '4200606' ? 0.45 : 0.3;
  const grisMinimo = 3.5;
  const gris = round2(Math.max((valorNF * grisPct) / 100, grisMinimo));
  const advPct = canal === 'ATACADO' ? 0.2 : 0.15;
  const adv = round2((valorNF * advPct) / 100);
  const pedagio = round2(peso > 100 ? Math.ceil(peso / 100) * 1.9 : 0);
  const tas = round2(canal === 'ATACADO' ? 4.5 : 2.5);
  const despacho = round2(destino.prazo >= 3 ? 6.5 : 0);
  const tda = round2(canal === 'ATACADO' ? 3.25 : 0);
  const tde = round2(destino.prazo <= 1 ? 2.1 : 0);
  const trt = round2(destino.cidade === 'Belo Horizonte' ? 8.9 : 0);
  const suframa = 0;
  const outras = 0;

  const totalTaxas = round2(gris + adv + pedagio + tas + despacho + tda + tde + trt + suframa + outras);
  const subtotal = round2(freteBase + totalTaxas);

  return {
    tipoCalculo,
    faixa,
    percentualAplicado,
    valorKg,
    freteTabela,
    fretePeso,
    fretePercentual,
    freteBase,
    subtotal,
    taxas: {
      grisPct,
      grisMinimo,
      gris,
      advPct,
      adv,
      pedagio,
      tas,
      despacho,
      tda,
      tde,
      trt,
      suframa,
      outras,
      totalTaxas,
    },
  };
}

function construirResultado({ transportadora, canal, origem, destino, peso, valorNF }) {
  const detalhes = montarDetalhamento({ destino, peso, valorNF, canal });
  const total = round2(detalhes.subtotal);

  return {
    transportadora,
    prazo: destino.prazo,
    descricao: `Origem ${origem} • Destino ${destino.cidade}`,
    origem,
    destino: destino.cidade,
    ibge: destino.ibge,
    canal,
    peso,
    valorNF,
    total,
    detalhes,
  };
}

function rankear(resultados) {
  const ordenados = [...resultados].sort((a, b) => a.total - b.total);
  const lider = ordenados[0]?.total ?? 0;
  const segundo = ordenados[1]?.total ?? lider;

  return ordenados.map((item, idx) => ({
    ...item,
    posicao: idx + 1,
    savingSegundo: idx === 0 ? Math.max(segundo - item.total, 0) : 0,
    diferencaLider: idx === 0 ? 0 : round2(item.total - lider),
    reducaoNecessariaPct: idx === 0 || item.total <= lider ? 0 : round2(((item.total - lider) / item.total) * 100),
  }));
}

export function simularSimples({ transportadoras, origem, canal, peso, valorNF, destinoCodigo, destinosBase }) {
  const destino = destinosBase.find(
    (item) => String(item.codigo) === String(destinoCodigo) || item.cidade.toLowerCase() === String(destinoCodigo).toLowerCase(),
  );

  const resultados = transportadoras
    .filter((t) => t.canais.includes(canal))
    .flatMap((t) =>
      t.destinos
        .filter((d) => d.origem === origem && String(d.ibge) === String(destino?.codigo || destinoCodigo))
        .map((d) =>
          construirResultado({
            transportadora: t.nome,
            canal,
            origem,
            destino: d,
            peso,
            valorNF,
          }),
        ),
    );

  return rankear(resultados);
}

export function simularPorTransportadora({ transportadoras, nomeTransportadora, canal, origem, destinoCodigos, peso, valorNF }) {
  const selecionada = transportadoras.find((item) => item.nome === nomeTransportadora);
  if (!selecionada || !selecionada.canais.includes(canal)) return [];

  let destinos = selecionada.destinos;
  if (origem) destinos = destinos.filter((d) => d.origem === origem);
  if (destinoCodigos?.length) destinos = destinos.filter((d) => destinoCodigos.includes(String(d.ibge)));

  const resultados = destinos.map((destino) => {
    const concorrentesDoMesmoCenario = transportadoras
      .filter((t) => t.canais.includes(canal))
      .flatMap((t) =>
        t.destinos
          .filter((d) => d.origem === destino.origem && String(d.ibge) === String(destino.ibge))
          .map((d) =>
            construirResultado({
              transportadora: t.nome,
              canal,
              origem: d.origem,
              destino: d,
              peso,
              valorNF,
            }),
          ),
      );

    const ranking = rankear(concorrentesDoMesmoCenario);
    return ranking.find((item) => item.transportadora === nomeTransportadora);
  }).filter(Boolean);

  return resultados.sort((a, b) => a.total - b.total);
}

export function analisarTransportadoraPorGrade({ transportadoras, nomeTransportadora, canal, grade }) {
  const selecionada = transportadoras.find((item) => item.nome === nomeTransportadora);
  if (!selecionada || !selecionada.canais.includes(canal)) {
    return { rotasAvaliadas: 0, vitorias: 0, aderencia: 0, saving: 0, detalhes: [] };
  }

  const detalhes = [];

  selecionada.destinos.forEach((destino) => {
    grade.forEach((linha) => {
      const ranking = transportadoras
        .filter((t) => t.canais.includes(canal))
        .flatMap((t) =>
          t.destinos
            .filter((d) => d.origem === destino.origem && String(d.ibge) === String(destino.ibge))
            .map((d) =>
              construirResultado({
                transportadora: t.nome,
                canal,
                origem: d.origem,
                destino: d,
                peso: linha.peso,
                valorNF: linha.valorNF,
              }),
            ),
        );

      const ordenado = rankear(ranking);
      const atual = ordenado.find((item) => item.transportadora === nomeTransportadora);
      const lider = ordenado[0];
      const segundo = ordenado[1];

      if (atual) {
        detalhes.push({
          origem: atual.origem,
          destino: atual.destino,
          ibge: atual.ibge,
          peso: linha.peso,
          valorNF: linha.valorNF,
          valorAtual: atual.total,
          melhorConcorrente: lider?.transportadora ?? atual.transportadora,
          segundoLugar: segundo?.transportadora ?? atual.transportadora,
          diferencaValor: atual.diferencaLider,
          reducaoPercentual: atual.reducaoNecessariaPct,
          posicao: atual.posicao,
          prazo: atual.prazo,
        });
      }
    });
  });

  const rotasAvaliadas = detalhes.length;
  const vitorias = detalhes.filter((item) => item.posicao === 1).length;
  const aderencia = rotasAvaliadas ? (vitorias / rotasAvaliadas) * 100 : 0;
  const saving = detalhes.filter((item) => item.posicao === 1).reduce((acc, item) => acc + (item.diferencaValor || 0), 0);

  return { rotasAvaliadas, vitorias, aderencia, saving, detalhes };
}

export function analisarCoberturaTabela({ transportadoras, ibges, canal, origem, transportadora }) {
  const base = transportadoras.filter((t) => t.canais.includes(canal) && (!transportadora || t.nome === transportadora));
  const origens = origem ? [origem] : [...new Set(base.flatMap((t) => t.origens))];
  const cobertos = new Set(
    base.flatMap((t) => t.destinos.filter((d) => !origem || d.origem === origem).map((d) => `${d.origem}-${d.ibge}`)),
  );

  const listaFaltantes = [];
  origens.forEach((orig) => {
    ibges.forEach((item) => {
      const key = `${orig}-${item.codigo}`;
      if (!cobertos.has(key)) listaFaltantes.push({ ...item, origem: orig });
    });
  });

  const total = origens.length * ibges.length;
  const faltantes = listaFaltantes.length;
  const cobertas = total - faltantes;
  const percentual = total ? (cobertas / total) * 100 : 0;

  return { total, cobertas, faltantes, percentual, listaFaltantes };
}
