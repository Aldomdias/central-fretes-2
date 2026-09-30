import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'robos_parametros';
const CHAVE_LANCAMENTO = 'lancamento';

function tabelaAusente(mensagem = '') {
  return /relation .* does not exist|could not find the table|schema cache|42P01|PGRST205/i.test(String(mensagem));
}

// Le as tabelas de parametros compartilhadas (Filiais e Escritorios BI).
// Nunca lanca: devolve { ok:false, tabelaAusente } quando o banco nao esta pronto.
export async function carregarParametrosRemotos() {
  if (!isSupabaseConfigured()) return { ok: false, motivo: 'Supabase nao configurado.' };
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, motivo: 'Supabase nao configurado.' };
  try {
    const { data, error } = await supabase
      .from(TABELA)
      .select('dados, atualizado_em, atualizado_por')
      .eq('chave', CHAVE_LANCAMENTO)
      .maybeSingle();
    if (error) return { ok: false, motivo: error.message, tabelaAusente: tabelaAusente(error.message) };
    const d = data?.dados;
    if (!d || !Array.isArray(d.filiais) || !Array.isArray(d.escritorios)) return { ok: true, vazio: true };
    return { ok: true, filiais: d.filiais, escritorios: d.escritorios, atualizadoEm: data.atualizado_em, atualizadoPor: data.atualizado_por };
  } catch (e) {
    return { ok: false, motivo: e?.message || 'Falha de rede.' };
  }
}

export async function salvarParametrosRemotos({ filiais, escritorios }, por = '') {
  if (!isSupabaseConfigured()) return { ok: false, motivo: 'Supabase nao configurado.' };
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, motivo: 'Supabase nao configurado.' };
  try {
    const { error } = await supabase.from(TABELA).upsert({
      chave: CHAVE_LANCAMENTO,
      dados: { filiais, escritorios },
      atualizado_em: new Date().toISOString(),
      atualizado_por: por || null,
    }, { onConflict: 'chave' });
    if (error) return { ok: false, motivo: error.message, tabelaAusente: tabelaAusente(error.message) };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e?.message || 'Falha de rede.' };
  }
}
