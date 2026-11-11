import { lancamentoDaFatura, resumirLancamentosFatura } from './robos/historicoLancamentos.js';

// Linha de fatura que e NFS-e (nota fiscal de servico municipal), nao CT-e: serie de NFS-e (SPN, CWN, RJN... ou OS)
// e sem chave de 44 digitos. Nunca vai estar na base de CT-es, entao o robo nao audita: vai para conferencia manual.
export function ehLinhaNfse(item = {}) {
  if (String(item.chave_cte || '').replace(/\D/g, '').length === 44) return false;
  const serie = String(item.serie_cte || '').trim().toUpperCase();
  return /^[A-Z]{2}N$/.test(serie) || serie === 'OS';
}

// Diferenca aceita entre a soma das notas lancadas e o valor da fatura (arredondamento).
export const TOLERANCIA_NFSE_LANCADA = 0.05;

const brl = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

// Fatura de NFS-e lancada pelo robo de lancamento: fechou quando as notas com MIRO sao pelo menos as NFS-e da
// fatura (qtdNfse; 0 = fatura sem documentos vinculados, basta 1) e a soma bate com o valor da fatura.
// registros = linhas de robos_lancamentos (filtra as desta fatura aqui).
export function conferirNfseLancada(fatura = {}, qtdNfse = 0, registros = []) {
  const resumo = resumirLancamentosFatura((registros || []).filter((r) => lancamentoDaFatura(r, fatura)));
  const comMiro = resumo.registros.filter((r) => r.miro);
  const valor = Math.round(comMiro.reduce((s, r) => s + (Number(r.valor) || 0), 0) * 100) / 100;
  const esperadas = Math.max(Number(qtdNfse || 0), 1);
  const diferenca = Math.round((Number(fatura.valor_fatura || 0) - valor) * 100) / 100;
  const quantidadeOk = comMiro.length >= esperadas;
  const valorOk = Math.abs(diferenca) <= TOLERANCIA_NFSE_LANCADA;
  const fechou = quantidadeOk && valorOk;
  let texto;
  if (!comMiro.length) texto = resumo.total ? `NFS-e com pedido, falta a MIRO (${resumo.total} nota(s)).` : 'NFS-e ainda nao lancada no robo de Lancamento NFS-e.';
  else if (!quantidadeOk) texto = `NFS-e lancadas: ${comMiro.length} de ${esperadas} com MIRO (${brl(valor)}).`;
  else if (!valorOk) texto = `NFS-e lancadas (${comMiro.length}), mas a soma ${brl(valor)} nao bate com a fatura ${brl(fatura.valor_fatura)} (diferenca ${brl(diferenca)}).`;
  else texto = `NFS-e lancadas: ${comMiro.length} nota(s) com MIRO, soma ${brl(valor)} = valor da fatura.`;
  return { fechou, lancadas: comMiro.length, comPedido: resumo.total, esperadas, valor, diferenca, texto, registros: resumo.registros };
}
