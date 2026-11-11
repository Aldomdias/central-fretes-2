import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { identificacaoSapDoCte, resumirCtesFatura } from '../utils/diagnosticoFaturas';
import { chaveCasamentoCte, situacaoLancamentoCte } from '../utils/lancamentosCteSap';
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

async function carregarLancamentos(client, detalhes) {
  const numerosPorCnpj = new Map();
  detalhes.forEach((item) => {
    if (item.excluido_da_versao === true || ehLinhaNfse(item)) return;
    const { cnpj, numero } = identificacaoSapDoCte(item);
    if (!cnpj || numero === '0') return;
    if (!numerosPorCnpj.has(cnpj)) numerosPorCnpj.set(cnpj, new Set());
    numerosPorCnpj.get(cnpj).add(numero);
  });
  const porChave = new Map();
  for (const [cnpj, numeros] of numerosPorCnpj) {
    const lista = [...numeros];
    for (let i = 0; i < lista.length; i += LOTE_NUMEROS) {
      const lote = lista.slice(i, i + LOTE_NUMEROS);
      // eslint-disable-next-line no-await-in-loop
      const linhas = await paginarPorId(() => client.from('ctes_lancamentos_sap')
        .select('id,cnpj_emitente,numero_cte,serie_cte,lancamento_contabil,data_lancamento,montante')
        .eq('cnpj_emitente', cnpj).in('numero_cte', lote));
      linhas.forEach((l) => {
        const k = chaveCasamentoCte({ cnpj: l.cnpj_emitente, numero: l.numero_cte, serie: l.serie_cte });
        porChave.set(k, [...(porChave.get(k) || []), l]);
      });
    }
  }
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

const idHistorico = (prefixo) => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${prefixo}-${Date.now()}-${Math.random().toString(16).slice(2)}`);

// Marca como CANCELADA a fatura que nao existe mais (cancelada pela transportadora): sai das pendencias,
// mas continua na plataforma. Guarda o status anterior para desfazer. Devolve os campos gravados por id.
// faturas: [{ id, status }] (o status atual vira status_antes_cancelamento).
export async function cancelarFaturas(faturas = [], motivo = '', usuario = '') {
  if (!isSupabaseConfigured() || !faturas.length) return new Map();
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const gravadas = new Map();
  // Agrupa por status anterior: um update por grupo.
  const porStatus = new Map();
  faturas.forEach((f) => {
    const anterior = f.status || null;
    porStatus.set(anterior, [...(porStatus.get(anterior) || []), f.id]);
  });
  for (const [anterior, ids] of porStatus) {
    const campos = { status: 'CANCELADA', cancelada_em: agora, cancelada_por: usuario || null, cancelamento_motivo: motivo || null, status_antes_cancelamento: anterior };
    for (let i = 0; i < ids.length; i += 200) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await client.from('faturas').update(campos).in('id', ids.slice(i, i + 200)).select('id');
      if (error) {
        if (/cancelad|cancelamento/.test(error.message || '')) throw new Error('A migration 20261111_002_faturas_cancelamento_manual.sql ainda não foi aplicada no Supabase.');
        throw error;
      }
      (data || []).forEach((r) => gravadas.set(r.id, campos));
    }
  }
  await registrarHistorico(client, [...gravadas.keys()].map((id) => ({
    id: idHistorico('cancel'),
    fatura_id: id,
    created_at: agora,
    acao: 'FATURA_CANCELADA',
    descricao: `Fatura marcada como cancelada pela tela Diagnóstico${motivo ? `: ${motivo}` : '.'}`,
    usuario_nome: usuario || null,
    usuario_email: '',
  })));
  return gravadas;
}

// Desfaz o cancelamento manual: volta ao status anterior (ou RECEBIDA, se nao houver).
// faturas: [{ id, status_antes_cancelamento }].
export async function reativarFaturas(faturas = [], usuario = '') {
  if (!isSupabaseConfigured() || !faturas.length) return new Map();
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const gravadas = new Map();
  const porStatus = new Map();
  faturas.forEach((f) => {
    const volta = f.status_antes_cancelamento && f.status_antes_cancelamento !== 'CANCELADA' ? f.status_antes_cancelamento : 'RECEBIDA';
    porStatus.set(volta, [...(porStatus.get(volta) || []), f.id]);
  });
  for (const [volta, ids] of porStatus) {
    const campos = { status: volta, cancelada_em: null, cancelada_por: null, cancelamento_motivo: null, status_antes_cancelamento: null };
    for (let i = 0; i < ids.length; i += 200) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await client.from('faturas').update(campos).in('id', ids.slice(i, i + 200)).select('id');
      if (error) throw error;
      (data || []).forEach((r) => gravadas.set(r.id, campos));
    }
  }
  await registrarHistorico(client, [...gravadas.keys()].map((id) => ({
    id: idHistorico('reativ'),
    fatura_id: id,
    created_at: agora,
    acao: 'FATURA_REATIVADA',
    descricao: `Cancelamento desfeito pela tela Diagnóstico (voltou para ${String(gravadas.get(id).status).replaceAll('_', ' ')}).`,
    usuario_nome: usuario || null,
    usuario_email: '',
  })));
  return gravadas;
}

async function registrarHistorico(client, historico) {
  for (let i = 0; i < historico.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from('auditoria_fatura_historico').insert(historico.slice(i, i + 200));
    if (error) { console.warn('Historico da fatura nao registrado:', error.message); break; }
  }
}

// Data do ultimo relatorio SAP importado: mostra ate quando a informacao de partida por CT-e vale.
export async function carregarUltimaImportacaoSap() {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from('ctes_lancamentos_sap')
    .select('data_lancamento').order('data_lancamento', { ascending: false, nullsFirst: false }).limit(1);
  if (error) return null;
  return data?.[0]?.data_lancamento || null;
}
