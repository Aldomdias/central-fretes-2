import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { isTomadorServicoValidoRealizado } from '../utils/realizadoCtes';
import * as localFallback from './ctesLocalFallbackDb';

const TABELA_CTES = 'realizado_local_ctes';
const DEFAULT_PAGE_SIZE = 1000;
const CTES_SELECT_COLUMNS = [
  'id',
  'arquivo_origem',
  'competencia',
  'data_emissao',
  'chave_cte',
  'numero_cte',
  'transportadora',
  'cnpj_transportadora',
  'canal',
  'canal_original',
  'cidade_origem',
  'uf_origem',
  'ibge_origem',
  'cidade_destino',
  'uf_destino',
  'ibge_destino',
  'chave_rota_ibge',
  'peso',
  'peso_declarado',
  'peso_cubado',
  'cubagem',
  'qtd_volumes',
  'valor_cte',
  'valor_nf',
  'ibge_ok',
  'ibge_corrigido_origem',
  'ibge_corrigido_destino',
  'tomador_servico',
  'created_at',
  'updated_at',
].join(',');
const ROTAS_CHUNK_SIZE = 60;


function getClient() {
  if (!isSupabaseConfigured()) return null;
  return getSupabaseClient();
}

function shouldUseFallback() {
  return !getClient();
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function normalizeLoose(value) {
  return normalize(value).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  return ['true', '1', 'sim', 's', 'yes'].includes(String(value).trim().toLowerCase());
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function cleanUf(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

function cleanDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function uniqueItems(items = []) {
  return [...new Set((items || []).filter(Boolean))];
}

function chunkArray(items = [], chunkSize = 100) {
  const size = Math.max(1, Number(chunkSize || 100));
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function splitRotaIbge(rota = '') {
  const normalizada = normalizeChaveRotaIbge(rota);
  if (!normalizada) return null;
  const [origem, destino] = normalizada.split('-');
  if (!origem || !destino) return null;
  return { origem, destino, rota: normalizada };
}

function erroTimeoutSupabase(error = {}) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('statement timeout') || msg.includes('canceling statement due to statement timeout');
}

function normalizeChaveRotaIbge(rawValue = '', ibgeOrigemRaw = '', ibgeDestinoRaw = '') {
  const origem = cleanDigits(ibgeOrigemRaw).slice(0, 7);
  const destino = cleanDigits(ibgeDestinoRaw).slice(0, 7);
  if (origem && destino) return `${origem}-${destino}`;

  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  const partes = raw
    .split(/[^0-9]+/g)
    .map((item) => cleanDigits(item).slice(0, 7))
    .filter((item) => item.length >= 6);

  if (partes.length >= 2) return `${partes[0]}-${partes[1]}`;

  const digits = cleanDigits(raw);
  if (digits.length >= 14) return `${digits.slice(0, 7)}-${digits.slice(7, 14)}`;

  return '';
}

function dataToDb(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00`;
  return raw;
}

function getDataRef(row = {}) {
  return row.dataEmissao || row.data_emissao || row.emissao || row.created_at || '';
}

function getChaveCte(row = {}) {
  const chave = cleanText(row.chaveCte ?? row.chave_cte);
  if (chave) return chave;
  const fallback = [
    row.numeroCte ?? row.numero_cte,
    getDataRef(row),
    row.transportadora,
    row.cidadeOrigem ?? row.cidade_origem,
    row.cidadeDestino ?? row.cidade_destino,
    row.valorCte ?? row.valor_cte,
  ]
    .map((item) => cleanText(item).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-'))
    .filter(Boolean)
    .join('-')
    .slice(0, 180);
  return fallback ? `cte-sem-chave-${fallback}` : '';
}

function resolverCanalDbRow(row = {}) {
  const canalOriginal = cleanText(row.canal_original ?? row.canalOriginal ?? row.raw?.canal_original ?? row.raw?.canalOriginal ?? row.raw?.canalVendas ?? row.raw?.canais);
  const canalAtual = cleanText(row.canal);
  const normalOriginal = normalizeCanalParaMalha(canalOriginal);
  const normalAtual = normalizeCanalParaMalha(canalAtual);

  // Prioridade para B2B/ATACADO quando algum campo forte trouxer essa informação.
  // Isso corrige bases antigas onde o canal gravado ficou B2C, mas o original era B2B.
  if (normalOriginal === 'ATACADO' || normalAtual === 'ATACADO') return 'ATACADO';
  if (normalOriginal === 'INTERCOMPANY' || normalAtual === 'INTERCOMPANY') return 'INTERCOMPANY';
  if (normalOriginal === 'REVERSA' || normalAtual === 'REVERSA') return 'REVERSA';
  if (normalOriginal === 'B2C' || normalAtual === 'B2C') return 'B2C';
  return normalAtual || normalOriginal || canalAtual || canalOriginal || '';
}

function fromDbRow(row = {}) {
  const ibgeOrigem = cleanText(row.ibge_origem ?? row.ibgeOrigem);
  const ibgeDestino = cleanText(row.ibge_destino ?? row.ibgeDestino);
  const dataEmissao = getDataRef(row);
  const peso = toNumber(row.peso ?? Math.max(toNumber(row.peso_declarado), toNumber(row.peso_cubado)));
  const canalOriginal = cleanText(row.canal_original ?? row.canalOriginal ?? row.canal);
  const canalClassificado = resolverCanalDbRow(row);
  return {
    id: row.id,
    arquivoOrigem: row.arquivo_origem ?? row.arquivoOrigem ?? '',
    competencia: cleanText(row.competencia),
    dataEmissao,
    emissao: dataEmissao,
    chaveCte: getChaveCte(row),
    numeroCte: cleanText(row.numero_cte ?? row.numeroCte),
    transportadora: cleanText(row.transportadora),
    cnpjTransportadora: cleanText(row.cnpj_transportadora ?? row.cnpjTransportadora),
    canal: canalClassificado,
    canalOriginal,
    cidadeOrigem: cleanText(row.cidade_origem ?? row.cidadeOrigem),
    ufOrigem: cleanUf(row.uf_origem ?? row.ufOrigem),
    ibgeOrigem,
    cidadeDestino: cleanText(row.cidade_destino ?? row.cidadeDestino),
    ufDestino: cleanUf(row.uf_destino ?? row.ufDestino),
    ibgeDestino,
    chaveRotaIbge: normalizeChaveRotaIbge(row.chave_rota_ibge ?? row.chaveRotaIbge, ibgeOrigem, ibgeDestino),
    peso,
    pesoDeclarado: toNumber(row.peso_declarado ?? row.pesoDeclarado ?? peso),
    pesoCubado: toNumber(row.peso_cubado ?? row.pesoCubado),
    cubagem: toNumber(row.cubagem),
    qtdVolumes: toNumber(row.qtd_volumes ?? row.qtdVolumes),
    valorCte: toNumber(row.valor_cte ?? row.valorCte),
    valorNF: toNumber(row.valor_nf ?? row.valorNF),
    ibgeOk: row.ibge_ok === undefined || row.ibge_ok === null ? Boolean(ibgeOrigem && ibgeDestino) : toBool(row.ibge_ok),
    ibgeCorrigidoOrigem: toBool(row.ibge_corrigido_origem ?? row.ibgeCorrigidoOrigem),
    ibgeCorrigidoDestino: toBool(row.ibge_corrigido_destino ?? row.ibgeCorrigidoDestino),
    tomadorServico: cleanText(row.tomador_servico ?? row.tomadorServico),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDbRow(row = {}) {
  const ibgeOrigem = cleanText(row.ibgeOrigem ?? row.ibge_origem);
  const ibgeDestino = cleanText(row.ibgeDestino ?? row.ibge_destino);
  const chaveRotaIbge = normalizeChaveRotaIbge(row.chaveRotaIbge ?? row.chave_rota_ibge, ibgeOrigem, ibgeDestino) || null;
  const pesoDeclarado = toNumber(row.pesoDeclarado ?? row.peso_declarado ?? row.peso);
  const pesoCubado = toNumber(row.pesoCubado ?? row.peso_cubado);
  const peso = toNumber(row.peso ?? Math.max(pesoDeclarado, pesoCubado));
  return {
    arquivo_origem: cleanText(row.arquivoOrigem ?? row.arquivo_origem),
    competencia: cleanText(row.competencia),
    data_emissao: dataToDb(row.dataEmissao ?? row.data_emissao ?? row.emissao),
    chave_cte: getChaveCte(row),
    numero_cte: cleanText(row.numeroCte ?? row.numero_cte),
    transportadora: cleanText(row.transportadora),
    cnpj_transportadora: cleanText(row.cnpjTransportadora ?? row.cnpj_transportadora),
    canal: normalizeCanalParaMalha(row.canal || row.canalOriginal || row.canal_original),
    canal_original: cleanText(row.canalOriginal ?? row.canal_original),
    cidade_origem: cleanText(row.cidadeOrigem ?? row.cidade_origem),
    uf_origem: cleanUf(row.ufOrigem ?? row.uf_origem),
    ibge_origem: ibgeOrigem || null,
    cidade_destino: cleanText(row.cidadeDestino ?? row.cidade_destino),
    uf_destino: cleanUf(row.ufDestino ?? row.uf_destino),
    ibge_destino: ibgeDestino || null,
    chave_rota_ibge: chaveRotaIbge,
    peso,
    peso_declarado: pesoDeclarado,
    peso_cubado: pesoCubado,
    cubagem: toNumber(row.cubagem),
    qtd_volumes: toNumber(row.qtdVolumes ?? row.qtd_volumes ?? row.volume),
    valor_cte: toNumber(row.valorCte ?? row.valor_cte),
    valor_nf: toNumber(row.valorNF ?? row.valor_nf),
    ibge_ok: row.ibgeOk === undefined || row.ibgeOk === null ? Boolean(ibgeOrigem && ibgeDestino) : Boolean(row.ibgeOk),
    ibge_corrigido_origem: Boolean(row.ibgeCorrigidoOrigem ?? row.ibge_corrigido_origem),
    ibge_corrigido_destino: Boolean(row.ibgeCorrigidoDestino ?? row.ibge_corrigido_destino),
    tomador_servico: cleanText(row.tomadorServico ?? row.tomador_servico),
  };
}

function isTransportadoraEbazar(value) {
  return normalizeLoose(value).includes('EBAZAR');
}

function matchesPeso(row, filtros = {}) {
  const peso = Math.max(toNumber(row.peso), toNumber(row.pesoDeclarado), toNumber(row.pesoCubado));
  const min = filtros.pesoMin !== '' && filtros.pesoMin !== null && filtros.pesoMin !== undefined ? Number(filtros.pesoMin) : null;
  const max = filtros.pesoMax !== '' && filtros.pesoMax !== null && filtros.pesoMax !== undefined ? Number(filtros.pesoMax) : null;
  if (Number.isFinite(min) && peso < min) return false;
  if (Number.isFinite(max) && peso > max) return false;
  return true;
}

function getCanalServerVariants(value) {
  const canal = normalizeCanalParaMalha(value);
  if (!canal) return [];

  if (canal === 'ATACADO') {
    return ['ATACADO', 'B2B', 'B 2 B', 'CANTU', 'CANTU PNEUS', 'CANTU STORE'];
  }

  if (canal === 'B2C') {
    return [
      'B2C', 'Via Varejo', 'VIA VAREJO', 'Mercado Livre', 'MERCADO LIVRE',
      'Mercador Livre', 'MERCADOR LIVRE', 'B2W', 'Magazine Luiza', 'MAGAZINE LUIZA',
      'Carrefour', 'CARREFOUR', 'GPA', 'Colombo', 'COLOMBO', 'Amazon', 'AMAZON',
      'Inter', 'INTER', 'AnyMarket', 'ANYMARKET', 'Bradesco Shop', 'BRADESCO SHOP',
      'Itaú Shop', 'ITAU SHOP', 'Shopee', 'SHOPEE', 'Livelo', 'LIVELO',
      'Marketplace/E-commerce', 'MARKETPLACE', 'MARKET PLACE', 'E-COMMERCE', 'E COMMERCE', 'ECOMMERCE',
    ];
  }

  return [value];
}

export function filtrarCteLocal(row = {}, filtros = {}) {
  if (filtros.competencia && row.competencia !== filtros.competencia) return false;
  if (filtros.inicio && (!row.dataEmissao || row.dataEmissao.slice(0, 10) < filtros.inicio)) return false;
  if (filtros.fim && (!row.dataEmissao || row.dataEmissao.slice(0, 10) > filtros.fim)) return false;
  if (filtros.canal && normalizeCanalParaMalha(row.canal) !== normalizeCanalParaMalha(filtros.canal)) return false;
  if (filtros.excluirEbazar && isTransportadoraEbazar(row.transportadora)) return false;
  if (filtros.transportadoraRealizada && !normalizeLoose(row.transportadora).includes(normalizeLoose(filtros.transportadoraRealizada))) return false;
  if (filtros.ufOrigem && normalize(row.ufOrigem) !== normalize(filtros.ufOrigem)) return false;
  if (filtros.ufDestino && normalize(row.ufDestino) !== normalize(filtros.ufDestino)) return false;
  if (filtros.origem && !normalizeLoose(row.cidadeOrigem).includes(normalizeLoose(filtros.origem))) return false;
  if (filtros.destino && !normalizeLoose(row.cidadeDestino).includes(normalizeLoose(filtros.destino))) return false;
  if (filtros.somentePendenciasIbge && row.ibgeOk) return false;
  if (!matchesPeso(row, filtros)) return false;
  return true;
}

function applyServerFilters(query, filtros = {}) {
  let q = query;
  if (filtros.competencia) q = q.eq('competencia', filtros.competencia);
  if (filtros.inicio) q = q.gte('data_emissao', `${filtros.inicio}T00:00:00`);
  if (filtros.fim) q = q.lte('data_emissao', `${filtros.fim}T23:59:59`);
  if (filtros.canal) {
    const canalNormalizado = normalizeCanalParaMalha(filtros.canal);
    // Para ATACADO/B2C, não filtramos só no banco: bases antigas podem estar com canal errado
    // e canal_original correto. O filtro final é aplicado em filtrarCteLocal após normalizar.
    if (canalNormalizado && !['ATACADO', 'B2C'].includes(canalNormalizado)) {
      q = q.eq('canal', filtros.canal);
    }
  }
  if (filtros.transportadoraRealizada) q = q.ilike('transportadora', `%${filtros.transportadoraRealizada}%`);
  if (filtros.ufOrigem) q = q.eq('uf_origem', cleanUf(filtros.ufOrigem));
  if (filtros.ufDestino) q = q.eq('uf_destino', cleanUf(filtros.ufDestino));
  if (filtros.origem) q = q.ilike('cidade_origem', `%${filtros.origem}%`);
  if (filtros.destino) q = q.ilike('cidade_destino', `%${filtros.destino}%`);
  if (filtros.somentePendenciasIbge) q = q.eq('ibge_ok', false);
  if (filtros.pesoMin !== '' && filtros.pesoMin !== null && filtros.pesoMin !== undefined) q = q.gte('peso', Number(filtros.pesoMin));
  if (filtros.pesoMax !== '' && filtros.pesoMax !== null && filtros.pesoMax !== undefined) q = q.lte('peso', Number(filtros.pesoMax));
  return q;
}

async function fetchRowsSupabase(filtros = {}, options = {}) {
  const supabase = getClient();
  if (!supabase) return localFallback.exportarRealizadoLocal(filtros, options);

  const limit = Math.max(1, Number(options.limit || 100000));
  const pageSize = Math.max(100, Math.min(Number(options.pageSize || DEFAULT_PAGE_SIZE), 1000));
  const rows = [];
  let avaliados = 0;

  for (let from = 0; rows.length < limit; from += pageSize) {
    const to = from + pageSize - 1;
    let query = supabase
      .from(TABELA_CTES)
      .select(CTES_SELECT_COLUMNS)
      .order('data_emissao', { ascending: false, nullsFirst: false })
      .range(from, to);

    query = applyServerFilters(query, filtros);
    const { data, error } = await query;
    if (error) {
      throw new Error(`Erro ao consultar CTes no Supabase (${TABELA_CTES}). Detalhe: ${error.message}`);
    }

    const page = (data || []).map(fromDbRow);
    avaliados += page.length;
    for (const row of page) {
      if (filtrarCteLocal(row, filtros)) {
        rows.push(row);
        if (rows.length >= limit) break;
      }
    }
    if ((data || []).length < pageSize) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { rows, totalCompativel: rows.length, limit, avaliados };
}

const CANAIS_ATACADO_CTES = ['ATACADO', 'B2B', 'B 2 B', 'CANTU', 'CANTU PNEUS', 'CANTU STORE'];
const CANAIS_B2C_CTES = [
  'B2C', 'VIA VAREJO', 'MERCADO LIVRE', 'MERCADOR LIVRE', 'B2W', 'MAGAZINE LUIZA',
  'CARREFOUR', 'GPA', 'COLOMBO', 'AMAZON', 'INTER', 'ANYMARKET', 'ANY MARKET',
  'BRADESCO SHOP', 'ITAU SHOP', 'ITAÚ SHOP', 'SHOPEE', '99', 'MUSTANG', 'LIVELO',
  'COOPERA', 'MARKETPLACE', 'MARKET PLACE', 'ECOMMERCE', 'E COMMERCE', 'E-COMMERCE',
];

function canalContem(canal, lista = []) {
  return lista.some((item) => canal === item || canal.includes(item));
}

function normalizeCanalParaMalha(value) {
  const canal = normalize(value).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!canal) return '';
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  // B2B é sempre ATACADO no CTes. Essa regra vem antes de qualquer B2C.
  if (canalContem(canal, CANAIS_ATACADO_CTES)) return 'ATACADO';
  if (canalContem(canal, CANAIS_B2C_CTES)) return 'B2C';
  return canal;
}

function chaveRotaCte(row = {}) {
  return normalizeChaveRotaIbge(row.chaveRotaIbge, row.ibgeOrigem, row.ibgeDestino);
}

function chaveMalhaCte(row = {}) {
  const canal = normalizeCanalParaMalha(row.canal);
  const rota = chaveRotaCte(row);
  return canal && rota ? `${canal}|${rota}` : '';
}

function extrairRotasDaMalha(malhaKeys = []) {
  const rotas = new Set();
  for (const key of malhaKeys || []) {
    const raw = String(key || '').trim();
    if (!raw) continue;
    const rota = raw.includes('|') ? raw.split('|').pop() : raw;
    const normalizada = normalizeChaveRotaIbge(rota);
    if (normalizada) rotas.add(normalizada);
  }
  return rotas;
}

function resumoFromRows(rows = [], options = {}) {
  const resumo = {
    total: 0,
    comIbge: 0,
    pendenciasIbge: 0,
    valorCte: 0,
    valorNF: 0,
    peso: 0,
    cubagem: 0,
    volumes: 0,
    periodoInicio: '',
    periodoFim: '',
    porTransportadora: new Map(),
    porCanal: new Map(),
    porOrigem: new Map(),
    porDestino: new Map(),
    porUfDestino: new Map(),
    porMes: new Map(),
  };

  const addGroup = (map, key, row) => {
    const safeKey = key || 'Não informado';
    const atual = map.get(safeKey) || { chave: safeKey, ctes: 0, frete: 0, nf: 0, peso: 0 };
    atual.ctes += 1;
    atual.frete += toNumber(row.valorCte);
    atual.nf += toNumber(row.valorNF);
    atual.peso += toNumber(row.peso);
    map.set(safeKey, atual);
  };

  rows.forEach((row) => {
    resumo.total += 1;
    if (row.ibgeOk) resumo.comIbge += 1;
    else resumo.pendenciasIbge += 1;
    resumo.valorCte += toNumber(row.valorCte);
    resumo.valorNF += toNumber(row.valorNF);
    resumo.peso += toNumber(row.peso);
    resumo.cubagem += toNumber(row.cubagem);
    resumo.volumes += toNumber(row.qtdVolumes);
    const data = row.dataEmissao || '';
    if (data) {
      if (!resumo.periodoInicio || data < resumo.periodoInicio) resumo.periodoInicio = data;
      if (!resumo.periodoFim || data > resumo.periodoFim) resumo.periodoFim = data;
    }
    addGroup(resumo.porTransportadora, row.transportadora, row);
    addGroup(resumo.porCanal, row.canal, row);
    addGroup(resumo.porOrigem, `${row.cidadeOrigem}/${row.ufOrigem}`, row);
    addGroup(resumo.porDestino, `${row.cidadeDestino}/${row.ufDestino}`, row);
    addGroup(resumo.porUfDestino, row.ufDestino || 'Sem UF', row);
    addGroup(resumo.porMes, row.competencia || data.slice(0, 7), row);
  });

  const finalize = (map) => [...map.values()]
    .map((item) => ({ ...item, percentual: item.nf > 0 ? (item.frete / item.nf) * 100 : 0 }))
    .sort((a, b) => b.frete - a.frete || b.ctes - a.ctes)
    .slice(0, options.top || 10);

  return {
    ...resumo,
    percentualFrete: resumo.valorNF > 0 ? (resumo.valorCte / resumo.valorNF) * 100 : 0,
    porTransportadora: finalize(resumo.porTransportadora),
    porCanal: finalize(resumo.porCanal),
    porOrigem: finalize(resumo.porOrigem),
    porDestino: finalize(resumo.porDestino),
    porUfDestino: finalize(resumo.porUfDestino),
    porMes: finalize(resumo.porMes),
  };
}

export async function salvarRealizadoLocal(registros = [], options = {}) {
  if (shouldUseFallback()) return localFallback.salvarRealizadoLocal(registros, options);
  const supabase = getClient();
  const chunkSize = Math.max(100, Math.min(Number(options.chunkSize || 500), 1000));
  const byKey = new Map();

  (registros || []).forEach((row) => {
    const dbRow = toDbRow(row);
    if (dbRow.chave_cte) byKey.set(dbRow.chave_cte, dbRow);
  });

  const payload = [...byKey.values()];
  let salvos = 0;

  for (let index = 0; index < payload.length; index += chunkSize) {
    const chunk = payload.slice(index, index + chunkSize);
    const chaves = chunk.map((row) => row.chave_cte).filter(Boolean);
    if (chaves.length) {
      const { error: deleteError } = await supabase.from(TABELA_CTES).delete().in('chave_cte', chaves);
      if (deleteError) {
        throw new Error(`Erro ao substituir CT-e(s) existentes em ${TABELA_CTES}. Detalhe: ${deleteError.message}`);
      }
    }
    const { error } = await supabase.from(TABELA_CTES).insert(chunk);
    if (error) {
      throw new Error(`Erro ao salvar CTes no Supabase (${TABELA_CTES}). Detalhe: ${error.message}`);
    }
    salvos += chunk.length;
    options.onProgress?.({ salvos, total: payload.length });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { salvos };
}

export async function listarRealizadoLocal(filtros = {}, options = {}) {
  if (shouldUseFallback()) return localFallback.listarRealizadoLocal(filtros, options);
  const result = await fetchRowsSupabase(filtros, { ...options, limit: Number(options.limit || 200) });
  return { rows: result.rows, avaliados: result.avaliados || result.rows.length };
}


async function fetchRowsSupabasePorRotas(filtros = {}, malhaKeys = [], options = {}) {
  const supabase = getClient();
  if (!supabase) return localFallback.buscarRealizadoLocalPorMalha(filtros, malhaKeys, options);

  const keys = malhaKeys instanceof Set ? [...malhaKeys] : [...(malhaKeys || [])];
  const rotas = uniqueItems([...extrairRotasDaMalha(keys)]);
  const rotaSet = new Set(rotas);
  const limit = Math.max(1, Number(options.limit || 10000));
  const pageSize = Math.max(100, Math.min(Number(options.pageSize || DEFAULT_PAGE_SIZE), 1000));
  const rowsByChave = new Map();
  let avaliados = 0;
  let consultas = 0;
  let usouFallbackIbge = false;

  const addPage = (data = []) => {
    const page = (data || []).map(fromDbRow);
    avaliados += page.length;
    for (const row of page) {
      const rota = chaveRotaCte(row);
      if (!rota || !rotaSet.has(rota)) continue;
      if (!filtrarCteLocal(row, filtros)) continue;
      const key = row.chaveCte || row.id || `${rota}-${rowsByChave.size}`;
      if (!rowsByChave.has(key)) rowsByChave.set(key, row);
      if (rowsByChave.size >= limit) break;
    }
  };

  const consultar = async (montarQuery, label = 'rotas') => {
    for (let from = 0; rowsByChave.size < limit; from += pageSize) {
      const to = from + pageSize - 1;
      let query = montarQuery().range(from, to);
      query = applyServerFilters(query, filtros);
      const { data, error } = await query;
      consultas += 1;
      if (error) {
        const complemento = erroTimeoutSupabase(error)
          ? ' A consulta por CTes foi otimizada por rota IBGE, mas ainda estourou o tempo. Rode o SQL CTES_AJUSTE_SIMULACAO_SEM_TIMEOUT.sql no Supabase para criar os índices e padronizar a chave_rota_ibge.'
          : '';
        throw new Error(`Erro ao consultar CTes no Supabase (${TABELA_CTES}) por ${label}. Detalhe: ${error.message}.${complemento}`);
      }
      addPage(data || []);
      if ((data || []).length < pageSize) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  // 1) Caminho principal: usa a coluna pronta chave_rota_ibge.
  // Isso evita varrer a tabela inteira de CTes e elimina o timeout da simulação.
  for (const chunk of chunkArray(rotas, Number(options.rotaChunkSize || ROTAS_CHUNK_SIZE))) {
    if (rowsByChave.size >= limit) break;
    await consultar(
      () => supabase.from(TABELA_CTES).select(CTES_SELECT_COLUMNS).in('chave_rota_ibge', chunk),
      'chave_rota_ibge'
    );
  }

  // 2) Fallback seguro: se a base ainda tiver CTes antigos sem chave_rota_ibge,
  // busca por par IBGE origem/destino. Agrupar por origem reduz muito o volume retornado.
  const pares = rotas.map(splitRotaIbge).filter(Boolean);
  const precisaFallbackIbge = rowsByChave.size < limit && pares.length;
  if (precisaFallbackIbge) {
    const destinosPorOrigem = new Map();
    pares.forEach(({ origem, destino }) => {
      const set = destinosPorOrigem.get(origem) || new Set();
      set.add(destino);
      destinosPorOrigem.set(origem, set);
    });

    for (const [origem, destinosSet] of destinosPorOrigem.entries()) {
      if (rowsByChave.size >= limit) break;
      const destinos = [...destinosSet];
      for (const destinoChunk of chunkArray(destinos, Number(options.destinoChunkSize || 80))) {
        if (rowsByChave.size >= limit) break;
        usouFallbackIbge = true;
        await consultar(
          () => supabase
            .from(TABELA_CTES)
            .select(CTES_SELECT_COLUMNS)
            .eq('ibge_origem', origem)
            .in('ibge_destino', destinoChunk),
          'ibge_origem/ibge_destino'
        );
      }
    }
  }

  const rows = [...rowsByChave.values()].slice(0, limit);
  return {
    rows,
    totalCompativel: rows.length,
    limit,
    malhaKeys: keys.length,
    rotaKeys: rotas.length,
    avaliados,
    consultas,
    usouFallbackIbge,
  };
}

export async function buscarRealizadoLocalPorMalha(filtros = {}, malhaKeys = [], options = {}) {
  if (shouldUseFallback()) return localFallback.buscarRealizadoLocalPorMalha(filtros, malhaKeys, options);
  const keysArray = malhaKeys instanceof Set ? [...malhaKeys] : [...(malhaKeys || [])];
  if (!keysArray.length) return { rows: [], totalCompativel: 0, limit: Number(options.limit || 5000), malhaKeys: 0, avaliados: 0 };

  // Não varrer a tabela inteira de CTes.
  // A simulação agora consulta somente as rotas IBGE existentes na malha da transportadora selecionada.
  return fetchRowsSupabasePorRotas(filtros, keysArray, {
    ...options,
    limit: Number(options.limit || 10000),
  });
}

export async function buscarRealizadoLocalParaSimulacao(filtros = {}, options = {}) {
  if (shouldUseFallback()) return localFallback.buscarRealizadoLocalParaSimulacao(filtros, options);
  const result = await fetchRowsSupabase(filtros, { ...options, limit: Number(options.limit || 5000) });
  return { rows: result.rows, totalCompativel: result.totalCompativel, limit: result.limit };
}

export async function resumirRealizadoLocal(filtros = {}, options = {}) {
  if (shouldUseFallback()) return localFallback.resumirRealizadoLocal(filtros, options);
  const supabase = getClient();

  const canalNormalizado = normalizeCanalParaMalha(filtros.canal);
  if (canalNormalizado && ['ATACADO', 'B2C'].includes(canalNormalizado)) {
    const base = await fetchRowsSupabase(filtros, { limit: Number(options.limit || 50000) });
    return resumoFromRows(base.rows, options);
  }

  const params = {
    p_competencia: filtros.competencia || null,
    p_inicio: filtros.inicio || null,
    p_fim: filtros.fim || null,
    p_canal: filtros.canal || null,
    p_transportadora: filtros.transportadoraRealizada || null,
    p_uf_origem: filtros.ufOrigem || null,
    p_uf_destino: filtros.ufDestino || null,
    p_origem: filtros.origem || null,
    p_destino: filtros.destino || null,
    p_excluir_ebazar: filtros.excluirEbazar !== false,
    p_somente_pendencias_ibge: Boolean(filtros.somentePendenciasIbge),
    p_peso_min: filtros.pesoMin === '' || filtros.pesoMin === null || filtros.pesoMin === undefined ? null : Number(filtros.pesoMin),
    p_peso_max: filtros.pesoMax === '' || filtros.pesoMax === null || filtros.pesoMax === undefined ? null : Number(filtros.pesoMax),
    p_top: Number(options.top || 10),
  };

  const { data, error } = await supabase.rpc('resumir_realizado_local_ctes', params);
  if (!error && data) return data;

  const fallback = await fetchRowsSupabase(filtros, { limit: Number(options.limit || 50000) });
  return resumoFromRows(fallback.rows, options);
}

export async function exportarRealizadoLocal(filtros = {}, options = {}) {
  if (shouldUseFallback()) return localFallback.exportarRealizadoLocal(filtros, options);
  return fetchRowsSupabase(filtros, { ...options, limit: Number(options.limit || 100000) });
}

export async function diagnosticarRealizadoLocal() {
  if (shouldUseFallback()) return localFallback.diagnosticarRealizadoLocal();
  const supabase = getClient();
  const { data, error } = await supabase.rpc('diagnosticar_realizado_local_ctes');
  if (!error && data) return data;

  const { count, error: countError } = await supabase
    .from(TABELA_CTES)
    .select('id', { count: 'exact', head: true });
  if (countError) {
    throw new Error(`Erro ao diagnosticar CTes no Supabase. Detalhe: ${countError.message}`);
  }
  return { total: count || 0, ultimaAtualizacao: '', periodoInicio: '', periodoFim: '' };
}

export async function limparNaoTomadoresRealizadoLocal(options = {}) {
  if (shouldUseFallback()) return localFallback.limparNaoTomadoresRealizadoLocal(options);
  const supabase = getClient();
  const { data, error } = await supabase.rpc('limpar_nao_tomadores_realizado_local', {
    p_confirmacao: 'LIMPAR NAO TOMADORES',
  });
  if (!error && data) return data;

  const base = await fetchRowsSupabase({}, { limit: Number(options.limit || 500000) });
  const remover = base.rows.filter((row) => !isTomadorServicoValidoRealizado(row.tomadorServico));
  let removidos = 0;
  for (let index = 0; index < remover.length; index += 500) {
    const chaves = remover.slice(index, index + 500).map((row) => row.chaveCte).filter(Boolean);
    if (!chaves.length) continue;
    const { error: deleteError } = await supabase.from(TABELA_CTES).delete().in('chave_cte', chaves);
    if (deleteError) throw new Error(`Erro ao limpar tomadores na base CTes. Detalhe: ${deleteError.message}`);
    removidos += chaves.length;
    options.onProgress?.({ avaliados: Math.min(index + 500, base.rows.length), removidos, mantidos: base.rows.length - removidos });
  }
  return { avaliados: base.rows.length, removidos, mantidos: base.rows.length - removidos };
}

export async function limparRealizadoLocal() {
  if (shouldUseFallback()) return localFallback.limparRealizadoLocal();
  const supabase = getClient();
  const { data, error } = await supabase.rpc('limpar_realizado_local_ctes', {
    p_confirmacao: 'APAGAR REALIZADO ONLINE',
  });
  if (error) {
    throw new Error(`Erro ao limpar a tabela ${TABELA_CTES}. Detalhe: ${error.message}`);
  }
  return { ok: true, removidos: Number(data || 0) };
}
