const IBGE_API_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome';
const CACHE_KEY = 'amd-ibge-municipios-oficial-v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function extrairUf(item = {}) {
  return (
    item?.microrregiao?.mesorregiao?.UF?.sigla ||
    item?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla ||
    item?.uf ||
    ''
  ).toString().toUpperCase();
}

function normalizarLista(raw = []) {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => ({
      ibge: String(item.id || item.ibge || item.codigo_ibge || '').replace(/\D/g, '').slice(0, 7),
      cidade: String(item.nome || item.cidade || item.municipio || '').trim(),
      uf: extrairUf(item),
    }))
    .filter((item) => item.ibge.length === 7 && item.cidade && item.uf.length === 2)
    .sort((a, b) => `${a.cidade}/${a.uf}`.localeCompare(`${b.cidade}/${b.uf}`, 'pt-BR'));
}

function lerCache() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - Number(parsed.savedAt) > CACHE_TTL_MS) return [];
    return normalizarLista(parsed.data || []);
  } catch {
    return [];
  }
}

function salvarCache(data = []) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Cache é opcional.
  }
}

export async function carregarMunicipiosIbgeOficial({ usarCache = true } = {}) {
  if (usarCache) {
    const cached = lerCache();
    if (cached.length >= 5000) return { municipios: cached, fonte: 'IBGE oficial em cache' };
  }

  const response = await fetch(IBGE_API_URL, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Não foi possível baixar a base oficial de municípios do IBGE. Status ${response.status}.`);
  }

  const raw = await response.json();
  const municipios = normalizarLista(raw);
  if (municipios.length >= 5000) salvarCache(municipios);
  return { municipios, fonte: 'IBGE oficial online' };
}

export function normalizarMunicipiosIbgeExternos(lista = []) {
  return normalizarLista(lista);
}
