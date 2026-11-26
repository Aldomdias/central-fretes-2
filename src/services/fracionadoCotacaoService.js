import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { urlBaseApp } from '../utils/urlBaseApp';

export function linkConviteFracionado(token) {
  return `${urlBaseApp()}/api/fracionado-cotacao/${token}`;
}

function client() {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  return getSupabaseClient();
}

function erroMigration(error) {
  if (/does not exist|schema cache|relation/i.test(error?.message || '')) {
    return new Error('Aplique as migrations 20261123_001_fracionado_portal.sql, 20261123_002_fracionado_atendimento.sql e 20261123_004_fracionado_propria.sql no Supabase.');
  }
  return error;
}

export async function gerarConviteFracionado({ transportadora, campanha, origens = [], canal, modalidade, faixas, dias = 5, cnpjRaizes = [], criadoPor }) {
  const expira = new Date(Date.now() + Number(dias || 5) * 86400000).toISOString();
  const { data, error } = await client().from('fracionado_convites').insert({
    transportadora, campanha: campanha || null, origens: origens.length ? origens : null, origem: origens[0] || null, canal, modalidade,
    faixas: modalidade === 'FAIXA_PESO' ? faixas : null, cnpj_raizes: cnpjRaizes, expira_em: expira, criado_por: criadoPor || null,
  }).select().single();
  if (error) throw erroMigration(error);
  return data;
}

export async function listarConvitesFracionado() {
  const { data, error } = await client().from('fracionado_convites').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw erroMigration(error);
  return data || [];
}

export async function carregarRespostasFracionado(conviteId) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client().from('fracionado_respostas').select('*').eq('convite_id', conviteId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function carregarAtendimentoFracionado(conviteId) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client().from('fracionado_atendimento').select('*').eq('convite_id', conviteId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function listarEnviosFracionado(conviteId) {
  const { data, error } = await client().from('fracionado_envios').select('*').eq('convite_id', conviteId).order('enviado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function renovarConviteFracionado(id, dias = 5) {
  const { error } = await client().from('fracionado_convites')
    .update({ expira_em: new Date(Date.now() + Number(dias) * 86400000).toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function cancelarConviteFracionado(id) {
  const { error } = await client().from('fracionado_convites').update({ status: 'CANCELADO' }).eq('id', id);
  if (error) throw error;
}

export async function reabrirConviteFracionado(id, temEnvio) {
  const { error } = await client().from('fracionado_convites').update({ status: temEnvio ? 'ENVIADO' : 'EM_PREENCHIMENTO' }).eq('id', id);
  if (error) throw error;
}

export async function excluirConviteFracionado(id) {
  const { error } = await client().from('fracionado_convites').delete().eq('id', id);
  if (error) throw error;
}

export async function carregarAnexosFracionado(conviteId) {
  const { data, error } = await client().from('fracionado_anexos').select('id,canal,nome,tipo,tamanho,created_at').eq('convite_id', conviteId).order('created_at');
  if (error) return [];
  return data || [];
}

export async function baixarAnexoFracionado(id) {
  const { data, error } = await client().from('fracionado_anexos').select('nome,tipo,conteudo').eq('id', id).single();
  if (error) throw error;
  const bin = atob(data.conteudo);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: data.tipo || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = data.nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------- Volumetria pronta (gerada aqui, so baixada no portal) ----------------
const LINHAS_POR_PARTE_VOL = 5000;

function alvosVolumetria(convite, canaisFn, origensFn, faixasFn, periodoFn, baseFn) {
  return canaisFn(convite).flatMap((canal) => origensFn(convite).map((origem) => {
    const faixas = faixasFn(convite, canal);
    const periodo = periodoFn(canal);
    return { canal, origem, faixas, periodo, base: baseFn({ canal, origem, faixas }) };
  }));
}

async function utilsVol() {
  const vol = await import('../../api/_fracionadoVolumetria.mjs');
  const mod = await import('../utils/fracionadoModelo');
  return { vol, mod, base: vol.baseVolumetria };
}

// Status da volumetria pronta para cada canal x origem do convite (periodo atual).
export async function statusVolumetriaConvite(convite) {
  const { vol, mod, base } = await utilsVol();
  const alvos = alvosVolumetria(convite, mod.canaisDoConviteFracionado, mod.origensDoConviteFracionado, mod.faixasDoConviteFracionado, vol.periodoVolumetria, base);
  const out = [];
  for (const a of alvos) {
    const { data, error } = await client().from('fracionado_volumetria').select('periodo_inicio,periodo_fim,notas,gerado_em,total_partes')
      .eq('base', a.base).eq('parte', 0).order('periodo_fim', { ascending: false }).limit(1);
    if (error) throw erroMigrationVol(error);
    const r = data?.[0] || null;
    out.push({ ...a, pronta: r, atual: !!r && r.periodo_inicio === a.periodo.inicio && r.periodo_fim === a.periodo.fim });
  }
  return out;
}

function erroMigrationVol(error) {
  if (/does not exist|schema cache|relation/i.test(error?.message || '')) return new Error('Aplique a migration 20261126_003_fracionado_volumetria_pronta.sql no Supabase.');
  return error;
}

// Gera (ou regera) a volumetria de um canal x origem e grava em partes.
export async function gerarVolumetriaPronta({ canal, origem, faixas, periodo, base }, { onProgresso, geradoPor } = {}) {
  const { vol } = await utilsVol();
  const sb = client();
  const res = await vol.gerarVolumetria(sb, { canal, origem, faixas, periodo, onProgresso });
  const partes = [];
  for (let i = 0; i < Math.max(res.linhas.length, 1); i += LINHAS_POR_PARTE_VOL) partes.push(res.linhas.slice(i, i + LINHAS_POR_PARTE_VOL));
  const { error: eDel } = await sb.from('fracionado_volumetria').delete().eq('base', base).eq('periodo_inicio', periodo.inicio).eq('periodo_fim', periodo.fim);
  if (eDel) throw erroMigrationVol(eDel);
  for (let p = 0; p < partes.length; p += 1) {
    const { error } = await sb.from('fracionado_volumetria').insert({
      base, canal, origem: origem || null, periodo_inicio: periodo.inicio, periodo_fim: periodo.fim, parte: p, total_partes: partes.length,
      linhas: partes[p], notas: res.notas, ctes_lidos: res.lidas, gerado_por: geradoPor || null,
    });
    if (error) throw erroMigrationVol(error);
  }
  return { notas: res.notas, linhas: res.linhas.length, lidas: res.lidas };
}
