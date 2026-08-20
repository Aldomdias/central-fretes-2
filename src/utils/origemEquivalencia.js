// Exceções de origem: casos em que a transportadora emite o CT-e numa cidade
// diferente da origem cadastrada na tabela de frete (ex.: TAM tem tabela com
// origem Serra/ES, mas emite os CT-e como Vitória/ES). Sem isso o motor não
// acha a origem e o CT-e fica sem cálculo.
//
// Aqui fica só a lógica pura (normalização + mapa + teste de equivalência).
// A persistência (Supabase/localStorage) fica em
// services/origemEquivalenciaService.js, e a tela de cadastro em Ferramentas.

export function normalizarTextoOrigemEquiv(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s*[/\-]\s*[A-Z]{2}\s*$/, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

// Mesma normalização de nome de transportadora usada no motor da auditoria,
// pra "TAM Transportes LTDA" e "TAM" caírem na mesma chave.
export function normalizarTransportadoraOrigemEquiv(valor = '') {
  return normalizarTextoOrigemEquiv(valor)
    .replace(/\b(s\s*a|sa|s\/a|ltda|eireli|me|epp|eirelli)\b/g, ' ')
    .replace(/\b(logistica|transportes|transporte|cargas|carga)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dig7(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 7);
}

export function normalizarEquivalenciaOrigem(item = {}) {
  const transportadora = String(item.transportadora || item.transportadora_nome || '').trim();
  const origemTabela = String(item.origemTabela || item.origem_tabela || '').trim();
  const origemCte = String(item.origemCte || item.origem_cte || '').trim();
  const uf = String(item.uf || '').trim().toUpperCase().slice(0, 2);
  const ibgeCte = dig7(item.ibgeCte || item.ibge_cte);
  const ibgeTabela = dig7(item.ibgeTabela || item.ibge_tabela);
  const transportadoraNorm = normalizarTransportadoraOrigemEquiv(transportadora);
  const origemTabelaNorm = normalizarTextoOrigemEquiv(origemTabela);
  const origemCteNorm = normalizarTextoOrigemEquiv(origemCte);
  return {
    id: item.id || `${transportadoraNorm}__${origemTabelaNorm}__${origemCteNorm}`,
    transportadora,
    transportadoraNorm,
    origemTabela,
    origemTabelaNorm,
    origemCte,
    origemCteNorm,
    uf,
    ibgeCte,
    ibgeTabela,
    createdAt: item.created_at || item.createdAt || null,
    updatedAt: item.updated_at || item.updatedAt || null,
  };
}

export function equivalenciaOrigemValida(item = {}) {
  const e = normalizarEquivalenciaOrigem(item);
  return Boolean(e.transportadoraNorm && e.origemTabelaNorm && e.origemCteNorm);
}

// Mapa: transportadoraNorm -> origemTabelaNorm -> { cidades:Set, ibges:Set, ibgesTabela:Set }
export function criarMapaEquivalenciasOrigem(lista = []) {
  const mapa = new Map();
  (lista || []).map(normalizarEquivalenciaOrigem).forEach((e) => {
    if (!equivalenciaOrigemValida(e)) return;
    if (!mapa.has(e.transportadoraNorm)) mapa.set(e.transportadoraNorm, new Map());
    const porOrigem = mapa.get(e.transportadoraNorm);
    if (!porOrigem.has(e.origemTabelaNorm)) porOrigem.set(e.origemTabelaNorm, { cidades: new Set(), ibges: new Set(), ibgesTabela: new Set() });
    const alvo = porOrigem.get(e.origemTabelaNorm);
    alvo.cidades.add(e.origemCteNorm);
    if (e.ibgeCte.length === 7) alvo.ibges.add(e.ibgeCte);
    if (e.ibgeTabela.length === 7) alvo.ibgesTabela.add(e.ibgeTabela);
  });
  return mapa;
}

// IBGEs de origem da TABELA que atendem uma origem de CT-e, em qualquer
// transportadora. Serve pra busca de rotas por par origem-destino: sem isso, um
// CT-e de Vitória nunca acha as rotas da TAM cadastradas com origem Serra, e o
// sistema cai no plano B de carregar a tabela inteira da transportadora.
export function ibgesOrigemEquivalentes(mapa, cidadeCte, ibgeCte = '') {
  const saida = new Set();
  if (!mapa || !mapa.size) return saida;
  const cidade = normalizarTextoOrigemEquiv(cidadeCte);
  const ibge = dig7(ibgeCte);
  if (!cidade && !ibge) return saida;
  mapa.forEach((porOrigem) => {
    porOrigem.forEach((alvo) => {
      const bate = (cidade && alvo.cidades.has(cidade)) || (ibge && alvo.ibges.has(ibge));
      if (!bate) return;
      alvo.ibgesTabela.forEach((valor) => saida.add(valor));
    });
  });
  return saida;
}

// A origem `cidadeTabela` da transportadora aceita a origem `cidadeCte` do CT-e?
export function origemAceitaPorExcecao(mapa, transportadoraNome, cidadeTabela, cidadeCte, ibgeCte = '') {
  if (!mapa || !mapa.size) return false;
  const porOrigem = mapa.get(normalizarTransportadoraOrigemEquiv(transportadoraNome));
  if (!porOrigem) return false;
  const alvo = porOrigem.get(normalizarTextoOrigemEquiv(cidadeTabela));
  if (!alvo) return false;
  const cidade = normalizarTextoOrigemEquiv(cidadeCte);
  if (cidade && alvo.cidades.has(cidade)) return true;
  const ibge = dig7(ibgeCte);
  return Boolean(ibge && alvo.ibges.has(ibge));
}
