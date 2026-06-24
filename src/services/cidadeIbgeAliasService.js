import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

// Vínculos cidade -> código IBGE. Resolve casos em que o nome da cidade no CT-e
// não bate com a lista oficial (ex.: "BRASILIA (DF)" vs "Brasília"). Espelha o
// padrão de vinculosTransportadoras: Supabase quando disponível, localStorage
// como fallback pra nunca quebrar a tela/enriquecimento.
const LOCAL_KEY = 'cidade-ibge-aliases';
const TABELA = 'cidade_ibge_aliases';

export function normalizarCidadeAlias(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dig7(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 7);
}

function getLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setLocal(lista = []) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(lista || []));
  } catch {
    // modo privado pode bloquear; segue só online.
  }
}

function normalizarAlias(item = {}) {
  const cidade = String(item.cidade || item.cidade_texto || '').trim();
  const uf = String(item.uf || '').trim().toUpperCase().slice(0, 2);
  const ibge = dig7(item.ibge || item.codigo_ibge);
  const cidadeNorm = String(item.cidade_norm || normalizarCidadeAlias(cidade));
  return {
    id: item.id || `${cidadeNorm}__${uf}`,
    cidade,
    uf,
    ibge,
    cidadeNorm,
    createdAt: item.created_at || item.createdAt || null,
    updatedAt: item.updated_at || item.updatedAt || null,
  };
}

export function carregarAliasesCidadeIbgeLocal() {
  return getLocal().map(normalizarAlias).filter((a) => a.cidadeNorm && a.ibge.length === 7);
}

export async function carregarAliasesCidadeIbge() {
  const locais = carregarAliasesCidadeIbgeLocal();
  if (!isSupabaseConfigured()) return locais;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABELA)
    .select('id, cidade, uf, ibge, cidade_norm, created_at, updated_at')
    .order('cidade', { ascending: true });

  if (error) {
    // Enquanto o SQL não foi rodado, não quebra nada: usa o local.
    console.warn('Aliases cidade->IBGE no Supabase indisponíveis; usando localStorage.', error.message || error);
    return locais;
  }

  const online = (data || []).map(normalizarAlias).filter((a) => a.cidadeNorm && a.ibge.length === 7);
  if (online.length) setLocal(online);
  return online.length ? online : locais;
}

export async function salvarAliasCidadeIbge(item, listaAtual = []) {
  const alias = normalizarAlias(item);
  if (!alias.cidade || alias.ibge.length !== 7) {
    throw new Error('Informe a cidade e um código IBGE de 7 dígitos.');
  }

  const semDuplicata = (listaAtual || []).filter((a) => normalizarAlias(a).id !== alias.id);
  const novaLista = [...semDuplicata, alias].sort((x, y) => x.cidade.localeCompare(y.cidade, 'pt-BR'));
  setLocal(novaLista);

  if (!isSupabaseConfigured()) {
    return { ok: true, modo: 'local', aliases: novaLista };
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(TABELA)
    .upsert({
      cidade: alias.cidade,
      uf: alias.uf,
      ibge: alias.ibge,
      cidade_norm: alias.cidadeNorm,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cidade_norm,uf' });

  if (error) {
    throw new Error(`Não consegui salvar no Supabase. Rode o SQL cidade_ibge_aliases_schema.sql. Detalhe: ${error.message}`);
  }

  return { ok: true, modo: 'supabase', aliases: novaLista };
}

export async function removerAliasCidadeIbge(id, listaAtual = []) {
  const alvo = String(id || '').trim();
  const item = (listaAtual || []).map(normalizarAlias).find((a) => a.id === alvo);
  const novaLista = (listaAtual || []).filter((a) => normalizarAlias(a).id !== alvo);
  setLocal(novaLista);

  if (isSupabaseConfigured() && item) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from(TABELA)
      .delete()
      .eq('cidade_norm', item.cidadeNorm)
      .eq('uf', item.uf);
    if (error) throw new Error(`Não consegui remover no Supabase. Detalhe: ${error.message}`);
  }

  return novaLista;
}

// Mapa para o resolvedor: chave por cidade e por cidade/uf -> ibge.
export function criarMapaAliasesCidadeIbge(aliases = []) {
  const mapa = new Map();
  (aliases || []).map(normalizarAlias).forEach((a) => {
    if (!a.cidadeNorm || a.ibge.length !== 7) return;
    mapa.set(a.cidadeNorm, a.ibge);
    if (a.uf) mapa.set(normalizarCidadeAlias(`${a.cidade}/${a.uf}`), a.ibge);
  });
  return mapa;
}
