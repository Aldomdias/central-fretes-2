import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient.js';
import {
  normalizarChave,
  normalizarVinculo,
  criarMapaVinculosTransportadoras,
  aplicarVinculoTransportadora,
  normalizarNomeVinculo,
} from './vinculosTransportadorasPuro.js';

export { criarMapaVinculosTransportadoras, aplicarVinculoTransportadora, normalizarNomeVinculo };

const LOCAL_KEY = 'vinculos-transportadoras';

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
