// Arquivo de apoio para padronização automática da cotação
// Regra: Origem - UF destino - Cotação base
// Exemplo: Itajaí - AL - Interior 1

export function limparTexto(valor = "") {
  return String(valor || "").trim().replace(/\s+/g, " ");
}

export function normalizarChave(valor = "") {
  return limparTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function obterUfDoDestino(ibgeDestino, baseIbge = []) {
  if (!ibgeDestino) return "";
  const chave = String(ibgeDestino).replace(/\D/g, "");
  const item = baseIbge.find((registro) => {
    const codigo =
      String(
        registro?.codigo_municipio_completo ??
        registro?.codigoMunicipioCompleto ??
        registro?.codigo_municipio ??
        registro?.municipio_ibge ??
        registro?.ibge ??
        registro?.codigo ??
        ""
      ).replace(/\D/g, "");
    return codigo === chave;
  });

  return limparTexto(
    item?.uf ??
    item?.sigla_uf ??
    item?.UF ??
    item?.SiglaUF ??
    ""
  ).toUpperCase();
}

export function montarCotacaoPadrao({ origem, ufDestino, cotacaoBase }) {
  const origemLimpa = limparTexto(origem);
  const ufLimpa = limparTexto(ufDestino).toUpperCase();
  const cotacaoLimpa = limparTexto(cotacaoBase);

  return [origemLimpa, ufLimpa, cotacaoLimpa].filter(Boolean).join(" - ");
}

export function montarCotacaoDaRota(rota = {}, dadosGerais = {}, baseIbge = []) {
  const origem =
    dadosGerais?.origemNome ||
    dadosGerais?.origem ||
    dadosGerais?.cidadeOrigem ||
    dadosGerais?.codigoUnidadeOrigem ||
    "";

  const ufDestino = obterUfDoDestino(
    rota?.ibgeDestino ?? rota?.ibge_destino,
    baseIbge
  );

  const cotacaoBase =
    rota?.cotacaoBase ??
    rota?.cotacao_base ??
    rota?.cotacao ??
    "";

  return montarCotacaoPadrao({
    origem,
    ufDestino,
    cotacaoBase
  });
}

export function aplicarCotacaoPadraoNasRotas(rotas = [], dadosGerais = {}, baseIbge = []) {
  return (rotas || []).map((rota) => {
    const cotacaoFinal = montarCotacaoDaRota(rota, dadosGerais, baseIbge);
    return {
      ...rota,
      cotacaoBase:
        rota?.cotacaoBase ??
        rota?.cotacao_base ??
        rota?.cotacao ??
        "",
      cotacao: cotacaoFinal,
      cotacaoFinal
    };
  });
}

export function obterCotacoesUnicasDasRotas(rotas = [], dadosGerais = {}, baseIbge = []) {
  const rotasPadronizadas = aplicarCotacaoPadraoNasRotas(rotas, dadosGerais, baseIbge);

  const mapa = new Map();
  for (const rota of rotasPadronizadas) {
    const chave = normalizarChave(rota.cotacaoFinal || rota.cotacao);
    if (!chave || mapa.has(chave)) continue;
    mapa.set(chave, rota.cotacaoFinal || rota.cotacao);
  }

  return Array.from(mapa.values());
}
