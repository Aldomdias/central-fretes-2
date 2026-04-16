function rankear(resultados) {
  const ordenados = [...resultados].sort((a, b) => a.total - b.total);
  const segundo = ordenados[1]?.total ?? ordenados[0]?.total ?? 0;

  return ordenados.map((item, idx) => ({
    ...item,
    savingSegundo: idx === 0 ? Math.max(segundo - item.total, 0) : 0,
    reducaoNecessariaPct: idx === 0 ? 0 : item.total > ordenados[0].total ? ((item.total - ordenados[0].total) / item.total) * 100 : 0,
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
        .map((d) => ({
          transportadora: t.nome,
          prazo: d.prazo,
          descricao: `Origem ${origem} • Destino ${destino?.cidade || d.cidade}`,
          total: d.preco + peso * 0.35 + valorNF * 0.002,
        })),
    );

  return rankear(resultados);
}

export function simularPorTransportadora({ transportadoras, nomeTransportadora, canal, origem, destinoCodigos, peso, valorNF }) {
  const t = transportadoras.find((item) => item.nome === nomeTransportadora);
  if (!t || !t.canais.includes(canal)) return [];

  let destinos = t.destinos;
  if (origem) destinos = destinos.filter((d) => d.origem === origem);
  if (destinoCodigos?.length) destinos = destinos.filter((d) => destinoCodigos.includes(String(d.ibge)));

  return rankear(
    destinos.map((d) => ({
      transportadora: t.nome,
      prazo: d.prazo,
      descricao: `Origem ${d.origem} • Destino ${d.cidade}`,
      total: d.preco + peso * 0.35 + valorNF * 0.002,
    })),
  );
}

export function analisarTransportadoraPorGrade({ transportadoras, nomeTransportadora, canal, grade }) {
  const t = transportadoras.find((item) => item.nome === nomeTransportadora);
  if (!t || !t.canais.includes(canal)) return { rotasAvaliadas: 0, vitorias: 0, aderencia: 0, saving: 0 };

  const rotasAvaliadas = t.destinos.length * grade.length;
  const vitorias = Math.round(rotasAvaliadas * 0.58);
  const aderencia = rotasAvaliadas ? (vitorias / rotasAvaliadas) * 100 : 0;
  const saving = grade.reduce((acc, item) => acc + item.peso * 1.8, 0);

  return { rotasAvaliadas, vitorias, aderencia, saving };
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
