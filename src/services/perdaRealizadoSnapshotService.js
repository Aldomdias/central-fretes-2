import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'perda_realizado_snapshots';

export function bancoPerdaSnapshotConfigurado() {
  return isSupabaseConfigured();
}

// Lista os indicadores salvos (1 linha por competência/canal), ordenados por mês.
export async function listarPerdaSnapshots() {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABELA)
    .select('*')
    .order('competencia', { ascending: true })
    .order('canal', { ascending: true });
  if (error) throw new Error(error.message || 'Erro ao listar indicadores salvos.');
  return data || [];
}

// Salva (ou atualiza) o resultado de uma análise. Re-salvar o mesmo mês+canal
// sobrescreve a linha anterior, mantendo o histórico limpo (1 por mês/canal).
export async function salvarPerdaSnapshot(payload = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const competencia = String(payload.competencia || '').trim();
  if (!competencia) throw new Error('Sem competência. Defina uma Data início no filtro antes de salvar.');
  const canal = String(payload.canal || '').trim().toUpperCase() || 'TODOS';

  const supabase = getSupabaseClient();
  const registro = {
    competencia,
    canal,
    rotulo: payload.rotulo || `${competencia} · ${canal}`,
    periodo_inicio: payload.periodoInicio || null,
    periodo_fim: payload.periodoFim || null,
    filtros: payload.filtros || {},
    resumo: payload.resumo || {},
    top_origens: payload.topOrigens || [],
    por_transportadora: payload.porTransportadora || [],
    por_ganhadora: payload.porGanhadora || [],
    por_destino: payload.porDestino || [],
    top_casos: payload.topCasos || [],
    prazo_stats: payload.prazoStats || {},
    total_ctes: Math.round(Number(payload.totalCtes || 0)),
    ctes_com_perda: Math.round(Number(payload.ctesComPerda || 0)),
    perda_total: Number(payload.perdaTotal || 0),
    perda_media: Number(payload.perdaMedia || 0),
    atualizado_em: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABELA)
    .upsert(registro, { onConflict: 'competencia,canal' })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message || 'Erro ao salvar indicador.');
  return data;
}

export async function excluirPerdaSnapshot(id) {
  if (!isSupabaseConfigured() || !id) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(TABELA).delete().eq('id', id);
  if (error) throw new Error(error.message || 'Erro ao excluir indicador.');
}
