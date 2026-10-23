import { getSupabaseClient } from '../lib/supabaseClient';

export const DECISAO = {
  ENVIAR_LAUDO: 'ENVIAR_LAUDO',
  ENVIAR_APROVACAO: 'ENVIAR_APROVACAO',
  REVISAO_AUDITOR: 'REVISAO_AUDITOR',
};

// O robo so olha faturas que entraram no sistema a partir desta data (as anteriores ficam com o auditor).
export const ROBO_DATA_INICIO = '2026-10-13'; // so quando a transportadora nao tem data de inclusao

// O robo considera as faturas que entraram no sistema a partir de UM DIA ANTES da data em que a
// transportadora foi incluida na lista (evita varrer o historico inteiro). Data no fuso de Brasilia.
export function dataInicioRobo(cfg) {
  // Data editada na tela vale sobre o padrao.
  if (/^\d{4}-\d{2}-\d{2}/.test(String(cfg?.data_inicio || ''))) return String(cfg.data_inicio).slice(0, 10);
  const criado = cfg?.created_at ? new Date(cfg.created_at) : null;
  if (!criado || Number.isNaN(criado.getTime())) return ROBO_DATA_INICIO;
  const brasilia = new Date(criado.getTime() - 3 * 3600000); // UTC-3
  brasilia.setUTCDate(brasilia.getUTCDate() - 1);
  return brasilia.toISOString().slice(0, 10);
}

// Data em que a fatura ENTROU no sistema (criacao do registro). Nao usar importado_em: reimportar uma fatura
// existente sobrescreve essa data (em 14/10/2026 ~1.000 faturas antigas ficaram com importado_em = 14/10).
export const dataEntradaFatura = (f) => {
  const v = f?.created_at || f?.importado_em;
  if (!v) return '';
  return new Date(new Date(v).getTime() - 3 * 3600000).toISOString().slice(0, 10); // dia em Brasilia
};

// Faturas que ainda estao na etapa de auditoria (o robo so olha para elas).
export const STATUS_ROBO_AUDITA = ['RECEBIDA', 'PRE_AUDITADA_VERUM', 'REAUDITADA_CENTRAL', 'COM_DIVERGENCIA'];

const STATUS_PAGAS = ['PAGA', 'PAGA_COM_DESCONTO', 'PAGA_COM_DIVERGENCIA'];
// Paga: status pago, data/valor de pagamento ou partida de compensacao (documento "200..."; o "190..." e so lancamento).
export const faturaPaga = (f = {}) => STATUS_PAGAS.includes(f.status) || Boolean(f.data_pagamento) || Number(f.valor_pago || 0) > 0
  || String(f.partida || '').trim().startsWith('200');
export const faturaLancadaErp = (f = {}) => Boolean(f.partida || f.lancamento_financeiro);
// Antecipacao: "Atribuição" do SAP = "Cessão". Fica em antecipacao (sem boleto) ate ser paga.
export const faturaEmAntecipacao = (f = {}) => /cess/i.test(String(f.atribuicao_sap || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')) && !faturaPaga(f);
// Laudo do robo ja resolvido por fora: baixado pelo auditor (modo TRATADA_FORA); laudo ainda nao enviado e a fatura ja
// tem partida/lancamento/pagamento; ou laudo enviado e a fatura ja foi paga. Sai das listas de laudo e das reavaliacoes.
export function laudoResolvidoFora(e = {}, f = null) {
  if (e.decisao !== DECISAO.ENVIAR_LAUDO) return false;
  if (e.modo === 'TRATADA_FORA') return true;
  if (!f) return false;
  const enviado = Boolean(e.acao_executada) || f.status === 'AGUARDANDO_TRANSPORTADORA';
  return enviado ? faturaPaga(f) : (faturaPaga(f) || faturaLancadaErp(f));
}

export const normNome = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

// Decide o que o robo faria a partir do resumo EXATO da fatura (mesmo calculo da tela da
// fatura / Aprovacao da Gestao: CT-es + tolerancia + saldo autorizado + entrega).
// `resumo` vem de resumirFaturasExato. Na duvida nunca envia: cai na fila do auditor.
export function classificarFatura(resumo, considerarMenor = false) {
  if (!resumo || !resumo.total) return { decisao: DECISAO.REVISAO_AUDITOR, motivo: 'Fatura sem CT-es vinculados.', descontar: 0 };
  const maior = Number(resumo.maior || 0);
  const menor = Number(resumo.menor || 0);
  const descontar = Number((considerarMenor ? Math.max(0, maior - menor) : maior).toFixed(2));
  if (resumo.calculados < resumo.total || Number(resumo.semCalculo || 0) > 0) {
    return { decisao: DECISAO.REVISAO_AUDITOR, motivo: `Auditoria incompleta: ${resumo.semCalculo || resumo.total - resumo.calculados} de ${resumo.total} CT-e(s) sem calculo${resumo.erroCalculo ? ` (erro no calculo: ${resumo.erroCalculo})` : (resumo.motivoSemCalculo ? ` (${resumo.motivoSemCalculo})` : '')}.`, descontar };
  }
  if (descontar > 0) {
    const brl = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
    const partes = [
      `${resumo.divergentes} de ${resumo.total} CT-e(s) divergente(s)`,
      `cobranca acima ${brl(maior)}`,
      menor > 0 ? `abaixo ${brl(menor)}` : '',
      resumo.pendentes > 0 ? `${resumo.pendentes} sem entrega comprovada` : '',
      `a descontar ${brl(descontar)}`,
    ].filter(Boolean);
    return { decisao: DECISAO.ENVIAR_LAUDO, motivo: `Laudo com desconto: ${partes.join(' · ')}.`, descontar };
  }
  if (resumo.pendentes == null) return { decisao: DECISAO.REVISAO_AUDITOR, motivo: 'Entrega nao verificada.', descontar: 0 };
  if (resumo.pendentes > 0) return { decisao: DECISAO.REVISAO_AUDITOR, motivo: `${resumo.pendentes} de ${resumo.total} CT-e(s) sem entrega comprovada.`, descontar: 0 };
  return { decisao: DECISAO.ENVIAR_APROVACAO, motivo: 'Auditoria completa, sem desconto e todos entregues.', descontar: 0 };
}

const tabelaAusente = (error) => ['42P01', 'PGRST205'].includes(error?.code) || /does not exist|schema cache/i.test(error?.message || '');

export async function listarRoboTransportadoras() {
  const { data, error } = await getSupabaseClient().from('auditor_robo_transportadoras').select('*').order('transportadora');
  if (error) {
    if (tabelaAusente(error)) return { lista: [], semTabela: true };
    throw new Error(`Erro ao carregar lista do robo: ${error.message}`);
  }
  return { lista: data || [], semTabela: false };
}

export async function salvarRoboTransportadora(registro) {
  const payload = { ...registro, updated_at: new Date().toISOString() };
  const client = getSupabaseClient();
  let { error } = await client.from('auditor_robo_transportadoras').upsert(payload, { onConflict: 'id' });
  // Colunas novas ainda sem migration: salva o resto e avisa qual migration falta.
  const migracoes = { email_automatico: '20261016_001_robo_email_automatico.sql', data_inicio: '20261017_002_robo_data_inicio_editavel.sql' };
  const faltando = Object.keys(migracoes).find((col) => error && new RegExp(col, 'i').test(error.message || '') && col in payload);
  if (faltando) {
    const { [faltando]: _ignorado, ...semColuna } = payload;
    ({ error } = await client.from('auditor_robo_transportadoras').upsert(semColuna, { onConflict: 'id' }));
    if (!error) throw new Error(`Salvo sem "${faltando}": aplique a migration ${migracoes[faltando]} no Supabase para essa opcao funcionar.`);
  }
  if (error) throw new Error(`Erro ao salvar transportadora do robo: ${error.message}`);
}

export async function removerRoboTransportadora(id) {
  const { error } = await getSupabaseClient().from('auditor_robo_transportadoras').delete().eq('id', id);
  if (error) throw new Error(`Erro ao remover: ${error.message}`);
}

// O Supabase devolve no maximo 1000 linhas por consulta (um .limit maior e ignorado): busca pagina a pagina.
// montar(de, ate) devolve a consulta com .range(de, ate); a ordenacao precisa ser estavel (inclua o id).
export async function buscarTodasPaginas(montar, maximo = 100000) {
  const linhas = [];
  for (let de = 0; de < maximo; de += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await montar(de, de + 999);
    if (error) return { data: linhas, error };
    linhas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: linhas, error: null };
}

export async function listarExecucoesRobo(limite = 100000) {
  const { data, error } = await buscarTodasPaginas((de, ate) => getSupabaseClient().from('auditor_robo_execucoes').select('*')
    .order('executado_em', { ascending: false }).order('fatura_id').range(de, ate), limite);
  if (error) {
    if (tabelaAusente(error)) return [];
    throw new Error(`Erro ao carregar execucoes do robo: ${error.message}`);
  }
  return data || [];
}

export async function gravarExecucoesRobo(registros) {
  for (let i = 0; i < registros.length; i += 200) {
    const { error } = await getSupabaseClient().from('auditor_robo_execucoes').upsert(registros.slice(i, i + 200), { onConflict: 'fatura_id' });
    if (error) throw new Error(`Erro ao gravar execucoes do robo: ${error.message}`);
  }
}

// Faturas ainda em auditoria (candidatas ao robo) e nomes de transportadora existentes.
export async function listarFaturasEmAuditoria() {
  const { data, error } = await buscarTodasPaginas((de, ate) => getSupabaseClient().from('faturas').select('*')
    .in('status', STATUS_ROBO_AUDITA).order('created_at', { ascending: false }).order('id').range(de, ate));
  if (error) throw new Error(`Erro ao carregar faturas: ${error.message}`);
  return data || []; // o corte de data e por transportadora (dataInicioRobo), aplicado por quem usa a lista
}

// Apaga so as simulacoes (nada enviado) para o robo reanalisar as faturas.
export async function limparSimulacoesRobo() {
  const { error } = await getSupabaseClient().from('auditor_robo_execucoes').delete().eq('acao_executada', false);
  if (error) throw new Error(`Erro ao limpar simulacoes: ${error.message}`);
}

// Fila do auditor: laudos esperando OK e casos para revisar (ainda nao resolvidos pelo robo).
export async function listarFilaAuditorRobo() {
  const { data, error } = await buscarTodasPaginas((de, ate) => getSupabaseClient().from('auditor_robo_execucoes').select('*')
    .eq('acao_executada', false).in('decisao', [DECISAO.ENVIAR_LAUDO, DECISAO.REVISAO_AUDITOR])
    .order('executado_em', { ascending: true }).order('fatura_id').range(de, ate));
  if (error) {
    if (tabelaAusente(error)) return [];
    throw new Error(`Erro ao carregar a fila do robo: ${error.message}`);
  }
  return data || [];
}

export async function aprovarLaudosRobo(faturaIds, usuario) {
  const agora = new Date().toISOString();
  for (let i = 0; i < faturaIds.length; i += 100) {
    const { error } = await getSupabaseClient().from('auditor_robo_execucoes')
      .update({ aprovado_auditor_por: usuario, aprovado_auditor_em: agora })
      .in('fatura_id', faturaIds.slice(i, i + 100).map(String)).eq('decisao', DECISAO.ENVIAR_LAUDO);
    if (error) throw new Error(`Erro ao aprovar laudo: ${error.message}`);
  }
}

export async function desfazerAprovacaoLaudoRobo(faturaId) {
  const { error } = await getSupabaseClient().from('auditor_robo_execucoes')
    .update({ aprovado_auditor_por: null, aprovado_auditor_em: null }).eq('fatura_id', String(faturaId));
  if (error) throw new Error(`Erro ao desfazer aprovacao: ${error.message}`);
}

// Reavalia UMA fatura agora (botao "Reavaliar agora"): calcula o que faltar, decide e, se ficou
// correta, envia para a gestao. Grava o resultado e devolve o registro.
// soEntrega: nao recalcula os CT-es; so confere de novo a entrega (tracking, comprovante, baixa aprovada) com o calculo ja gravado.
export async function reavaliarFaturaRobo(fatura, anterior, { usuario = 'auditor', aoProgredir = () => {}, pesoMaisProximo = false, soEntrega = false } = {}) {
  const core = await import('../utils/auditoriaRoboCore');
  const db = getSupabaseClient();
  const { data: cfgs } = await db.from('auditor_robo_transportadoras').select('*');
  const cfg = (cfgs || []).find((r) => normNome(r.transportadora) === normNome(fatura.transportadora)) || {};
  const emailsAuditores = await core.carregarEmailsAuditores(db);
  const registro = await core.analisarFaturaRobo(db, fatura, {
    cfg, emailsAuditores, usuario, origem: `reavaliacao ${soEntrega ? 'so entrega' : 'manual'} - ${usuario}`, anterior, aoProgredir,
    calcular: !soEntrega, recalcularTudo: !soEntrega, pesoMaisProximo,
  });
  const { error } = await db.from('auditor_robo_execucoes').upsert(registro, { onConflict: 'fatura_id' });
  if (error) throw new Error(`Erro ao gravar a reavaliacao: ${error.message}`);
  return registro;
}

// Fecha o ciclo do laudo aprovado enquanto o envio automatico nao existe: o auditor manda pelo
// fluxo atual da fatura (laudo + e-mail) e marca aqui. Sai das filas e entra em "aguardando transportadora".
export async function marcarLaudoEnviadoRobo(faturaIds, usuario) {
  const ids = (Array.isArray(faturaIds) ? faturaIds : [faturaIds]).map(String);
  const { error } = await getSupabaseClient().from('auditor_robo_execucoes')
    .update({ acao_executada: true, modo: 'LAUDO_ENVIADO', executado_por: usuario, executado_em: new Date().toISOString() })
    .in('fatura_id', ids).eq('decisao', DECISAO.ENVIAR_LAUDO);
  if (error) throw new Error(`Erro ao marcar laudo como enviado: ${error.message}`);
}

// Todas as transportadoras do cadastro (para escolher na lista do robo), sem depender de ter
// fatura em auditoria agora. Pagina para nao parar no limite de 1000 linhas.
export async function listarNomesTransportadoras() {
  const client = getSupabaseClient();
  const nomes = new Set();
  for (let inicio = 0; inicio < 20000; inicio += 1000) {
    const { data, error } = await client.from('transportadoras').select('nome').order('nome').range(inicio, inicio + 999);
    if (error || !data?.length) break;
    data.forEach((r) => { if (r.nome) nomes.add(String(r.nome).trim()); });
    if (data.length < 1000) break;
  }
  try {
    const { data } = await client.from('auditoria_carteiras').select('transportadora').limit(5000);
    (data || []).forEach((r) => { if (r.transportadora) nomes.add(String(r.transportadora).trim()); });
  } catch { /* sem carteiras */ }
  return [...nomes];
}

// ---- Configuracao do robo (editavel na tela; lida pela API do cron) ----
export const CONFIG_ROBO_PADRAO = {
  ativo: true, horas: [6, 12, 19], dias_semana: [0, 1, 2, 3, 4, 5, 6], calcular_nuvem: true,
  max_faturas: 60, bloco_ctes: 10, limite_bloco_seg: 75,
};

export async function carregarConfigRobo() {
  const { data, error } = await getSupabaseClient().from('auditor_robo_config').select('*').eq('id', 1).maybeSingle();
  if (error) {
    if (tabelaAusente(error)) return { config: { ...CONFIG_ROBO_PADRAO }, semTabela: true };
    throw new Error(`Erro ao carregar a configuracao do robo: ${error.message}`);
  }
  return { config: { ...CONFIG_ROBO_PADRAO, ...(data || {}) }, semTabela: false };
}

export async function salvarConfigRobo(config, usuario = '') {
  const payload = {
    id: 1,
    ativo: Boolean(config.ativo),
    horas: [...new Set((config.horas || []).map(Number).filter((h) => h >= 0 && h <= 23))].sort((a, b) => a - b),
    dias_semana: [...new Set((config.dias_semana || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b),
    calcular_nuvem: Boolean(config.calcular_nuvem),
    max_faturas: Math.min(Math.max(Number(config.max_faturas) || 60, 1), 300),
    bloco_ctes: Math.min(Math.max(Number(config.bloco_ctes) || 10, 1), 50),
    limite_bloco_seg: Math.min(Math.max(Number(config.limite_bloco_seg) || 75, 20), 240),
    atualizado_por: usuario || null,
    atualizado_em: new Date().toISOString(),
  };
  const { error } = await getSupabaseClient().from('auditor_robo_config').upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(tabelaAusente(error) ? 'Aplique a migration 20261016_002_auditor_robo_config.sql no Supabase para salvar a configuracao.' : `Erro ao salvar a configuracao: ${error.message}`);
  return payload;
}

// ---- Historico de execucoes (auditor_robo_rodadas) ----
export async function listarRodadasRobo(limite = 300) {
  const { data, error } = await getSupabaseClient().from('auditor_robo_rodadas').select('*')
    .order('iniciado_em', { ascending: false }).limit(limite);
  if (error) {
    if (tabelaAusente(error)) return { lista: [], semTabela: true };
    throw new Error(`Erro ao carregar o historico do robo: ${error.message}`);
  }
  return { lista: data || [], semTabela: false };
}

export async function registrarRodadaRobo(rodada) {
  try {
    await getSupabaseClient().from('auditor_robo_rodadas').insert(rodada);
  } catch { /* sem historico */ }
}

// Preferencia do auditor (por navegador): reavaliar usando o peso do Tracking quando mais proximo do cobrado.
const CHAVE_PESO_PROXIMO = 'cf_robo_reavaliar_peso_mais_proximo';
export function lerPreferenciaPesoMaisProximo() {
  try { return localStorage.getItem(CHAVE_PESO_PROXIMO) === '1'; } catch { return false; }
}
export function gravarPreferenciaPesoMaisProximo(valor) {
  try { localStorage.setItem(CHAVE_PESO_PROXIMO, valor ? '1' : '0'); } catch { /* sem armazenamento */ }
}
