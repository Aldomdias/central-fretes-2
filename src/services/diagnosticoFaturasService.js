import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { identificacaoSapDoCte, resumirCtesFatura } from '../utils/diagnosticoFaturas';
import { casarLancamentoPeloGrupo, chaveCasamentoCte, situacaoLancamentoCte } from '../utils/lancamentosCteSap';
import { carregarGruposRaizTransportadora } from './transportadoraCnpjsService';
import { ehLinhaNfse } from '../utils/nfseFatura';

const PAGINA = 1000;
const LOTE_FATURAS = 40;
const LOTE_NUMEROS = 200;
const COLUNAS_DETALHE = 'id,fatura_id,chave_cte,numero_cte,serie_cte,cnpj_emissor,cnpj_transportadora,valor_frete,excluido_da_versao';

async function paginarPorId(montar) {
  const todos = [];
  let ultimo = null;
  for (;;) {
    let q = montar().order('id').limit(PAGINA);
    if (ultimo) q = q.gt('id', ultimo);
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await q;
    if (error) throw error;
    todos.push(...(data || []));
    if ((data || []).length < PAGINA) return todos;
    ultimo = data[data.length - 1].id;
  }
}

async function carregarDetalhes(client, faturaIds) {
  const detalhes = [];
  for (let i = 0; i < faturaIds.length; i += LOTE_FATURAS) {
    const lote = faturaIds.slice(i, i + LOTE_FATURAS);
    // eslint-disable-next-line no-await-in-loop
    detalhes.push(...await paginarPorId(() => client.from('fatura_detalhes').select(COLUNAS_DETALHE).in('fatura_id', lote)));
  }
  return detalhes;
}

const COLUNAS_LANCAMENTO = 'id,cnpj_emitente,numero_cte,serie_cte,lancamento_contabil,data_lancamento,montante,documento_compensacao,data_compensacao,empresa,codigo_fornecedor,fornecedor,arquivo_origem';

// Raiz -> raizes da mesma transportadora (principal, origens, CNPJs adicionais). Cache curto: a tela
// verifica as faturas em lotes e nao precisa recarregar o cadastro a cada lote.
let cacheGrupos = null;
async function gruposRaiz() {
  if (cacheGrupos && Date.now() - cacheGrupos.em < 5 * 60 * 1000) return cacheGrupos.grupos;
  try {
    cacheGrupos = { em: Date.now(), grupos: await carregarGruposRaizTransportadora() };
  } catch (e) {
    console.warn('[Diagnostico] grupos de CNPJ nao carregados', e?.message || e);
    cacheGrupos = { em: Date.now(), grupos: new Map() };
  }
  return cacheGrupos.grupos;
}
export function limparCacheGruposCnpj() { cacheGrupos = null; }

async function buscarEmLotes(numeros, montar) {
  const lista = [...numeros];
  const linhas = [];
  for (let i = 0; i < lista.length; i += LOTE_NUMEROS) {
    // eslint-disable-next-line no-await-in-loop
    linhas.push(...await paginarPorId(() => montar(lista.slice(i, i + LOTE_NUMEROS))));
  }
  return linhas;
}

async function carregarLancamentos(client, detalhes) {
  const ctes = [];
  const numerosPorCnpj = new Map();
  detalhes.forEach((item) => {
    if (item.excluido_da_versao === true || ehLinhaNfse(item)) return;
    const id = identificacaoSapDoCte(item);
    if (!id.cnpj || id.numero === '0') return;
    ctes.push({ ...id, valor: Number(item.valor_frete || 0) });
    if (!numerosPorCnpj.has(id.cnpj)) numerosPorCnpj.set(id.cnpj, new Set());
    numerosPorCnpj.get(id.cnpj).add(id.numero);
  });
  const porChave = new Map();
  for (const [cnpj, numeros] of numerosPorCnpj) {
    // eslint-disable-next-line no-await-in-loop
    const linhas = await buscarEmLotes(numeros, (lote) => client.from('ctes_lancamentos_sap').select(COLUNAS_LANCAMENTO).eq('cnpj_emitente', cnpj).in('numero_cte', lote));
    linhas.forEach((l) => {
      const k = chaveCasamentoCte({ cnpj: l.cnpj_emitente, numero: l.numero_cte, serie: l.serie_cte });
      porChave.set(k, [...(porChave.get(k) || []), l]);
    });
  }

  // Sem lancamento no CNPJ do CT-e: procura nas outras empresas/filiais do grupo da transportadora.
  const faltam = ctes.filter((c) => !porChave.has(chaveCasamentoCte(c)));
  if (!faltam.length) return porChave;
  const grupos = await gruposRaiz();
  const numerosPorRaiz = new Map();
  faltam.forEach((c) => {
    const raiz = c.cnpj.slice(0, 8);
    new Set([raiz, ...(grupos.get(raiz) || [])]).forEach((r) => {
      if (!numerosPorRaiz.has(r)) numerosPorRaiz.set(r, new Set());
      numerosPorRaiz.get(r).add(c.numero);
    });
  });
  const porRaizNumero = new Map();
  for (const [raiz, numeros] of numerosPorRaiz) {
    // eslint-disable-next-line no-await-in-loop
    const linhas = await buscarEmLotes(numeros, (lote) => client.from('ctes_lancamentos_sap').select(COLUNAS_LANCAMENTO).like('cnpj_emitente', `${raiz}%`).in('numero_cte', lote));
    linhas.forEach((l) => {
      const k = `${raiz}|${Number(l.numero_cte)}`;
      porRaizNumero.set(k, [...(porRaizNumero.get(k) || []), l]);
    });
  }
  faltam.forEach((c) => {
    const raiz = c.cnpj.slice(0, 8);
    const candidatas = [...new Set([raiz, ...(grupos.get(raiz) || [])])].flatMap((r) => porRaizNumero.get(`${r}|${Number(c.numero)}`) || []);
    const casadas = casarLancamentoPeloGrupo(c, candidatas);
    if (casadas.length) porChave.set(chaveCasamentoCte(c), casadas);
  });
  return porChave;
}

// Resumo de CT-es x partida no SAP de um lote de faturas: Map(faturaId -> resumo).
export async function carregarResumoCtesFaturas(faturaIds = []) {
  if (!isSupabaseConfigured() || !faturaIds.length) return new Map();
  const client = getSupabaseClient();
  const detalhes = await carregarDetalhes(client, faturaIds);
  const lancamentos = await carregarLancamentos(client, detalhes);
  const porFatura = new Map(faturaIds.map((id) => [String(id), []]));
  detalhes.forEach((d) => porFatura.get(String(d.fatura_id))?.push(d));
  return new Map([...porFatura].map(([id, lista]) => [id, resumirCtesFatura(lista, lancamentos)]));
}

// Partida no SAP de cada CT-e de uma fatura (tela da fatura): Map(detalheId -> situacao).
// situacao: { situacao: 'COM_PARTIDA' | 'SEM_PARTIDA' | 'ESTORNADO' | 'NFSE', lancamento_contabil, data_lancamento }
export async function carregarPartidasCtes(detalhes = []) {
  if (!isSupabaseConfigured() || !detalhes.length) return new Map();
  const lancamentos = await carregarLancamentos(getSupabaseClient(), detalhes);
  return new Map(detalhes.map((item) => {
    if (ehLinhaNfse(item)) return [item.id, { situacao: 'NFSE' }];
    const sit = situacaoLancamentoCte(lancamentos.get(chaveCasamentoCte(identificacaoSapDoCte(item))) || []);
    if (sit.lancado) return [item.id, { situacao: 'COM_PARTIDA', lancamento_contabil: sit.lancamento_contabil, data_lancamento: sit.data_lancamento }];
    return [item.id, { situacao: sit.estornado ? 'ESTORNADO' : 'SEM_PARTIDA' }];
  }));
}

// Contingencia: marca/desmarca faturas que vao para protocolo por agrupamento manual (fora do AMD).
// Devolve os campos gravados por id, para atualizar a tela sem recarregar tudo.
export async function marcarAgrupamentoManual(ids = [], marcar = true, usuario = '') {
  if (!isSupabaseConfigured() || !ids.length) return new Map();
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const campos = marcar
    ? { agrupamento_manual: true, agrupamento_manual_em: agora, agrupamento_manual_por: usuario || null }
    : { agrupamento_manual: false, agrupamento_manual_em: null, agrupamento_manual_por: null };
  const gravadas = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await client.from('faturas').update(campos).in('id', ids.slice(i, i + 200)).select('id');
    if (error) {
      if (/agrupamento_manual/.test(error.message || '')) throw new Error('A migration 20261111_001_faturas_agrupamento_manual.sql ainda não foi aplicada no Supabase.');
      throw error;
    }
    (data || []).forEach((r) => gravadas.set(r.id, campos));
  }
  const historico = [...gravadas.keys()].map((id) => ({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `agrup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fatura_id: id,
    created_at: agora,
    acao: marcar ? 'AGRUPAMENTO_MANUAL_MARCADO' : 'AGRUPAMENTO_MANUAL_DESMARCADO',
    descricao: marcar ? 'Marcada para protocolo por agrupamento manual (contingência, fora do AMD) pela tela Diagnóstico.' : 'Marcação de agrupamento manual retirada pela tela Diagnóstico.',
    usuario_nome: usuario || null,
    usuario_email: '',
  }));
  for (let i = 0; i < historico.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('auditoria_fatura_historico').insert(historico.slice(i, i + 200));
    if (error) { console.warn('Historico do agrupamento manual nao registrado:', error.message); break; }
  }
  return gravadas;
}

// Cancela faturas pela tela Diagnostico (ex.: vencidas que nao serao pagas) ou desfaz. O status anterior
// fica no historico (status_anterior) e volta ao reativar. faturas: [{ id, status }].
// Devolve os campos gravados por id, para atualizar a tela sem recarregar tudo.
export const ACAO_CANCELADA_DIAGNOSTICO = 'CANCELADA_PELO_DIAGNOSTICO';
export const ACAO_SUBSTITUIDA_DUPLICIDADE = 'SUBSTITUIDA_DUPLICIDADE';
export async function marcarCanceladas(faturas = [], cancelar = true, usuario = '', motivo = '') {
  if (!isSupabaseConfigured() || !faturas.length) return new Map();
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const ids = faturas.map((f) => f.id);
  // Status de destino por fatura.
  const destino = new Map();
  if (cancelar) {
    faturas.forEach((f) => destino.set(f.id, { de: f.status || null, para: 'CANCELADA' }));
  } else {
    const ultimos = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await client.from('auditoria_fatura_historico')
        .select('fatura_id, status_anterior, created_at')
        .in('acao', [ACAO_CANCELADA_DIAGNOSTICO, ACAO_SUBSTITUIDA_DUPLICIDADE])
        .in('fatura_id', ids.slice(i, i + 200))
        .order('created_at', { ascending: false });
      if (error) throw error;
      (data || []).forEach((r) => { if (!ultimos.has(r.fatura_id)) ultimos.set(r.fatura_id, r.status_anterior); });
    }
    // Sem registro do status anterior (cancelada fora desta tela): volta como pendente.
    faturas.forEach((f) => {
      const anterior = ultimos.get(f.id);
      destino.set(f.id, { de: f.status || null, para: anterior && !['CANCELADA', 'SUBSTITUIDA'].includes(anterior) ? anterior : 'PENDENTE' });
    });
  }
  const porStatus = new Map();
  destino.forEach(({ para }, id) => porStatus.set(para, [...(porStatus.get(para) || []), id]));
  const gravadas = new Map();
  for (const [status, lista] of porStatus) {
    for (let i = 0; i < lista.length; i += 200) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await client.from('faturas').update({ status }).in('id', lista.slice(i, i + 200)).select('id');
      if (error) throw error;
      (data || []).forEach((r) => gravadas.set(r.id, { status }));
    }
  }
  const textoMotivo = String(motivo || '').trim();
  const historico = [...gravadas.keys()].map((id) => ({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `canc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fatura_id: id,
    created_at: agora,
    acao: cancelar ? ACAO_CANCELADA_DIAGNOSTICO : 'REATIVADA_PELO_DIAGNOSTICO',
    status_anterior: destino.get(id)?.de || null,
    status_novo: destino.get(id)?.para || null,
    descricao: cancelar
      ? `Cancelada pela tela Diagnóstico (não será paga).${textoMotivo ? ` Motivo: ${textoMotivo}` : ''}`
      : 'Cancelamento desfeito pela tela Diagnóstico: fatura reativada.',
    usuario_nome: usuario || null,
    usuario_email: '',
  }));
  for (let i = 0; i < historico.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('auditoria_fatura_historico').insert(historico.slice(i, i + 200));
    if (error) { console.warn('Historico do cancelamento nao registrado:', error.message); break; }
  }
  return gravadas;
}

// Duplicadas (mesma fatura importada mais de uma vez): marca as copias como SUBSTITUIDA, com a fatura
// que fica (principal) no historico. itens: [{ id, status, principalId, principalNumero, principalTransportadora }].
export async function marcarSubstituidasDuplicadas(itens = [], usuario = '') {
  if (!isSupabaseConfigured() || !itens.length) return new Map();
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const gravadas = new Map();
  const ids = itens.map((i) => i.id);
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await client.from('faturas').update({ status: 'SUBSTITUIDA' }).in('id', ids.slice(i, i + 200)).select('id');
    if (error) throw error;
    (data || []).forEach((r) => gravadas.set(r.id, { status: 'SUBSTITUIDA' }));
  }
  const historico = itens.filter((i) => gravadas.has(i.id)).map((i) => ({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `dup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fatura_id: i.id,
    created_at: agora,
    acao: ACAO_SUBSTITUIDA_DUPLICIDADE,
    status_anterior: i.status || null,
    status_novo: 'SUBSTITUIDA',
    descricao: `Fatura duplicada (mesmo número, valor e emissão): fica valendo a fatura ${i.principalNumero || ''} de ${i.principalTransportadora || '-'}. Marcada pela tela Diagnóstico.`,
    metadata: { fatura_valida_id: i.principalId },
    usuario_nome: usuario || null,
    usuario_email: '',
  }));
  for (let i = 0; i < historico.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('auditoria_fatura_historico').insert(historico.slice(i, i + 200));
    if (error) { console.warn('Historico das duplicadas nao registrado:', error.message); break; }
  }
  return gravadas;
}

// Pedido de estorno da Fenix ao financeiro (antes do protocolo). acao: 'ENVIADO' (enviada para ajustar),
// 'RETORNADO' (financeiro devolveu, falta protocolo) ou '' (desfaz). Devolve os campos gravados por id.
const DESCRICAO_FENIX = {
  ENVIADO: ['FENIX_ENVIADO_FINANCEIRO', 'Enviada ao financeiro para estornar a compensação Fênix (tela Diagnóstico).'],
  RETORNADO: ['FENIX_RETORNO_FINANCEIRO', 'Retorno do financeiro recebido: compensação Fênix ajustada, falta o protocolo (tela Diagnóstico).'],
  '': ['FENIX_AJUSTE_DESFEITO', 'Marcação do ajuste Fênix retirada pela tela Diagnóstico.'],
};

export async function marcarAjusteFenix(ids = [], acao = 'ENVIADO', usuario = '') {
  if (!isSupabaseConfigured() || !ids.length) return new Map();
  if (!(acao in DESCRICAO_FENIX)) throw new Error(`Ação de ajuste Fênix inválida: ${acao}`);
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const por = usuario || null;
  const campos = {
    ENVIADO: { fenix_ajuste_status: 'ENVIADO', fenix_enviado_em: agora, fenix_enviado_por: por, fenix_retorno_em: null, fenix_retorno_por: null },
    RETORNADO: { fenix_ajuste_status: 'RETORNADO', fenix_retorno_em: agora, fenix_retorno_por: por },
    '': { fenix_ajuste_status: null, fenix_enviado_em: null, fenix_enviado_por: null, fenix_retorno_em: null, fenix_retorno_por: null },
  }[acao];
  const gravadas = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await client.from('faturas').update(campos).in('id', ids.slice(i, i + 200)).select('id');
    if (error) {
      if (/fenix_/.test(error.message || '')) throw new Error('A migration 20261111_002_faturas_ajuste_fenix.sql ainda não foi aplicada no Supabase.');
      throw error;
    }
    (data || []).forEach((r) => gravadas.set(r.id, campos));
  }
  const [tipo, descricao] = DESCRICAO_FENIX[acao];
  const historico = [...gravadas.keys()].map((id) => ({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `fenix-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fatura_id: id,
    created_at: agora,
    acao: tipo,
    descricao,
    usuario_nome: por,
    usuario_email: '',
  }));
  for (let i = 0; i < historico.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('auditoria_fatura_historico').insert(historico.slice(i, i + 200));
    if (error) { console.warn('Historico do ajuste Fenix nao registrado:', error.message); break; }
  }
  return gravadas;
}

// Previsao de pagamento combinada (data 'AAAA-MM-DD'; vazio limpa). Devolve os campos gravados por id.
export async function marcarPrevisaoPagamento(ids = [], data = '', usuario = '', opcoes = {}) {
  if (!isSupabaseConfigured() || !ids.length) return new Map();
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error(`Data de previsão inválida: ${data}`);
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const origem = String(opcoes.origem || 'AUDITOR').toUpperCase();
  const confirmada = opcoes.confirmada === true;
  const anteriores = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data: atuais, error } = await client.from('faturas').select('id,data_previsao_pagamento').in('id', ids.slice(i, i + 200));
    if (error) throw error;
    (atuais || []).forEach((r) => anteriores.set(r.id, r.data_previsao_pagamento || null));
  }
  const campos = data
    ? { data_previsao_pagamento: data, previsao_pagamento_em: agora, previsao_pagamento_por: usuario || null, programacao_confirmada: confirmada, programacao_confirmada_em: confirmada ? agora : null }
    : { data_previsao_pagamento: null, previsao_pagamento_em: null, previsao_pagamento_por: null, programacao_confirmada: false, programacao_confirmada_em: null };
  const gravadas = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    let camposGravados = campos;
    let { data: linhas, error } = await client.from('faturas').update(camposGravados).in('id', ids.slice(i, i + 200)).select('id');
    // Migration do Portal Financeiro ausente: sem as colunas de programacao a previsao continua valendo.
    if (error && /programacao_confirmada/.test(error.message || '')) {
      const { programacao_confirmada, programacao_confirmada_em, ...semProgramacao } = campos;
      camposGravados = semProgramacao;
      ({ data: linhas, error } = await client.from('faturas').update(camposGravados).in('id', ids.slice(i, i + 200)).select('id'));
    }
    if (error) {
      if (/previsao_pagamento/.test(error.message || '')) throw new Error('A migration 20261111_003_faturas_previsao_pagamento.sql ainda não foi aplicada no Supabase.');
      throw error;
    }
    (linhas || []).forEach((r) => gravadas.set(r.id, camposGravados));
  }
  const alteradas = [...gravadas.keys()].filter((id) => anteriores.get(id) !== (data || null));
  if (alteradas.length) {
    const eventos = alteradas.map((id) => ({
      fatura_id: id, data_anterior: anteriores.get(id), data_nova: data || null,
      origem, confirmada, usuario_nome: usuario || null, created_at: agora,
    }));
    for (let i = 0; i < eventos.length; i += 200) {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await client.from('financeiro_previsao_historico').insert(eventos.slice(i, i + 200));
      if (error) {
        if (/financeiro_previsao_historico/.test(error.message || '')) throw new Error('A migration do Portal Financeiro ainda não foi aplicada no Supabase.');
        throw error;
      }
    }
  }
  const dataBr = data ? data.split('-').reverse().join('/') : '';
  const historico = [...gravadas.keys()].map((id) => ({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `prev-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fatura_id: id,
    created_at: agora,
    acao: data ? 'PREVISAO_PAGAMENTO_DEFINIDA' : 'PREVISAO_PAGAMENTO_RETIRADA',
    descricao: data ? `Previsão de pagamento definida para ${dataBr} (${origem}${confirmada ? ', confirmada' : ''}).` : 'Previsão de pagamento retirada pela tela Diagnóstico.',
    usuario_nome: usuario || null,
    usuario_email: '',
  }));
  for (let i = 0; i < historico.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('auditoria_fatura_historico').insert(historico.slice(i, i + 200));
    if (error) { console.warn('Historico da previsao de pagamento nao registrado:', error.message); break; }
  }
  return gravadas;
}

export const TIPOS_ENCAMINHAMENTO = { BOLETO_NA_PASTA: 'Boleto na pasta', DADOS_BANCARIOS: 'Dados bancários' };

// Encaminhamento ao financeiro (evidencia: boleto na pasta ou dados bancarios). Nao e programacao nem pagamento.
// Devolve os campos gravados por id; o encaminhamento anterior da fatura fica inativo, nunca apagado.
export async function marcarEncaminhamentoFinanceiro(ids = [], tipo = 'BOLETO_NA_PASTA', usuario = '', evidencia = null) {
  if (!isSupabaseConfigured() || !ids.length) return new Map();
  if (!(tipo in TIPOS_ENCAMINHAMENTO)) throw new Error(`Tipo de encaminhamento inválido: ${tipo}`);
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const campos = {
    encaminhado_financeiro_em: agora, encaminhado_financeiro_por: usuario || null,
    encaminhamento_tipo: tipo, encaminhamento_evidencia: evidencia,
  };
  const gravadas = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await client.from('faturas').update(campos).in('id', ids.slice(i, i + 200)).select('id');
    if (error) {
      if (/encaminh/.test(error.message || '')) throw new Error('A migration do Portal Financeiro ainda não foi aplicada no Supabase.');
      throw error;
    }
    (data || []).forEach((r) => gravadas.set(r.id, campos));
  }
  const ok = [...gravadas.keys()];
  for (let i = 0; i < ok.length; i += 200) {
    const lote = ok.slice(i, i + 200);
    // eslint-disable-next-line no-await-in-loop
    await client.from('financeiro_encaminhamentos').update({ ativo: false }).in('fatura_id', lote).eq('ativo', true);
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('financeiro_encaminhamentos').insert(lote.map((id) => ({ fatura_id: id, tipo, responsavel: usuario || 'Usuário', evidencia, ativo: true, created_at: agora })));
    if (error) throw new Error(`Encaminhamento gravado na fatura, mas o histórico falhou: ${error.message}`);
  }
  const historico = ok.map((id) => ({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `enc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fatura_id: id, created_at: agora, acao: 'ENCAMINHADA_FINANCEIRO',
    descricao: `Encaminhada ao financeiro (${TIPOS_ENCAMINHAMENTO[tipo]}).`, usuario_nome: usuario || null, usuario_email: '',
  }));
  for (let i = 0; i < historico.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('auditoria_fatura_historico').insert(historico.slice(i, i + 200));
    if (error) { console.warn('Historico do encaminhamento nao registrado:', error.message); break; }
  }
  return gravadas;
}

// Data do ultimo relatorio SAP importado: mostra ate quando a informacao de partida por CT-e vale.
export async function carregarUltimaImportacaoSap() {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from('ctes_lancamentos_sap')
    .select('data_lancamento').or('arquivo_origem.is.null,arquivo_origem.not.like.ROBO*').order('data_lancamento', { ascending: false, nullsFirst: false }).limit(1);
  if (error) return null;
  return data?.[0]?.data_lancamento || null;
}

// Antecipacao: marca/desmarca faturas enviadas para antecipacao. Saem de "Aptas" e ficam em "Enviadas"
// ate o SAP trazer a atribuicao "Cessao". Devolve os campos gravados por id.
export async function marcarEnviadaAntecipacao(ids = [], marcar = true, usuario = '') {
  if (!isSupabaseConfigured() || !ids.length) return new Map();
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const campos = marcar
    ? { antecipacao_enviada: true, antecipacao_enviada_em: agora, antecipacao_enviada_por: usuario || null }
    : { antecipacao_enviada: false, antecipacao_enviada_em: null, antecipacao_enviada_por: null };
  const gravadas = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await client.from('faturas').update(campos).in('id', ids.slice(i, i + 200)).select('id');
    if (error) {
      if (/antecipacao_enviada/.test(error.message || '')) throw new Error('A migration 20261116_002_faturas_enviada_antecipacao.sql ainda não foi aplicada no Supabase.');
      throw error;
    }
    (data || []).forEach((r) => gravadas.set(r.id, campos));
  }
  const historico = [...gravadas.keys()].map((id) => ({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `antec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fatura_id: id,
    created_at: agora,
    acao: marcar ? 'ANTECIPACAO_ENVIADA' : 'ANTECIPACAO_ENVIADA_DESMARCADA',
    descricao: marcar ? 'Enviada para antecipação (marcada na tela Diagnóstico).' : 'Marcação de envio para antecipação retirada pela tela Diagnóstico.',
    usuario_nome: usuario || null,
    usuario_email: '',
  }));
  for (let i = 0; i < historico.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('auditoria_fatura_historico').insert(historico.slice(i, i + 200));
    if (error) { console.warn('Historico da antecipacao nao registrado:', error.message); break; }
  }
  return gravadas;
}
