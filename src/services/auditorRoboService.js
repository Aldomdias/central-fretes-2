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
// Envio direto (sem OK do auditor): ligado na transportadora e a fatura ENTROU no sistema depois que foi ligado.
// O que ja estava na fila quando ligou continua pedindo a aprovacao do auditor.
export const ROBO_ENVIO_DIRETO_POR = 'Robo (envio direto)';
// CT-e sem vinculo de NF: o laudo sai sozinho para a transportadora pedindo a retirada do CT-e da fatura.
export const ROBO_SEM_NF_POR = 'Robo (CT-e sem NF)';
export const MOTIVO_SEM_NF = 'CT-e sem vinculo de NF';
export const ctesSemNfDe = (e) => (Array.isArray(e?.ctes_sem_nf) ? e.ctes_sem_nf : []);

// Grava execucoes do robo. Sem a coluna ctes_sem_nf (migration 20261104_002 ainda nao aplicada), grava sem ela.
export async function upsertExecucoesRobo(db, registros) {
  const lista = Array.isArray(registros) ? registros : [registros];
  let { error } = await db.from('auditor_robo_execucoes').upsert(lista, { onConflict: 'fatura_id' });
  if (error && /ctes_sem_nf/i.test(error.message || '')) {
    console.warn('[robo] aplique a migration 20261104_002_robo_cte_sem_nf.sql (coluna ctes_sem_nf).');
    ({ error } = await db.from('auditor_robo_execucoes').upsert(lista.map(({ ctes_sem_nf: _x, ...r }) => r), { onConflict: 'fatura_id' }));
  }
  return { error };
}
export function envioDiretoVale(cfg, f) {
  if (!cfg?.envio_direto || !cfg?.envio_direto_desde) return false;
  const desde = new Date(cfg.envio_direto_desde).getTime();
  const entrada = new Date(f?.created_at || f?.importado_em || 0).getTime();
  return Number.isFinite(desde) && Number.isFinite(entrada) && entrada >= desde;
}

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
  // CT-e sem a chave da NF: nao pode ser pago (o vinculo com a nota fiscal e obrigatorio). Vale sobre o resto:
  // a fatura nao vai para pagamento e o laudo segue para a transportadora pedindo a retirada desses CT-es
  // (o valor deles entra no desconto, sem contar duas vezes a cobranca acima que ja tinham).
  const semNf = Array.isArray(resumo.semNf) ? resumo.semNf : [];
  // Metade ou mais dos CT-es sem a NF na base: mais provavel a base ter sido importada sem a aba "Notas Fiscais"
  // do que a transportadora ter emitido tudo errado. Nao manda laudo; o auditor confere (e reimporta a base).
  if (resumo.semNfSuspeito) {
    return {
      decisao: DECISAO.REVISAO_AUDITOR, descontar: 0,
      motivo: `CT-e sem NF: ${semNf.length} de ${resumo.total} CT-e(s) aparecem sem a chave da NF na base de CT-es. Pode ser a base importada sem a aba "Notas Fiscais": reimporte a competencia em CT-e com "Atualizar CT-e(s) existentes" e reavalie. Laudo nao enviado.`,
    };
  }
  if (semNf.length) {
    const brl = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
    const valorSemNf = semNf.reduce((a, c) => a + Number(c.valor_frete || 0), 0);
    const difSemNf = semNf.reduce((a, c) => a + Math.max(Number(c.diferenca_incluida || 0), 0), 0);
    const total = Number(Math.max(0, descontar - difSemNf + valorSemNf).toFixed(2));
    const numeros = semNf.map((c) => c.numero_cte || String(c.chave_cte || '').slice(25, 34)).filter(Boolean);
    const extra = [
      resumo.calculados < resumo.total ? `${resumo.total - resumo.calculados} CT-e(s) sem calculo` : '',
      resumo.pendentes > 0 ? `${resumo.pendentes} sem entrega comprovada` : '',
      maior - difSemNf > 0.01 ? `cobranca acima ${brl(maior - difSemNf)} nos demais` : '',
    ].filter(Boolean);
    return {
      decisao: DECISAO.ENVIAR_LAUDO, semNf: true, descontar: total,
      motivo: `${MOTIVO_SEM_NF}: ${semNf.length} de ${resumo.total} CT-e(s) sem a chave da nota fiscal dentro do CT-e (CT-e ${numeros.slice(0, 10).join(', ')}${numeros.length > 10 ? '...' : ''}) — retirar da fatura e emitir CT-e novo com a NF vinculada (${brl(valorSemNf)}). Laudo segue para a transportadora.${extra.length ? ` Tambem: ${extra.join(' · ')}.` : ''} A descontar ${brl(total)}.`,
    };
  }
  if (resumo.calculados < resumo.total || Number(resumo.semCalculo || 0) > 0) {
    // So falta NFS-e (nota de servico, nao CT-e): o robo nunca resolve; motivo proprio para o card de NFS-e.
    const semCalc = Number(resumo.semCalculo || resumo.total - resumo.calculados);
    const nfse = Number(resumo.nfse || 0);
    if (nfse > 0 && nfse >= semCalc && !resumo.erroCalculo) {
      return { decisao: DECISAO.REVISAO_AUDITOR, motivo: `NFS-e: ${nfse} de ${resumo.total} documento(s) da fatura sao nota fiscal de servico, nao CT-e. O robo nao audita NFS-e: conferir manualmente.`, descontar };
    }
    const extraNfse = nfse > 0 ? ` Inclui ${nfse} NFS-e (conferir manualmente).` : '';
    return { decisao: DECISAO.REVISAO_AUDITOR, motivo: `Auditoria incompleta: ${resumo.semCalculo || resumo.total - resumo.calculados} de ${resumo.total} CT-e(s) sem calculo${resumo.erroCalculo ? ` (erro no calculo: ${resumo.erroCalculo})` : (resumo.motivoSemCalculo ? ` (${resumo.motivoSemCalculo})` : '')}.${extraNfse}`, descontar };
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

// Campos acompanhados no registro de alteracoes (auditor_robo_transportadoras_log, migration 20261105_003).
const CAMPOS_LOG_ROBO = {
  ativo: 'Ativo',
  email_automatico: 'E-mail automatico',
  envio_direto: 'Envio direto',
  emails_transportadora: 'E-mails da transportadora',
  email_aprovacao: 'E-mail de aprovacao',
  data_inicio: 'Data de inicio',
};
export const modoEnvioRobo = (r) => (r?.envio_direto ? 'Envio direto (sem aprovacao)' : r?.email_automatico ? 'E-mail automatico (apos o OK do auditor)' : 'Auditor envia (manual)');
const valorLog = (v) => (v === true ? 'Sim' : v === false ? 'Nao' : v == null || v === '' ? '(vazio)' : String(v));
const usuarioLogRobo = (usuario) => String(usuario || '').trim() || 'usuario nao identificado';
async function gravarLogRobo(linhas) {
  if (!linhas.length) return;
  const { error } = await getSupabaseClient().from('auditor_robo_transportadoras_log').insert(linhas);
  if (error) console.warn('[robo] registro de alteracao nao gravado (migration 20261105_003 aplicada?):', error.message);
}

export async function listarLogRoboTransportadoras(limite = 100) {
  try {
    const { data, error } = await getSupabaseClient().from('auditor_robo_transportadoras_log')
      .select('*').order('created_at', { ascending: false }).limit(limite);
    if (error) throw error;
    return { lista: data || [], semTabela: false };
  } catch { return { lista: [], semTabela: true }; }
}

// usuario: quem fez a alteracao (vai para o registro de alteracoes).
export async function salvarRoboTransportadora(registro, { usuario = '' } = {}) {
  const payload = { ...registro, updated_at: new Date().toISOString() };
  const client = getSupabaseClient();
  let anterior = null;
  if (registro.id) {
    try {
      const { data } = await client.from('auditor_robo_transportadoras').select('*').eq('id', registro.id).maybeSingle();
      anterior = data || null;
    } catch { anterior = null; }
  }
  let { error } = await client.from('auditor_robo_transportadoras').upsert(payload, { onConflict: 'id' });
  // Colunas novas ainda sem migration: salva o resto e avisa qual migration falta.
  const migracoes = {
    email_automatico: '20261016_001_robo_email_automatico.sql', data_inicio: '20261017_002_robo_data_inicio_editavel.sql',
    envio_direto: '20261104_001_robo_envio_direto.sql', envio_direto_desde: '20261104_001_robo_envio_direto.sql',
  };
  const faltando = Object.keys(migracoes).find((col) => error && new RegExp(col, 'i').test(error.message || '') && col in payload);
  if (faltando) {
    const { [faltando]: _ignorado, ...semColuna } = payload;
    ({ error } = await client.from('auditor_robo_transportadoras').upsert(semColuna, { onConflict: 'id' }));
    if (!error) throw new Error(`Salvo sem "${faltando}": aplique a migration ${migracoes[faltando]} no Supabase para essa opcao funcionar.`);
  }
  if (error) throw new Error(`Erro ao salvar transportadora do robo: ${error.message}`);
  const quem = usuarioLogRobo(usuario);
  const base = { transportadora_id: String(registro.id || ''), transportadora: registro.transportadora || anterior?.transportadora || '', usuario: quem };
  if (!anterior) {
    await gravarLogRobo([{ ...base, acao: 'INCLUIDA', descricao: `Incluida no robo. Modo de envio: ${modoEnvioRobo(registro)}.` }]);
    return;
  }
  const linhas = [];
  const modoAntes = modoEnvioRobo(anterior);
  const modoDepois = modoEnvioRobo({ ...anterior, ...registro });
  if (modoAntes !== modoDepois) linhas.push({ ...base, acao: 'ALTERADA', campo: 'Modo de envio', valor_anterior: modoAntes, valor_novo: modoDepois, descricao: `Modo de envio: ${modoAntes} -> ${modoDepois}.` });
  Object.entries(CAMPOS_LOG_ROBO).forEach(([campo, rotulo]) => {
    if (!(campo in registro) || ['email_automatico', 'envio_direto'].includes(campo)) return;
    const antes = valorLog(anterior[campo]);
    const depois = valorLog(registro[campo]);
    if (antes !== depois) linhas.push({ ...base, acao: 'ALTERADA', campo: rotulo, valor_anterior: antes, valor_novo: depois, descricao: `${rotulo}: ${antes} -> ${depois}.` });
  });
  await gravarLogRobo(linhas);
}

export async function removerRoboTransportadora(id, { usuario = '' } = {}) {
  let anterior = null;
  try {
    const { data } = await getSupabaseClient().from('auditor_robo_transportadoras').select('*').eq('id', id).maybeSingle();
    anterior = data || null;
  } catch { anterior = null; }
  const { error } = await getSupabaseClient().from('auditor_robo_transportadoras').delete().eq('id', id);
  if (error) throw new Error(`Erro ao remover: ${error.message}`);
  await gravarLogRobo([{ transportadora_id: String(id), transportadora: anterior?.transportadora || '', acao: 'REMOVIDA', descricao: `Removida do robo (estava em: ${modoEnvioRobo(anterior)}).`, usuario: usuarioLogRobo(usuario) }]);
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
    const { error } = await upsertExecucoesRobo(getSupabaseClient(), registros.slice(i, i + 200));
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
export async function reavaliarFaturaRobo(fatura, anterior, { usuario = 'auditor', aoProgredir = () => {}, pesoMaisProximo = true, soEntrega = false } = {}) {
  const core = await import('../utils/auditoriaRoboCore');
  const db = getSupabaseClient();
  const { data: cfgs } = await db.from('auditor_robo_transportadoras').select('*');
  const cfg = (cfgs || []).find((r) => normNome(r.transportadora) === normNome(fatura.transportadora)) || {};
  const emailsAuditores = await core.carregarEmailsAuditores(db);
  const registro = await core.analisarFaturaRobo(db, fatura, {
    cfg, emailsAuditores, usuario, origem: `reavaliacao ${soEntrega ? 'so entrega' : 'manual'} - ${usuario}`, anterior, aoProgredir,
    calcular: !soEntrega, recalcularTudo: !soEntrega, pesoMaisProximo,
  });
  const { error } = await upsertExecucoesRobo(db, registro);
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
  max_faturas: 60, bloco_ctes: 10, limite_bloco_seg: 75, liberar_entrega_contingencia: false, checar_cte_sem_nf: true,
};

export async function carregarConfigRobo() {
  const { data, error } = await getSupabaseClient().from('auditor_robo_config').select('*').eq('id', 1).maybeSingle();
  if (error) {
    if (tabelaAusente(error)) return { config: { ...CONFIG_ROBO_PADRAO }, semTabela: true };
    throw new Error(`Erro ao carregar a configuracao do robo: ${error.message}`);
  }
  return { config: { ...CONFIG_ROBO_PADRAO, ...(data || {}) }, semTabela: false };
}

// podeContingencia: so o administrador altera o flag de contingencia; para os demais a coluna nem vai no upsert.
export async function salvarConfigRobo(config, usuario = '', podeContingencia = false) {
  const payload = {
    id: 1,
    ativo: Boolean(config.ativo),
    horas: [...new Set((config.horas || []).map(Number).filter((h) => h >= 0 && h <= 23))].sort((a, b) => a - b),
    dias_semana: [...new Set((config.dias_semana || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b),
    calcular_nuvem: Boolean(config.calcular_nuvem),
    max_faturas: Math.min(Math.max(Number(config.max_faturas) || 60, 1), 300),
    bloco_ctes: Math.min(Math.max(Number(config.bloco_ctes) || 10, 1), 50),
    limite_bloco_seg: Math.min(Math.max(Number(config.limite_bloco_seg) || 75, 20), 240),
    ...(podeContingencia ? {
      liberar_entrega_contingencia: Boolean(config.liberar_entrega_contingencia),
      checar_cte_sem_nf: Boolean(config.checar_cte_sem_nf),
      // Regra CT-e sem NF vale para as faturas que entraram a partir do momento em que foi ligada.
      checar_cte_sem_nf_desde: config.checar_cte_sem_nf ? (config.checar_cte_sem_nf_desde || new Date().toISOString()) : null,
    } : {}),
    atualizado_por: usuario || null,
    atualizado_em: new Date().toISOString(),
  };
  const { error } = await getSupabaseClient().from('auditor_robo_config').upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(tabelaAusente(error) || /liberar_entrega_contingencia|checar_cte_sem_nf/.test(error.message || '') ? 'Aplique as migrations 20261016_002, 20261028_001, 20261104_003 e 20261105_001 (auditor_robo_config) no Supabase para salvar a configuracao.' : `Erro ao salvar a configuracao: ${error.message}`);
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
  try { return localStorage.getItem(CHAVE_PESO_PROXIMO) !== '0'; } catch { return true; }
}
export function gravarPreferenciaPesoMaisProximo(valor) {
  try { localStorage.setItem(CHAVE_PESO_PROXIMO, valor ? '1' : '0'); } catch { /* sem armazenamento */ }
}
