import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const LOCAL_KEY = 'vinculos-transportadoras';

function normalizarChave(nome = '') {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function getLocalVinculos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setLocalVinculos(lista = []) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(lista || []));
  } catch {
    // localStorage pode falhar em modo privado; mantém operação online.
  }
}

function normalizarVinculo(item = {}) {
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

export function carregarVinculosTransportadorasLocal() {
  return getLocalVinculos().map(normalizarVinculo).filter((item) => item.nomeCte && item.nomeTabela);
}

export async function carregarVinculosTransportadoras() {
  const locais = carregarVinculosTransportadorasLocal();

  if (!isSupabaseConfigured()) return locais;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('transportadora_vinculos')
    .select('id, nome_cte, nome_tabela, nome_cte_normalizado, nome_tabela_normalizado, origem, created_at, updated_at')
    .order('nome_cte', { ascending: true });

  if (error) {
    // Enquanto o SQL não foi rodado, não quebra a ferramenta/simulador.
    console.warn('Vínculos no Supabase indisponíveis; usando localStorage.', error.message || error);
    return locais;
  }

  const online = (data || [])
    .map(normalizarVinculo)
    .filter((item) => item.nomeCte && item.nomeTabela);

  if (online.length) setLocalVinculos(online);
  return online.length ? online : locais;
}

export async function salvarVinculosTransportadoras(lista = []) {
  const normalizados = (lista || [])
    .map(normalizarVinculo)
    .filter((item) => item.nomeCte && item.nomeTabela);

  const dedup = [];
  const chaves = new Set();
  normalizados.forEach((item) => {
    const chave = item.nomeCteNormalizado;
    if (!chave || chaves.has(chave)) return;
    chaves.add(chave);
    dedup.push(item);
  });

  setLocalVinculos(dedup);

  if (!isSupabaseConfigured()) {
    return { ok: true, modo: 'local', total: dedup.length, vinculos: dedup };
  }

  const supabase = getSupabaseClient();
  const payload = dedup.map((item) => ({
    nome_cte: item.nomeCte,
    nome_tabela: item.nomeTabela,
    nome_cte_normalizado: item.nomeCteNormalizado,
    nome_tabela_normalizado: item.nomeTabelaNormalizado,
    origem: item.origem || 'manual',
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('transportadora_vinculos')
    .upsert(payload, { onConflict: 'nome_cte_normalizado' });

  if (error) {
    throw new Error(`Não consegui salvar vínculos no Supabase. Rode o SQL transportadora_vinculos_schema.sql. Detalhe: ${error.message}`);
  }

  return { ok: true, modo: 'supabase', total: dedup.length, vinculos: dedup };
}

export async function removerVinculoTransportadora(idOuNomeCte, listaAtual = []) {
  const alvo = String(idOuNomeCte || '').trim();
  const item = (listaAtual || []).find((v) => String(v.id) === alvo || normalizarChave(v.nomeCte) === normalizarChave(alvo));
  const novaLista = (listaAtual || []).filter((v) => String(v.id) !== alvo && normalizarChave(v.nomeCte) !== normalizarChave(alvo));
  setLocalVinculos(novaLista);

  if (isSupabaseConfigured() && item?.nomeCte) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('transportadora_vinculos')
      .delete()
      .eq('nome_cte_normalizado', normalizarChave(item.nomeCte));
    if (error) throw new Error(`Não consegui remover vínculo no Supabase. Detalhe: ${error.message}`);
  }

  return novaLista;
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

export function aplicarVinculoTransportadora(nome, mapaVinculos) {
  const raw = String(nome || '').trim();
  if (!raw || !mapaVinculos) return raw;
  return mapaVinculos.get(normalizarChave(raw)) || mapaVinculos.get(raw.toUpperCase()) || raw;
}

export function normalizarNomeVinculo(nome = '') {
  return normalizarChave(nome);
}
