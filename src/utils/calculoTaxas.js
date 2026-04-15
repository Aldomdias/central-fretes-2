export function resolverTaxasTabela(generalidades, taxaDestino) {
  return {
    adValoremPercentualFinal:
      taxaDestino?.adValoremPercentual ??
      generalidades?.adValoremPercentual ??
      0,
    adValoremMinimoFinal:
      taxaDestino?.adValoremMinimo ?? generalidades?.adValoremMinimo ?? 0,
    grisPercentualFinal:
      taxaDestino?.grisPercentual ?? generalidades?.grisPercentual ?? 0,
    grisMinimoFinal: taxaDestino?.grisMinimo ?? generalidades?.grisMinimo ?? 0,
    tdaFinal: taxaDestino?.tda ?? 0,
    trtFinal: taxaDestino?.trt ?? 0,
    suframaFinal: taxaDestino?.suframa ?? 0,
    outrasTaxasFinal: taxaDestino?.outrasTaxas ?? 0,
  };
}
