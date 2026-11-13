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

// Expande o termo digitado na busca de transportadora para os nomes originais
// do CT-e cujo vínculo leva a um nome que contém o termo. Ex.: digitar
// "MOVIMENTE" também busca "MVT CAMPINAS ..." quando há vínculo MVT -> MOVIMENTE.
// O próprio termo vem sempre primeiro. Termos que já contêm outro termo da lista
// são descartados, pois a busca no banco é por "contém" e o menor já os cobre.
export function expandirTermosBuscaTransportadora(termo, mapaVinculos, aplicarVinculo = aplicarVinculoTransportadora) {
  const original = String(termo || '').trim();
  if (!original) return [];
  const termoNormalizado = normalizarChave(original);
  if (!termoNormalizado || !mapaVinculos || !mapaVinculos.size) return [original];

  const candidatos = new Set();
  mapaVinculos.forEach((_destino, nomeCte) => {
    const nome = String(nomeCte || '').trim().toUpperCase();
    if (!nome) return;
    const final = aplicarVinculo(nome, mapaVinculos);
    if (normalizarChave(final).includes(termoNormalizado)) candidatos.add(nome);
  });

  const termos = [original.toUpperCase()];
  [...candidatos]
    .sort((a, b) => a.length - b.length)
    .forEach((nome) => {
      if (!termos.some((t) => nome.includes(t))) termos.push(nome);
    });
  termos[0] = original;
  return termos;
}
