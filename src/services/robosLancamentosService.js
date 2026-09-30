import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { chaveRegistro, linhaParaRegistro } from '../utils/robos/historicoLancamentos';

const TABELA = 'robos_lancamentos';
const CHAVE_LOCAL = 'central_fretes_robo_lancamentos_local_v1';
const PAGINA = 1000;

function tabelaAusente(mensagem = '') {
  return /relation .* does not exist|could not find the table|schema cache|42P01|PGRST205/i.test(String(mensagem));
}

function lerLocal() {
  try { return JSON.parse(window.localStorage.getItem(CHAVE_LOCAL) || '[]'); } catch { return []; }
}

function gravarLocal(lista) {
  try { window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(lista.slice(-20000))); } catch { /* sem localStorage */ }
}

// Registra no historico os documentos que ja tem MIRO. Nao duplica: a mesma nota (tipo + MIRO +
// documento) entra uma vez so, mesmo que o resultado seja importado de novo.
// Se o banco nao estiver pronto, guarda neste navegador (aparece no acompanhamento com aviso).
export async function registrarLancamentos(tipo, linhas = [], por = '') {
  const registros = linhas.map((l) => linhaParaRegistro(tipo, l)).filter((r) => r && r.documento);
  if (!registros.length) return { ok: true, enviados: 0, novos: 0, onde: 'nenhum' };
  const agora = new Date().toISOString();
  const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABELA)
        .upsert(registros.map((r) => ({ ...r, lancado_por: por || null })), { onConflict: 'tipo,miro,documento', ignoreDuplicates: true })
        .select('id');
      if (!error) return { ok: true, enviados: registros.length, novos: data?.length ?? 0, onde: 'banco' };
      if (!tabelaAusente(error.message)) console.warn('Historico de lancamentos:', error.message);
    } catch (e) { console.warn('Historico de lancamentos:', e?.message); }
  }
  const local = lerLocal();
  const chaves = new Set(local.map(chaveRegistro));
  const novos = registros.filter((r) => !chaves.has(chaveRegistro(r))).map((r) => ({ ...r, lancado_em: agora, lancado_por: por || null }));
  gravarLocal([...local, ...novos]);
  return { ok: true, enviados: registros.length, novos: novos.length, onde: 'navegador' };
}

// Le o historico (banco, ou o que foi guardado neste navegador enquanto o banco nao esta pronto).
export async function listarLancamentos({ desde = '' } = {}) {
  const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
  if (supabase) {
    try {
      const todos = [];
      for (let de = 0; de < 200000; de += PAGINA) {
        let q = supabase.from(TABELA).select('*').order('lancado_em', { ascending: false }).range(de, de + PAGINA - 1);
        if (desde) q = q.gte('lancado_em', desde);
        const { data, error } = await q;
        if (error) throw error;
        todos.push(...(data || []));
        if (!data || data.length < PAGINA) break;
      }
      return { ok: true, registros: todos, onde: 'banco', locais: lerLocal().length };
    } catch (e) {
      if (!tabelaAusente(e?.message)) console.warn('Historico de lancamentos:', e?.message);
    }
  }
  return { ok: true, registros: lerLocal().slice().reverse(), onde: 'navegador', locais: 0 };
}
