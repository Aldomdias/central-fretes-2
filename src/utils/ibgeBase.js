const FALLBACK_ORIGENS = [
  { cidade: "Itajai", uf: "SC", ibge: "4208203" },
  { cidade: "Curitiba", uf: "PR", ibge: "4106902" },
  { cidade: "Barueri", uf: "SP", ibge: "3505708" },
  { cidade: "Contagem", uf: "MG", ibge: "3118601" },
  { cidade: "Serra", uf: "ES", ibge: "3205002" },
];

function normalizarTexto(valor = "") {
  return String(valor || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function buscarOrigemFallback(nomeCidade = "") {
  const chave = normalizarTexto(nomeCidade);
  return FALLBACK_ORIGENS.find((item) => normalizarTexto(item.cidade) === chave) || null;
}

export async function buscarCidadeIbge({ supabase, nomeCidade }) {
  const fallback = buscarOrigemFallback(nomeCidade);
  if (!nomeCidade) return fallback;
  if (!supabase) return fallback;

  const termo = String(nomeCidade || "").trim();

  const { data, error } = await supabase
    .from("ibge_municipios")
    .select("nome_municipio, nome_municipio_sem_acento, codigo_municipio_completo, uf")
    .or(
      `nome_municipio.ilike.${termo},nome_municipio_sem_acento.ilike.${termo},nome_municipio.ilike.%${termo}%,nome_municipio_sem_acento.ilike.%${termo}%`
    )
    .limit(20);

  if (error || !data?.length) return fallback;

  const chave = normalizarTexto(termo);
  const exato =
    data.find((item) => normalizarTexto(item.nome_municipio) === chave) ||
    data.find((item) => normalizarTexto(item.nome_municipio_sem_acento) === chave) ||
    data[0];

  if (!exato) return fallback;

  return {
    cidade: exato.nome_municipio,
    uf: exato.uf,
    ibge: String(exato.codigo_municipio_completo || ""),
  };
}

export async function preencherOrigemAutomaticamente({
  supabase,
  nomeCidade,
  setDadosGerais,
}) {
  const resultado = await buscarCidadeIbge({ supabase, nomeCidade });

  setDadosGerais((prev) => ({
    ...prev,
    origemNome: nomeCidade,
    ufOrigem: resultado?.uf || "",
    ibgeOrigem: resultado?.ibge || "",
  }));

  return resultado;
}
