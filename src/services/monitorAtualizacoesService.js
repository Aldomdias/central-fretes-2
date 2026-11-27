import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TIPOS = ['faturas-verum', 'sap-pagamentos', 'doccob', 'ctes', 'tracking'];

function comTimeout(promessa, ms = 8000) {
  return Promise.race([
    promessa,
    new Promise((resolve) => window.setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), ms)),
  ]);
}

function lerLocal() {
  try { return JSON.parse(window.localStorage.getItem('amd_importacoes_registro_v1') || '[]'); } catch { return []; }
}

export async function carregarMonitorAtualizacoes() {
  const porTipo = Object.fromEntries(TIPOS.map((tipo) => [tipo, null]));
  let registros = lerLocal();

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await comTimeout(
        getSupabaseClient()
          .from('importacoes_registro')
          .select('tipo,status,resumo,usuario,criado_em')
          .in('tipo', TIPOS)
          .order('criado_em', { ascending: false })
          .limit(100)
      );
      if (!error && Array.isArray(data)) registros = [...data, ...registros];
    } catch {
      // O monitor e informativo: indisponibilidade da tabela nao bloqueia a home.
    }
  }

  registros
    .sort((a, b) => String(b?.criado_em || '').localeCompare(String(a?.criado_em || '')))
    .forEach((registro) => {
      if (Object.hasOwn(porTipo, registro?.tipo) && !porTipo[registro.tipo] && registro.status === 'OK') {
        porTipo[registro.tipo] = registro;
      }
    });

  return porTipo;
}
