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

export async function criarCotacao({ nome, periodoLabel, prazoResposta, criadoPor, rotas, convites }) {
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
  const { data: criados, error: e3 } = await sb.from('lotacao_cotacao_convites').insert(
    convites.map((c) => ({
      cotacao_id: cot.id,
      transportadora: c.transportadora,
      cnpj_raizes: Array.from(new Set((c.cnpjs || []).map(soDigitos).filter((x) => x.length >= 8).map((x) => x.slice(0, 8)))),
      chaves: c.chaves || null,
    })),
  ).select();
  if (e3) throw e3;
  return { cotacao: cot, convites: criados };
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
