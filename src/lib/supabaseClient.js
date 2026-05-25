import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let clientInstance = null;

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabaseInfo() {
  let host = '';
  try {
    host = supabaseUrl ? new URL(supabaseUrl).host : '';
  } catch {
    host = String(supabaseUrl || '').replace(/^https?:\/\//, '').split('/')[0];
  }

  return {
    configured: isSupabaseConfigured(),
    url: supabaseUrl || '',
    host,
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
    anonKeyPrefix: supabaseAnonKey ? `${String(supabaseAnonKey).slice(0, 8)}...` : '',
  };
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!clientInstance) {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return clientInstance;
}

export const supabase = getSupabaseClient();

export default supabase;
