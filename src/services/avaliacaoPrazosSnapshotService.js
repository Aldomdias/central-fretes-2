import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { gerarRotuloRecorte } from './avaliacaoPrazosCache';

const MAX_SNAPSHOTS = 24;

function texto(valor = '') {
  return String(valor ?? '').trim();
}

function exigirSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Snapshots na nuvem exigem conexão com o banco.');
  }
  const client = getSupabaseClient();
  if (!client) throw new Error('Cliente Supabase indisponível.');
  return client;
}

function montarResumo(item = {}) {
  return {
    id: item.id,
    nome: item.nome,
    rotulo: item.rotulo,
    salvoEm: item.salvo_em || item.salvoEm,
    totalLinhas: item.total_linhas ?? item.totalLinhas ?? 0,
    filtros: item.filtros || {},
    origem: 'nuvem',
  };
}

function serializarPayload({ nome, filtros = {}, kpis = {}, analise = {} }) {
  const rotulo = gerarRotuloRecorte(filtros);
  return {
    nome: texto(nome) || rotulo,
    rotulo,
    filtros,
    kpis,
    mapa: analise.mapa || [],
    melhores_prazos: analise.melhoresPrazos || [],
    rotas_criticas: analise.rotasCriticas || [],
    lacunas: analise.lacunas || { resumo: {}, itens: [] },
    total_linhas: analise.totalLinhas || 0,
    salvo_em: new Date().toISOString(),
    salvo_por: '',
  };
}

async function podarSnapshotsAntigos(supabase) {
  const { data, error } = await supabase
    .from('avaliacao_prazos_snapshots')
    .select('id')
    .order('salvo_em', { ascending: true });

  if (error || !Array.isArray(data) || data.length <= MAX_SNAPSHOTS) return;

  const excesso = data.slice(0, data.length - MAX_SNAPSHOTS);
  const ids = excesso.map((item) => item.id).filter(Boolean);
  if (!ids.length) return;

  await supabase.from('avaliacao_prazos_snapshots').delete().in('id', ids);
}

export function snapshotsNuvemDisponiveis() {
  return isSupabaseConfigured();
}

export async function listarSnapshotsNuvemAvaliacao() {
  const supabase = exigirSupabase();
  const { data, error } = await supabase
    .from('avaliacao_prazos_snapshots')
    .select('id, nome, rotulo, filtros, total_linhas, salvo_em')
    .order('salvo_em', { ascending: false })
    .limit(MAX_SNAPSHOTS);

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) {
      throw new Error('Tabela de snapshots não encontrada. Aplique a migration 20260609_009 no Supabase.');
    }
    throw error;
  }

  return (data || []).map(montarResumo);
}

export async function salvarSnapshotNuvemAvaliacao({ nome, filtros = {}, kpis = {}, analise = {} }) {
  if (!analise.totalLinhas && !(analise.mapa || []).length) {
    throw new Error('Não há análise agregada para salvar. Conclua a busca antes de salvar na nuvem.');
  }

  const supabase = exigirSupabase();
  const payload = serializarPayload({ nome, filtros, kpis, analise });

  const { data, error } = await supabase
    .from('avaliacao_prazos_snapshots')
    .insert(payload)
    .select('id, nome, rotulo, filtros, total_linhas, salvo_em')
    .single();

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) {
      throw new Error('Tabela de snapshots não encontrada. Aplique a migration 20260609_009 no Supabase.');
    }
    throw error;
  }

  await podarSnapshotsAntigos(supabase);
  return montarResumo(data);
}

export async function carregarSnapshotNuvemAvaliacao(id) {
  const supabase = exigirSupabase();
  const { data, error } = await supabase
    .from('avaliacao_prazos_snapshots')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Snapshot não encontrado na nuvem.');

  return {
    filtros: data.filtros || {},
    kpis: data.kpis || {},
    analise: {
      linhas: [],
      totalLinhas: data.total_linhas || 0,
      mapa: data.mapa || [],
      melhoresPrazos: data.melhores_prazos || [],
      rotasCriticas: data.rotas_criticas || [],
      lacunas: data.lacunas || { resumo: {}, itens: [] },
    },
    meta: montarResumo(data),
  };
}

export async function excluirSnapshotNuvemAvaliacao(id) {
  const supabase = exigirSupabase();
  const { error } = await supabase
    .from('avaliacao_prazos_snapshots')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
