export function limparTexto(valor) {
  return String(valor ?? "").trim();
}

export function montarCotacaoFinal({ origem, ufDestino, cotacaoBase }) {
  return [limparTexto(origem), limparTexto(ufDestino).toUpperCase(), limparTexto(cotacaoBase).toUpperCase()]
    .filter(Boolean)
    .join(" - ");
}

export function sincronizarCotacoesRotas(rotas = []) {
  return (rotas || []).map((rota) => {
    const cotacaoBase =
      rota?.cotacaoBase ??
      rota?.cotacao_base ??
      rota?.regiao ??
      rota?.região ??
      rota?.cotacao ??
      "";

    const origem =
      rota?.origem ??
      rota?.cidadeOrigem ??
      rota?.cidade_origem ??
      "";

    const ufDestino =
      rota?.ufDestino ??
      rota?.uf_destino ??
      "";

    const cotacaoFinal = montarCotacaoFinal({
      origem,
      ufDestino,
      cotacaoBase,
    });

    return {
      ...rota,
      cotacaoBase,
      cotacao: cotacaoFinal,
      cotacaoFinal,
    };
  });
}

export function criarEstadoLimpoFormatacao() {
  return {
    rotas: [],
    quebrasFaixa: [],
    fretes: [],
    etapaAtual: 1,
    modoEntrada: "escolha",
    importandoTemplate: false,
  };
}
