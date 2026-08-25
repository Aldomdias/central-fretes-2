import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { normalizarNomeVinculo } from './vinculosTransportadorasService';

function client() {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  return getSupabaseClient();
}

export async function carregarGestaoContratos(competencia) {
  const { data, error } = await client().rpc('rpc_gestao_contratos_pareto', { p_competencia: competencia, p_percentual_alvo: 80 });
  if (error) throw new Error(`Não foi possível calcular a cobertura: ${error.message}`);
  return data || [];
}

export async function carregarSemVinculoContratos(competencia) {
  const { data, error } = await client().rpc('rpc_gestao_contratos_sem_vinculo', { p_competencia: competencia });
  if (error) throw new Error(`Não foi possível listar os nomes sem vínculo: ${error.message}`);
  return data || [];
}

export async function listarTabelasTransportadorasContrato() {
  const { data, error } = await client().from('transportadoras').select('nome').order('nome');
  if (error) throw new Error(`Não foi possível listar as tabelas: ${error.message}`);
  return [...new Set((data || []).map((item) => item.nome).filter(Boolean))];
}

export async function decidirNomePendente(nomeCte, incluir, usuario) {
  const { error } = await client().from('gestao_contratos_nomes_pendentes').upsert({ nome_cte: nomeCte, incluir, atualizado_por: usuario?.email || usuario?.nome || null, updated_at: new Date().toISOString() }, { onConflict: 'nome_cte' });
  if (error) throw new Error(`Não foi possível salvar a decisão: ${error.message}`);
}

export async function vincularNomePendente(nomeCte, nomeTabela) {
  const agora = new Date().toISOString();
  const { error } = await client().from('transportadora_vinculos').upsert({ nome_cte: nomeCte, nome_tabela: nomeTabela, nome_cte_normalizado: normalizarNomeVinculo(nomeCte), nome_tabela_normalizado: normalizarNomeVinculo(nomeTabela), origem: 'gestao_contratos', updated_at: agora }, { onConflict: 'nome_cte_normalizado' });
  if (error) throw new Error(`Não foi possível criar o vínculo: ${error.message}`);
}

export async function listarCompetenciasContratos() {
  const { data, error } = await client().from('realizado_local_ctes').select('competencia').not('competencia', 'is', null).neq('competencia', '').order('competencia', { ascending: false }).limit(1);
  if (error) throw new Error(`Não foi possível consultar as competências: ${error.message}`);
  const fim = data?.[0]?.competencia;
  if (!/^\d{4}-\d{2}$/.test(fim || '')) return [];
  const [ano, mes] = fim.split('-').map(Number);
  const meses = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(ano, mes - 1 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const anos = [...new Set(meses.map((item) => item.slice(0, 4)))];
  return anos.flatMap((a) => [`${a}-S2`, `${a}-S1`, ...meses.filter((m) => m.startsWith(a))]);
}

export async function salvarContrato(transportadora, alteracoes, usuario) {
  const payload = { transportadora, ...alteracoes, atualizado_por: usuario?.email || usuario?.nome || null, updated_at: new Date().toISOString() };
  const { data, error } = await client().from('gestao_contratos_transportadoras').upsert(payload, { onConflict: 'transportadora' }).select().single();
  if (error) throw new Error(`Não foi possível salvar o contrato: ${error.message}`);
  return data;
}
