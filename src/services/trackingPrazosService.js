import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export async function carregarAcompanhamentoPrazos({ dias = 90, transportadora = '', status = '', limite = 200 } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado para consultar os prazos do Tracking.');
  const { data, error } = await getSupabaseClient().rpc('rpc_tracking_acompanhamento_prazos', {
    p_dias_historico: Number(dias) || 90, p_transportadora: transportadora || null,
    p_status: status || null, p_limite: Number(limite) || 200,
  });
  if (error) throw new Error(`Não foi possível carregar o acompanhamento: ${error.message}`);
  return { geradoEm: data?.gerado_em || '', resumo: data?.resumo || {}, transportadoras: data?.transportadoras || [], rotas: data?.rotas || [], tendencia: data?.tendencia || [], qualidade: data?.qualidade || {}, entregas: data?.entregas || [] };
}
