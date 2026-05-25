import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const PAGE_SIZE = 1000;

function norm(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function normLoose(value = '') {
  return norm(value).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function buildMunicipioMap(municipios = []) {
  const mapa = new Map();
  (municipios || []).forEach((item) => {
    const cidade = item.cidade || item.nome || item.municipio || item.nome_municipio || '';
    const uf = item.uf || item.estado || '';
    const ibge = onlyDigits(item.ibge || item.codigo_ibge || item.codigo || item.codigo_municipio_completo).slice(0, 7);
    if (!cidade || !ibge) return;
    const keyUf = `${normLoose(cidade)}|${norm(uf).slice(0, 2)}`;
    const keyCidade = `${normLoose(cidade)}|`;
    mapa.set(keyUf, ibge);
    if (!mapa.has(keyCidade)) mapa.set(keyCidade, ibge);
  });
  return mapa;
}

function resolverIbge(row = {}, tipo = 'destino', mapaMunicipios = new Map()) {
  const atual = onlyDigits(tipo === 'origem'
    ? row.ibgeOrigem || row.ibge_origem || row.codigo_ibge_origem || row.cod_mun_origem
    : row.ibgeDestino || row.ibge_destino || row.codigo_ibge_destino || row.cod_mun_destino).slice(0, 7);
  if (atual) return atual;

  const cidade = tipo === 'origem'
    ? row.cidadeOrigem || row.cidade_origem || row.origem || row.municipio_origem
    : row.cidadeDestino || row.cidade_destino || row.destino || row.municipio_destino;
  const uf = tipo === 'origem'
    ? row.ufOrigem || row.uf_origem || row.estado_origem
    : row.ufDestino || row.uf_destino || row.estado_destino;

  return mapaMunicipios.get(`${normLoose(cidade)}|${norm(uf).slice(0, 2)}`)
    || mapaMunicipios.get(`${normLoose(cidade)}|`)
    || '';
}

function normalizarCanal(value = '') {
  const canal = norm(value);
  if (!canal) return '';
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  if (canal.includes('ATACADO') || canal.includes('B2B')) return 'ATACADO';
  if (canal.includes('B2C') || canal.includes('ECOMMERCE') || canal.includes('MARKETPLACE') || canal.includes('MERCADO LIVRE') || canal.includes('SHOPEE')) return 'B2C';
  return canal;
}

function normalizarRow(row = {}, mapaMunicipios = new Map()) {
  const dataEmissao = String(row.dataEmissao || row.data_emissao || row.emissao || '').slice(0, 10);
  const cidadeOrigem = row.cidadeOrigem || row.cidade_origem || row.origem || row.municipio_origem || '';
  const cidadeDestino = row.cidadeDestino || row.cidade_destino || row.destino || row.municipio_destino || '';
  const ufOrigem = norm(row.ufOrigem || row.uf_origem || row.estado_origem).slice(0, 2);
  const ufDestino = norm(row.ufDestino || row.uf_destino || row.estado_destino).slice(0, 2);
  const ibgeOrigem = resolverIbge({ ...row, cidadeOrigem, ufOrigem }, 'origem', mapaMunicipios);
  const ibgeDestino = resolverIbge({ ...row, cidadeDestino, ufDestino }, 'destino', mapaMunicipios);
  const peso = Math.max(
    toNumber(row.peso),
    toNumber(row.pesoDeclarado),
    toNumber(row.peso_declarado),
    toNumber(row.pesoCubado),
    toNumber(row.peso_cubado)
  );
  const chaveRotaIbge = ibgeOrigem && ibgeDestino ? `${ibgeOrigem}-${ibgeDestino}` : '';

  return {
    chaveCte: row.chaveCte || row.chave_cte || row.id || `${row.numeroCte || row.numero_cte || 'cte'}-${dataEmissao}-${row.transportadora || ''}`,
    numeroCte: row.numeroCte || row.numero_cte || row.cte || '',
    competencia: row.competencia || (dataEmissao ? dataEmissao.slice(0, 7) : ''),
    dataEmissao,
    canal: normalizarCanal(row.canal || row.canalVendas || row.canal_vendas || row.canais || row.canal_original || ''),
    transportadora: row.transportadora || row.nome_transportadora || row.transportador || row.transportadora_contratada || row.transportadoraContratada || '',
    ufOrigem,
    ufDestino,
    cidadeOrigem,
    cidadeDestino,
    valorCte: toNumber(row.valorCte ?? row.valor_cte ?? row.frete_realizado ?? row.valor_frete),
    valorNF: toNumber(row.valorNF ?? row.valor_nf ?? row.nf_venda ?? row.valor_nota),
    peso,
    pesoDeclarado: toNumber(row.pesoDeclarado ?? row.peso_declarado) || peso,
    pesoCubado: toNumber(row.pesoCubado ?? row.peso_cubado),
    cubagem: toNumber(row.cubagem ?? row.cubagem_total ?? row.metrosCubicos ?? row.metros_cubicos),
    qtdVolumes: toNumber(row.qtdVolumes ?? row.qtd_volumes ?? row.volume ?? row.volumes),
    ibgeOrigem,
    ibgeDestino,
    chaveRotaIbge,
    ibgeOk: Boolean(chaveRotaIbge),
    tomadorServico: row.tomadorServico || row.tomador_servico || row.tomador || '',
    origemFonte: row.__fonte || 'realizado-remoto',
  };
}

function passaFiltros(row = {}, filtros = {}) {
  if (filtros.inicio && (!row.dataEmissao || row.dataEmissao < filtros.inicio)) return false;
  if (filtros.fim && (!row.dataEmissao || row.dataEmissao > filtros.fim)) return false;
  if (filtros.canal && normalizarCanal(row.canal) !== normalizarCanal(filtros.canal)) return false;
  if (filtros.transportadoraRealizada && !normLoose(row.transportadora).includes(normLoose(filtros.transportadoraRealizada))) return false;
  if (filtros.ufOrigem && norm(row.ufOrigem) !== norm(filtros.ufOrigem)) return false;
  if (filtros.ufDestino && norm(row.ufDestino) !== norm(filtros.ufDestino)) return false;
  if (filtros.origem && !normLoose(row.cidadeOrigem).includes(normLoose(filtros.origem))) return false;
  if (filtros.destino && !normLoose(row.cidadeDestino).includes(normLoose(filtros.destino))) return false;
  return true;
}

async function buscarTabelaPaginada(supabase, tabela, filtros = {}, totalMax = 30000) {
  const rows = [];
  const inicio = filtros.inicio ? `${filtros.inicio}T00:00:00` : '';
  const fim = filtros.fim ? `${filtros.fim}T23:59:59` : '';
  const colunaData = tabela === 'realizado_local_ctes' ? 'data_emissao' : 'emissao';

  for (let from = 0; from < totalMax; from += PAGE_SIZE) {
    let query = supabase
      .from(tabela)
      .select('*')
      .range(from, from + PAGE_SIZE - 1);

    if (inicio) query = query.gte(colunaData, inicio);
    if (fim) query = query.lte(colunaData, fim);
    if (filtros.transportadoraRealizada) query = query.ilike('transportadora', `%${filtros.transportadoraRealizada}%`);
    if (filtros.ufOrigem) query = query.eq('uf_origem', norm(filtros.ufOrigem).slice(0, 2));
    if (filtros.ufDestino) query = query.eq('uf_destino', norm(filtros.ufDestino).slice(0, 2));

    try {
      query = query.order(colunaData, { ascending: false, nullsFirst: false });
    } catch {
      // algumas tabelas/visões não aceitam ordenação; segue sem bloquear
    }

    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    rows.push(...page.map((row) => ({ ...row, __fonte: tabela })));
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

export async function buscarRealizadoRemotoParaPerda(filtros = {}, options = {}) {
  if (!isSupabaseConfigured()) {
    return { rows: [], totalCompativel: 0, limit: Number(options.limit || 30000), origem: 'sem-supabase' };
  }

  const supabase = getSupabaseClient();
  const limit = Number(options.limit || 30000);
  const totalMax = Math.max(limit, Number(options.totalMax || 50000));
  const mapaMunicipios = buildMunicipioMap(options.municipios || []);

  const tentativas = ['realizado_local_ctes', 'realizado_ctes'];
  const erros = [];

  for (const tabela of tentativas) {
    try {
      const brutos = await buscarTabelaPaginada(supabase, tabela, filtros, totalMax);
      const rows = brutos
        .map((row) => normalizarRow(row, mapaMunicipios))
        .filter((row) => passaFiltros(row, filtros));

      if (rows.length) {
        return {
          rows: rows.slice(0, limit),
          totalCompativel: rows.length,
          limit,
          origem: tabela,
          totalBruto: brutos.length,
        };
      }

      erros.push(`${tabela}: ${brutos.length} brutos, 0 após filtros`);
    } catch (error) {
      erros.push(`${tabela}: ${error?.message || String(error)}`);
    }
  }

  return {
    rows: [],
    totalCompativel: 0,
    limit,
    origem: 'realizado-remoto',
    diagnostico: erros.join(' | '),
  };
}
