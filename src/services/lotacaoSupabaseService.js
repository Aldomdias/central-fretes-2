import { getSupabaseClient, getSupabaseInfo, isSupabaseConfigured } from '../lib/supabaseClient';
import { normalizarTexto, normalizarTipoTabela } from '../utils/lotacaoTables';

const PAGE_SIZE = 1000;
const INSERT_CHUNK_SIZE = 500;

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase não configurado. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente do projeto.');
  return client;
}

function detalheErroSupabase(error) {
  const msg = error?.message || String(error || 'Erro desconhecido no Supabase.');
  if (msg.includes('lotacao_tabelas') || msg.includes('lotacao_rotas') || msg.includes('relation') || msg.includes('does not exist') || error?.code === '42P01') {
    return `${msg}. Rode o script supabase/lotacao_schema.sql no SQL Editor do Supabase antes de usar o módulo.`;
  }
  return msg;
}

function calcularTipoNomeKey(tabela = {}) {
  const tipo = normalizarTipoTabela(tabela.tipo);
  if (tipo === 'ANTT') return 'ANTT';
  return `TRANSPORTADORA|${normalizarTexto(tabela.nome || '')}`;
}

function tabelaParaDb(tabela = {}) {
  const tipo = normalizarTipoTabela(tabela.tipo);
  return {
    id: tabela.id,
    tipo,
    nome: tipo === 'ANTT' ? 'ANTT' : tabela.nome,
    nome_normalizado: normalizarTexto(tipo === 'ANTT' ? 'ANTT' : tabela.nome || ''),
    tipo_nome_key: calcularTipoNomeKey(tabela),
    modelo: tabela.modelo || '',
    file_name: tabela.fileName || '',
    total_linhas: Number(tabela.totalLinhas || tabela.linhas?.length || 0),
    rotas_unicas: Number(tabela.rotasUnicas || 0),
    origens: Number(tabela.origens || 0),
    destinos: Number(tabela.destinos || 0),
    abas_importadas: tabela.abasImportadas || [],
    abas_ignoradas: tabela.abasIgnoradas || [],
    fontes_valor: tabela.fontesValor || {},
    resumo_fontes_valor: tabela.resumoFontesValor || '',
    created_at: tabela.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function rotaParaDb(linha = {}, tabelaId) {
  return {
    id: linha.id,
    tabela_id: tabelaId,
    chave: linha.chave || '',
    sheet_name: linha.sheetName || '',
    excel_row: linha.excelRow || null,
    transportadora: linha.transportadora || '',
    origem: linha.origem || '',
    uf_origem: linha.ufOrigem || '',
    destino: linha.destino || '',
    uf_destino: linha.ufDestino || '',
    tipo_veiculo: linha.tipo || '',
    km: linha.km ?? null,
    prazo: linha.prazo || '',
    icms: linha.icms ?? null,
    pedagio: linha.pedagio ?? null,
    target: linha.target ?? null,
    frete_antt_oficial: linha.freteAnttOficial ?? null,
    frete_antt: linha.freteAntt ?? null,
    diferenca_antt: linha.diferencaAntt ?? null,
    valor: linha.valor ?? null,
    valor_fonte: linha.valorFonte || '',
    raw: linha.raw || {},
  };
}

function dbParaRota(row = {}) {
  return {
    id: row.id,
    sheetName: row.sheet_name || '',
    excelRow: row.excel_row || null,
    transportadora: row.transportadora || '',
    origem: row.origem || '',
    ufOrigem: row.uf_origem || '',
    destino: row.destino || '',
    ufDestino: row.uf_destino || '',
    tipo: row.tipo_veiculo || '',
    km: row.km === null || row.km === undefined ? null : Number(row.km),
    prazo: row.prazo || '',
    icms: row.icms === null || row.icms === undefined ? null : Number(row.icms),
    pedagio: row.pedagio === null || row.pedagio === undefined ? null : Number(row.pedagio),
    target: row.target === null || row.target === undefined ? null : Number(row.target),
    freteAnttOficial: row.frete_antt_oficial === null || row.frete_antt_oficial === undefined ? null : Number(row.frete_antt_oficial),
    freteAntt: row.frete_antt === null || row.frete_antt === undefined ? null : Number(row.frete_antt),
    diferencaAntt: row.diferenca_antt === null || row.diferenca_antt === undefined ? null : Number(row.diferenca_antt),
    valor: row.valor === null || row.valor === undefined ? null : Number(row.valor),
    valorFonte: row.valor_fonte || '',
    chave: row.chave || '',
    raw: row.raw || {},
  };
}

function dbParaTabela(row = {}, linhas = []) {
  return {
    id: row.id,
    nome: row.nome || '',
    tipo: normalizarTipoTabela(row.tipo),
    modelo: row.modelo || '',
    fileName: row.file_name || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    linhas,
    totalLinhas: Number(row.total_linhas || linhas.length || 0),
    rotasUnicas: Number(row.rotas_unicas || 0),
    origens: Number(row.origens || 0),
    destinos: Number(row.destinos || 0),
    abasImportadas: Array.isArray(row.abas_importadas) ? row.abas_importadas : [],
    abasIgnoradas: Array.isArray(row.abas_ignoradas) ? row.abas_ignoradas : [],
    fontesValor: row.fontes_valor || {},
    resumoFontesValor: row.resumo_fontes_valor || '',
    fonteDados: 'supabase',
  };
}

async function fetchAllRows(supabase, table, orderBy = 'created_at', ascending = true, filters = null) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = supabase.from(table).select('*').range(from, from + PAGE_SIZE - 1);
    if (orderBy) query = query.order(orderBy, { ascending });
    if (typeof filters === 'function') query = filters(query);
    const { data, error } = await query;
    if (error) throw new Error(detalheErroSupabase(error));
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

export function lotacaoSupabaseConfigurado() {
  return isSupabaseConfigured();
}

export function obterInfoLotacaoSupabase() {
  return getSupabaseInfo();
}

export async function carregarTabelasLotacaoSupabase() {
  const supabase = ensureClient();
  const tabelasDb = await fetchAllRows(supabase, 'lotacao_tabelas', 'created_at', false);
  if (!tabelasDb.length) return { fonte: 'supabase', tabelas: [] };
  const tabelaIds = tabelasDb.map((item) => item.id);
  const rotasDb = await fetchAllRows(supabase, 'lotacao_rotas', 'created_at', true, (query) => query.in('tabela_id', tabelaIds));
  const rotasPorTabela = new Map();
  rotasDb.forEach((row) => {
    const atual = rotasPorTabela.get(row.tabela_id) || [];
    atual.push(dbParaRota(row));
    rotasPorTabela.set(row.tabela_id, atual);
  });
  const tabelas = tabelasDb.map((row) => dbParaTabela(row, rotasPorTabela.get(row.id) || []));
  return { fonte: 'supabase', tabelas };
}

export async function salvarTabelaLotacaoSupabase(tabela) {
  const supabase = ensureClient();
  const tabelaRow = tabelaParaDb(tabela);
  const { error: deleteError } = await supabase.from('lotacao_tabelas').delete().eq('tipo_nome_key', tabelaRow.tipo_nome_key);
  if (deleteError) throw new Error(detalheErroSupabase(deleteError));
  const { error: tabelaError } = await supabase.from('lotacao_tabelas').insert(tabelaRow);
  if (tabelaError) throw new Error(detalheErroSupabase(tabelaError));
  const rotas = (tabela.linhas || []).map((linha) => rotaParaDb(linha, tabela.id));
  for (let index = 0; index < rotas.length; index += INSERT_CHUNK_SIZE) {
    const chunk = rotas.slice(index, index + INSERT_CHUNK_SIZE);
    const { error } = await supabase.from('lotacao_rotas').insert(chunk);
    if (error) throw new Error(detalheErroSupabase(error));
  }
  return { ok: true, modo: 'supabase', tabelaId: tabela.id, rotas: rotas.length };
}

export async function removerTabelaLotacaoSupabase(tabelaId) {
  const supabase = ensureClient();
  const { error } = await supabase.from('lotacao_tabelas').delete().eq('id', tabelaId);
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true, modo: 'supabase' };
}

export async function diagnosticarLotacaoSupabase() {
  if (!isSupabaseConfigured()) return { ok: false, configured: false, erro: 'Supabase não configurado.' };
  const supabase = ensureClient();
  const [tabelas, rotas] = await Promise.all([
    supabase.from('lotacao_tabelas').select('id', { count: 'exact', head: true }),
    supabase.from('lotacao_rotas').select('id', { count: 'exact', head: true }),
  ]);
  if (tabelas.error) throw new Error(detalheErroSupabase(tabelas.error));
  if (rotas.error) throw new Error(detalheErroSupabase(rotas.error));
  return { ok: true, configured: true, info: getSupabaseInfo(), tabelas: tabelas.count || 0, rotas: rotas.count || 0 };
}
