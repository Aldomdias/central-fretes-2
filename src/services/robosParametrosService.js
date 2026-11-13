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

// Fila de CT-es pendentes de escrituracao, gerada pela Provisao de CT-es (Central financeira).
// Cada calculo da provisao substitui a lista da sua competencia: so os CT-es NAO lancados no SAP.
// Formato: { porCompetencia: { 'AAAA-MM': { gerado_em, gerado_por, itens: [{chave, transportadora, numero, valor, emissao}] } } }
const CHAVE_PENDENTES_ESCRITURACAO = 'escrituracao_pendentes';

export async function carregarPendentesEscrituracao() {
  if (!isSupabaseConfigured()) return { ok: false, motivo: 'Supabase nao configurado.' };
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, motivo: 'Supabase nao configurado.' };
  try {
    const { data, error } = await supabase
      .from(TABELA)
      .select('dados, atualizado_em, atualizado_por')
      .eq('chave', CHAVE_PENDENTES_ESCRITURACAO)
      .maybeSingle();
    if (error) return { ok: false, motivo: error.message, tabelaAusente: tabelaAusente(error.message) };
    const por = data?.dados?.porCompetencia || {};
    const competencias = Object.entries(por)
      .map(([competencia, v]) => ({ competencia, gerado_em: v.gerado_em, gerado_por: v.gerado_por, itens: Array.isArray(v.itens) ? v.itens : [] }))
      .filter((c) => c.itens.length)
      .sort((a, b) => b.competencia.localeCompare(a.competencia));
    return { ok: true, competencias };
  } catch (e) {
    return { ok: false, motivo: e?.message || 'Falha de rede.' };
  }
}

export async function salvarPendentesEscrituracao(competencia, itens = [], por = '') {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ''))) return { ok: false, motivo: 'Competência inválida.' };
  if (!isSupabaseConfigured()) return { ok: false, motivo: 'Supabase nao configurado.' };
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, motivo: 'Supabase nao configurado.' };
  try {
    const { data, error: erroLeitura } = await supabase
      .from(TABELA).select('dados').eq('chave', CHAVE_PENDENTES_ESCRITURACAO).maybeSingle();
    if (erroLeitura) return { ok: false, motivo: erroLeitura.message, tabelaAusente: tabelaAusente(erroLeitura.message) };
    const porCompetencia = { ...(data?.dados?.porCompetencia || {}) };
    if (itens.length) {
      porCompetencia[competencia] = { gerado_em: new Date().toISOString(), gerado_por: por || null, itens };
    } else {
      delete porCompetencia[competencia];
    }
    const { error } = await supabase.from(TABELA).upsert({
      chave: CHAVE_PENDENTES_ESCRITURACAO,
      dados: { porCompetencia },
      atualizado_em: new Date().toISOString(),
      atualizado_por: por || null,
    }, { onConflict: 'chave' });
    if (error) return { ok: false, motivo: error.message, tabelaAusente: tabelaAusente(error.message) };
    return { ok: true, qtd: itens.length };
  } catch (e) {
    return { ok: false, motivo: e?.message || 'Falha de rede.' };
  }
}
