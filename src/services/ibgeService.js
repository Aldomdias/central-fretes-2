import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarMunicipiosIbgeDb } from './freteDatabaseService';
import { carregarMunicipiosIbgeOficial } from '../utils/ibgeMunicipiosOficial';

const PAGE_SIZE = 1000;

function supabaseOrNull() {
  return isSupabaseConfigured() ? getSupabaseClient() : null;
}

export function normalizarTextoIbge(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function municipioToSupabaseRow(item = {}) {
  const ibge = String(item.ibge || item.codigo_ibge || item.codigo_municipio_completo || '').replace(/\D/g, '').slice(0, 7);
  const cidade = String(item.cidade || item.nome || item.nome_municipio || item.municipio || '').trim();
  const uf = String(item.uf || item.estado || '').trim().toUpperCase().slice(0, 2);
  if (!ibge || ibge.length !== 7 || !cidade || uf.length !== 2) return null;
  return {
    uf,
    nome_municipio: cidade,
    nome_municipio_sem_acento: normalizarTextoIbge(cidade),
    codigo_municipio_completo: ibge,
  };
}

function normalizeMunicipio(item = {}) {
  const ibge = String(item.ibge || item.codigo_ibge || item.codigo_municipio_completo || '').replace(/\D/g, '').slice(0, 7);
  const cidade = String(item.cidade || item.nome || item.nome_municipio || item.municipio || '').trim();
  const uf = String(item.uf || item.estado || '').trim().toUpperCase().slice(0, 2);
  if (!ibge || !cidade) return null;
  return {
    ibge,
    cidade,
    uf,
    cidadeSemAcento: normalizarTextoIbge(cidade),
    fonte: item.fonte || 'Supabase IBGE',
  };
}

export async function diagnosticarBaseIbgeSupabase() {
  const supabase = supabaseOrNull();
  if (!supabase) {
    return { conectado: false, existe: false, total: 0, faixasCep: 0, erro: 'Supabase não configurado.' };
  }

  try {
    const municipios = await supabase.from('ibge_municipios').select('id', { count: 'exact', head: true });
    if (municipios.error) throw municipios.error;

    let faixasCep = 0;
    try {
      const faixas = await supabase.from('ibge_faixas_cep').select('id', { count: 'exact', head: true });
      faixasCep = faixas?.count || 0;
    } catch {
      faixasCep = 0;
    }

    return {
      conectado: true,
      existe: true,
      total: municipios.count || 0,
      faixasCep,
      erro: '',
    };
  } catch (error) {
    return {
      conectado: true,
      existe: false,
      total: 0,
      faixasCep: 0,
      erro: error?.message || 'Tabela ibge_municipios não encontrada no Supabase.',
    };
  }
}

export async function carregarMunicipiosIbgeComFallback({ permitirOficial = true } = {}) {
  const supabaseRows = await carregarMunicipiosIbgeDb().catch(() => []);
  if (supabaseRows.length >= 5000 || !permitirOficial) {
    return {
      municipios: supabaseRows.map((item) => ({ ...item, fonte: 'Supabase IBGE' })),
      fonte: supabaseRows.length ? 'Supabase IBGE' : 'Supabase IBGE vazio',
      totalSupabase: supabaseRows.length,
    };
  }

  try {
    const oficial = await carregarMunicipiosIbgeOficial({ usarCache: true });
    if (oficial.municipios?.length) {
      return {
        municipios: oficial.municipios.map((item) => ({ ...item, fonte: oficial.fonte || 'IBGE oficial' })),
        fonte: supabaseRows.length ? `${oficial.fonte || 'IBGE oficial'} + Supabase incompleto` : (oficial.fonte || 'IBGE oficial'),
        totalSupabase: supabaseRows.length,
      };
    }
  } catch {
    // Mantém Supabase, mesmo incompleto.
  }

  return {
    municipios: supabaseRows.map((item) => ({ ...item, fonte: 'Supabase IBGE' })),
    fonte: supabaseRows.length ? 'Supabase IBGE incompleto' : 'IBGE não carregado',
    totalSupabase: supabaseRows.length,
  };
}

export async function consultarMunicipiosIbge({ termo = '', uf = '', limite = 80, usarOficialSeVazio = true } = {}) {
  const termoNormalizado = normalizarTextoIbge(termo);
  const ufFiltro = String(uf || '').trim().toUpperCase().slice(0, 2);
  const supabase = supabaseOrNull();
  const resultados = [];

  if (supabase) {
    try {
      let query = supabase
        .from('ibge_municipios')
        .select('uf, nome_municipio, nome_municipio_sem_acento, codigo_municipio_completo')
        .limit(limite);

      if (ufFiltro) query = query.eq('uf', ufFiltro);
      if (termoNormalizado) {
        const termoRaw = String(termo || '').trim();
        query = query.or(`nome_municipio.ilike.%${termoRaw}%,nome_municipio_sem_acento.ilike.%${termoNormalizado}%`);
      }

      const { data, error } = await query.order('uf', { ascending: true }).order('nome_municipio', { ascending: true });
      if (!error) {
        resultados.push(...(data || []).map((item) => normalizeMunicipio(item)).filter(Boolean).map((item) => ({ ...item, fonte: 'Supabase IBGE' })));
      }
    } catch {
      // Fallback oficial abaixo.
    }
  }

  if ((!resultados.length || !supabase) && usarOficialSeVazio) {
    const oficial = await carregarMunicipiosIbgeOficial({ usarCache: true }).catch(() => ({ municipios: [] }));
    const filtrados = (oficial.municipios || [])
      .map((item) => normalizeMunicipio({ ...item, fonte: oficial.fonte || 'IBGE oficial' }))
      .filter(Boolean)
      .filter((item) => !ufFiltro || item.uf === ufFiltro)
      .filter((item) => !termoNormalizado || item.cidadeSemAcento.includes(termoNormalizado) || String(item.ibge).includes(termoNormalizado))
      .slice(0, limite)
      .map((item) => ({ ...item, fonte: oficial.fonte || 'IBGE oficial' }));
    resultados.push(...filtrados);
  }

  const dedup = new Map();
  resultados.forEach((item) => {
    if (!dedup.has(item.ibge)) dedup.set(item.ibge, item);
  });
  return [...dedup.values()].sort((a, b) => `${a.uf}/${a.cidade}`.localeCompare(`${b.uf}/${b.cidade}`, 'pt-BR'));
}

export async function consultarFaixasCepIbgeDb(ibge) {
  const codigo = String(ibge || '').replace(/\D/g, '').slice(0, 7);
  const supabase = supabaseOrNull();
  if (!supabase || !codigo) return [];

  try {
    const { data, error } = await supabase
      .from('ibge_faixas_cep')
      .select('cep_inicial, cep_final, ordem_faixa, codigo_municipio_completo')
      .eq('codigo_municipio_completo', codigo)
      .order('ordem_faixa', { ascending: true });
    if (error) return [];
    return (data || []).map((item) => ({
      cepInicial: item.cep_inicial || '',
      cepFinal: item.cep_final || '',
      ordem: item.ordem_faixa || 1,
    }));
  } catch {
    return [];
  }
}

export async function sincronizarIbgeOficialSupabase({ onProgress } = {}) {
  const supabase = supabaseOrNull();
  if (!supabase) throw new Error('Supabase não configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');

  const oficial = await carregarMunicipiosIbgeOficial({ usarCache: false });
  const rows = (oficial.municipios || []).map(municipioToSupabaseRow).filter(Boolean);
  if (!rows.length) throw new Error('Não consegui carregar a base oficial de municípios do IBGE.');

  let salvos = 0;
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const chunk = rows.slice(i, i + PAGE_SIZE);
    const { error } = await supabase
      .from('ibge_municipios')
      .upsert(chunk, { onConflict: 'codigo_municipio_completo' });
    if (error) throw error;
    salvos += chunk.length;
    onProgress?.({ salvos, total: rows.length });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { salvos, total: rows.length, fonte: oficial.fonte || 'IBGE oficial online' };
}
