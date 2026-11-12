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

const COLUNAS_LANCAMENTO = 'id,cnpj_emitente,numero_cte,serie_cte,lancamento_contabil,data_lancamento,montante,documento_compensacao,data_compensacao,empresa,codigo_fornecedor,fornecedor';

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
        .eq('acao', ACAO_CANCELADA_DIAGNOSTICO)
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
export async function marcarPrevisaoPagamento(ids = [], data = '', usuario = '') {
  if (!isSupabaseConfigured() || !ids.length) return new Map();
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error(`Data de previsão inválida: ${data}`);
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const campos = data
    ? { data_previsao_pagamento: data, previsao_pagamento_em: agora, previsao_pagamento_por: usuario || null }
    : { data_previsao_pagamento: null, previsao_pagamento_em: null, previsao_pagamento_por: null };
  const gravadas = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data: linhas, error } = await client.from('faturas').update(campos).in('id', ids.slice(i, i + 200)).select('id');
    if (error) {
      if (/previsao_pagamento/.test(error.message || '')) throw new Error('A migration 20261111_003_faturas_previsao_pagamento.sql ainda não foi aplicada no Supabase.');
      throw error;
    }
    (linhas || []).forEach((r) => gravadas.set(r.id, campos));
  }
  const dataBr = data ? data.split('-').reverse().join('/') : '';
  const historico = [...gravadas.keys()].map((id) => ({
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `prev-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fatura_id: id,
    created_at: agora,
    acao: data ? 'PREVISAO_PAGAMENTO_DEFINIDA' : 'PREVISAO_PAGAMENTO_RETIRADA',
    descricao: data ? `Previsão de pagamento definida para ${dataBr} (tela Diagnóstico).` : 'Previsão de pagamento retirada pela tela Diagnóstico.',
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

// Data do ultimo relatorio SAP importado: mostra ate quando a informacao de partida por CT-e vale.
export async function carregarUltimaImportacaoSap() {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from('ctes_lancamentos_sap')
    .select('data_lancamento').order('data_lancamento', { ascending: false, nullsFirst: false }).limit(1);
  if (error) return null;
  return data?.[0]?.data_lancamento || null;
}
