export function analisarCoberturaOrigem(origem) {
  const rotas = Array.isArray(origem?.rotas) ? origem.rotas : [];
  const cotacoes = Array.isArray(origem?.cotacoes) ? origem.cotacoes : [];

  const normalizar = (valor) =>
    String(valor || "")
      .trim()
      .toUpperCase();

  const chavesRotas = new Set(
    rotas
      .map((item) => normalizar(item?.cotacao || item?.nomeRota || item?.rota))
      .filter(Boolean)
  );

  const chavesCotacoes = new Set(
    cotacoes
      .map((item) => normalizar(item?.rota || item?.nomeRota || item?.cotacao))
      .filter(Boolean)
  );

  const rotasSemFrete = [...chavesRotas].filter((chave) => !chavesCotacoes.has(chave));
  const fretesSemRota = [...chavesCotacoes].filter((chave) => !chavesRotas.has(chave));

  const totalRotas = rotas.length;
  const totalCotacoes = cotacoes.length;

  let status = "sem_tabela";
  let label = "Sem tabela";

  if (totalRotas === 0 && totalCotacoes === 0) {
    status = "sem_tabela";
    label = "Sem tabela";
  } else if (totalRotas === 0 || totalCotacoes === 0) {
    status = "parcial";
    label = "Parcial";
  } else if (rotasSemFrete.length > 0 || fretesSemRota.length > 0) {
    status = "inconsistente";
    label = "Inconsistente";
  } else {
    status = "completa";
    label = "Completa";
  }

  return {
    status,
    label,
    totalRotas,
    totalCotacoes,
    rotasSemFrete,
    fretesSemRota,
    possuiProblema: status === "inconsistente" || status === "parcial",
  };
}
