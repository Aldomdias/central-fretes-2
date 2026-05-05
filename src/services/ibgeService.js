import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarMunicipiosIbgeDb } from './freteDatabaseService';
import { carregarMunicipiosIbgeOficial } from '../utils/ibgeMunicipiosOficial';
import * as XLSX from 'xlsx';

const PAGE_SIZE = 1000;

const CEP_REGEX = /cep/i;

function normalizarChavePlanilha(key = '') {
  return String(key || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function normalizarCep(value = '') {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 8) return digits.slice(0, 8);
  return digits.padStart(8, '0');
}

function limparIbge(value = '') {
  return String(value ?? '').replace(/\D/g, '').slice(0, 7);
}

function normalizarLinhaPlanilha(row = {}) {
  const out = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    out[normalizarChavePlanilha(key)] = value;
  });
  return out;
}

function pickByAliases(row = {}, aliases = []) {
  for (const alias of aliases) {
    const key = normalizarChavePlanilha(alias);
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function pickByPattern(row = {}, predicate) {
  for (const [key, value] of Object.entries(row || {})) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    if (predicate(key)) return String(value).trim();
  }
  return '';
}

function parseIbgeCepRow(rawRow = {}) {
  const row = normalizarLinhaPlanilha(rawRow);

  let ibge = limparIbge(pickByAliases(row, [
    'IBGE', 'Codigo IBGE', 'Código IBGE', 'Cod IBGE', 'Cod. IBGE',
    'Codigo Municipio Completo', 'Código Município Completo', 'Cod Municipio Completo',
    'Codigo Municipio', 'Código Município', 'Cod Municipio', 'Cod Mun', 'CD_MUN', 'CD GEOCMU', 'CD_GEOCMU',
  ]));

  if (!ibge) {
    ibge = limparIbge(pickByPattern(row, (key) => /IBGE|COD.*MUNIC|MUNIC.*COD|CDGEOCMU/.test(key)));
  }

  const cidade = pickByAliases(row, [
    'Cidade', 'Municipio', 'Município', 'Nome Municipio', 'Nome Município',
    'Nome do Municipio', 'Nome do Município', 'Nome Cidade', 'Cidade com Acento',
    'Municipio com Acento', 'Município com Acento', 'NM_MUNICIPIO', 'NOME_MUNICIPIO',
  ]) || pickByPattern(row, (key) => (/CIDADE|MUNICIPIO|MUNICIP|NOMEMUN|NOMEMUNICIPIO/.test(key) && !/SEMACENTO|NORMALIZ/.test(key)));

  const cidadeSemAcentoArquivo = pickByAliases(row, [
    'Cidade sem Acento', 'Município sem Acento', 'Municipio sem Acento',
    'Nome Municipio sem Acento', 'Nome Município sem Acento', 'Nome sem Acento',
    'NOME_MUNICIPIO_SEM_ACENTO', 'NOME_SEM_ACENTO',
  ]) || pickByPattern(row, (key) => (/SEMACENTO|NORMALIZADO|NORMALIZADA/.test(key) && /CIDADE|MUNICIPIO|MUNICIP|NOME/.test(key)));

  const uf = (pickByAliases(row, ['UF', 'Estado', 'Sigla UF', 'UF Municipio', 'UF Município', 'SG_UF']) ||
    pickByPattern(row, (key) => /(^UF$|SIGLAUF|ESTADO|SGUF)/.test(key))).toUpperCase().slice(0, 2);

  let cepInicial = normalizarCep(pickByAliases(row, [
    'CEP Inicial', 'Cep Inicial', 'CEP Inicio', 'CEP Início', 'CEP Ini',
    'Inicio CEP', 'Início CEP', 'Faixa CEP Inicial', 'Faixa Inicial CEP',
    'CEP De', 'CEP Inicial Municipio', 'CEP_INICIAL', 'CEPINI', 'CEP_INI',
  ]));

  let cepFinal = normalizarCep(pickByAliases(row, [
    'CEP Final', 'Cep Final', 'CEP Fim', 'Fim CEP', 'Faixa CEP Final',
    'Faixa Final CEP', 'CEP Ate', 'CEP Até', 'CEP Final Municipio',
    'CEP_FINAL', 'CEPFIM', 'CEP_FIM',
  ]));

  if (!cepInicial) {
    cepInicial = normalizarCep(pickByPattern(row, (key) => CEP_REGEX.test(key) && /INICIAL|INICIO|INI|DE$|^DE/.test(key)));
  }
  if (!cepFinal) {
    cepFinal = normalizarCep(pickByPattern(row, (key) => CEP_REGEX.test(key) && /FINAL|FIM|ATE|ATÉ/.test(key)));
  }

  const cepUnico = normalizarCep(pickByAliases(row, ['CEP', 'Cep Municipio', 'CEP Município']));
  if (!cepInicial && cepUnico) cepInicial = cepUnico;
  if (!cepFinal && cepUnico) cepFinal = cepUnico;

  if (!ibge && !cidade && !uf && !cepInicial && !cepFinal) return null;

  return {
    ibge,
    cidade: String(cidade || '').trim(),
    cidadeSemAcentoArquivo: String(cidadeSemAcentoArquivo || '').trim(),
    uf,
    cepInicial,
    cepFinal,
  };
}

function baixarWorkbook(workbook, filename) {
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


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
    nome_municipio_sem_acento: normalizarTextoIbge(item.nome_municipio_sem_acento || item.cidadeSemAcentoArquivo || cidade),
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
  const termoRaw = String(termo || '').trim();
  const somenteDigitos = termoRaw.replace(/\D/g, '');
  const ufFiltro = String(uf || '').trim().toUpperCase().slice(0, 2);
  const supabase = supabaseOrNull();
  const resultados = [];

  if (supabase) {
    try {
      const codigosPorCep = [];
      if (somenteDigitos.length === 8) {
        const cep = normalizarCep(somenteDigitos);
        const { data: faixasData } = await supabase
          .from('ibge_faixas_cep')
          .select('codigo_municipio_completo, cep_inicial, cep_final, ordem_faixa')
          .lte('cep_inicial', cep)
          .gte('cep_final', cep)
          .limit(limite);
        (faixasData || []).forEach((item) => {
          const codigo = limparIbge(item.codigo_municipio_completo);
          if (codigo && !codigosPorCep.includes(codigo)) codigosPorCep.push(codigo);
        });
      }

      let query = supabase
        .from('ibge_municipios')
        .select('uf, nome_municipio, nome_municipio_sem_acento, codigo_municipio_completo')
        .limit(limite);

      if (ufFiltro) query = query.eq('uf', ufFiltro);

      if (codigosPorCep.length) {
        query = query.in('codigo_municipio_completo', codigosPorCep);
      } else if (termoNormalizado) {
        const filtros = [
          `nome_municipio.ilike.%${termoRaw}%`,
          `nome_municipio_sem_acento.ilike.%${termoNormalizado}%`,
          `codigo_municipio_completo.ilike.%${somenteDigitos || termoNormalizado}%`,
        ];
        query = query.or(filtros.join(','));
      }

      const { data, error } = await query.order('uf', { ascending: true }).order('nome_municipio', { ascending: true });
      if (!error) {
        resultados.push(...(data || []).map((item) => normalizeMunicipio(item)).filter(Boolean).map((item) => ({ ...item, fonte: codigosPorCep.length ? 'Supabase CEP/IBGE' : 'Supabase IBGE' })));
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
      .filter((item) => !termoNormalizado || item.cidadeSemAcento.includes(termoNormalizado) || String(item.ibge).includes(somenteDigitos || termoNormalizado))
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


export async function importarBaseIbgeCepSupabase(file, { onProgress } = {}) {
  const supabase = supabaseOrNull();
  if (!supabase) throw new Error('Supabase não configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  if (!file) throw new Error('Selecione uma planilha de IBGE/CEP para importar.');

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const todasLinhas = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    rows.forEach((row, idx) => todasLinhas.push({ sheetName, rowIndex: idx + 2, row }));
  });

  if (!todasLinhas.length) throw new Error('A planilha não possui linhas para importar.');

  const municipiosMap = new Map();
  const faixasMap = new Map();
  const ignoradas = [];

  todasLinhas.forEach(({ sheetName, rowIndex, row }) => {
    const parsed = parseIbgeCepRow(row);
    if (!parsed) return;

    if (!parsed.ibge || parsed.ibge.length !== 7 || !parsed.cidade || parsed.uf.length !== 2) {
      ignoradas.push(`${sheetName} linha ${rowIndex}: faltou IBGE, cidade ou UF.`);
      return;
    }

    municipiosMap.set(parsed.ibge, {
      uf: parsed.uf,
      nome_municipio: parsed.cidade,
      nome_municipio_sem_acento: normalizarTextoIbge(parsed.cidadeSemAcentoArquivo || parsed.cidade),
      codigo_municipio_completo: parsed.ibge,
    });

    if (parsed.cepInicial || parsed.cepFinal) {
      const cepInicial = parsed.cepInicial || parsed.cepFinal;
      const cepFinal = parsed.cepFinal || parsed.cepInicial;
      if (cepInicial.length === 8 && cepFinal.length === 8) {
        const inicio = cepInicial <= cepFinal ? cepInicial : cepFinal;
        const fim = cepInicial <= cepFinal ? cepFinal : cepInicial;
        faixasMap.set(`${parsed.ibge}|${inicio}|${fim}`, {
          codigo_municipio_completo: parsed.ibge,
          cep_inicial: inicio,
          cep_final: fim,
          ordem_faixa: 1,
        });
      } else {
        ignoradas.push(`${sheetName} linha ${rowIndex}: CEP inicial/final inválido.`);
      }
    }
  });

  const municipios = [...municipiosMap.values()];
  const faixas = [...faixasMap.values()].map((faixa, idx) => ({ ...faixa, ordem_faixa: idx + 1 }));
  if (!municipios.length) throw new Error('Nenhum município válido localizado. Confira se a planilha possui colunas de IBGE, cidade e UF.');

  let municipiosSalvos = 0;
  let faixasSalvas = 0;
  onProgress?.({ etapa: 'municipios', salvos: 0, total: municipios.length });

  for (let i = 0; i < municipios.length; i += PAGE_SIZE) {
    const chunk = municipios.slice(i, i + PAGE_SIZE);
    const { error } = await supabase
      .from('ibge_municipios')
      .upsert(chunk, { onConflict: 'codigo_municipio_completo' });
    if (error) throw error;
    municipiosSalvos += chunk.length;
    onProgress?.({ etapa: 'municipios', salvos: municipiosSalvos, total: municipios.length });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (faixas.length) {
    const codigosComFaixa = [...new Set(faixas.map((item) => item.codigo_municipio_completo))];
    onProgress?.({ etapa: 'limpando_faixas', salvos: 0, total: codigosComFaixa.length });
    for (let i = 0; i < codigosComFaixa.length; i += 500) {
      const chunkCodigos = codigosComFaixa.slice(i, i + 500);
      const { error } = await supabase
        .from('ibge_faixas_cep')
        .delete()
        .in('codigo_municipio_completo', chunkCodigos);
      if (error) throw error;
      onProgress?.({ etapa: 'limpando_faixas', salvos: Math.min(i + chunkCodigos.length, codigosComFaixa.length), total: codigosComFaixa.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    onProgress?.({ etapa: 'faixas', salvos: 0, total: faixas.length });
    for (let i = 0; i < faixas.length; i += PAGE_SIZE) {
      const chunk = faixas.slice(i, i + PAGE_SIZE);
      const { error } = await supabase
        .from('ibge_faixas_cep')
        .insert(chunk);
      if (error) throw error;
      faixasSalvas += chunk.length;
      onProgress?.({ etapa: 'faixas', salvos: faixasSalvas, total: faixas.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    municipiosSalvos,
    faixasSalvas,
    linhasLidas: todasLinhas.length,
    linhasIgnoradas: ignoradas.length,
    exemplosIgnoradas: ignoradas.slice(0, 8),
  };
}

export function baixarModeloIbgeCep() {
  const exemplo = [
    {
      UF: 'SC',
      Municipio: 'Itajaí',
      Municipio_Sem_Acento: 'ITAJAI',
      Codigo_IBGE: '4208203',
      CEP_Inicial: '88300000',
      CEP_Final: '88319999',
    },
    {
      UF: 'GO',
      Municipio: 'Cavalcante',
      Municipio_Sem_Acento: 'CAVALCANTE',
      Codigo_IBGE: '5205305',
      CEP_Inicial: '73790000',
      CEP_Final: '73799999',
    },
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exemplo);
  XLSX.utils.book_append_sheet(wb, ws, 'IBGE_CEP');
  baixarWorkbook(wb, 'modelo-importacao-ibge-cep.xlsx');
}
