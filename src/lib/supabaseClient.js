import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let clientInstance = null;
let wrappedClientInstance = null;

function mapRealizadoLocalColumn(column) {
  const key = String(column || '');
  const columnMap = {
    data_emissao: 'emissao',
    created_at: 'criado_em',
  };
  return columnMap[key] || key;
}

function wrapRealizadoLocalBuilder(builder) {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;

      if (['then', 'catch', 'finally'].includes(String(prop))) {
        return value.bind(target);
      }

      return (...args) => {
        const method = String(prop);
        const shouldMapColumn = ['order', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not', 'in'].includes(method);
        const mappedArgs = shouldMapColumn ? [mapRealizadoLocalColumn(args[0]), ...args.slice(1)] : args;
        const result = value.apply(target, mappedArgs);
        if (result && typeof result === 'object') return wrapRealizadoLocalBuilder(result);
        return result;
      };
    },
  });
}

function wrapSupabaseClient(client) {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== 'from') return Reflect.get(target, prop, receiver);

      return (table, ...args) => {
        const tableName = String(table || '');
        if (tableName === 'realizado_local_ctes') {
          return wrapRealizadoLocalBuilder(target.from('realizado_ctes', ...args));
        }
        return target.from(table, ...args);
      };
    },
  });
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
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    wrappedClientInstance = wrapSupabaseClient(clientInstance);
  }

  return wrappedClientInstance;
}

export const supabase = getSupabaseClient();

export default supabase;
