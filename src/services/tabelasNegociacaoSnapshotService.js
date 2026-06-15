import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  erroColunaResumoCapaAusente,
  extrairResumoCapaNegociacao,
  mesclarResumoCapaNaTabela,
  removerResumoCapaDoSelect,
} from '../utils/tabelasNegociacaoResumoCapa';
import { montarLaudoTransportadoraConsolidado } from '../utils/laudoTransportadoraConsolidado';

const COLUNAS_GESTAO = [
  'criado_por', 'criado_por_nome', 'negociador_id', 'negociador_nome',
  'aprovador_id', 'aprovador_nome', 'status_gestao', 'status_aprovacao',
  'aprovado_em', 'publicado_em', 'enviado_aprovacao_em',
].join(',');

const COLUNAS_EDITOR_TIPO = [
  'id', 'transportadora', 'tipo_negociacao', 'tipo_tabela', 'canal', 'status',
  'descricao', 'regiao', 'origem', 'uf_origem', 'uf_destino',
  'transportadora_base_nome', 'tabela_base_id', 'comparar_com_proprio_realizado',
  'periodo_realizado_inicio', 'periodo_realizado_fim', 'tipo_veiculo', 'modalidade',
  'observacao', 'data_inicio_prevista', 'incluir_simulacao',
].join(',');

const COLUNAS_LISTAGEM_NEGOCIACAO = [
  'id', 'transportadora', 'canal', 'tipo_tabela', 'tipo_negociacao', 'status',
  'descricao', 'regiao', 'origem', 'uf_origem', 'uf_destino',
  'data_recebimento', 'data_inicio_prevista', 'data_inicio_vigencia',
  'incluir_simulacao', 'observacao', 'origem_importacao',
  'criado_em', 'atualizado_em',
  'saving_projetado', 'aderencia_projetada', 'faturamento_projetado',
  'impacto_projetado', 'percentual_frete_projetado', 'volumetria_dia',
  'ctes_analisados', 'ctes_atendidos', 'rotas_sem_cobertura',
  'substituir_tabela_anterior', 'tabela_base_id', 'transportadora_base_nome',
  'percentual_medio_impacto', 'impacto_valor', 'valor_atual_realizado',
  'valor_simulado_nova_tabela', 'impacto_mensal', 'impacto_anual',
  'resumo_capa',
  COLUNAS_GESTAO,
].join(',');

const COLUNAS_CAPA_DETALHE = [
  ...COLUNAS_LISTAGEM_NEGOCIACAO.split(','),
  'generalidades', 'modalidade', 'tipo_veiculo',
  'periodo_realizado_inicio', 'periodo_realizado_fim',
  'comparar_com_proprio_realizado',
].filter((col, idx, arr) => arr.indexOf(col) === idx).join(',');

function supabaseOrThrow() {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  return getSupabaseClient();
}

async function executarComConcorrencia(itens, limite, executor) {
  const resultados = new Array(itens.length);
  let cursor = 0;
  const workers = new Array(Math.min(limite, Math.max(itens.length, 1))).fill(null).map(async () => {
    while (cursor < itens.length) {
      const indice = cursor;
      cursor += 1;
      resultados[indice] = await executor(itens[indice], indice);
    }
  });
  await Promise.all(workers);
  return resultados;
}

/** Lista leve: capas + resumo_capa (sem resumo_simulacao completo). */
export async function listarNegociacoesResumo(filtros = {}) {
  const supabase = supabaseOrThrow();
  let query = supabase
    .from('tabelas_negociacao')
    .select(COLUNAS_LISTAGEM_NEGOCIACAO)
    .order('criado_em', { ascending: false });

  if (filtros.status) query = query.eq('status', filtros.status);
  if (filtros.tipoTabela) query = query.eq('tipo_tabela', filtros.tipoTabela);
  if (filtros.tipoNegociacao) query = query.eq('tipo_negociacao', filtros.tipoNegociacao);
  if (filtros.canal) query = query.eq('canal', filtros.canal);
  if (filtros.transportadora) query = query.ilike('transportadora', `%${filtros.transportadora}%`);
  if (filtros.somenteSimulacao) query = query.eq('incluir_simulacao', true);

  let { data, error } = await query;

  if (error && erroColunaResumoCapaAusente(error)) {
    const fallbackCols = removerResumoCapaDoSelect(COLUNAS_LISTAGEM_NEGOCIACAO);
    query = supabase.from('tabelas_negociacao').select(fallbackCols).order('criado_em', { ascending: false });
    if (filtros.status) query = query.eq('status', filtros.status);
    if (filtros.tipoTabela) query = query.eq('tipo_tabela', filtros.tipoTabela);
    if (filtros.tipoNegociacao) query = query.eq('tipo_negociacao', filtros.tipoNegociacao);
    if (filtros.canal) query = query.eq('canal', filtros.canal);
    if (filtros.transportadora) query = query.ilike('transportadora', `%${filtros.transportadora}%`);
    if (filtros.somenteSimulacao) query = query.eq('incluir_simulacao', true);
    ({ data, error } = await query);
  }

  if (error) throw new Error(error.message || 'Erro ao listar negociações (resumo).');
  return (data || []).map(mesclarResumoCapaNaTabela);
}

/** Lista mínima para o editor de tipo (sem resumo_capa / gestão / histórico). */
export async function listarNegociacoesCapaEditor() {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .select(COLUNAS_EDITOR_TIPO)
    .order('criado_em', { ascending: false });

  if (error) throw new Error(error.message || 'Erro ao listar negociações (editor).');
  return data || [];
}

/** Histórico de gestão sob demanda (aba Histórico / painel lateral). */
export async function carregarHistoricoGestaoNegociacoes() {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .select('id,transportadora,origem,canal,historico_gestao')
    .order('criado_em', { ascending: false });

  if (error) throw new Error(error.message || 'Erro ao carregar histórico de gestão.');
  return data || [];
}

/** Capa de uma negociação (sem resumo_simulacao completo). */
export async function obterNegociacaoCapa(id) {
  const supabase = supabaseOrThrow();
  let { data, error } = await supabase
    .from('tabelas_negociacao')
    .select(COLUNAS_CAPA_DETALHE)
    .eq('id', id)
    .single();

  if (error && erroColunaResumoCapaAusente(error)) {
    const fallbackCols = removerResumoCapaDoSelect(COLUNAS_CAPA_DETALHE);
    ({ data, error } = await supabase.from('tabelas_negociacao').select(fallbackCols).eq('id', id).single());
  }

  if (error) throw new Error(error.message || 'Erro ao buscar capa da negociação.');
  return mesclarResumoCapaNaTabela(data);
}

/** Carrega somente o JSON pesado de simulação/rodadas. */
export async function carregarResumoCompletoNegociacao(id) {
  const supabase = supabaseOrThrow();
  let { data, error } = await supabase
    .from('tabelas_negociacao')
    .select('id,resumo_simulacao,resumo_capa')
    .eq('id', id)
    .single();

  if (error && erroColunaResumoCapaAusente(error)) {
    ({ data, error } = await supabase
      .from('tabelas_negociacao')
      .select('id,resumo_simulacao')
      .eq('id', id)
      .single());
  }

  if (error) throw new Error(error.message || 'Erro ao carregar resumo completo da negociação.');
  const completo = data?.resumo_simulacao && typeof data.resumo_simulacao === 'object'
    ? data.resumo_simulacao
    : null;
  return {
    id: data?.id,
    resumo_simulacao: completo || extrairResumoCapaNegociacao(data?.resumo_capa || {}),
    resumo_capa: data?.resumo_capa || extrairResumoCapaNegociacao(completo || {}),
  };
}

/** Busca resumos completos das origens e monta laudo consolidado para devolutiva. */
export async function carregarLaudoTransportadoraConsolidado(transportadoraNome, tabelasResumo = []) {
  const nome = String(transportadoraNome || '').trim();
  if (!nome) throw new Error('Informe a transportadora para gerar o laudo consolidado.');

  const candidatas = (tabelasResumo || []).filter(
    (t) => String(t.transportadora || '').trim().toUpperCase() === nome.toUpperCase(),
  );

  if (!candidatas.length) {
    throw new Error(`Nenhuma negociação encontrada para ${nome}.`);
  }

  const comResumo = await executarComConcorrencia(candidatas, 3, async (tabela) => {
    try {
      const { resumo_simulacao: completo } = await carregarResumoCompletoNegociacao(tabela.id);
      return { ...tabela, resumo_simulacao: completo || tabela.resumo_simulacao };
    } catch {
      return tabela;
    }
  });

  return montarLaudoTransportadoraConsolidado(comResumo, nome);
}

export function snapshotsNegociacaoDisponiveis() {
  return isSupabaseConfigured();
}
