import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'ctes_competencias_resumo';

function ensureSupabase() {
  const client = getSupabaseClient();
  if (!client || !isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }
  return client;
}

function detalheErro(error) {
  const msg = error?.message || String(error || 'Erro desconhecido no Supabase.');
  if (msg.toLowerCase().includes('permission denied') || error?.code === '42501') {
    return `${msg}. Reexecute o script supabase/ctes_competencias_resumo.sql no SQL Editor para aplicar os GRANTs e policies da tabela.`;
  }
  if (msg.includes(TABELA) || msg.includes('relation') || msg.includes('does not exist') || error?.code === '42P01') {
    return `${msg}. Rode o script supabase/ctes_competencias_resumo.sql no SQL Editor do Supabase antes de usar o comparativo mensal.`;
  }
  return msg;
}

export async function listarCompetenciasCtesResumo() {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from(TABELA)
    .select('*')
    .order('competencia', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(detalheErro(error));
  return data || [];
}

export async function buscarCompetenciaCtesResumoExistente({ competencia, filtrosHash }) {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from(TABELA)
    .select('*')
    .eq('competencia', competencia)
    .eq('filtros_hash', filtrosHash)
    .maybeSingle();

  if (error) throw new Error(detalheErro(error));
  return data || null;
}

export async function salvarCompetenciaCtesResumo(payload, { substituir = false } = {}) {
  const supabase = ensureSupabase();
  const row = {
    ...payload,
    updated_at: new Date().toISOString(),
  };

  const query = substituir
    ? supabase.from(TABELA).upsert(row, { onConflict: 'competencia,filtros_hash' })
    : supabase.from(TABELA).insert(row);

  const { data, error } = await query.select('*').single();
  if (error) throw new Error(detalheErro(error));
  return data;
}
