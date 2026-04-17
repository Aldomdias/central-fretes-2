import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const FALLBACK_KEY = 'simulador-fretes-local-v7';

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase não configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }
  return client;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function bancoConfigurado() {
  return isSupabaseConfigured();
}

export async function carregarBaseFretesDb() {
  if (!isSupabaseConfigured()) {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  const supabase = ensureClient();

  const [transportadorasResp, origensResp, generalidadesResp, rotasResp, cotacoesResp, taxasResp] = await Promise.all([
    supabase.from('transportadoras').select('id, nome, status, created_at, updated_at').order('nome'),
    supabase.from('origens').select('id, transportadora_id, cidade, canal, status, created_at, updated_at').order('cidade'),
    supabase.from('generalidades').select('origem_id, payload, updated_at'),
    supabase.from('rotas').select('id, origem_id, payload, updated_at'),
    supabase.from('cotacoes').select('id, origem_id, payload, updated_at'),
    supabase.from('taxas_especiais').select('id, origem_id, payload, updated_at'),
  ]);

  const all = [transportadorasResp, origensResp, generalidadesResp, rotasResp, cotacoesResp, taxasResp];
  const failed = all.find((item) => item.error);
  if (failed?.error) throw failed.error;

  const generalidadesMap = new Map((generalidadesResp.data || []).map((item) => [item.origem_id, item.payload || {}]));
  const rotasMap = new Map();
  const cotacoesMap = new Map();
  const taxasMap = new Map();

  for (const row of rotasResp.data || []) {
    const list = rotasMap.get(row.origem_id) || [];
    list.push({ ...(row.payload || {}), id: row.id });
    rotasMap.set(row.origem_id, list);
  }

  for (const row of cotacoesResp.data || []) {
    const list = cotacoesMap.get(row.origem_id) || [];
    list.push({ ...(row.payload || {}), id: row.id });
    cotacoesMap.set(row.origem_id, list);
  }

  for (const row of taxasResp.data || []) {
    const list = taxasMap.get(row.origem_id) || [];
    list.push({ ...(row.payload || {}), id: row.id });
    taxasMap.set(row.origem_id, list);
  }

  const origensByTransportadora = new Map();
  for (const origem of origensResp.data || []) {
    const list = origensByTransportadora.get(origem.transportadora_id) || [];
    list.push({
      id: origem.id,
      cidade: origem.cidade,
      canal: origem.canal || 'ATACADO',
      status: origem.status || 'Ativa',
      generalidades: generalidadesMap.get(origem.id) || {},
      rotas: rotasMap.get(origem.id) || [],
      cotacoes: cotacoesMap.get(origem.id) || [],
      taxasEspeciais: taxasMap.get(origem.id) || [],
    });
    origensByTransportadora.set(origem.transportadora_id, list);
  }

  return (transportadorasResp.data || []).map((transportadora) => ({
    id: transportadora.id,
    nome: transportadora.nome,
    status: transportadora.status || 'Ativa',
    origens: origensByTransportadora.get(transportadora.id) || [],
  }));
}

export async function salvarBaseFretesDb(transportadoras) {
  const cleaned = Array.isArray(transportadoras) ? clone(transportadoras) : [];

  if (!isSupabaseConfigured()) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(cleaned));
    return { updated_at: new Date().toISOString(), modo: 'local' };
  }

  const supabase = ensureClient();

  const transportadoraRows = [];
  const origemRows = [];
  const generalidadesRows = [];
  const rotasRows = [];
  const cotacoesRows = [];
  const taxasRows = [];

  cleaned.forEach((transportadora) => {
    transportadoraRows.push({
      id: transportadora.id,
      nome: transportadora.nome,
      status: transportadora.status || 'Ativa',
    });

    (transportadora.origens || []).forEach((origem) => {
      origemRows.push({
        id: origem.id,
        transportadora_id: transportadora.id,
        cidade: origem.cidade,
        canal: origem.canal || 'ATACADO',
        status: origem.status || 'Ativa',
      });

      generalidadesRows.push({
        origem_id: origem.id,
        payload: clone(origem.generalidades || {}),
      });

      (origem.rotas || []).forEach((item) => {
        rotasRows.push({
          id: item.id,
          origem_id: origem.id,
          payload: clone(item),
        });
      });

      (origem.cotacoes || []).forEach((item) => {
        cotacoesRows.push({
          id: item.id,
          origem_id: origem.id,
          payload: clone(item),
        });
      });

      (origem.taxasEspeciais || []).forEach((item) => {
        taxasRows.push({
          id: item.id,
          origem_id: origem.id,
          payload: clone(item),
        });
      });
    });
  });

  const resetTables = [
    'taxas_especiais',
    'cotacoes',
    'rotas',
    'generalidades',
    'origens',
    'transportadoras',
  ];

  for (const table of resetTables) {
    const { error } = await supabase.from(table).delete().not('id', 'is', null);
    if (error && !String(error.message || '').includes('Results contain 0 rows')) {
      throw error;
    }
  }

  if (transportadoraRows.length) {
    const { error } = await supabase.from('transportadoras').insert(transportadoraRows);
    if (error) throw error;
  }

  if (origemRows.length) {
    const { error } = await supabase.from('origens').insert(origemRows);
    if (error) throw error;
  }

  if (generalidadesRows.length) {
    const { error } = await supabase.from('generalidades').insert(generalidadesRows);
    if (error) throw error;
  }

  if (rotasRows.length) {
    const { error } = await supabase.from('rotas').insert(rotasRows);
    if (error) throw error;
  }

  if (cotacoesRows.length) {
    const { error } = await supabase.from('cotacoes').insert(cotacoesRows);
    if (error) throw error;
  }

  if (taxasRows.length) {
    const { error } = await supabase.from('taxas_especiais').insert(taxasRows);
    if (error) throw error;
  }

  const now = new Date().toISOString();
  return { updated_at: now, modo: 'supabase' };
}

export async function testarConexaoFretesDb() {
  if (!isSupabaseConfigured()) {
    return { ok: false, mensagem: 'Supabase não configurado.' };
  }

  const supabase = ensureClient();
  const { error } = await supabase.from('transportadoras').select('id').limit(1);
  if (error) throw error;
  return { ok: true, mensagem: 'Conexão com Supabase validada.' };
}

export async function registrarImportacao(payload) {
  if (!isSupabaseConfigured()) {
    return { ok: true, mode: 'local', payload };
  }

  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('frete_importacoes')
    .insert({
      arquivo: payload.arquivo,
      tipo: payload.tipo,
      canal: payload.canal,
      inseridos: Number(payload.inseridos || 0),
      erros: clone(payload.erros || []),
      meta: clone(payload.meta || {}),
    })
    .select('id, tipo, created_at')
    .single();

  if (error) throw error;
  return { ok: true, mode: 'remote', data };
}
