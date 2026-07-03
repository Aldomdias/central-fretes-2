import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'simulacao_realizado_mensal';

function ensureSupabase() {
  const client = getSupabaseClient();
  if (!client || !isSupabaseConfigured()) {
    throw new Error('Supabase nao configurado.');
  }
  return client;
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function competenciaFromPeriodo(inicio = '', fim = '') {
  const candidato = String(inicio || fim || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(candidato) ? candidato : '';
}

function compactarDetalheCte(item = {}) {
  return {
    ...item,
    todosResultados: (item.todosResultados || []).slice(0, 5).map((resultado) => ({
      transportadora: resultado.transportadora,
      total: resultado.total,
      ranking: resultado.ranking,
      origem: resultado.origem,
      detalhes: resultado.detalhes || null,
    })),
  };
}

export function prepararResultadoRealizadoParaSalvar(resultado = {}) {
  const ctesDetalhes = Array.isArray(resultado.ctesDetalhes)
    ? resultado.ctesDetalhes.slice(0, 800).map(compactarDetalheCte)
    : [];

  return {
    ...resultado,
    ctesDetalhes,
    ctesDetalhesPersistidos: ctesDetalhes.length,
    ctesDetalhesTotal: resultado.ctesDetalhesTotal || resultado.ctesAnalisados || ctesDetalhes.length,
  };
}

export function resumoResultadoRealizado(resultado = {}) {
  return {
    ctesAnalisados: toNumber(resultado.ctesAnalisados),
    ctesSimulados: toNumber(resultado.ctesSimulados),
    ctesComTabelaSelecionada: toNumber(resultado.ctesComTabelaSelecionada),
    ctesGanhariaSelecionada: toNumber(resultado.ctesGanhariaSelecionada),
    ctesPerdidosSelecionada: toNumber(resultado.ctesPerdidosSelecionada),
    freteRealizado: toNumber(resultado.freteRealizado),
    freteSelecionada: toNumber(resultado.freteSelecionada),
    freteSelecionadaGanhadora: toNumber(resultado.freteSelecionadaGanhadora),
    savingSelecionadaVsReal: toNumber(resultado.savingSelecionadaVsReal),
    aderenciaSelecionada: toNumber(resultado.aderenciaSelecionada),
    valorNF: toNumber(resultado.valorNF),
    peso: toNumber(resultado.peso),
    volumes: toNumber(resultado.volumes),
    cubagemTotal: toNumber(resultado.cubagemTotal),
  };
}

function montarPayloadSimulacao({ resultado, filtros = {}, nome = '', status = 'CONCLUIDA', totalParcelas = 1, parcelasConcluidas = 1 } = {}) {
  if (!resultado) throw new Error('Nenhum resultado para salvar.');
  const inicio = filtros.inicio || resultado.filtros?.inicio || '';
  const fim = filtros.fim || resultado.filtros?.fim || '';
  const competencia = filtros.competencia || resultado.filtros?.competencia || competenciaFromPeriodo(inicio, fim);
  const periodoLabel = inicio || fim ? `${inicio || 'sem inicio'} a ${fim || 'sem fim'}` : (competencia || 'periodo');
  const transportadoraLabel = filtros.transportadora || resultado.filtros?.transportadora || 'simulacao';
  const payloadResultado = prepararResultadoRealizadoParaSalvar(resultado);
  const resumo = resumoResultadoRealizado(resultado);

  return {
    nome: nome || `${periodoLabel} - ${transportadoraLabel}`,
    competencia,
    transportadora: filtros.transportadora || resultado.filtros?.transportadora || '',
    canal: filtros.canal || resultado.filtros?.canal || '',
    origem: filtros.origem || resultado.filtros?.origem || '',
    periodo_inicio: inicio || null,
    periodo_fim: fim || null,
    filtros: {
      ...(resultado.filtros || {}),
      ...filtros,
    },
    resumo,
    resultado: payloadResultado,
    ctes_analisados: resumo.ctesAnalisados,
    ctes_simulados: resumo.ctesSimulados,
    frete_realizado: resumo.freteRealizado,
    frete_simulado: resumo.freteSelecionada,
    saving: resumo.savingSelecionadaVsReal,
    status,
    total_parcelas: Math.max(1, toNumber(totalParcelas) || 1),
    parcelas_concluidas: Math.max(0, toNumber(parcelasConcluidas) || 0),
    updated_at: new Date().toISOString(),
  };
}

export async function salvarSimulacaoRealizadoMensal({ resultado, filtros = {}, nome = '' } = {}) {
  const supabase = ensureSupabase();
  const payload = montarPayloadSimulacao({ resultado, filtros, nome, status: 'CONCLUIDA', totalParcelas: 1, parcelasConcluidas: 1 });

  const { data, error } = await supabase
    .from(TABELA)
    .insert(payload)
    .select('id,nome,competencia,transportadora,canal,origem,periodo_inicio,periodo_fim,ctes_analisados,ctes_simulados,frete_realizado,frete_simulado,saving,status,total_parcelas,parcelas_concluidas,created_at,updated_at')
    .single();

  if (error) throw new Error(`Erro ao salvar analise mensal. Detalhe: ${error.message}`);
  return data;
}

export async function salvarParcialSimulacaoRealizadoMensal({ id = '', resultado, filtros = {}, nome = '', totalParcelas = 1, parcelasConcluidas = 0, concluida = false } = {}) {
  const supabase = ensureSupabase();
  const payload = montarPayloadSimulacao({
    resultado,
    filtros,
    nome,
    status: concluida ? 'CONCLUIDA' : 'PROCESSANDO',
    totalParcelas,
    parcelasConcluidas,
  });

  const query = id
    ? supabase.from(TABELA).update(payload).eq('id', id)
    : supabase.from(TABELA).insert(payload);

  const { data, error } = await query
    .select('id,nome,competencia,transportadora,canal,origem,periodo_inicio,periodo_fim,ctes_analisados,ctes_simulados,frete_realizado,frete_simulado,saving,status,total_parcelas,parcelas_concluidas,created_at,updated_at')
    .single();

  if (error) throw new Error(`Erro ao salvar parcial da analise mensal. Detalhe: ${error.message}`);
  return data;
}

export async function listarSimulacoesRealizadoMensal({ competencia = '', transportadora = '', canal = '', limite = 20 } = {}) {
  const supabase = ensureSupabase();
  let query = supabase
    .from(TABELA)
    .select('id,nome,competencia,transportadora,canal,origem,periodo_inicio,periodo_fim,ctes_analisados,ctes_simulados,frete_realizado,frete_simulado,saving,status,total_parcelas,parcelas_concluidas,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limite);

  if (competencia) query = query.eq('competencia', competencia);
  if (transportadora) query = query.ilike('transportadora', `%${transportadora}%`);
  if (canal) query = query.eq('canal', canal);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao listar analises mensais. Detalhe: ${error.message}`);
  return data || [];
}

export async function carregarSimulacaoRealizadoMensal(id) {
  if (!id) throw new Error('Selecione uma analise salva.');
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from(TABELA)
    .select('id,nome,resultado,updated_at')
    .eq('id', id)
    .single();

  if (error) throw new Error(`Erro ao carregar analise mensal. Detalhe: ${error.message}`);
  return data;
}

export async function carregarSimulacoesRealizadoMensalPorIds(ids = []) {
  const lista = [...new Set((ids || []).filter(Boolean))];
  if (!lista.length) return [];
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from(TABELA)
    .select('id,nome,competencia,transportadora,canal,origem,periodo_inicio,periodo_fim,status,total_parcelas,parcelas_concluidas,resultado,updated_at')
    .in('id', lista);

  if (error) throw new Error(`Erro ao carregar analises para unificar. Detalhe: ${error.message}`);
  return data || [];
}

export async function excluirSimulacaoRealizadoMensal(id) {
  if (!id) throw new Error('Selecione uma analise salva para excluir.');
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from(TABELA)
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Erro ao excluir analise mensal. Detalhe: ${error.message}`);
  return true;
}

export async function excluirSimulacoesRealizadoMensal(ids = []) {
  const lista = [...new Set((ids || []).filter(Boolean))];
  if (!lista.length) return 0;
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from(TABELA)
    .delete()
    .in('id', lista);

  if (error) throw new Error(`Erro ao excluir parcelas da analise mensal. Detalhe: ${error.message}`);
  return lista.length;
}
