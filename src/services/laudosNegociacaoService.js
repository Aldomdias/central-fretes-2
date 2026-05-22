import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { montarLaudosNegociacao } from '../utils/laudosNegociacaoHtml';

function supabaseOrThrow() {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  return getSupabaseClient();
}

export function prepararLaudosNegociacao(resultado = {}, contexto = {}) {
  const laudos = montarLaudosNegociacao(resultado, contexto);
  return {
    executivo: {
      geradoEm: laudos.executivo.geradoEm,
      assunto: laudos.executivo.assunto,
      corpoEmail: laudos.executivo.corpoEmail,
      laudoCompleto: laudos.executivo.laudoCompleto,
      dados: laudos.executivo,
    },
    transportador: {
      geradoEm: laudos.transportador.geradoEm,
      assunto: laudos.transportador.assunto,
      corpoEmail: laudos.transportador.corpoEmail,
      laudoCompleto: laudos.transportador.laudoCompleto,
      dados: laudos.transportador,
    },
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
    .select()
    .single();

  if (error) throw new Error(error.message || 'Erro ao salvar laudos na negociacao.');
  return data;
}
