import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase não configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }
  return client;
}

export async function listarTransportadorasDb() {
  if (!isSupabaseConfigured()) return [];
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('transportadoras')
    .select('id, nome, status, created_at, updated_at')
    .order('nome');

  if (error) throw error;
  return data || [];
}

export async function criarImportacaoDb(payload) {
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('importacoes')
    .insert(payload)
    .select('id')
    .single();

  if (error) throw error;
  return data;
}

export async function salvarArquivoImportadoDb(payload) {
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('arquivos_importados')
    .insert(payload)
    .select('id')
    .single();

  if (error) throw error;
  return data;
}

export async function salvarRealizadoLoteDb(registros = []) {
  if (!registros.length) return { inseridos: 0 };
  const supabase = ensureClient();
  const { error } = await supabase.from('realizado_cargas').insert(registros);
  if (error) throw error;
  return { inseridos: registros.length };
}

export async function salvarSimulacaoResumoDb(payload) {
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('simulacoes')
    .insert(payload)
    .select('id')
    .single();

  if (error) throw error;
  return data;
}

export async function salvarSimulacaoItensDb(itens = []) {
  if (!itens.length) return { inseridos: 0 };
  const supabase = ensureClient();
  const { error } = await supabase.from('simulacao_itens').insert(itens);
  if (error) throw error;
  return { inseridos: itens.length };
}
