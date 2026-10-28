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
  return registrarRegistros(linhas.map((l) => linhaParaRegistro(tipo, l)), por);
}

// registros ja no formato da tabela (ex.: montados da fila do robo).
export async function registrarRegistros(lista = [], por = '') {
  const registros = lista.filter((r) => r && r.documento);
  if (!registros.length) return { ok: true, enviados: 0, novos: 0, onde: 'nenhum' };
  const agora = new Date().toISOString();
  const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABELA)
        .upsert(registros.map((r) => ({ ...r, lancado_por: r.lancado_por || por || null })), { onConflict: 'tipo,miro,documento', ignoreDuplicates: true })
        .select('id');
      if (!error) return { ok: true, enviados: registros.length, novos: data?.length ?? 0, onde: 'banco' };
      if (!tabelaAusente(error.message)) console.warn('Historico de lancamentos:', error.message);
    } catch (e) { console.warn('Historico de lancamentos:', e?.message); }
  }
  const local = lerLocal();
  const chaves = new Set(local.map(chaveRegistro));
  const novos = registros.filter((r) => !chaves.has(chaveRegistro(r))).map((r) => ({ ...r, lancado_em: agora, lancado_por: r.lancado_por || por || null }));
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

// Grava o lancamento contabil / pagamento (relatorio do HANA) nos registros do historico.
// registros: linhas do historico ja com os campos novos (vem de casarContabil).
export async function atualizarContabil(registros = []) {
  if (!registros.length) return { ok: true, atualizados: 0, onde: 'nenhum' };
  const agora = new Date().toISOString();
  const linhas = registros.map((r) => ({ ...r, contabil_atualizado_em: agora }));
  const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
  if (supabase && linhas.every((r) => r.id)) {
    try {
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await supabase.from(TABELA).upsert(linhas.slice(i, i + 500), { onConflict: 'id' });
        if (error) throw error;
      }
      return { ok: true, atualizados: linhas.length, onde: 'banco' };
    } catch (e) {
      const msg = String(e?.message || '');
      if (/column .* does not exist|lancamento_contabil|PGRST204/i.test(msg)) {
        return { ok: false, erro: 'O banco ainda nao tem as colunas do lancamento contabil: rode o SQL 20261028_003_robos_lancamentos_contabil.sql no Supabase.' };
      }
      if (!tabelaAusente(msg)) return { ok: false, erro: msg };
    }
  }
  const novos = new Map(linhas.map((r) => [chaveRegistro(r), r]));
  gravarLocal(lerLocal().map((r) => novos.get(chaveRegistro(r)) || r));
  return { ok: true, atualizados: linhas.length, onde: 'navegador' };
}
