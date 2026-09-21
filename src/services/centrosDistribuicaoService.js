import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'centros_distribuicao';

export async function listarCentrosDistribuicao() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient().from(TABELA).select('centro,cidade');
  if (error) throw new Error(`Não foi possível carregar os centros de distribuição: ${error.message}`);
  return data || [];
}

// Mapa centro -> cidade (chave em maiúsculas, já que a planilha de estoque traz o código do centro como coluna).
export async function mapaCentroParaCidade() {
  const lista = await listarCentrosDistribuicao();
  const mapa = new Map();
  lista.forEach((item) => mapa.set(String(item.centro).trim().toUpperCase(), item.cidade));
  return mapa;
}
