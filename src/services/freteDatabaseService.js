import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const SNAPSHOT_CHAVE = 'cadastro-fretes-principal';
const FALLBACK_KEY = 'simulador-fretes-local-v6';

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      'Supabase não configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'
    );
  }
  return client;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function bancoConfigurado() {
  return isSupabaseConfigured();
}

export async function carregarSnapshotFretesDb(chave = SNAPSHOT_CHAVE) {
  if (!isSupabaseConfigured()) {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('cadastros_snapshot')
    .select('id, chave, payload, updated_at, created_at')
    .eq('chave', chave)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function salvarSnapshotFretesDb(transportadoras, chave = SNAPSHOT_CHAVE) {
  const payload = {
    chave,
    payload: {
      transportadoras: clone(transportadoras),
      updatedAt: new Date().toISOString(),
    },
  };

  if (!isSupabaseConfigured()) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(payload));
    return { updated_at: payload.payload.updatedAt, modo: 'local' };
  }

  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('cadastros_snapshot')
    .upsert(payload, { onConflict: 'chave' })
    .select('id, updated_at, created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function testarConexaoFretesDb() {
  if (!isSupabaseConfigured()) {
    return { ok: false, mensagem: 'Supabase não configurado.' };
  }

  const supabase = ensureClient();
  const { error } = await supabase
    .from('cadastros_snapshot')
    .select('id')
    .limit(1);

  if (error) throw error;
  return { ok: true, mensagem: 'Conexão com Supabase validada.' };
}

export async function listarImportacoesDb(limit = 20) {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('frete_importacoes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Aliases para compatibilidade com versões anteriores do projeto.
export async function salvarSnapshotBase(payload, metadata = {}) {
  const transportadoras = Array.isArray(payload) ? payload : payload?.transportadoras || [];
  return salvarSnapshotFretesDb(transportadoras, metadata.chave || SNAPSHOT_CHAVE);
}

export async function buscarUltimoSnapshot() {
  return carregarSnapshotFretesDb();
}

export async function registrarImportacao(payload) {
  if (!isSupabaseConfigured()) {
    return { ok: true, mode: 'local', payload };
  }

  const supabase = ensureClient();
  const row = {
    arquivo: payload.arquivo || 'arquivo',
    tipo: payload.tipo || 'desconhecido',
    canal: payload.canal || null,
    inseridos: Number(payload.inseridos || 0),
    erros: Array.isArray(payload.erros) ? payload.erros : [],
    meta: payload.meta || null,
  };

  const { data, error } = await supabase
    .from('frete_importacoes')
    .insert(row)
    .select('*')
    .single();

  if (error) throw error;
  return { ok: true, mode: 'remote', data };
}
