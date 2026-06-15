import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { gerarProtocolo, isoDate } from '../utils/auditoriaFretesDomain';

const STORAGE_KEY = 'central_fretes_plataforma_auditoria_440_v1';

function uid(prefix) {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function demoState() {
  const faturas = [
    {
      id: 'fat-demo-1', numero_fatura: '84521', transportadora: 'Tomasi', data_emissao: addDays(-8),
      data_vencimento: addDays(2), valor_fatura: 128450.72, valor_calculado: 124930.5, diferenca: 3520.22,
      valor_recuperado: 2100, ctes_totais: 38, ctes_vinculados: 38, ctes_auditados: 38,
      ctes_divergentes: 3, ctes_sem_calculo: 1, ctes_sem_tabela: 0, auditor_nome: 'Joao',
      auditor_email: 'joao@amdlog.local', status: 'COM_DIVERGENCIA', boleto_status: 'RECEBIDO',
    },
    {
      id: 'fat-demo-2', numero_fatura: 'WM-2026-190', transportadora: 'WM', data_emissao: addDays(-5),
      data_vencimento: addDays(6), valor_fatura: 88730, valor_calculado: 88730, diferenca: 0,
      ctes_totais: 27, ctes_vinculados: 27, ctes_auditados: 27, ctes_divergentes: 0,
      ctes_sem_calculo: 0, ctes_sem_tabela: 0, auditor_nome: 'Maria',
      auditor_email: 'maria@amdlog.local', status: 'PRONTA_PARA_PAGAMENTO', boleto_status: 'RECEBIDO',
    },
    {
      id: 'fat-demo-3', numero_fatura: 'AT-7781', transportadora: 'Atual', data_emissao: addDays(-12),
      data_vencimento: addDays(-1), valor_fatura: 64200, valor_calculado: 63000, diferenca: 1200,
      ctes_totais: 19, ctes_vinculados: 18, ctes_auditados: 18, ctes_divergentes: 2,
      ctes_sem_calculo: 1, ctes_sem_tabela: 1, auditor_nome: 'Joao',
      auditor_email: 'joao@amdlog.local', status: 'AGUARDANDO_TRANSPORTADORA', boleto_status: 'SEM_BOLETO',
    },
    {
      id: 'fat-demo-4', numero_fatura: 'CP-00441', transportadora: 'CP Comercial', data_emissao: addDays(-15),
      data_vencimento: addDays(1), valor_fatura: 45110.35, valor_calculado: 45110.35, diferenca: 0,
      ctes_totais: 14, ctes_vinculados: 14, ctes_auditados: 14, ctes_divergentes: 0,
      ctes_sem_calculo: 0, ctes_sem_tabela: 0, auditor_nome: '', auditor_email: '',
      status: 'ENVIADA_AO_FINANCEIRO', boleto_status: 'ENVIADO_FINANCEIRO',
    },
  ];
  const detalhes = {
    'fat-demo-1': [
      { id: 'cte-d1', chave_cte: '35260600000000000000570010000018211000018210', numero_cte: '1821', valor_frete: 4250.22, calculado_frete: 3900, diferenca: 350.22, status: 'DIVERGENTE', motivo_divergencia: 'TARIFA_DIVERGENTE', observacao: 'Tarifa acima da tabela.' },
      { id: 'cte-d2', chave_cte: '35260600000000000000570010000018221000018220', numero_cte: '1822', valor_frete: 3170, calculado_frete: 0, diferenca: 3170, status: 'SEM_CALCULO', motivo_divergencia: 'SEM_TABELA', observacao: 'Rota sem tabela vigente.' },
      { id: 'cte-d3', chave_cte: '35260600000000000000570010000018231000018230', numero_cte: '1823', valor_frete: 2890, calculado_frete: 2890, diferenca: 0, status: 'OK', observacao: '' },
    ],
    'fat-demo-2': [
      { id: 'cte-d4', chave_cte: '41260600000000000000570010000099211000099210', numero_cte: '9921', valor_frete: 3286.3, calculado_frete: 3286.3, diferenca: 0, status: 'OK' },
    ],
    'fat-demo-3': [
      { id: 'cte-d5', chave_cte: '42260600000000000000570010000044011000044010', numero_cte: '4401', valor_frete: 5400, calculado_frete: 4200, diferenca: 1200, status: 'DIVERGENTE', motivo_divergencia: 'ADICIONAL_INDEVIDO' },
    ],
    'fat-demo-4': [],
  };
  return {
    faturas,
    detalhes,
    carteiras: [
      { id: 'cart-1', transportadora: 'Tomasi', auditor_nome: 'Joao', auditor_email: 'joao@amdlog.local' },
      { id: 'cart-2', transportadora: 'Atual', auditor_nome: 'Joao', auditor_email: 'joao@amdlog.local' },
      { id: 'cart-3', transportadora: 'Brenex', auditor_nome: 'Joao', auditor_email: 'joao@amdlog.local' },
      { id: 'cart-4', transportadora: 'WM', auditor_nome: 'Maria', auditor_email: 'maria@amdlog.local' },
      { id: 'cart-5', transportadora: 'Tausen', auditor_nome: 'Maria', auditor_email: 'maria@amdlog.local' },
      { id: 'cart-6', transportadora: 'CP Comercial', auditor_nome: '', auditor_email: '' },
    ],
    tratativas: [
      { id: 'trt-1', fatura_id: 'fat-demo-1', protocolo: 'TRT-2026-000001', descricao: 'Validar tarifa e solicitar correcao.', status: 'AGUARDANDO_TRANSPORTADORA', prazo_sla: addDays(1), created_at: new Date().toISOString() },
    ],
    historico: [
      { id: 'hist-1', fatura_id: 'fat-demo-1', acao: 'FATURA_RECEBIDA', descricao: 'Fatura importada do Verum.', created_at: new Date(Date.now() - 86400000 * 8).toISOString(), usuario_nome: 'Sistema' },
      { id: 'hist-2', fatura_id: 'fat-demo-1', acao: 'REAUDITORIA_CONCLUIDA', descricao: '3 divergencias identificadas.', created_at: new Date(Date.now() - 86400000 * 2).toISOString(), usuario_nome: 'Joao' },
    ],
    doccobs: [],
    protocolos: [
      { id: 'fin-1', protocolo: 'FIN-2026-000001', fatura_ids: ['fat-demo-4'], valor: 45110.35, canal: 'PROTOCOLO_FINANCEIRO', status: 'ENVIADO', lote: '2026-06-13 14:00', responsavel_nome: 'Maria', created_at: new Date().toISOString() },
    ],
    solicitacoes: [
      { id: 'sol-1', protocolo: 'FIN-SLA-2026-000001', tipo: 'COMPROVANTE_PAGAMENTO', descricao: 'Enviar comprovante da fatura CP-00441.', status: 'ABERTA', prazo_sla: addDays(1), responsavel_nome: 'Financeiro', created_at: new Date().toISOString() },
    ],
    solicitacaoHistorico: [],
    boletos: faturas.map((fatura) => ({
      id: `bol-${fatura.id}`, fatura_id: fatura.id, status: fatura.boleto_status, vencimento: fatura.data_vencimento,
    })),
    pagamentos: [],
  };
}

function readLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (parsed?.faturas) return parsed;
  } catch {
    // Recria a base local quando o armazenamento estiver invalido.
  }
  const initial = demoState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function writeLocal(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

async function safeSelect(table, order = 'created_at') {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseClient();
  const { data, error } = await client.from(table).select('*').order(order, { ascending: false }).limit(1000);
  if (error) return null;
  return data || [];
}

async function safeUpsert(table, payload) {
  if (!isSupabaseConfigured()) return false;
  const client = getSupabaseClient();
  const { error } = await client.from(table).upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(`Erro ao salvar em ${table}: ${error.message}`);
  return true;
}

export async function carregarPlataformaAuditoria() {
  const local = readLocal();
  if (!isSupabaseConfigured()) return { ...local, modo: 'DEMONSTRACAO_LOCAL' };

  const [faturas, carteiras, tratativas, historico, doccobs, protocolos, solicitacoes, solicitacaoHistorico, boletos, pagamentos] = await Promise.all([
    safeSelect('faturas'),
    safeSelect('auditoria_carteiras', 'transportadora'),
    safeSelect('tratativas'),
    safeSelect('auditoria_fatura_historico'),
    safeSelect('auditoria_doccobs'),
    safeSelect('financeiro_protocolos'),
    safeSelect('financeiro_solicitacoes'),
    safeSelect('financeiro_solicitacao_historico'),
    safeSelect('financeiro_boletos', 'vencimento'),
    safeSelect('financeiro_pagamentos', 'data_pagamento'),
  ]);

  const state = {
    ...local,
    faturas: faturas?.length ? faturas : local.faturas,
    carteiras: carteiras || local.carteiras,
    tratativas: tratativas || local.tratativas,
    historico: historico || local.historico,
    doccobs: doccobs || local.doccobs,
    protocolos: protocolos || local.protocolos,
    solicitacoes: solicitacoes || local.solicitacoes,
    solicitacaoHistorico: solicitacaoHistorico || local.solicitacaoHistorico || [],
    boletos: boletos || local.boletos,
    pagamentos: pagamentos || local.pagamentos,
    modo: faturas ? 'SUPABASE' : 'DEMONSTRACAO_LOCAL',
  };

  if (faturas?.length) {
    const detalhes = {};
    await Promise.all(faturas.slice(0, 100).map(async (fatura) => {
      const client = getSupabaseClient();
      const { data } = await client.from('fatura_detalhes').select('*').eq('fatura_id', fatura.id).order('numero_cte');
      detalhes[fatura.id] = data || [];
    }));
    state.detalhes = { ...local.detalhes, ...detalhes };
  }
  writeLocal(state);
  return state;
}

export async function atualizarFaturaAuditoria(state, fatura, evento) {
  const next = {
    ...state,
    faturas: state.faturas.map((item) => item.id === fatura.id ? { ...item, ...fatura, updated_at: new Date().toISOString() } : item),
  };
  await safeUpsert('faturas', fatura);
  if (evento) {
    const historico = {
      id: uid('hist'), fatura_id: fatura.id, created_at: new Date().toISOString(), ...evento,
    };
    next.historico = [historico, ...(next.historico || [])];
    await safeUpsert('auditoria_fatura_historico', historico);
  }
  return writeLocal(next);
}

export async function salvarCarteiraAuditoria(state, carteira) {
  const payload = { id: carteira.id || uid('cart'), ...carteira, updated_at: new Date().toISOString() };
  const existe = state.carteiras.some((item) => item.id === payload.id);
  const next = { ...state, carteiras: existe
    ? state.carteiras.map((item) => item.id === payload.id ? payload : item)
    : [...state.carteiras, payload] };
  await safeUpsert('auditoria_carteiras', payload);
  return writeLocal(next);
}

export async function registrarDoccob(state, doccob) {
  const payload = { id: uid('doccob'), created_at: new Date().toISOString(), ...doccob };
  const next = { ...state, doccobs: [payload, ...(state.doccobs || [])] };
  await safeUpsert('auditoria_doccobs', payload);
  return writeLocal(next);
}

export async function criarProtocoloFinanceiro(state, dados) {
  const payload = {
    id: uid('fin'),
    protocolo: gerarProtocolo('FIN', state.protocolos),
    status: 'ENVIADO',
    created_at: new Date().toISOString(),
    ...dados,
  };
  const next = { ...state, protocolos: [payload, ...state.protocolos] };
  await safeUpsert('financeiro_protocolos', payload);
  return writeLocal(next);
}

export async function criarSolicitacaoFinanceira(state, dados) {
  const payload = {
    id: uid('fin-sla'),
    protocolo: gerarProtocolo('FIN-SLA', state.solicitacoes),
    status: 'ABERTA',
    created_at: new Date().toISOString(),
    ...dados,
  };
  const next = { ...state, solicitacoes: [payload, ...state.solicitacoes] };
  await safeUpsert('financeiro_solicitacoes', payload);
  return writeLocal(next);
}

export async function atenderSolicitacaoFinanceira(state, solicitacao, atendimento) {
  const agora = new Date().toISOString();
  const statusAnterior = solicitacao.status;
  const payload = {
    ...solicitacao,
    status: atendimento.status,
    responsavel_id: atendimento.responsavel_id || solicitacao.responsavel_id || null,
    responsavel_nome: atendimento.responsavel_nome || solicitacao.responsavel_nome || 'Financeiro',
    concluido_em: atendimento.status === 'CONCLUIDA' ? agora : null,
    updated_at: agora,
  };
  const evento = {
    id: uid('fin-hist'),
    solicitacao_id: solicitacao.id,
    acao: atendimento.status,
    comentario: atendimento.comentario || '',
    anexos: atendimento.anexo_nome ? [{ nome: atendimento.anexo_nome }] : [],
    usuario_id: atendimento.usuario_id || '',
    usuario_nome: atendimento.usuario_nome || '',
    created_at: agora,
  };
  const next = {
    ...state,
    solicitacoes: state.solicitacoes.map((item) => item.id === solicitacao.id ? payload : item),
    solicitacaoHistorico: [evento, ...(state.solicitacaoHistorico || [])],
  };
  await safeUpsert('financeiro_solicitacoes', payload);
  await safeUpsert('financeiro_solicitacao_historico', evento);
  return writeLocal(next);
}

export async function salvarBoletoFinanceiro(state, boleto) {
  const payload = { id: boleto.id || uid('bol'), ...boleto, updated_at: new Date().toISOString() };
  const existe = state.boletos.some((item) => item.fatura_id === payload.fatura_id);
  const next = { ...state, boletos: existe
    ? state.boletos.map((item) => item.fatura_id === payload.fatura_id ? { ...item, ...payload } : item)
    : [payload, ...state.boletos] };
  await safeUpsert('financeiro_boletos', payload);
  return writeLocal(next);
}

export async function salvarPagamentosFinanceiros(state, pagamentos) {
  const novos = pagamentos.map((item) => ({ id: item.id || uid('pag'), imported_at: new Date().toISOString(), ...item }));
  const next = { ...state, pagamentos: [...novos, ...state.pagamentos] };
  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    await client.from('financeiro_pagamentos').upsert(novos, { onConflict: 'id' });
  }
  return writeLocal(next);
}

export function restaurarDemonstracaoAuditoria() {
  return writeLocal(demoState());
}
