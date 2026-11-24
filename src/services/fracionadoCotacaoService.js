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
