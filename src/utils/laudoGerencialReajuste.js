// Independente dos KPIs antigos: realizado próprio e competição por tabela
// nunca compartilham denominadores nem usam o valor pago como preço concorrente.
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const campos = ['analisados', 'proprios', 'comparaveis', 'semCalculo', 'realizado', 'proposta', 'aumentos', 'reducoes', 'neutros', 'baseMercado', 'semComparacao', 'vitoriasAtual', 'vitoriasNova', 'empatesAtual', 'empatesNova', 'faturamentoAtual', 'faturamentoNova'];
const vazio = () => Object.fromEntries(campos.map(c => [c, 0]));
export const criarGerencialReajuste = () => ({ versao: 1, totais: vazio(), rotas: {} });
function posicao(preco, concorrente) {
  if (preco == null || concorrente == null) return 'semComparacao';
  const diferenca = Math.round(n(preco) * 100) - Math.round(n(concorrente) * 100);
  return diferenca < 0 ? 'vitoria' : diferenca === 0 ? 'empate' : 'perda';
}
export function acumularGerencialReajuste(estado, item) {
  const chave = JSON.stringify([norm(item.origem), norm(item.ufOrigem), norm(item.destino), norm(item.ufDestino)]);
  const rota = estado.rotas[chave] ||= { chave, origem: item.origem || '-', ufOrigem: item.ufOrigem || '-', destino: item.destino || '-', ufDestino: item.ufDestino || '-', ...vazio(), amostra: [] };
  const delta = vazio(); delta.analisados = 1;
  if (item.proprio) {
    delta.proprios = 1;
    if (n(item.proposta) > 0 && item.realizado != null && n(item.realizado) >= 0) {
      delta.comparaveis = 1; delta.realizado = n(item.realizado); delta.proposta = n(item.proposta);
      const diferenca = Math.round(n(item.proposta) * 100) - Math.round(n(item.realizado) * 100);
      delta[diferenca > 0 ? 'aumentos' : diferenca < 0 ? 'reducoes' : 'neutros'] = 1;
    } else delta.semCalculo = 1;
  }
  // Base pareada: vigente, proposta e pelo menos um concorrente calculados.
  // Ausências são explicitadas, não viram vitórias automáticas.
  if (item.compararConcorrentes && n(item.atual) > 0 && n(item.proposta) > 0 && n(item.concorrente) > 0) {
    delta.baseMercado = 1;
    const a = posicao(item.atual, item.concorrente), b = posicao(item.proposta, item.concorrente);
    if (a === 'vitoria') { delta.vitoriasAtual = 1; delta.faturamentoAtual = n(item.atual); }
    if (b === 'vitoria') { delta.vitoriasNova = 1; delta.faturamentoNova = n(item.proposta); }
    if (a === 'empate') delta.empatesAtual = 1;
    if (b === 'empate') delta.empatesNova = 1;
  } else delta.semComparacao = 1;
  for (const campo of campos) { rota[campo] += delta[campo]; estado.totais[campo] += delta[campo]; }
  if (rota.amostra.length < 20) rota.amostra.push({ cte: item.cte || '', chaveCte: item.chaveCte || '', proprio: Boolean(item.proprio), realizado: item.realizado ?? null, proposta: item.proposta ?? null, atual: item.atual ?? null, concorrente: item.concorrente ?? null });
  return estado;
}
export function consolidarGerenciaisReajuste(lista = []) {
  if (!lista.length || lista.some(x => x?.versao !== 1)) return null;
  const saida = criarGerencialReajuste();
  for (const item of lista) {
    for (const campo of campos) saida.totais[campo] += n(item.totais[campo]);
    for (const [chave, r] of Object.entries(item.rotas)) {
      const alvo = saida.rotas[chave] ||= { ...r, ...vazio(), amostra: [] };
      for (const campo of campos) alvo[campo] += n(r[campo]);
      alvo.amostra.push(...r.amostra.slice(0, 20 - alvo.amostra.length));
    }
  }
  return saida;
}
export function estadosGerenciais(gerencial) {
  const estados = new Map();
  for (const rota of Object.values(gerencial?.rotas || {})) {
    const uf = norm(rota.ufDestino) || '-';
    const estado = estados.get(uf) || { uf, ...vazio(), rotas: [] };
    for (const campo of campos) estado[campo] += n(rota[campo]);
    estado.rotas.push(rota); estados.set(uf, estado);
  }
  return [...estados.values()].sort((a,b) => b.realizado - a.realizado || a.uf.localeCompare(b.uf));
}
export const percentualGerencial = (valor, base) => base > 0 ? valor / base * 100 : null;
