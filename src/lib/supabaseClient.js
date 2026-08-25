import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let clientInstance = null;
export const SUPABASE_STATUS_EVENT = 'central-fretes:supabase-status';

function emitirStatusSupabase(status, detalhe = '') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SUPABASE_STATUS_EVENT, {
    detail: { status, detalhe, ocorridoEm: new Date().toISOString() },
  }));
}

function fetchMonitorado(input, init) {
  return fetch(input, init)
    .then((response) => {
      if ([502, 503, 504].includes(response.status)) {
        emitirStatusSupabase('reiniciando', `HTTP ${response.status}`);
      } else if (response.status < 500) {
        emitirStatusSupabase('online');
      }
      return response;
    })
    .catch((error) => {
      const mensagem = String(error?.message || error || 'Falha de rede');
      if (/failed to fetch|fetch failed|network|load failed|timeout/i.test(mensagem)) {
        emitirStatusSupabase('reiniciando', mensagem);
      }
      throw error;
    });
}

export async function verificarDisponibilidadeSupabase() {
  if (!isSupabaseConfigured()) return false;
  try {
    const response = await fetchMonitorado(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
      cache: 'no-store',
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

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
      global: { fetch: fetchMonitorado },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        experimental: { passkey: true },
      },
    });
  }

  return clientInstance;
}

export const supabase = getSupabaseClient();

export default supabase;
