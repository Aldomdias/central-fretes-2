// Funções puras de vínculo de transportadora (sem Supabase), extraídas para
// permitir teste direto com Node — vinculosTransportadorasService.js depende de
// import.meta.env e não pode ser carregado fora do Vite.

export function normalizarChave(nome = '') {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function normalizarVinculo(item = {}) {
  const nomeCte = String(item.nomeCte || item.nome_cte || item.transportadora_cte || '').trim();
  const nomeTabela = String(item.nomeTabela || item.nome_tabela || item.transportadora_tabela || '').trim();
  return {
    id: item.id || `${normalizarChave(nomeCte)}__${normalizarChave(nomeTabela)}`,
    nomeCte,
    nomeTabela,
    nomeCteNormalizado: normalizarChave(nomeCte),
    nomeTabelaNormalizado: normalizarChave(nomeTabela),
    origem: item.origem || item.fonte || 'manual',
    createdAt: item.created_at || item.createdAt || null,
    updatedAt: item.updated_at || item.updatedAt || null,
  };
}

export function criarMapaVinculosTransportadoras(vinculos = []) {
  const mapa = new Map();
  (vinculos || []).forEach((item) => {
    const vinculo = normalizarVinculo(item);
    if (!vinculo.nomeCte || !vinculo.nomeTabela) return;
    mapa.set(vinculo.nomeCteNormalizado, vinculo.nomeTabela);
    mapa.set(String(vinculo.nomeCte || '').trim().toUpperCase(), vinculo.nomeTabela);
  });
  return mapa;
}

// Segue a cadeia de vínculos até estabilizar (ex.: "razão social" -> "nome curto" ->
// "nome da negociação"), em vez de aplicar só um salto. O guard de visitados evita
// loop infinito caso alguém cadastre um vínculo circular por engano.
export function aplicarVinculoTransportadora(nome, mapaVinculos) {
  let atual = String(nome || '').trim();
  if (!atual || !mapaVinculos) return atual;

  const visitados = new Set();
  for (let i = 0; i < 10; i += 1) {
    const chave = normalizarChave(atual);
    if (visitados.has(chave)) break;
    visitados.add(chave);

    const proximo = mapaVinculos.get(chave) || mapaVinculos.get(atual.toUpperCase());
    if (!proximo || proximo === atual) break;
    atual = proximo;
  }
  return atual;
}

export function normalizarNomeVinculo(nome = '') {
  return normalizarChave(nome);
}
