import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { cnpjPreenchidoValido, normalizarCnpj, obterRaizCnpj } from '../utils/cnpj';

function client() {
  const supabase = getSupabaseClient();
  if (!supabase || !isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  return supabase;
}

export async function listarCnpjsAdicionaisTransportadora(transportadoraId) {
  if (!transportadoraId || !isSupabaseConfigured()) return [];
  const { data, error } = await client()
    .from('transportadora_cnpjs')
    .select('id,transportadora_id,cnpj,cnpj_raiz,descricao,ativo,created_at,updated_at')
    .eq('transportadora_id', transportadoraId)
    .eq('ativo', true)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message || 'Erro ao carregar CNPJs adicionais.');
  return data || [];
}

export async function adicionarCnpjTransportadora(transportadoraId, valor, descricao = '') {
  const cnpj = normalizarCnpj(valor);
  if (!transportadoraId) throw new Error('Transportadora não informada.');
  if (!cnpjPreenchidoValido(cnpj)) throw new Error('Informe um CNPJ válido com 14 dígitos.');
  const { data: existente, error: erroConsulta } = await client()
    .from('transportadora_cnpjs')
    .select('id,transportadora_id')
    .eq('cnpj', cnpj)
    .maybeSingle();
  if (erroConsulta) throw new Error(erroConsulta.message || 'Erro ao conferir o CNPJ.');
  if (existente && existente.transportadora_id !== transportadoraId) {
    throw new Error('Este CNPJ já pertence a outra transportadora.');
  }
  const payload = {
    ...(existente?.id ? { id: existente.id } : {}),
    transportadora_id: transportadoraId,
    cnpj,
    cnpj_raiz: obterRaizCnpj(cnpj),
    descricao: String(descricao || '').trim() || null,
    ativo: true,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client()
    .from('transportadora_cnpjs')
    .upsert(payload, { onConflict: 'cnpj' })
    .select('*')
    .single();
  if (error) throw new Error(error.message || 'Erro ao adicionar CNPJ.');
  return data;
}

export async function removerCnpjTransportadora(id) {
  const { error } = await client().from('transportadora_cnpjs').delete().eq('id', id);
  if (error) throw new Error(error.message || 'Erro ao remover CNPJ adicional.');
  return true;
}

export async function carregarRaizesAdicionaisPorTransportadora() {
  if (!isSupabaseConfigured()) return new Map();
  const { data, error } = await client()
    .from('transportadora_cnpjs')
    .select('cnpj_raiz,transportadoras!inner(nome)')
    .eq('ativo', true);
  if (error) throw new Error(error.message || 'Erro ao carregar CNPJs adicionais.');
  const mapa = new Map();
  (data || []).forEach((item) => {
    const nome = String(item.transportadoras?.nome || '').trim().toUpperCase();
    if (!nome || !item.cnpj_raiz) return;
    const atuais = mapa.get(nome) || [];
    atuais.push(item.cnpj_raiz);
    mapa.set(nome, atuais);
  });
  return mapa;
}
