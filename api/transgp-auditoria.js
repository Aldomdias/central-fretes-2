/**
 * Sincroniza a auditoria de fretes do painel da TransGP para a Central (tabela transgp_auditoria_ctes).
 *
 * GET /api/transgp-auditoria            — cron da Vercel (de hora em hora): ultimos 120 dias de coleta
 * GET /api/transgp-auditoria?dias=400   — janela maior (max. 400, limite da API deles)
 *
 * Tambem grava as cargas (uma por DIST) no fluxo de lotacao (lotacao_cargas), no lugar da planilha:
 * DIST que ja existe: so PREENCHE campo vazio no fluxo (nunca sobrescreve o que veio da planilha/Operacao);
 * os CT-es sao somados (uniao). DIST nova entra com origem_registro = 'api_transgp'. Nunca apaga.
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

// "ITAJAÍ/SC" -> { cidade: 'ITAJAÍ', uf: 'SC' }
function cidadeUf(texto) {
  const t = String(texto || '').trim();
  const m = t.match(/^(.*?)[\s]*[/\-][\s]*([A-Za-z]{2})$/);
  return m ? { cidade: m[1].trim(), uf: m[2].toUpperCase() } : { cidade: t, uf: '' };
}
const normDist = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

// Campos do fluxo que a API da TransGP traz (null = a API nao mandou; nao sobrescreve).
function cargaDaDist(item) {
  const origem = cidadeUf(item.origem);
  const destinos = (Array.isArray(item.destinos) ? item.destinos : [item.destinos]).filter(Boolean);
  const destino = cidadeUf(destinos[0]);
  const numeros = [...new Set((Array.isArray(item.ctes) ? item.ctes : []).map((c) => digitos(c.numero)).filter(Boolean).map((n) => String(Number(n))))];
  const ctes = numeros.length ? numeros : String(item.cte_numeros || '').split(/[^0-9]+/).filter(Boolean).map((n) => String(Number(n)));
  const status = String(item.status_carga || '').trim();
  return {
    dist: String(item.dist ?? '').trim().slice(0, 200),
    operacao: item.operacao ? String(item.operacao).slice(0, 100) : null,
    transportadora: item.transportadora ? String(item.transportadora).slice(0, 200) : null,
    origem: origem.cidade ? origem.cidade.slice(0, 200) : null,
    uf_origem: origem.uf || null,
    destino: destino.cidade ? destino.cidade.slice(0, 200) : null,
    uf_destino: destino.uf || null,
    status: status ? status.slice(0, 100) : null,
    coleta_planejada: item.coleta_planejada || null,
    frete_transp: num(item.frete?.contratado),
    pedagio: num(item.frete?.pedagio),
    cte: ctes.length ? ctes.join(';').slice(0, 500) : null,
    finalizado: /FINALIZ/i.test(status) ? true : null,
    placa_cavalo: item.placa ? String(item.placa).trim().toUpperCase().slice(0, 20) : null,
  };
}

const CAMPOS_FLUXO = ['dist', 'operacao', 'transportadora', 'origem', 'uf_origem', 'destino', 'uf_destino', 'status', 'coleta_planejada', 'frete_transp', 'pedagio', 'cte', 'finalizado', 'placa_cavalo'];

async function gravarCargasNoFluxo(db, itens) {
  const porDist = new Map();
  itens.forEach((item) => { const c = cargaDaDist(item); if (c.dist) porDist.set(normDist(c.dist), c); });
  const dists = [...new Set([...porDist.values()].map((c) => c.dist))];
  const existentes = new Map();
  for (let i = 0; i < dists.length; i += 200) {
    const { data, error } = await db.from('lotacao_cargas').select(`id,${CAMPOS_FLUXO.join(',')}`).in('dist', dists.slice(i, i + 200));
    if (error) throw new Error(`Fluxo (ler): ${error.message}`);
    (data || []).forEach((row) => { const k = normDist(row.dist); if (!existentes.has(k)) existentes.set(k, row); });
  }
  let atualizadas = 0; let inseridas = 0; const falhas = [];
  const novas = [];
  const atualizacoes = [];
  porDist.forEach((carga, k) => {
    const atual = existentes.get(k);
    const campos = Object.fromEntries(Object.entries(carga).filter(([, v]) => v !== null && v !== ''));
    if (!atual) { novas.push({ ...campos, arquivo_origem: 'API TransGP', origem_registro: 'api_transgp', importado_em: new Date().toISOString() }); return; }
    // So preenche o que esta vazio: planilha e alocacao da Operacao mandam no que ja tem valor.
    const vazio = (v) => v === null || v === undefined || String(v).trim() === '' || (typeof v === 'number' && v === 0);
    const update = {};
    Object.entries(campos).forEach(([campo, valor]) => {
      if (campo === 'dist' || campo === 'cte') return;
      if (campo === 'finalizado') { if (valor === true && atual.finalizado !== true) update.finalizado = true; return; }
      if (vazio(atual[campo]) && !vazio(valor) && String(atual[campo] ?? '') !== String(valor)) update[campo] = valor;
    });
    if (campos.cte) {
      const antes = String(atual.cte || '').split(/[^0-9]+/).filter(Boolean).map((n) => String(Number(n)));
      const uniao = [...new Set([...antes, ...campos.cte.split(';')])];
      if (uniao.length > antes.length) update.cte = uniao.join(';').slice(0, 500);
    }
    if (Object.keys(update).length) atualizacoes.push({ id: atual.id, campos: update });
  });
  for (let i = 0; i < atualizacoes.length; i += 20) {
    await Promise.all(atualizacoes.slice(i, i + 20).map(async ({ id, campos }) => {
      const { error } = await db.from('lotacao_cargas').update(campos).eq('id', id);
      if (error) falhas.push(error.message); else atualizadas += 1;
    }));
  }
  for (let i = 0; i < novas.length; i += 500) {
    let lote = novas.slice(i, i + 500);
    let { error } = await db.from('lotacao_cargas').insert(lote);
    if (error && /origem_registro/i.test(error.message)) {
      lote = lote.map(({ origem_registro, ...resto }) => resto); // migration da Fase 1 ainda nao aplicada
      ({ error } = await db.from('lotacao_cargas').insert(lote));
    }
    if (error) falhas.push(error.message); else inseridas += lote.length;
  }
  return { atualizadas, inseridas, falhas: falhas.slice(0, 5) };
}

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
  // ?manual=1 (botao "Sincronizar agora" da tela): sem o segredo do cron, janela padrao e no maximo 1 a cada 3 min.
  const manual = String(req.query?.manual || '') === '1';
  const segredo = process.env.CRON_SECRET;
  if (!manual && segredo && req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ ok: false, erro: 'Nao autorizado.' });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const chaveDb = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const chaveApi = process.env.TRANSGP_API_KEY;
  if (!url || !chaveDb) return res.status(500).json({ ok: false, erro: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas.' });
  if (!chaveApi) return res.status(500).json({ ok: false, erro: 'TRANSGP_API_KEY nao configurada no Vercel.' });
  const db = createClient(url, chaveDb, { auth: { persistSession: false } });

  if (manual) {
    const { data: ultima } = await db.from('transgp_auditoria_sync_log').select('iniciado_em').order('id', { ascending: false }).limit(1);
    const ha = ultima?.[0]?.iniciado_em ? Date.now() - new Date(ultima[0].iniciado_em).getTime() : Infinity;
    if (ha < 3 * 60 * 1000) return res.status(429).json({ ok: false, erro: 'Sincronizado ha menos de 3 minutos; aguarde um pouco.' });
  }
  const dias = manual ? 120 : Math.min(Math.max(Number(req.query?.dias) || 120, 1), 400);
  const ate = new Date();
  const de = new Date(ate.getTime() - (dias - 1) * 86400000);
  const base = process.env.TRANSGP_API_URL || API_PADRAO;
  const agora = new Date().toISOString();
  let dists = 0;
  let linhas = 0;
  const todasDists = [];
  try {
    for (let pagina = 1; pagina <= 200; pagina += 1) {
      const qs = new URLSearchParams({ de: dataIso(de), ate: dataIso(ate), pagina: String(pagina), por_pagina: '500' });
      const resp = await fetch(`${base}?${qs}`, { headers: { Authorization: `Bearer ${chaveApi}`, Accept: 'application/json' } });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok || corpo.ok === false) throw new Error(`API TransGP ${resp.status}: ${corpo.erro || corpo.error || corpo.message || 'resposta invalida'}`);
      const dados = Array.isArray(corpo.dados) ? corpo.dados : [];
      dists += dados.length;
      todasDists.push(...dados);
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
    const fluxo = await gravarCargasNoFluxo(db, todasDists);
    const avisoFluxo = fluxo.falhas.length ? `Fluxo: ${fluxo.falhas.length} falha(s): ${fluxo.falhas.join(' | ')}`.slice(0, 500) : null;
    await db.from('transgp_auditoria_sync_log').insert({ periodo_de: dataIso(de), periodo_ate: dataIso(ate), dists, ctes: linhas, ok: !avisoFluxo, erro: avisoFluxo });
    return res.status(200).json({ ok: true, de: dataIso(de), ate: dataIso(ate), dists, ctes: linhas, fluxo });
  } catch (error) {
    await db.from('transgp_auditoria_sync_log').insert({ periodo_de: dataIso(de), periodo_ate: dataIso(ate), dists, ctes: linhas, ok: false, erro: String(error.message || error).slice(0, 500) });
    return res.status(502).json({ ok: false, erro: error.message, dists, ctes: linhas });
  }
}
