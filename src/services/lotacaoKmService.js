// Completa o KM das rotas pela internet: coordenadas (OpenStreetMap/Nominatim) + distancia
// rodoviaria (OSRM). Roda no navegador, 1 consulta de coordenada por segundo (regra do servico).
import { norm } from '../utils/lotacaoCotacaoChave';

const GEO_KEY = 'lotacao_geo_cache_v1';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function lerCache() {
  try { return JSON.parse(localStorage.getItem(GEO_KEY) || '{}'); } catch { return {}; }
}
function gravarCache(cache) {
  try { localStorage.setItem(GEO_KEY, JSON.stringify(cache)); } catch { /* sem cache local */ }
}

export async function buscarKmInternet(rotas, onProgresso) {
  const cache = lerCache();
  const achados = {};
  const falhas = [];

  const geo = async (cidade, uf) => {
    const k = `${norm(cidade)}|${uf}`;
    if (cache[k] !== undefined) return cache[k];
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${cidade}, ${uf}, Brasil`)}&format=json&limit=3&addressdetails=1&countrycodes=br&accept-language=pt-BR`;
    const resp = await fetch(url);
    const lista = await resp.json();
    const ok = (Array.isArray(lista) ? lista : []).find((x) => String(x.address?.['ISO3166-2-lvl4'] || '').toUpperCase() === `BR-${uf}`);
    cache[k] = ok ? { lat: Number(ok.lat), lon: Number(ok.lon) } : false;
    gravarCache(cache);
    await sleep(1100);
    return cache[k];
  };

  let i = 0;
  for (const r of rotas) {
    i += 1;
    if (onProgresso) onProgresso(`${i}/${rotas.length}: ${r.origem} → ${r.destino}`);
    try {
      const a = await geo(r.origem, r.uf_origem);
      const b = await geo(r.destino, r.uf_destino);
      if (!a || !b) { falhas.push({ rota: r, motivo: `cidade não localizada: ${!a ? r.origem : r.destino}` }); continue; }
      const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
      const j = await resp.json();
      if (j.code === 'Ok') achados[r.chave] = Math.round(j.routes[0].distance / 1000);
      else falhas.push({ rota: r, motivo: 'sem rota rodoviária' });
      await sleep(400);
    } catch (e) {
      falhas.push({ rota: r, motivo: e.message || 'erro de rede' });
    }
  }
  return { achados, falhas };
}
