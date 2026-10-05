import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { cnpjPreenchidoValido, formatarCnpj, normalizarCnpj, obterRaizCnpj } from '../utils/cnpj';

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
  const raiz = obterRaizCnpj(cnpj);
  const { data: existente, error: erroConsulta } = await client()
    .from('transportadora_cnpjs')
    .select('id,transportadora_id')
    .eq('cnpj', cnpj)
    .maybeSingle();
  if (erroConsulta) throw new Error(erroConsulta.message || 'Erro ao conferir o CNPJ.');
  if (existente && existente.transportadora_id !== transportadoraId) {
    throw new Error('Este CNPJ já pertence a outra transportadora.');
  }
  // Conflito pela RAIZ: a mesma raiz nao pode estar em duas transportadoras
  // (adicional, principal ou origem).
  const [adicionais, principais, origens] = await Promise.all([
    client().from('transportadora_cnpjs').select('transportadora_id,transportadoras(nome)').eq('cnpj_raiz', raiz).eq('ativo', true).neq('transportadora_id', transportadoraId),
    client().from('transportadoras').select('id,nome').eq('cnpj_raiz', raiz).neq('id', transportadoraId),
    client().from('origens').select('transportadora_id,transportadoras(nome)').eq('cnpj_raiz', raiz).neq('transportadora_id', transportadoraId),
  ]);
  const conflito = adicionais.data?.[0]?.transportadoras?.nome
    || principais.data?.[0]?.nome
    || origens.data?.[0]?.transportadoras?.nome;
  if (conflito) {
    throw new Error(`A raiz ${raiz} (${formatarCnpj(cnpj)}) já está cadastrada na transportadora ${conflito}. Não é possível duplicar.`);
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

// Raizes adicionais indexadas por id da transportadora (usado no vinculo de CT-es).
export async function carregarRaizesAdicionaisPorId() {
  const mapa = new Map();
  if (!isSupabaseConfigured()) return mapa;
  const { data, error } = await client()
    .from('transportadora_cnpjs')
    .select('transportadora_id,cnpj_raiz')
    .eq('ativo', true);
  if (error) throw new Error(error.message || 'Erro ao carregar CNPJs adicionais.');
  (data || []).forEach((item) => {
    if (!item.transportadora_id || !item.cnpj_raiz) return;
    mapa.set(item.transportadora_id, [...(mapa.get(item.transportadora_id) || []), item.cnpj_raiz]);
  });
  return mapa;
}

// Quantos CT-es e pagamentos estao vinculados a cada raiz adicional.
export async function contarVinculosPorRaiz(raizes = []) {
  const resultado = {};
  if (!isSupabaseConfigured()) return resultado;
  for (const raiz of Array.from(new Set(raizes))) {
    const [ctes, faturas] = await Promise.all([
      client().from('auditoria_cte_resultados').select('id', { count: 'exact', head: true }).like('cnpj_transportadora', `${raiz}%`),
      client().from('faturas').select('id').like('cnpj_transportadora', `${raiz}%`).limit(5000),
    ]);
    // Pagamentos ficam ligados a fatura (financeiro_pagamentos.fatura_id).
    const ids = (faturas.data || []).map((item) => item.id);
    let pagamentos = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { count } = await client().from('financeiro_pagamentos').select('id', { count: 'exact', head: true }).in('fatura_id', ids.slice(i, i + 200));
      pagamentos += count || 0;
    }
    resultado[raiz] = { ctes: ctes.count ?? 0, pagamentos };
  }
  return resultado;
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
