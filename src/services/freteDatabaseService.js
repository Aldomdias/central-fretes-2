import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const SNAPSHOT_CHAVE = 'cadastro-fretes-principal';

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase não configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }
  return client;
}

export function bancoConfigurado() {
  return isSupabaseConfigured();
}

export async function carregarSnapshotFretesDb(chave = SNAPSHOT_CHAVE) {
  if (!isSupabaseConfigured()) return null;

  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('cadastros_snapshot')
    .select('payload, updated_at')
    .eq('chave', chave)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function salvarSnapshotFretesDb(transportadoras, chave = SNAPSHOT_CHAVE) {
  const supabase = ensureClient();
  const payload = {
    chave,
    payload: {
      transportadoras,
      updatedAt: new Date().toISOString(),
    },
  };

  const { data, error } = await supabase
    .from('cadastros_snapshot')
    .upsert(payload, { onConflict: 'chave' })
    .select('id, updated_at')
    .single();

  if (error) throw error;
  return data;
}

export async function testarConexaoFretesDb() {
  if (!isSupabaseConfigured()) {
    return { ok: false, mensagem: 'Supabase não configurado.' };
  }

  const supabase = ensureClient();
  const { error } = await supabase.from('cadastros_snapshot').select('id').limit(1);
  if (error) throw error;
  return { ok: true, mensagem: 'Conexão com Supabase validada.' };
}
