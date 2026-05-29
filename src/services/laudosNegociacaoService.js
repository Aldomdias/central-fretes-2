import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { montarLaudosNegociacao } from '../utils/laudosNegociacaoHtml';

function supabaseOrThrow() {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  return getSupabaseClient();
}

function limparLaudoParaSalvar(laudo = {}) {
  if (!laudo || typeof laudo !== 'object') return null;

  return {
    geradoEm: laudo.geradoEm || new Date().toISOString(),
    assunto: laudo.assunto || '',
    corpoEmail: laudo.corpoEmail || '',
    laudoCompleto: laudo.laudoCompleto || '',
    dados: {
      transportadora: laudo.transportadora || '',
      canal: laudo.canal || '',
      origem: laudo.origem || '',
      periodo: laudo.periodo || '',
      usoInterno: Boolean(laudo.usoInterno),
      indicadores: laudo.indicadores || {},
      rotasGanhas: Array.isArray(laudo.rotasGanhas) ? laudo.rotasGanhas.slice(0, 20) : [],
      rotasPerdidas: Array.isArray(laudo.rotasPerdidas) ? laudo.rotasPerdidas.slice(0, 20) : [],
      estados: Array.isArray(laudo.estados) ? laudo.estados.slice(0, 27) : [],
      observacaoCubagem: laudo.observacaoCubagem || '',
      recomendacao: laudo.recomendacao || '',
    },
  };
}

export function prepararLaudosNegociacao(resultado = {}, contexto = {}) {
  const laudos = montarLaudosNegociacao(resultado, contexto);
  return {
    executivo: limparLaudoParaSalvar(laudos.executivo),
    transportador: limparLaudoParaSalvar(laudos.transportador),
  };
}

export async function salvarLaudosNegociacao(tabelaNegociacaoId, resultado = {}, contexto = {}) {
  if (!tabelaNegociacaoId) throw new Error('Negociacao invalida para salvar laudos.');
  const supabase = supabaseOrThrow();
  const laudos = prepararLaudosNegociacao(resultado, contexto);

  const { data: tabelaAtual, error: buscaError } = await supabase
    .from('tabelas_negociacao')
    .select('id,resumo_simulacao')
    .eq('id', tabelaNegociacaoId)
    .single();

  if (buscaError) throw new Error(buscaError.message || 'Erro ao buscar negociacao.');

  const resumoAtual = tabelaAtual?.resumo_simulacao && typeof tabelaAtual.resumo_simulacao === 'object'
    ? tabelaAtual.resumo_simulacao
    : {};

  const resumoAtualizado = {
    ...resumoAtual,
    laudos,
    laudos_gerados_em: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update({ resumo_simulacao: resumoAtualizado })
    .eq('id', tabelaNegociacaoId)
    .select('id,transportadora,canal,status')
    .single();

  if (error) throw new Error(error.message || 'Erro ao salvar laudos na negociacao.');
  return data;
}
