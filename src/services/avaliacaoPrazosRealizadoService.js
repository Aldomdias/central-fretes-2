import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

function numero(valor = 0) {
  const n = Number(valor || 0);
  return Number.isFinite(n) ? n : 0;
}

function texto(valor = '') {
  return String(valor ?? '').trim();
}

function limpar(valor) {
  const v = texto(valor);
  return v || null;
}

function erroRpcRealizado(error) {
  const msg = error?.message || String(error || 'Erro ao carregar realizado.');
  if (/rpc_avaliacao_prazos_realizado_transportadoras|schema cache|does not exist|not found/i.test(msg)) {
    return 'A funcao de realizado ainda nao esta disponivel no Supabase. Rode o SQL supabase/migrations/20260617_001_avaliacao_prazos_realizado_transportadoras.sql no SQL Editor e tente novamente.';
  }
  return msg;
}

export function competenciaAtualAvaliacaoRealizado() {
  return new Date().toISOString().slice(0, 7);
}

export async function carregarRealizadoTransportadorasAvaliacao(filtros = {}, { competencia = competenciaAtualAvaliacaoRealizado(), limite = 200 } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase nao configurado. Nao foi possivel carregar realizado CT-e.');
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_avaliacao_prazos_realizado_transportadoras', {
    p_competencia: limpar(competencia),
    p_canal: limpar(filtros.canal),
    p_transportadora: limpar(filtros.transportadora),
    p_uf_origem: limpar(filtros.ufOrigem),
    p_uf_destino: limpar(filtros.ufDestino),
    p_regiao_origem: limpar(filtros.regiaoOrigem),
    p_regiao_destino: limpar(filtros.regiaoDestino),
    p_busca: limpar(filtros.busca),
    p_limite: limite,
  });

  if (error) throw new Error(erroRpcRealizado(error));

  const linhasBase = (data || []).map((item) => ({
    transportadora: texto(item.transportadora),
    ctes: numero(item.ctes),
    rotas: numero(item.rotas),
    valorCteTotal: numero(item.valor_cte_total),
    valorNfTotal: numero(item.valor_nf_total),
    ticketMedio: numero(item.ticket_medio),
    percentualFreteNf: numero(item.percentual_frete_nf),
    pctMedioSobreMenorRota: item.pct_medio_sobre_menor_rota === null ? null : numero(item.pct_medio_sobre_menor_rota),
    menorTicketRota: numero(item.menor_ticket_rota),
    maiorTicketRota: numero(item.maior_ticket_rota),
  }));

  const totalValorCte = linhasBase.reduce((acc, item) => acc + item.valorCteTotal, 0);
  const linhas = linhasBase.map((item) => ({
    ...item,
    percentualParticipacao: totalValorCte > 0 ? (item.valorCteTotal / totalValorCte) * 100 : 0,
  }));

  return {
    competencia,
    linhas,
    totalTransportadoras: linhas.length,
    totalCtes: linhas.reduce((acc, item) => acc + item.ctes, 0),
    valorCteTotal: totalValorCte,
  };
}
