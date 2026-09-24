// O default da coluna updated_at so roda no INSERT. Todo resultado recalculado
// precisa renovar a data explicitamente para a fatura preferir este registro
// quando a mesma chave existir em mais de uma competencia/reprocessamento.
export function marcarResultadoRecalculado(linha = {}, agora = new Date()) {
  return { ...linha, updated_at: agora.toISOString() };
}
