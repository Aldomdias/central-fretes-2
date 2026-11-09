/**
 * Sincroniza a auditoria de fretes do painel da TransGP para a Central (tabela transgp_auditoria_ctes).
 *
 * GET /api/transgp-auditoria            — cron da Vercel (de hora em hora): ultimos 120 dias de coleta
 * GET /api/transgp-auditoria?dias=400   — janela maior (max. 400, limite da API deles)
 *
 * Fonte: GET https://painel-transgp.vercel.app/api/v1/auditoria/fretes?de=&ate=&pagina=&por_pagina=500
 * (Authorization: Bearer TRANSGP_API_KEY). Uma linha por CT-e de cada DIST, chave = chave do CT-e.
 * Variaveis no Vercel: TRANSGP_API_KEY, SUPABASE_URL (ou VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY;
 * opcional TRANSGP_API_URL e CRON_SECRET (se existir, o cron manda o Bearer; chamada manual tambem precisa).
 */
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 120 };

const API_PADRAO = 'https://painel-transgp.vercel.app/api/v1/auditoria/fretes';
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const digitos = (v) => String(v ?? '').replace(/\D+/g, '');
const dataIso = (d) => d.toISOString().slice(0, 10);

function linhasDaDist(item, agora) {
  const ctes = Array.isArray(item.ctes) ? item.ctes : [];
  const comum = {
    dist: String(item.dist ?? '').trim(),
    operacao: item.operacao || null,
    transportadora: item.transportadora || null,
    origem: item.origem || null,
    destinos: Array.isArray(item.destinos) ? item.destinos.join(' | ') : (item.destinos || null),
    coleta_planejada: item.coleta_planejada || null,
    status_carga: item.status_carga || null,
    frete_contratado: num(item.frete?.contratado),
    pedagio: num(item.frete?.pedagio),
    total_contratado: num(item.frete?.total_contratado),
    qtd_ctes: num(item.qtd_ctes) ?? ctes.length,
    cte_total: num(item.cte_total),
    diferenca_total: num(item.diferenca_total),
    situacao: item.situacao || null,
    liberado_pagamento: item.liberado_pagamento === true,
    liberado_em: item.liberado_em || null,
    decisao_auditoria: item.decisao_auditoria ?? null,
    sincronizado_em: agora,
  };
  if (!comum.dist) return [];
  return ctes.map((cte) => {
    const chave = digitos(cte.chave);
    const numero = digitos(cte.numero) ? String(Number(digitos(cte.numero))) : null;
    const id = chave.length === 44 ? chave : (numero ? `${comum.dist}|${numero}` : null);
    if (!id) return null;
    return { ...comum, chave_cte: id, numero_cte: numero, serie: cte.serie != null ? String(cte.serie) : null, valor_cte: num(cte.valor_total), payload: cte };
  }).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const segredo = process.env.CRON_SECRET;
  if (segredo && req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ ok: false, erro: 'Nao autorizado.' });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const chaveDb = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const chaveApi = process.env.TRANSGP_API_KEY;
  if (!url || !chaveDb) return res.status(500).json({ ok: false, erro: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas.' });
  if (!chaveApi) return res.status(500).json({ ok: false, erro: 'TRANSGP_API_KEY nao configurada no Vercel.' });
  const db = createClient(url, chaveDb, { auth: { persistSession: false } });

  const dias = Math.min(Math.max(Number(req.query?.dias) || 120, 1), 400);
  const ate = new Date();
  const de = new Date(ate.getTime() - (dias - 1) * 86400000);
  const base = process.env.TRANSGP_API_URL || API_PADRAO;
  const agora = new Date().toISOString();
  let dists = 0;
  let linhas = 0;
  try {
    for (let pagina = 1; pagina <= 200; pagina += 1) {
      const qs = new URLSearchParams({ de: dataIso(de), ate: dataIso(ate), pagina: String(pagina), por_pagina: '500' });
      const resp = await fetch(`${base}?${qs}`, { headers: { Authorization: `Bearer ${chaveApi}`, Accept: 'application/json' } });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok || corpo.ok === false) throw new Error(`API TransGP ${resp.status}: ${corpo.erro || corpo.error || corpo.message || 'resposta invalida'}`);
      const dados = Array.isArray(corpo.dados) ? corpo.dados : [];
      dists += dados.length;
      const porChave = new Map();
      dados.flatMap((item) => linhasDaDist(item, agora)).forEach((l) => porChave.set(l.chave_cte, l));
      const lote = [...porChave.values()];
      for (let i = 0; i < lote.length; i += 500) {
        const { error } = await db.from('transgp_auditoria_ctes').upsert(lote.slice(i, i + 500), { onConflict: 'chave_cte' });
        if (error) throw new Error(`Gravar: ${error.message}`);
      }
      linhas += lote.length;
      if (!dados.length || pagina >= (Number(corpo.paginas) || 1)) break;
    }
    await db.from('transgp_auditoria_sync_log').insert({ periodo_de: dataIso(de), periodo_ate: dataIso(ate), dists, ctes: linhas, ok: true });
    return res.status(200).json({ ok: true, de: dataIso(de), ate: dataIso(ate), dists, ctes: linhas });
  } catch (error) {
    await db.from('transgp_auditoria_sync_log').insert({ periodo_de: dataIso(de), periodo_ate: dataIso(ate), dists, ctes: linhas, ok: false, erro: String(error.message || error).slice(0, 500) });
    return res.status(502).json({ ok: false, erro: error.message, dists, ctes: linhas });
  }
}
