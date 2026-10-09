import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const LOTE = 500;

export function linkConviteCotacao(token) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/api/lotacao-cotacao/${token}`;
}

function client() {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  return getSupabaseClient();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

// CNPJs (raiz) conhecidos de uma transportadora pelo nome, via cadastro.
export async function buscarCnpjRaizesPorNome(nome) {
  try {
    const sb = client();
    const { data: transp } = await sb.from('transportadoras').select('id,nome,cnpj_raiz').ilike('nome', `%${String(nome).trim()}%`).limit(5);
    const raizes = new Set();
    const ids = [];
    (transp || []).forEach((t) => { if (t.cnpj_raiz) raizes.add(t.cnpj_raiz); ids.push(t.id); });
    if (ids.length) {
      const { data: extras } = await sb.from('transportadora_cnpjs').select('cnpj_raiz').in('transportadora_id', ids).eq('ativo', true);
      (extras || []).forEach((e) => raizes.add(e.cnpj_raiz));
    }
    return Array.from(raizes);
  } catch {
    return [];
  }
}

export async function criarCotacao({ nome, periodoLabel, prazoResposta, criadoPor, rotas }) {
  const sb = client();
  const { data: cot, error } = await sb.from('lotacao_cotacoes').insert({
    nome, periodo_label: periodoLabel || null, prazo_resposta: prazoResposta || null, criado_por: criadoPor || null,
  }).select().single();
  if (error) throw error;
  const linhasRotas = rotas.map((r) => ({ cotacao_id: cot.id, ...r }));
  for (let i = 0; i < linhasRotas.length; i += LOTE) {
    const { error: e2 } = await sb.from('lotacao_cotacao_rotas').insert(linhasRotas.slice(i, i + LOTE));
    if (e2) throw e2;
  }
  return cot;
}

// Cada chamada gera um token novo (link novo) com validade em dias.
export async function gerarConvite({ cotacaoId, transportadora, dias = 5, chaves = null }) {
  const expira = new Date(Date.now() + Number(dias || 5) * 86400000).toISOString();
  const { data, error } = await client().from('lotacao_cotacao_convites')
    .insert({ cotacao_id: cotacaoId, transportadora, chaves, expira_em: expira }).select().single();
  if (error) {
    if (/expira_em/i.test(error.message || '')) throw new Error('Aplique a migration 20261009_001_lotacao_cotacao_expiracao.sql no Supabase.');
    throw error;
  }
  return data;
}

export async function renovarConvite(id, dias = 5) {
  const { error } = await client().from('lotacao_cotacao_convites')
    .update({ expira_em: new Date(Date.now() + Number(dias) * 86400000).toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function excluirConvite(id) {
  const { error } = await client().from('lotacao_cotacao_convites').delete().eq('id', id);
  if (error) throw error;
}

export async function listarCotacoes() {
  const { data, error } = await client().from('lotacao_cotacoes').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

async function todas(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function carregarCotacao(id) {
  const sb = client();
  const [convites, rotas, propostas] = await Promise.all([
    todas(() => sb.from('lotacao_cotacao_convites').select('*').eq('cotacao_id', id).order('transportadora')),
    todas(() => sb.from('lotacao_cotacao_rotas').select('*').eq('cotacao_id', id).order('id')),
    todas(() => sb.from('lotacao_cotacao_propostas').select('*').eq('cotacao_id', id).order('id')),
  ]);
  return { convites, rotas, propostas };
}

export async function alterarStatusCotacao(id, status) {
  const { error } = await client().from('lotacao_cotacoes').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function excluirCotacao(id) {
  const { error } = await client().from('lotacao_cotacoes').delete().eq('id', id);
  if (error) throw error;
}
