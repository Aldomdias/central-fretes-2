import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { montarDadosLaudoNegociacao } from '../utils/laudosNegociacaoHtml';

function supabaseOrThrow() {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  return getSupabaseClient();
}

function getResumoSeguro(tabela = {}) {
  const resumo = tabela.resumo_simulacao;
  if (!resumo || typeof resumo !== 'object' || Array.isArray(resumo)) return {};
  return resumo;
}

function getHistoricoSeguro(resumo = {}) {
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}

function montarSnapshotLaudo(dados, tipo) {
  return {
    tipo,
    versao: 1,
    gerado_em: new Date().toISOString(),
    dados,
    texto_email: tipo === 'executivo' ? dados.textoExecutivo : dados.textoTransportador,
    origem_template: 'LaudoNegociacaoTemplate',
  };
}

export async function salvarLaudosNegociacao(tabelaNegociacaoId, resultado = {}, opcoes = {}) {
  const supabase = supabaseOrThrow();
  if (!tabelaNegociacaoId) throw new Error('Negociação inválida para salvar laudos.');

  const { data: tabelaAtual, error: tabelaError } = await supabase
    .from('tabelas_negociacao')
    .select('*')
    .eq('id', tabelaNegociacaoId)
    .single();

  if (tabelaError) throw new Error(tabelaError.message || 'Erro ao buscar negociação atual.');

  const resumoAnterior = getResumoSeguro(tabelaAtual);
  const historicoAnterior = getHistoricoSeguro(resumoAnterior);
  const dados = montarDadosLaudoNegociacao(resultado, {
    transportadora: opcoes.transportadora || tabelaAtual.transportadora || resultado?.filtros?.transportadora,
    canal: opcoes.canal || tabelaAtual.canal || resultado?.filtros?.canal,
    origem: opcoes.origem || tabelaAtual.origem || resultado?.filtros?.origem,
    periodo: opcoes.periodo,
  });

  const laudos = {
    ...(resumoAnterior.laudos || {}),
    executivo: montarSnapshotLaudo(dados, 'executivo'),
    transportador: montarSnapshotLaudo(dados, 'transportador'),
  };

  const entradaHistorico = {
    id: `LAUDOS-${Date.now()}`,
    tipo_registro: 'LAUDOS_GERADOS',
    rodada: Number(resumoAnterior.rodada_atual || resultado.rodada || 1) || 1,
    criado_em: new Date().toISOString(),
    resumo: {
      transportadora: dados.transportadora,
      canal: dados.canal,
      periodo: dados.periodo,
      ctes_analisados: dados.ctesAnalisados,
      aderencia: dados.aderencia,
      rotas_criticas: dados.rotasCriticas.length,
      rotas_competitivas: dados.rotasCompetitivas.length,
    },
  };

  const resumoAtualizado = {
    ...resumoAnterior,
    laudos,
    ultima_geracao_laudos_em: entradaHistorico.criado_em,
    ultimo_laudo_executivo: laudos.executivo,
    ultimo_laudo_transportador: laudos.transportador,
    historico_rodadas: historicoAnterior.concat([entradaHistorico]).slice(-30),
  };

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update({ resumo_simulacao: resumoAtualizado })
    .eq('id', tabelaNegociacaoId)
    .select()
    .single();

  if (error) throw new Error(error.message || 'Erro ao salvar laudos da negociação.');

  return {
    tabela: data,
    laudos,
    dados,
  };
}
