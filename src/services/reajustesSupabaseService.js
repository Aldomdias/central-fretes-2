import { getSupabaseClient, getSupabaseInfo, isSupabaseConfigured } from '../lib/supabaseClient';

const WORKSPACE_KEY = 'default';
const INSERT_CHUNK_SIZE = 500;

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase não configurado. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente do projeto.');
  return client;
}

function detalheErroSupabase(error) {
  const msg = error?.message || String(error || 'Erro desconhecido no Supabase.');
  if (msg.includes('reajustes_controle') || msg.includes('reajustes_config') || msg.includes('relation') || msg.includes('does not exist') || error?.code === '42P01') {
    return `${msg}. Rode o script supabase/reajustes_schema.sql no SQL Editor do Supabase antes de usar o módulo de reajustes.`;
  }
  return msg;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateOrNull(value) {
  const raw = String(value || '').slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function timestampOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function listaTexto(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function itemParaDb(item = {}) {
  return {
    id: String(item.id || `reajuste-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    workspace_key: WORKSPACE_KEY,
    origem_importacao: item.origemImportacao || '',
    linha_origem: item.linhaOrigem === '' || item.linhaOrigem === null || item.linhaOrigem === undefined ? null : Number(item.linhaOrigem),
    emergencial: item.emergencial || '',
    canal: item.canal || '',
    transportadora_informada: item.transportadoraInformada || '',
    transportadora_sistema: item.transportadoraSistema || '',
    transportadoras_realizado: listaTexto(item.transportadorasRealizado),
    data_inicio: dateOrNull(item.dataInicio),
    data_solicitacao: dateOrNull(item.dataSolicitacao),
    reajuste_solicitado_texto: item.reajusteSolicitadoTexto || '',
    reajuste_solicitado: toNumber(item.reajusteSolicitado),
    reajuste_primeira_parcela: toNumber(item.reajustePrimeiraParcela),
    data_primeira_parcela: dateOrNull(item.dataPrimeiraParcela),
    reajuste_segunda_parcela: toNumber(item.reajusteSegundaParcela),
    data_segunda_parcela: dateOrNull(item.dataSegundaParcela),
    proposta_final: toNumber(item.propostaFinal),
    reajuste_aplicado: toNumber(item.reajusteAplicado),
    status: item.status || '',
    representatividade: toNumber(item.representatividade),
    valor_cte_planilha: toNumber(item.valorCtePlanilha),
    faturamento_medio_planilha: toNumber(item.faturamentoMedioPlanilha),
    impacto_emergencial_planilha: toNumber(item.impactoEmergencialPlanilha),
    impacto_antt_planilha: toNumber(item.impactoAnttPlanilha),
    impacto_reajuste_planilha: toNumber(item.impactoReajustePlanilha),
    percentual_atual_realizado: toNumber(item.percentualAtualRealizado),
    percentual_com_reajuste_original: toNumber(item.percentualComReajuste),
    ctes_periodo: toNumber(item.ctesPeriodo),
    valor_frete_periodo: toNumber(item.valorFretePeriodo),
    valor_nf_periodo: toNumber(item.valorNFPeriodo),
    peso_periodo: toNumber(item.pesoPeriodo),
    impacto_previsto: toNumber(item.impactoPrevisto || item.impactoPeriodo),
    impacto_periodo: toNumber(item.impactoPeriodo || item.impactoPrevisto),
    frete_com_reajuste: toNumber(item.freteComReajuste),
    percentual_frete_atual: toNumber(item.percentualFreteAtual),
    percentual_frete_com_reajuste: toNumber(item.percentualFreteComReajuste),
    ctes_realizado_reajuste: toNumber(item.ctesRealizadoReajuste),
    valor_frete_realizado_reajuste: toNumber(item.valorFreteRealizadoReajuste),
    valor_nf_realizado_reajuste: toNumber(item.valorNFRealizadoReajuste),
    impacto_realizado: toNumber(item.impactoRealizado),
    percentual_frete_realizado_reajuste: toNumber(item.percentualFreteRealizadoReajuste),
    inicio_impacto_realizado: dateOrNull(item.inicioImpactoRealizado),
    fim_impacto_realizado: dateOrNull(item.fimImpactoRealizado),
    vinculado: Boolean(item.vinculado),
    observacao: item.observacao || '',
    ativo: item.ativo !== false,
    criado_em: timestampOrNull(item.criadoEm),
    atualizado_em: timestampOrNull(item.atualizadoEm),
    raw: item || {},
    updated_at: new Date().toISOString(),
  };
}

function dbParaItem(row = {}) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  return {
    ...raw,
    id: row.id,
    origemImportacao: raw.origemImportacao ?? row.origem_importacao ?? '',
    linhaOrigem: raw.linhaOrigem ?? row.linha_origem ?? '',
    emergencial: raw.emergencial ?? row.emergencial ?? '',
    canal: raw.canal ?? row.canal ?? '',
    transportadoraInformada: raw.transportadoraInformada ?? row.transportadora_informada ?? '',
    transportadoraSistema: raw.transportadoraSistema ?? row.transportadora_sistema ?? '',
    transportadorasRealizado: listaTexto(raw.transportadorasRealizado?.length ? raw.transportadorasRealizado : row.transportadoras_realizado),
    dataInicio: raw.dataInicio ?? row.data_inicio ?? '',
    dataSolicitacao: raw.dataSolicitacao ?? row.data_solicitacao ?? '',
    reajusteSolicitadoTexto: raw.reajusteSolicitadoTexto ?? row.reajuste_solicitado_texto ?? '',
    reajusteSolicitado: raw.reajusteSolicitado ?? toNumber(row.reajuste_solicitado),
    reajustePrimeiraParcela: raw.reajustePrimeiraParcela ?? toNumber(row.reajuste_primeira_parcela),
    dataPrimeiraParcela: raw.dataPrimeiraParcela ?? row.data_primeira_parcela ?? '',
    reajusteSegundaParcela: raw.reajusteSegundaParcela ?? toNumber(row.reajuste_segunda_parcela),
    dataSegundaParcela: raw.dataSegundaParcela ?? row.data_segunda_parcela ?? '',
    propostaFinal: raw.propostaFinal ?? toNumber(row.proposta_final),
    reajusteAplicado: raw.reajusteAplicado ?? toNumber(row.reajuste_aplicado),
    status: raw.status ?? row.status ?? '',
    representatividade: raw.representatividade ?? toNumber(row.representatividade),
    valorCtePlanilha: raw.valorCtePlanilha ?? toNumber(row.valor_cte_planilha),
    faturamentoMedioPlanilha: raw.faturamentoMedioPlanilha ?? toNumber(row.faturamento_medio_planilha),
    impactoEmergencialPlanilha: raw.impactoEmergencialPlanilha ?? toNumber(row.impacto_emergencial_planilha),
    impactoAnttPlanilha: raw.impactoAnttPlanilha ?? toNumber(row.impacto_antt_planilha),
    impactoReajustePlanilha: raw.impactoReajustePlanilha ?? toNumber(row.impacto_reajuste_planilha),
    percentualAtualRealizado: raw.percentualAtualRealizado ?? toNumber(row.percentual_atual_realizado),
    percentualComReajuste: raw.percentualComReajuste ?? toNumber(row.percentual_com_reajuste_original),
    ctesPeriodo: raw.ctesPeriodo ?? toNumber(row.ctes_periodo),
    valorFretePeriodo: raw.valorFretePeriodo ?? toNumber(row.valor_frete_periodo),
    valorNFPeriodo: raw.valorNFPeriodo ?? toNumber(row.valor_nf_periodo),
    pesoPeriodo: raw.pesoPeriodo ?? toNumber(row.peso_periodo),
    impactoPrevisto: raw.impactoPrevisto ?? toNumber(row.impacto_previsto),
    impactoPeriodo: raw.impactoPeriodo ?? toNumber(row.impacto_periodo),
    freteComReajuste: raw.freteComReajuste ?? toNumber(row.frete_com_reajuste),
    percentualFreteAtual: raw.percentualFreteAtual ?? toNumber(row.percentual_frete_atual),
    percentualFreteComReajuste: raw.percentualFreteComReajuste ?? toNumber(row.percentual_frete_com_reajuste),
    ctesRealizadoReajuste: raw.ctesRealizadoReajuste ?? toNumber(row.ctes_realizado_reajuste),
    valorFreteRealizadoReajuste: raw.valorFreteRealizadoReajuste ?? toNumber(row.valor_frete_realizado_reajuste),
    valorNFRealizadoReajuste: raw.valorNFRealizadoReajuste ?? toNumber(row.valor_nf_realizado_reajuste),
    impactoRealizado: raw.impactoRealizado ?? toNumber(row.impacto_realizado),
    percentualFreteRealizadoReajuste: raw.percentualFreteRealizadoReajuste ?? toNumber(row.percentual_frete_realizado_reajuste),
    inicioImpactoRealizado: raw.inicioImpactoRealizado ?? row.inicio_impacto_realizado ?? '',
    fimImpactoRealizado: raw.fimImpactoRealizado ?? row.fim_impacto_realizado ?? '',
    vinculado: raw.vinculado ?? Boolean(row.vinculado),
    observacao: raw.observacao ?? row.observacao ?? '',
    ativo: raw.ativo ?? row.ativo !== false,
    criadoEm: raw.criadoEm ?? row.criado_em ?? row.created_at ?? '',
    atualizadoEm: raw.atualizadoEm ?? row.atualizado_em ?? row.updated_at ?? '',
  };
}

export function reajustesSupabaseConfigurado() {
  return isSupabaseConfigured();
}

export function obterInfoReajustesSupabase() {
  return getSupabaseInfo();
}

export async function carregarReajustesSupabase() {
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('reajustes_controle')
    .select('*')
    .eq('workspace_key', WORKSPACE_KEY)
    .order('created_at', { ascending: false });
  if (error) throw new Error(detalheErroSupabase(error));
  return (data || []).map(dbParaItem);
}

export async function salvarReajustesSupabase(itens = []) {
  const supabase = ensureClient();
  const rows = (itens || []).map(itemParaDb);
  const { error: deleteError } = await supabase
    .from('reajustes_controle')
    .delete()
    .eq('workspace_key', WORKSPACE_KEY);
  if (deleteError) throw new Error(detalheErroSupabase(deleteError));

  for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + INSERT_CHUNK_SIZE);
    if (!chunk.length) continue;
    const { error } = await supabase.from('reajustes_controle').insert(chunk);
    if (error) throw new Error(detalheErroSupabase(error));
  }

  return { ok: true, total: rows.length };
}

export async function carregarConfigReajustesSupabase() {
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('reajustes_config')
    .select('*')
    .eq('workspace_key', WORKSPACE_KEY)
    .maybeSingle();
  if (error) throw new Error(detalheErroSupabase(error));
  if (!data) return null;
  return {
    ...(data.config || {}),
    inicio: data.inicio || data.config?.inicio || '',
    fim: data.fim || data.config?.fim || '',
  };
}

export async function salvarConfigReajustesSupabase(config = {}) {
  const supabase = ensureClient();
  const row = {
    workspace_key: WORKSPACE_KEY,
    inicio: dateOrNull(config.inicio),
    fim: dateOrNull(config.fim),
    config: config || {},
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('reajustes_config')
    .upsert(row, { onConflict: 'workspace_key' });
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true };
}

export async function diagnosticarReajustesSupabase() {
  if (!isSupabaseConfigured()) return { ok: false, configured: false, erro: 'Supabase não configurado.' };
  const supabase = ensureClient();
  const [itens, config] = await Promise.all([
    supabase.from('reajustes_controle').select('id', { count: 'exact', head: true }).eq('workspace_key', WORKSPACE_KEY),
    supabase.from('reajustes_config').select('workspace_key', { count: 'exact', head: true }).eq('workspace_key', WORKSPACE_KEY),
  ]);
  if (itens.error) throw new Error(detalheErroSupabase(itens.error));
  if (config.error) throw new Error(detalheErroSupabase(config.error));
  return {
    ok: true,
    configured: true,
    info: getSupabaseInfo(),
    reajustes: itens.count || 0,
    configs: config.count || 0,
  };
}
