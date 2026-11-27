// Limites de carga da Auditoria. Varios usuarios auditam ao mesmo tempo e cada
// execucao dispara muitas consultas no Supabase; estes tetos mantem cada
// pedido pequeno e espacam os blocos para nao saturar o servidor.

export const AUDITORIA_MAX_FATURAS_LOTE = 10; // faturas selecionadas por recalculo em lote
export const AUDITORIA_MAX_CTES_EXECUCAO = 250; // CT-es por bloco/execucao (avulsos, lote, fatura)
export const AUDITORIA_MAX_FATURAS_BLOCO = 4; // faturas por bloco dentro do lote
export const AUDITORIA_PAUSA_ENTRE_BLOCOS_MS = 1200; // respiro entre blocos

export const pausaAuditoria = (ms = AUDITORIA_PAUSA_ENTRE_BLOCOS_MS) => new Promise((resolve) => setTimeout(resolve, ms));

// Processa chaves em blocos de ate AUDITORIA_MAX_CTES_EXECUCAO, em sequencia e
// com pausa entre blocos, juntando o resultado. `processar` e a funcao
// (chaves, onProgress, opcoes) => Promise<{registros, encontrados, naoEncontrados}>.
export async function processarEmBlocosLimitados(chaves = [], processar, onProgress, opcoes = {}) {
  const lista = [...chaves];
  if (lista.length <= AUDITORIA_MAX_CTES_EXECUCAO) {
    return processar(lista, onProgress, opcoes);
  }
  const total = { registros: [], encontrados: 0, naoEncontrados: 0 };
  for (let inicio = 0; inicio < lista.length; inicio += AUDITORIA_MAX_CTES_EXECUCAO) {
    if (opcoes?.deveCancelar?.()) break;
    if (inicio > 0) await pausaAuditoria();
    const resultado = await processar(
      lista.slice(inicio, inicio + AUDITORIA_MAX_CTES_EXECUCAO),
      (p) => onProgress?.({ ...p, bloco: Math.floor(inicio / AUDITORIA_MAX_CTES_EXECUCAO) + 1, totalBlocos: Math.ceil(lista.length / AUDITORIA_MAX_CTES_EXECUCAO) }),
      opcoes,
    );
    total.registros.push(...(resultado.registros || []));
    total.encontrados += resultado.encontrados || 0;
    total.naoEncontrados += resultado.naoEncontrados || 0;
  }
  return total;
}
