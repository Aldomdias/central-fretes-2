import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export function registrarAlteracaoTransportadora(usuario, evento = {}) {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;

  supabase
    .from('historico_alteracoes_transportadoras')
    .insert({
      tipo: evento.tipo || 'alteracao',
      transportadora_id: evento.transportadoraId != null ? String(evento.transportadoraId) : null,
      transportadora_nome: evento.transportadoraNome || null,
      origem_id: evento.origemId != null ? String(evento.origemId) : null,
      origem_cidade: evento.origemCidade || null,
      secao: evento.secao || null,
      detalhe: evento.detalhe || null,
      usuario_id: usuario?.id || null,
      usuario_nome: usuario?.nome || usuario?.email || 'Usuário',
      usuario_email: usuario?.email || '',
    })
    .then(({ error }) => {
      if (error) console.warn('Não foi possível registrar histórico de alteração:', error.message);
    });
}

export async function listarHistoricoAlteracoesTransportadoras({ limite = 200, transportadoraId = null } = {}) {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  let query = supabase
    .from('historico_alteracoes_transportadoras')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(limite);

  if (transportadoraId) query = query.eq('transportadora_id', String(transportadoraId));

  const { data, error } = await query;
  if (error) {
    console.warn('Não foi possível carregar histórico de alterações:', error.message);
    return [];
  }
  return data || [];
}
