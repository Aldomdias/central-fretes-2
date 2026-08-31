import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let clientInstance = null;
export const SUPABASE_STATUS_EVENT = 'central-fretes:supabase-status';
const JANELA_FALHAS_MS = 15000;
const FALHAS_PARA_INDISPONIVEL = 3;
let falhasRecentes = [];

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
        registrarFalhaSupabase(`HTTP ${response.status}`);
      } else if (response.status < 500) {
        falhasRecentes = [];
        emitirStatusSupabase('online');
      }
      return response;
    })
    .catch((error) => {
      const mensagem = String(error?.message || error || 'Falha de rede');
      if (/failed to fetch|fetch failed|network|load failed|timeout/i.test(mensagem)) {
        registrarFalhaSupabase(mensagem);
      }
      throw error;
    });
}

function registrarFalhaSupabase(detalhe) {
  const agora = Date.now();
  falhasRecentes = falhasRecentes.filter((instante) => agora - instante <= JANELA_FALHAS_MS);
  falhasRecentes.push(agora);
  // Um timeout de uma consulta pesada nao significa que o servidor caiu.
  if (falhasRecentes.length >= FALHAS_PARA_INDISPONIVEL) {
    emitirStatusSupabase('reiniciando', detalhe);
  }
}

export async function verificarDisponibilidadeSupabase() {
  if (!isSupabaseConfigured()) return false;
  try {
    // Nao usa o monitor aqui: a propria verificacao nao pode disparar outro ciclo.
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
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
