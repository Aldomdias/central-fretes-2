import { getSupabaseClient, getSupabaseInfo, isSupabaseConfigured } from '../lib/supabaseClient';
import { normalizarTexto, normalizarTipoTabela } from '../utils/lotacaoTables';
import { filtrarCpComercialCte } from './cteBasePolicy';

const PAGE_SIZE = 1000;
const INSERT_CHUNK_SIZE = 500;

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase não configurado. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente do projeto.');
  return client;
}

function detalheErroSupabase(error) {
  const msg = error?.message || String(error || 'Erro desconhecido no Supabase.');
  if (msg.includes('lotacao_tabelas') || msg.includes('lotacao_rotas') || msg.includes('lotacao_cargas') || msg.includes('lotacao_lancamentos') || msg.includes('lotacao_solicitacoes') || msg.includes('relation') || msg.includes('does not exist') || error?.code === '42P01') {
    return `${msg}. Rode o script supabase/lotacao_schema.sql no SQL Editor do Supabase antes de usar o módulo.`;
  }
  return msg;
}

const COLUNAS_COMPAT_PENDENCIA = [
  'valor_original',
  'valor_adicional_aprovado',
  'valor_final_autorizado',
  'aprovado_por_user_id',
  'aprovado_por_name',
  'aprovado_por_email',
  'aprovado_em',
  'motivo_recusa',
  'resposta_operacao',
  'justificativa_operacao',
  'resposta_auditoria',
  'auditado_ok_em',
  'devolvido_auditoria_em',
  'prazo_operacao_em',
  'prazo_auditoria_em',
];

const COLUNAS_RESPOSTA_PENDENCIA = [
  'motivo_recusa',
  'resposta_operacao',
  'justificativa_operacao',
  'resposta_auditoria',
];

function colunasPendenciaComErro(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return COLUNAS_COMPAT_PENDENCIA.filter((coluna) => msg.includes(coluna));
}

function erroColunasAprovacaoPendencia(error) {
  return colunasPendenciaComErro(error).length > 0;
}

function removerColunasPendenciaComErro(row = {}, error) {
  const colunas = colunasPendenciaComErro(error);
  if (!colunas.length) return { ...row };

  const colunasRespostaPerdidas = colunas.filter((coluna) => (
    COLUNAS_RESPOSTA_PENDENCIA.includes(coluna)
    && row[coluna] !== undefined
    && row[coluna] !== null
    && String(row[coluna]).trim() !== ''
  ));
  if (colunasRespostaPerdidas.length) {
    throw new Error(`Campo(s) de resposta/tratamento ausente(s) em audit_pendencias: ${colunasRespostaPerdidas.join(', ')}. Ajuste o schema antes de concluir a pendência para não perder o tratamento.`);
  }

  const compat = { ...row };
  colunas.forEach((coluna) => { delete compat[coluna]; });
  return compat;
}

function semColunasAprovacaoPendencia(row = {}) {
  const compat = { ...row };
  COLUNAS_COMPAT_PENDENCIA.forEach((coluna) => { delete compat[coluna]; });
  return compat;
}

async function atualizarLinhaUnicaSupabase(query, descricaoRegistro) {
  const { data, error } = await query.select('id').maybeSingle();
  if (error) throw new Error(detalheErroSupabase(error));
  if (!data?.id) throw new Error(`${descricaoRegistro} não foi encontrado ou nenhuma linha foi atualizada no Supabase.`);
  return data;
}

function erroColunasSolicitacaoInfo(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return [
    'resposta',
    'resposta_operacao',
    'observacao_tratamento',
    'respondido_por_id',
    'respondido_por_nome',
    'respondido_por_email',
    'respondido_em',
  ].filter((coluna) => msg.includes(coluna));
}

function removerColunasSolicitacaoInfoComErro(row = {}, error) {
  const colunas = erroColunasSolicitacaoInfo(error);
  const colunasRespostaPerdidas = colunas.filter((coluna) => (
    ['resposta', 'resposta_operacao', 'observacao_tratamento'].includes(coluna)
    && row[coluna] !== undefined
    && row[coluna] !== null
    && String(row[coluna]).trim() !== ''
  ));
  if (colunasRespostaPerdidas.length) {
    throw new Error(`Campo(s) de resposta/tratamento ausente(s) em audit_solicitacoes_informacao: ${colunasRespostaPerdidas.join(', ')}. Ajuste o schema antes de concluir o questionamento para não misturar resposta com a descrição original.`);
  }
  const compat = { ...row };
  colunas.forEach((coluna) => { delete compat[coluna]; });
  return compat;
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

// ============================================================
// CARGAS DE LOTAÃ‡ÃƒO â€” salvar e carregar do Supabase
// ============================================================

function parseDateSafe(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor.toISOString();
  const s = String(valor).trim();
  if (!s) return null;
  // Tenta parse direto
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  // Tenta formato BR: dd/mm/yyyy ou dd/mm/yy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (m) {
    const ano = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : new Date().getFullYear();
    const d2 = new Date(`${ano}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
    if (!isNaN(d2.getTime())) return d2.toISOString();
  }
  return null;
}

function numSafe(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function cargaParaDb(carga = {}, arquivoOrigem = '') {
  return {
    dist:              String(carga.dist              || '').slice(0, 200),
    referencia:        String(carga.referencia        || '').slice(0, 200),
    operacao:          String(carga.operacao          || '').slice(0, 100),
    origem:            String(carga.origem            || '').slice(0, 200),
    uf_origem:         String(carga.ufOrigem          || '').slice(0, 10),
    destino:           String(carga.destino           || '').slice(0, 200),
    uf_destino:        String(carga.ufDestino         || '').slice(0, 10),
    status:            String(carga.status            || '').slice(0, 100),
    transportadora:    String(carga.transportadora    || '').slice(0, 200),
    placa_cavalo:      String(carga.placaCavalo       || '').slice(0, 20),
    placa_carreta:     String(carga.placaCarreta      || '').slice(0, 20),
    tipo_veiculo:      String(carga.tipoVeiculo       || '').slice(0, 100),
    eixos:             String(carga.eixos             || '').slice(0, 20),
    cubagem:           numSafe(carga.cubagem),
    coleta_planejada:  parseDateSafe(carga.coletaPlanejada),
    coleta_realizada:  parseDateSafe(carga.coletaRealizada),
    emissao_nf:        parseDateSafe(carga.emissaoNf),
    frete_cantu:       numSafe(carga.freteCantu),
    frete_transp:      numSafe(carga.freteTransp),
    valor_comparacao:  numSafe(carga.valorComparacao),
    pedagio:           numSafe(carga.pedagio),
    seguro:            String(carga.seguro            || '').slice(0, 200),
    cte:               (Array.isArray(carga.ctes) ? carga.ctes.join(';') : (carga.cte || '')).slice(0, 500),
    liberado:          Boolean(carga.liberado),
    descarga:          Boolean(carga.descarga),
    finalizado:        Boolean(carga.finalizado),
    ocorrencia:        String(carga.ocorrencia        || '').slice(0, 500),
    arquivo_origem:    String(arquivoOrigem || '').slice(0, 200),
  };
}

function dbParaCarga(row = {}) {
  const ctes = row.cte ? row.cte.split(';').filter(Boolean) : [];
  return {
    id:              row.id,
    dist:            row.dist            || '',
    distKey:         normalizarTexto(row.dist || ''),
    referencia:      row.referencia      || '',
    operacao:        row.operacao        || '',
    origem:          row.origem          || '',
    origemKey:       normalizarTexto(row.origem || ''),
    ufOrigem:        row.uf_origem       || '',
    destino:         row.destino         || '',
    destinoKey:      normalizarTexto(row.destino || ''),
    ufDestino:       row.uf_destino      || '',
    status:          row.status          || '',
    transportadora:  row.transportadora  || '',
    transportadoraKey: normalizarTexto(row.transportadora || ''),
    placaCavalo:     row.placa_cavalo    || '',
    placaCarreta:    row.placa_carreta   || '',
    tipoVeiculo:     row.tipo_veiculo    || '',
    tipoKey:         normalizarTexto(row.tipo_veiculo || 'GERAL'),
    eixos:           row.eixos           || '',
    cubagem:         row.cubagem         != null ? Number(row.cubagem)         : null,
    coletaPlanejada: row.coleta_planejada || null,
    coletaRealizada: row.coleta_realizada || null,
    emissaoNf:       row.emissao_nf      || null,
    freteCantu:      row.frete_cantu     != null ? Number(row.frete_cantu)     : null,
    freteTransp:     row.frete_transp    != null ? Number(row.frete_transp)    : null,
    valorComparacao: row.valor_comparacao!= null ? Number(row.valor_comparacao): null,
    pedagio:         row.pedagio         != null ? Number(row.pedagio)         : null,
    seguro:          row.seguro          || '',
    cteRaw:          row.cte             || '',
    ctes,
    cteKeys:         ctes.map(normalizarTexto),
    liberado:        Boolean(row.liberado),
    descarga:        Boolean(row.descarga),
    finalizado:      Boolean(row.finalizado),
    ocorrencia:      row.ocorrencia      || '',
    arquivoOrigem:   row.arquivo_origem  || '',
    importadoEm:     row.importado_em    || '',
    rotaKey:         [normalizarTexto(row.origem || ''), normalizarTexto(row.destino || ''), normalizarTexto(row.tipo_veiculo || 'GERAL')].join('|'),
    regraCalculo:    'Valor carregado do Supabase',
  };
}

function chaveCargaIdentica(carga = {}) {
  const numero = (valor) => {
    const parsed = Number(valor);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
  };
  return [
    normalizarTexto(carga.dist || ''),
    numero(carga.valorComparacao),
    numero(carga.freteCantu),
    numero(carga.freteTransp),
    numero(carga.pedagio),
    numero(carga.icmsRemovido),
  ].join('|');
}

export async function removerCargasDuplicadasLotacaoSupabase() {
  if (!isSupabaseConfigured()) return { ok: false, removidas: 0 };

  const supabase = ensureClient();
  const cargas = await carregarCargasLotacaoSupabase({});
  const ordenadas = [...cargas].sort((a, b) => {
    const dataA = new Date(a.importadoEm || 0).getTime() || 0;
    const dataB = new Date(b.importadoEm || 0).getTime() || 0;
    return dataB - dataA;
  });
  const vistas = new Set();
  const idsDuplicados = [];

  for (const carga of ordenadas) {
    const chave = chaveCargaIdentica(carga);
    if (vistas.has(chave)) {
      if (carga.id) idsDuplicados.push(carga.id);
      continue;
    }
    vistas.add(chave);
  }

  const CHUNK = 200;
  for (let i = 0; i < idsDuplicados.length; i += CHUNK) {
    const ids = idsDuplicados.slice(i, i + CHUNK);
    const { error } = await supabase.from('lotacao_cargas').delete().in('id', ids);
    if (error) throw new Error(detalheErroSupabase(error));
  }

  return { ok: true, removidas: idsDuplicados.length };
}

export async function salvarCargasLotacaoSupabase(cargas = [], arquivoOrigem = '') {
  if (!isSupabaseConfigured()) return { ok: false, modo: 'local', total: 0 };
  if (!cargas.length) return { ok: true, modo: 'supabase', total: 0 };

  const supabase = ensureClient();
  const rows = cargas.map(c => cargaParaDb(c, arquivoOrigem));
  const CHUNK = 500;
  let total = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('lotacao_cargas').insert(chunk);
    if (error) throw new Error(detalheErroSupabase(error));
    total += chunk.length;
  }

  const deduplicacao = await removerCargasDuplicadasLotacaoSupabase();
  return {
    ok: true,
    modo: 'supabase',
    total,
    duplicadasRemovidas: deduplicacao.removidas || 0,
  };
}

export async function carregarCargasLotacaoSupabase(filtros = {}) {
  if (!isSupabaseConfigured()) return [];

  const supabase = ensureClient();
  const PAGE = 1000;
  let todas = [];
  let pagina = 0;
  let continuar = true;

  while (continuar) {
    let query = supabase
      .from('lotacao_cargas')
      .select('*')
      .order('coleta_realizada', { ascending: false })
      .range(pagina * PAGE, (pagina + 1) * PAGE - 1);

    if (filtros.origem)         query = query.ilike('origem', `%${filtros.origem}%`);
    if (filtros.destino)        query = query.ilike('destino', `%${filtros.destino}%`);
    if (filtros.transportadora) query = query.ilike('transportadora', `%${filtros.transportadora}%`);
    if (filtros.tipoVeiculo)    query = query.ilike('tipo_veiculo', `%${filtros.tipoVeiculo}%`);
    if (filtros.inicio)         query = query.gte('coleta_realizada', filtros.inicio);
    if (filtros.fim)            query = query.lte('coleta_realizada', filtros.fim);
    if (filtros.limit)          { query = query.limit(filtros.limit); continuar = false; }

    const { data, error } = await query;
    if (error) throw new Error(detalheErroSupabase(error));

    todas = todas.concat((data || []).map(dbParaCarga));
    if (!filtros.limit) {
      continuar = (data || []).length === PAGE;
      pagina++;
      if (pagina > 50) break;
    }
  }

  return todas;
}


const FONTES_CTE_AUDITORIA_LOTACAO = [
  { tabela: 'realizado_local_ctes', campoData: 'data_emissao', prioridade: 1 },
  { tabela: 'realizado_ctes_enxuta', campoData: 'data_emissao', prioridade: 2 },
  { tabela: 'realizado_ctes', campoData: 'emissao', prioridade: 3 },
];

function somenteDigitos(valor = '') {
  return String(valor || '').replace(/\D/g, '');
}

function pickCteCampo(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function numeroValorCte(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value).trim();
  if (!text) return 0;
  text = text.replace(/R\$|%/gi, '').replace(/\s+/g, '');
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    text = text.replace(',', '.');
  } else if (hasDot) {
    const parts = text.split('.');
    const pareceMilhar = parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
    if (pareceMilhar) text = parts.join('');
  }
  const parsed = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function valorAuditoriaCte(row = {}, pick = () => '') {
  return numeroValorCte(pick(['valor_cte', 'valorCte', 'valor_frete', 'frete']));
}

function normalizarCteLotacaoAuditoria(row = {}, fonte = '') {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  const pick = (keys) => pickCteCampo(row, keys) || pickCteCampo(raw, keys);
  const dataEmissao = pick(['data_emissao', 'emissao', 'dataEmissao']);
  return {
    ...row,
    fonte_cte: fonte || row.fonte_cte || '',
    emissao: dataEmissao || null,
    data_emissao: dataEmissao || row.data_emissao || row.emissao || null,
    chave_cte: pick(['chave_cte', 'chaveCte', 'chave', 'chave_acesso', 'chaveAcesso']) || null,
    numero_cte: pick(['numero_cte', 'numeroCte', 'cte', 'nro_cte', 'numero']) || null,
    serie_cte: pick(['serie_cte', 'serieCte', 'serie']) || row.serie_cte || null,
    transportadora: pick(['transportadora', 'nome_transportadora', 'transportadora_realizada', 'transportador', 'transportadora_contratada']) || null,
    transportadora_contratada: pick(['transportadora_contratada', 'transportadora', 'nome_transportadora']) || null,
    cnpj_transportadora: pick(['cnpj_transportadora', 'cnpjTransportadora', 'cnpj_transportador']) || null,
    cidade_origem: pick(['cidade_origem', 'cidadeOrigem', 'origem']) || null,
    uf_origem: String(pick(['uf_origem', 'ufOrigem']) || '').toUpperCase() || null,
    cidade_destino: pick(['cidade_destino', 'cidadeDestino', 'destino']) || null,
    uf_destino: String(pick(['uf_destino', 'ufDestino']) || '').toUpperCase() || null,
    canal: pick(['canal', 'canal_original', 'canais']) || null,
    tomador: pick(['tomador', 'tomador_servico', 'tomadorServico', 'nomeTomador']) || null,
    valor_nf: numeroValorCte(pick(['valor_nf', 'valorNF', 'nf_venda', 'valor_nota'])),
    valor_cte_original: numeroValorCte(pick(['valor_cte', 'valorCte', 'valor_frete', 'frete'])),
    valor_cte: valorAuditoriaCte(row, pick),
    percentual_frete: numeroValorCte(pick(['percentual_frete', 'percentualFrete', 'frete_percentual'])),
    peso_declarado: numeroValorCte(pick(['peso_declarado', 'pesoDeclarado', 'peso', 'peso_final', 'pesoFinal'])),
    peso_cubado: numeroValorCte(pick(['peso_cubado', 'pesoCubado'])),
    metros_cubicos: numeroValorCte(pick(['metros_cubicos', 'cubagem', 'cubagem_total', 'cubagemTotal'])),
    volume: numeroValorCte(pick(['volume', 'qtd_volumes', 'qtdVolumes', 'volumes'])),
    raw,
  };
}

async function consultarCtesPorFiltro({ supabase, fonte, campo, operador, valor, limite = 20 }) {
  let query = supabase
    .from(fonte.tabela)
    .select('*')
    .limit(limite);

  if (operador === 'eq') query = query.eq(campo, valor);
  else query = query.ilike(campo, `%${valor}%`);

  if (fonte.campoData) query = query.order(fonte.campoData, { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => normalizarCteLotacaoAuditoria(row, fonte.tabela));
}

async function consultarCtesComFallbacks({
  campo,
  valores = [],
  operadores = ['eq', 'ilike'],
  limite = 20,
  opcoesBaseCte = {},
}) {
  const supabase = ensureClient();
  const erros = [];
  const encontradosPorChave = new Map();

  for (const fonte of FONTES_CTE_AUDITORIA_LOTACAO) {
    for (const valor of valores.filter(Boolean)) {
      for (const operador of operadores) {
        try {
          const rows = await consultarCtesPorFiltro({ supabase, fonte, campo, operador, valor, limite });
          for (const row of rows) {
            const chave = row.id || row.chave_cte || `${fonte.tabela}|${row.numero_cte}|${row.emissao}|${Math.random()}`;
            encontradosPorChave.set(String(chave), row);
          }
          if (encontradosPorChave.size && operador === 'eq') break;
        } catch (error) {
          erros.push(`${fonte.tabela}.${campo}: ${error.message || String(error)}`);
          break;
        }
      }
      if (encontradosPorChave.size) break;
    }
    if (encontradosPorChave.size) break;
  }

  if (!encontradosPorChave.size && erros.length) {
    console.warn('[Auditoria Lotação] Busca CT-e sem resultado. Tentativas:', erros);
  }

  return filtrarCpComercialCte(
    Array.from(encontradosPorChave.values()).slice(0, limite),
    opcoesBaseCte,
  );
}

export async function buscarCteLotacaoAuditoriaPorChaveSupabase(chave = '', opcoesBaseCte = {}) {
  if (!isSupabaseConfigured()) return [];
  const digitos = somenteDigitos(chave);
  if (!digitos) return [];
  if (digitos.length !== 44) {
    throw new Error('Informe uma chave CT-e válida com 44 dígitos.');
  }

  return consultarCtesComFallbacks({
    campo: 'chave_cte',
    valores: [digitos],
    operadores: ['eq'],
    limite: 5,
    opcoesBaseCte,
  });
}

export async function buscarCtesLotacaoAuditoriaPorChavesSupabase(chaves = [], opcoesBaseCte = {}) {
  if (!isSupabaseConfigured()) return [];
  const unicas = [...new Set((Array.isArray(chaves) ? chaves : [])
    .map((chave) => somenteDigitos(chave))
    .filter((chave) => chave.length === 44))];

  const resultados = [];
  for (const chave of unicas) {
    try {
      const ctes = await buscarCteLotacaoAuditoriaPorChaveSupabase(chave, opcoesBaseCte);
      resultados.push({ chave, ctes, erro: '' });
    } catch (error) {
      resultados.push({ chave, ctes: [], erro: error.message || String(error) });
    }
  }
  return resultados;
}

export async function buscarCtesLotacaoAuditoriaPorNumeroSupabase(numero = '', opcoesBaseCte = {}) {
  if (!isSupabaseConfigured()) return [];
  const digitos = somenteDigitos(numero);
  const termo = String(numero || '').trim().replace(/[%*,()]/g, ' ');
  const semZeros = digitos ? String(Number(digitos) || digitos) : '';
  const valores = [...new Set([digitos, semZeros, termo].filter(Boolean))];
  if (!valores.length) return [];

  return consultarCtesComFallbacks({
    campo: 'numero_cte',
    valores,
    operadores: ['eq', 'ilike'],
    limite: 30,
    opcoesBaseCte,
  });
}

export async function buscarCtesLotacaoAuditoriaSupabase(termo = '', opcoesBaseCte = {}) {
  const busca = String(termo || '').trim();
  if (!busca) return [];
  const digitos = somenteDigitos(busca);
  if (digitos.length === 44) {
    return buscarCteLotacaoAuditoriaPorChaveSupabase(digitos, opcoesBaseCte);
  }
  return buscarCtesLotacaoAuditoriaPorNumeroSupabase(busca, opcoesBaseCte);
}

export async function resumoRotasLotacaoSupabase(filtros = {}) {
  if (!isSupabaseConfigured()) return [];
  const supabase = ensureClient();

  let query = supabase.from('vw_lotacao_resumo_rotas').select('*').order('total_cargas', { ascending: false });
  if (filtros.origem)      query = query.ilike('origem', `%${filtros.origem}%`);
  if (filtros.destino)     query = query.ilike('destino', `%${filtros.destino}%`);
  if (filtros.tipoVeiculo) query = query.ilike('tipo_veiculo', `%${filtros.tipoVeiculo}%`);

  const { data, error } = await query.limit(5000);
  if (error) throw new Error(detalheErroSupabase(error));
  return data || [];
}

export async function limparCargasLotacaoSupabase() {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const { error } = await supabase.from('lotacao_cargas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true };
}

// ============================================================
// LANÃ‡AMENTOS DE AUDITORIA â€” Supabase
// ============================================================

function lancamentoParaDb(item = {}) {
  return {
    id:                          String(item.id || ''),
    carga_id:                    String(item.cargaId || item.carga_id || ''),
    dist:                        String(item.dist || ''),
    dist_key:                    String(item.distKey || item.dist_key || ''),
    cte:                         String(item.cte || ''),
    cte_key:                     String(item.cteKey || item.cte_key || ''),
    fatura:                      String(item.fatura || ''),
    valor_lancado:               Number(item.valorLancado ?? item.valor_lancado ?? 0),
    valor_autorizado_carga:      item.valorAutorizadoCarga      != null ? Number(item.valorAutorizadoCarga)      : null,
    total_autorizado_no_momento: item.totalAutorizadoNoMomento  != null ? Number(item.totalAutorizadoNoMomento)  : null,
    total_anterior:              item.totalAnterior             != null ? Number(item.totalAnterior)             : null,
    saldo_anterior:              item.saldoAnterior             != null ? Number(item.saldoAnterior)             : null,
    excedente:                   Number(item.excedente ?? 0),
    status:                      String(item.status || 'OK'),
    observacao:                  String(item.observacao || ''),
    // â”€â”€ FASE 1: campos de rastreabilidade do auditor â”€â”€â”€â”€â”€â”€â”€â”€â”€
    audited_by_user_id:          String(item.auditedByUserId  || item.audited_by_user_id  || ''),
    audited_by_name:             String(item.auditedByName    || item.audited_by_name    || ''),
    audited_by_email:            String(item.auditedByEmail   || item.audited_by_email   || ''),
    audited_at:                  item.auditedAt || item.audited_at || new Date().toISOString(),
    audit_observation:           String(item.observacao || item.auditObservation || item.audit_observation || ''),
    audit_status:                String(item.auditStatus || item.audit_status || (Number(item.excedente ?? 0) > 0 ? 'EXCEDEU_AGUARDANDO_OPERACAO' : 'AUDITADO_OK')),
    audit_exceeded_amount:       item.auditExceededAmount != null ? Number(item.auditExceededAmount) : Number(item.excedente ?? 0),
    audit_allowed_amount:        item.auditAllowedAmount  != null ? Number(item.auditAllowedAmount)  : null,
    audit_entered_amount:        item.auditEnteredAmount  != null ? Number(item.auditEnteredAmount)  : Number(item.valorLancado ?? item.valor_lancado ?? 0),
    origem_tela:                 String(item.origemTela || item.origem_tela || 'AUDITORIA_LOTACAO'),
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    criado_em:                   item.criadoEm || item.criado_em || new Date().toISOString(),
  };
}

function dbParaLancamento(row = {}) {
  return {
    id:                        row.id,
    cargaId:                   row.carga_id              || '',
    dist:                      row.dist                  || '',
    distKey:                   row.dist_key              || '',
    cte:                       row.cte                   || '',
    cteKey:                    row.cte_key               || '',
    fatura:                    row.fatura                || '',
    valorLancado:              row.valor_lancado         != null ? Number(row.valor_lancado)         : 0,
    valorAutorizadoCarga:      row.valor_autorizado_carga!= null ? Number(row.valor_autorizado_carga): null,
    totalAutorizadoNoMomento:  row.total_autorizado_no_momento != null ? Number(row.total_autorizado_no_momento) : null,
    totalAnterior:             row.total_anterior        != null ? Number(row.total_anterior)        : null,
    saldoAnterior:             row.saldo_anterior        != null ? Number(row.saldo_anterior)        : null,
    excedente:                 row.excedente             != null ? Number(row.excedente)             : 0,
    status:                    row.status                || 'OK',
    observacao:                row.observacao            || row.audit_observation || '',
    // â”€â”€ FASE 1: campos de rastreabilidade do auditor â”€â”€â”€â”€â”€â”€â”€â”€â”€
    auditedByUserId:           row.audited_by_user_id   || '',
    auditedByName:             row.audited_by_name      || '',
    auditedByEmail:            row.audited_by_email     || '',
    auditedAt:                 row.audited_at           || '',
    auditObservation:          row.audit_observation    || row.observacao || '',
    auditStatus:               row.audit_status         || row.status     || 'AUDITADO_OK',
    auditExceededAmount:       row.audit_exceeded_amount!= null ? Number(row.audit_exceeded_amount) : 0,
    auditAllowedAmount:        row.audit_allowed_amount != null ? Number(row.audit_allowed_amount)  : null,
    auditEnteredAmount:        row.audit_entered_amount != null ? Number(row.audit_entered_amount)  : null,
    origemTela:                row.origem_tela          || '',
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    criadoEm:                  row.criado_em            || '',
  };
}

export async function carregarLancamentosAuditoriaSupabase() {
  if (!isSupabaseConfigured()) return null; // null = usar localStorage como fallback
  const supabase = ensureClient();
  const rows = await fetchAllRows(supabase, 'lotacao_lancamentos', 'criado_em', false);
  return rows.map(dbParaLancamento);
}

export async function salvarLancamentoAuditoriaSupabase(lancamento) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const row = lancamentoParaDb(lancamento);
  const { error } = await supabase.from('lotacao_lancamentos').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true };
}

// ============================================================
// SOLICITAÃ‡Ã•ES DE PAGAMENTO â€” Supabase
// ============================================================

function solicitacaoParaDb(item = {}) {
  return {
    id:                     String(item.id || ''),
    tipo:                   String(item.tipo || 'EXCEDENTE_AUDITORIA'),
    origem_solicitacao:     String(item.origemSolicitacao || item.origem_solicitacao || ''),
    carga_id:               String(item.cargaId || item.carga_id || ''),
    dist:                   String(item.dist || ''),
    dist_key:               String(item.distKey || item.dist_key || ''),
    cte:                    String(item.cte || ''),
    fatura:                 String(item.fatura || ''),
    transportadora:         String(item.transportadora || ''),
    origem:                 String(item.origem || ''),
    destino:                String(item.destino || ''),
    tipo_veiculo:           String(item.tipoVeiculo || item.tipo_veiculo || ''),
    valor_autorizado_carga: item.valorAutorizadoCarga != null ? Number(item.valorAutorizadoCarga) : null,
    total_anterior:         item.totalAnterior        != null ? Number(item.totalAnterior)        : null,
    saldo_anterior:         item.saldoAnterior        != null ? Number(item.saldoAnterior)        : null,
    valor_lancado:          item.valorLancado         != null ? Number(item.valorLancado)         : null,
    excedente:              item.excedente            != null ? Number(item.excedente)            : null,
    valor_adicional:        item.valorAdicional       != null ? Number(item.valorAdicional)       : null,
    tipo_custo:             String(item.tipoCusto || item.tipo_custo || ''),
    status:                 String(item.status || 'PENDENTE'),
    observacao:             String(item.observacao || ''),
    resposta:               String(item.resposta || ''),
    criado_em:              item.criadoEm  || item.criado_em  || new Date().toISOString(),
    atualizado_em:          item.atualizadoEm || item.atualizado_em || null,
  };
}

function dbParaSolicitacao(row = {}) {
  return {
    id:                   row.id,
    tipo:                 row.tipo                  || 'EXCEDENTE_AUDITORIA',
    origemSolicitacao:    row.origem_solicitacao    || '',
    cargaId:              row.carga_id              || '',
    dist:                 row.dist                  || '',
    distKey:              row.dist_key              || '',
    cte:                  row.cte                   || '',
    fatura:               row.fatura                || '',
    transportadora:       row.transportadora        || '',
    origem:               row.origem                || '',
    destino:              row.destino               || '',
    tipoVeiculo:          row.tipo_veiculo          || '',
    valorAutorizadoCarga: row.valor_autorizado_carga!= null ? Number(row.valor_autorizado_carga) : null,
    totalAnterior:        row.total_anterior        != null ? Number(row.total_anterior)        : null,
    saldoAnterior:        row.saldo_anterior        != null ? Number(row.saldo_anterior)        : null,
    valorLancado:         row.valor_lancado         != null ? Number(row.valor_lancado)         : null,
    excedente:            row.excedente             != null ? Number(row.excedente)             : null,
    valorAdicional:       row.valor_adicional       != null ? Number(row.valor_adicional)       : null,
    tipoCusto:            row.tipo_custo            || '',
    status:               row.status                || 'PENDENTE',
    observacao:           row.observacao            || '',
    resposta:             row.resposta              || '',
    criadoEm:             row.criado_em             || '',
    atualizadoEm:         row.atualizado_em         || '',
  };
}

export async function carregarSolicitacoesSupabase() {
  if (!isSupabaseConfigured()) return null; // null = usar localStorage como fallback
  const supabase = ensureClient();
  const rows = await fetchAllRows(supabase, 'lotacao_solicitacoes', 'criado_em', false);
  return rows.map(dbParaSolicitacao);
}

export async function salvarSolicitacaoSupabase(solicitacao) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const row = solicitacaoParaDb(solicitacao);
  const { error } = await supabase.from('lotacao_solicitacoes').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true };
}

export async function atualizarSolicitacaoSupabase(id, status, resposta = '') {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado. Não foi possível atualizar a solicitação.');
  if (!id) throw new Error('Solicitação sem identificador para atualizar.');
  const supabase = ensureClient();
  await atualizarLinhaUnicaSupabase(
    supabase
      .from('lotacao_solicitacoes')
      .update({ status, resposta, atualizado_em: new Date().toISOString() })
      .eq('id', id),
    `Solicitação ${id}`,
  );
  return { ok: true };
}

// ============================================================
// FASE 1/2: PENDÃŠNCIAS DE AUDITORIA (audit_pendencias)
// ============================================================

export async function carregarPendenciasAuditoriaSupabase({ status, transportadora } = {}) {
  if (!isSupabaseConfigured()) return null;
  const supabase = ensureClient();
  let query = supabase
    .from('audit_pendencias')
    .select('*')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (transportadora) query = query.ilike('transportadora', `%${transportadora}%`);
  const { data, error } = await query;
  if (error) throw new Error(detalheErroSupabase(error));
  return data || [];
}

export async function salvarPendenciaAuditoriaSupabase(pendencia) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const row = {
    id: pendencia.id || undefined,
    lancamento_id: String(pendencia.lancamentoId || pendencia.lancamento_id || ''),
    dist: String(pendencia.dist || ''),
    dist_key: String(pendencia.distKey || pendencia.dist_key || ''),
    cte: String(pendencia.cte || ''),
    fatura: String(pendencia.fatura || ''),
    transportadora: String(pendencia.transportadora || ''),
    carga_id: String(pendencia.cargaId || pendencia.carga_id || ''),
    valor_lancado: pendencia.valorLancado != null ? Number(pendencia.valorLancado) : null,
    valor_autorizado: pendencia.valorAutorizado != null ? Number(pendencia.valorAutorizado) : null,
    valor_excedente: pendencia.valorExcedente != null ? Number(pendencia.valorExcedente) : null,
    valor_original: pendencia.valorOriginal != null ? Number(pendencia.valorOriginal) : null,
    valor_adicional_aprovado: pendencia.valorAdicionalAprovado != null ? Number(pendencia.valorAdicionalAprovado) : null,
    valor_final_autorizado: pendencia.valorFinalAutorizado != null ? Number(pendencia.valorFinalAutorizado) : null,
    prazo_operacao_em: pendencia.prazoOperacaoEm || pendencia.prazo_operacao_em || null,
    prazo_auditoria_em: pendencia.prazoAuditoriaEm || pendencia.prazo_auditoria_em || null,
    status: String(pendencia.status || 'EXCEDEU_AGUARDANDO_OPERACAO'),
    audited_by_user_id: String(pendencia.auditedByUserId || ''),
    audited_by_name: String(pendencia.auditedByName || ''),
    audited_by_email: String(pendencia.auditedByEmail || ''),
    audited_at: pendencia.auditedAt || new Date().toISOString(),
    observation: String(pendencia.observation || pendencia.observacao || ''),
    motivo_recusa: String(pendencia.motivoRecusa || pendencia.motivo_recusa || ''),
    resposta_operacao: String(pendencia.respostaOperacao || pendencia.resposta_operacao || pendencia.resposta || ''),
    justificativa_operacao: String(pendencia.justificativaOperacao || pendencia.justificativa_operacao || ''),
    resposta_auditoria: String(pendencia.respostaAuditoria || pendencia.resposta_auditoria || ''),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('audit_pendencias').upsert(row, { onConflict: 'id' });
  if (error) {
    if (erroColunasAprovacaoPendencia(error)) {
      const fallback = removerColunasPendenciaComErro(row, error);
      const retry = await supabase.from('audit_pendencias').upsert(fallback, { onConflict: 'id' });
      if (!retry.error) return { ok: true, compat: true };
      throw new Error(detalheErroSupabase(retry.error));
    }
    throw new Error(detalheErroSupabase(error));
  }
  return { ok: true };
}

export async function atualizarPendenciaAuditoriaSupabase(id, status, dadosExtra = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado. Não foi possível atualizar a pendência.');
  if (!id) throw new Error('Pendência sem identificador para atualizar.');
  const supabase = ensureClient();
  const update = {
    status,
    updated_at: new Date().toISOString(),
    ...dadosExtra,
  };
  try {
    await atualizarLinhaUnicaSupabase(
      supabase.from('audit_pendencias').update(update).eq('id', id),
      `Pendência ${id}`,
    );
    return { ok: true };
  } catch (error) {
    if (erroColunasAprovacaoPendencia(error)) {
      const fallback = removerColunasPendenciaComErro(update, error);
      await atualizarLinhaUnicaSupabase(
        supabase.from('audit_pendencias').update(fallback).eq('id', id),
        `Pendência ${id}`,
      );
      return { ok: true, compat: true };
    }
    throw error;
  }
}

// ============================================================
// FASE 2: HISTÃ“RICO DE EVENTOS (audit_historico_eventos)
// ============================================================

export async function registrarEventoHistoricoSupabase(evento) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const row = {
    pendencia_id: evento.pendenciaId || evento.pendencia_id || null,
    lancamento_id: String(evento.lancamentoId || evento.lancamento_id || ''),
    data_hora: evento.dataHora || new Date().toISOString(),
    user_id: String(evento.userId || evento.user_id || ''),
    user_name: String(evento.userName || evento.user_name || ''),
    user_email: String(evento.userEmail || evento.user_email || ''),
    acao: String(evento.acao || ''),
    status_anterior: String(evento.statusAnterior || evento.status_anterior || ''),
    status_novo: String(evento.statusNovo || evento.status_novo || ''),
    comentario: String(evento.comentario || ''),
    origem_tela: String(evento.origemTela || evento.origem_tela || ''),
  };
  const { error } = await supabase.from('audit_historico_eventos').insert(row);
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true };
}

export async function carregarHistoricoEventosSupabase(pendenciaId) {
  if (!isSupabaseConfigured()) return [];
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('audit_historico_eventos')
    .select('*')
    .eq('pendencia_id', pendenciaId)
    .order('data_hora', { ascending: true });
  if (error) throw new Error(detalheErroSupabase(error));
  return data || [];
}

// ============================================================
// FASE 3: CONFIGURAÃ‡Ã•ES DE SLA (audit_sla_config)
// ============================================================

export async function carregarSlaConfigSupabase(canal = 'LOTACAO') {
  if (!isSupabaseConfigured()) return null;
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('audit_sla_config')
    .select('*')
    .eq('canal_modulo', canal)
    .eq('ativo', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(detalheErroSupabase(error));
  return data?.[0] || null;
}

export async function salvarSlaConfigSupabase(config) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const row = {
    id: config.id || undefined,
    nome: String(config.nome || 'Padrão'),
    prazo_alerta_operacao_h: Number(config.prazoAlertaOperacaoH ?? config.prazo_alerta_operacao_h ?? 24),
    prazo_escalonamento_dias: Number(config.prazoEscalonamentoDias ?? config.prazo_escalonamento_dias ?? 2),
    emails_operacao: Array.isArray(config.emailsOperacao) ? config.emailsOperacao : [],
    emails_gerencia: Array.isArray(config.emailsGerencia) ? config.emailsGerencia : [],
    emails_diretoria: Array.isArray(config.emailsDiretoria) ? config.emailsDiretoria : [],
    envio_email_ativo: Boolean(config.envioEmailAtivo ?? config.envio_email_ativo ?? true),
    alerta_visual_ativo: Boolean(config.alertaVisualAtivo ?? config.alerta_visual_ativo ?? true),
    mensagem_padrao_email: String(config.mensagemPadraoEmail ?? config.mensagem_padrao_email ?? ''),
    canal_modulo: String(config.canalModulo ?? config.canal_modulo ?? 'LOTACAO'),
    ativo: true,
    created_by: String(config.createdBy || config.created_by || ''),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('audit_sla_config').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true };
}

// ============================================================
// FASE 5: SOLICITAÃ‡Ã•ES DE INFORMAÃ‡ÃƒO (audit_solicitacoes_informacao)
// ============================================================

export async function carregarSolicitacoesInfoSupabase({ status, responsavelId } = {}) {
  if (!isSupabaseConfigured()) return null;
  const supabase = ensureClient();
  let query = supabase
    .from('audit_solicitacoes_informacao')
    .select('*')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (responsavelId) query = query.eq('responsavel_id', responsavelId);
  const { data, error } = await query;
  if (error) throw new Error(detalheErroSupabase(error));
  return data || [];
}

export async function salvarSolicitacaoInfoSupabase(sol) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const row = {
    id: sol.id || undefined,
    tipo: String(sol.tipo || 'OUTRO'),
    chave_informada: String(sol.chaveInformada || sol.chave_informada || ''),
    numero_informado: String(sol.numeroInformado || sol.numero_informado || ''),
    transportadora: String(sol.transportadora || ''),
    fatura: String(sol.fatura || ''),
    descricao_problema: String(sol.descricaoProblema || sol.descricao_problema || ''),
    resposta: String(sol.resposta || ''),
    resposta_operacao: String(sol.respostaOperacao || sol.resposta_operacao || sol.resposta || ''),
    observacao_tratamento: String(sol.observacaoTratamento || sol.observacao_tratamento || ''),
    responsavel_id: String(sol.responsavelId || sol.responsavel_id || ''),
    responsavel_nome: String(sol.responsavelNome || sol.responsavel_nome || ''),
    prioridade: String(sol.prioridade || 'NORMAL'),
    prazo: sol.prazo || null,
    status: String(sol.status || 'AGUARDANDO_INFORMACAO'),
    aberto_por_id: String(sol.abertoPorId || sol.aberto_por_id || ''),
    aberto_por_nome: String(sol.abertoPorNome || sol.aberto_por_nome || ''),
    aberto_por_email: String(sol.abertoPorEmail || sol.aberto_por_email || ''),
    respondido_por_id: String(sol.respondidoPorId || sol.respondido_por_id || ''),
    respondido_por_nome: String(sol.respondidoPorNome || sol.respondido_por_nome || ''),
    respondido_por_email: String(sol.respondidoPorEmail || sol.respondido_por_email || ''),
    respondido_em: sol.respondidoEm || sol.respondido_em || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('audit_solicitacoes_informacao').upsert(row, { onConflict: 'id' });
  if (error) {
    const colunas = erroColunasSolicitacaoInfo(error);
    if (colunas.length) {
      const fallback = removerColunasSolicitacaoInfoComErro(row, error);
      const retry = await supabase.from('audit_solicitacoes_informacao').upsert(fallback, { onConflict: 'id' });
      if (!retry.error) return { ok: true, compat: true };
      throw new Error(detalheErroSupabase(retry.error));
    }
    throw new Error(detalheErroSupabase(error));
  }
  return { ok: true };
}

export async function atualizarSolicitacaoInfoSupabase(id, status, dadosExtra = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado. Não foi possível atualizar o questionamento.');
  if (!id) throw new Error('Questionamento sem identificador para atualizar.');
  const supabase = ensureClient();
  const update = {
    status,
    updated_at: new Date().toISOString(),
    ...dadosExtra,
  };
  try {
    await atualizarLinhaUnicaSupabase(
      supabase.from('audit_solicitacoes_informacao').update(update).eq('id', id),
      `Questionamento ${id}`,
    );
    return { ok: true };
  } catch (error) {
    const colunas = erroColunasSolicitacaoInfo(error);
    if (colunas.length) {
      const fallback = removerColunasSolicitacaoInfoComErro(update, error);
      await atualizarLinhaUnicaSupabase(
        supabase.from('audit_solicitacoes_informacao').update(fallback).eq('id', id),
        `Questionamento ${id}`,
      );
      return { ok: true, compat: true };
    }
    throw error;
  }
}

// ============================================================
// FASE 4: FATURAS
// ============================================================

export async function carregarFaturasSupabase({ transportadora, status, dataVencimentoInicio, dataVencimentoFim } = {}) {
  if (!isSupabaseConfigured()) return null;
  const supabase = ensureClient();
  let query = supabase.from('faturas').select('*').order('created_at', { ascending: false });
  if (transportadora) query = query.ilike('transportadora', `%${transportadora}%`);
  if (status) query = query.eq('status', status);
  if (dataVencimentoInicio) query = query.gte('data_vencimento', dataVencimentoInicio);
  if (dataVencimentoFim) query = query.lte('data_vencimento', dataVencimentoFim);
  const { data, error } = await query.limit(500);
  if (error) throw new Error(detalheErroSupabase(error));
  return data || [];
}

export async function carregarDetalhesFaturaSupabase(faturaId) {
  if (!isSupabaseConfigured()) return [];
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('fatura_detalhes')
    .select('*')
    .eq('fatura_id', faturaId)
    .order('numero_cte');
  if (error) throw new Error(detalheErroSupabase(error));
  return data || [];
}

export async function salvarFaturaSupabase(fatura) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('faturas')
    .upsert(fatura, { onConflict: 'id' })
    .select('id')
    .single();
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true, id: data?.id };
}

export async function salvarDetalhesFaturaSupabase(detalhes) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  // Insert em lotes
  const CHUNK = 200;
  for (let i = 0; i < detalhes.length; i += CHUNK) {
    const chunk = detalhes.slice(i, i + CHUNK);
    const { error } = await supabase.from('fatura_detalhes').upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(detalheErroSupabase(error));
  }
  return { ok: true };
}

// ============================================================
// FASE 9: TRATATIVAS
// ============================================================

export async function carregarTratativasSupabase({ status, responsavelId, tipo } = {}) {
  if (!isSupabaseConfigured()) return null;
  const supabase = ensureClient();
  let query = supabase.from('tratativas').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (responsavelId) query = query.eq('responsavel_id', responsavelId);
  if (tipo) query = query.eq('tipo', tipo);
  const { data, error } = await query.limit(500);
  if (error) throw new Error(detalheErroSupabase(error));
  return data || [];
}

export async function salvarTratativaSupabase(tratativa) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const { error } = await supabase.from('tratativas').upsert(tratativa, { onConflict: 'id' });
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true };
}

export async function registrarHistoricoTratativaSupabase(evento) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const { error } = await supabase.from('tratativa_historico').insert(evento);
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true };
}

// ============================================================
// FASE 10: LAUDOS DO SIMULADOR
// ============================================================

export async function salvarLaudoSimulacaoSupabase(laudo) {
  if (!isSupabaseConfigured()) return { ok: false };
  const supabase = ensureClient();
  const { data, error } = await supabase
    .from('simulation_reports')
    .upsert(laudo, { onConflict: 'id' })
    .select('id')
    .single();
  if (error) throw new Error(detalheErroSupabase(error));
  return { ok: true, id: data?.id };
}

export async function carregarLaudosSimulacaoSupabase({ simulationId, carrierId, reportType } = {}) {
  if (!isSupabaseConfigured()) return [];
  const supabase = ensureClient();
  let query = supabase.from('simulation_reports').select('*').order('created_at', { ascending: false });
  if (simulationId) query = query.eq('simulation_id', simulationId);
  if (carrierId) query = query.eq('carrier_id', carrierId);
  if (reportType) query = query.eq('report_type', reportType);
  const { data, error } = await query.limit(100);
  if (error) throw new Error(detalheErroSupabase(error));
  return data || [];
}
