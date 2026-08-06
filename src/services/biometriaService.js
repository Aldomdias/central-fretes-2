import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export function biometriaDisponivelNesteDispositivo() {
  return Boolean(isSupabaseConfigured()
    && typeof window !== 'undefined'
    && window.isSecureContext
    && typeof window.PublicKeyCredential !== 'undefined'
    && navigator.credentials);
}

function clienteComPasskey() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase não configurado.');
  if (!biometriaDisponivelNesteDispositivo()) throw new Error('Este dispositivo ou navegador não oferece Windows Hello/digital.');
  if (!supabase.auth?.passkey || typeof supabase.auth.registerPasskey !== 'function') throw new Error('A versão atual do sistema não oferece suporte a passkeys.');
  return supabase;
}

export async function cadastrarBiometria() {
  const supabase = clienteComPasskey();
  const { data: sessao } = await supabase.auth.getSession();
  if (!sessao?.session?.user) throw new Error('Entre novamente com sua senha antes de cadastrar a digital.');
  const { data, error } = await supabase.auth.registerPasskey();
  if (error) throw error;
  return data;
}

export async function listarBiometrias() {
  const supabase = getSupabaseClient();
  if (!supabase?.auth?.passkey) return [];
  const { data: sessao } = await supabase.auth.getSession();
  if (!sessao?.session?.user) return [];
  const { data, error } = await supabase.auth.passkey.list();
  if (error) throw error;
  return Array.isArray(data) ? data : (data?.passkeys || []);
}

export async function excluirBiometria(passkeyId) {
  const supabase = clienteComPasskey();
  const { error } = await supabase.auth.passkey.delete({ passkeyId });
  if (error) throw error;
}

export async function sairSupabaseAuth() {
  const supabase = getSupabaseClient();
  if (supabase) await supabase.auth.signOut({ scope: 'local' });
}
