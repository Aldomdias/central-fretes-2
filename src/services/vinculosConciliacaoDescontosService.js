import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient.js';
import {
  normalizarVinculo,
  criarMapaVinculosTransportadoras,
  aplicarVinculoTransportadora,
} from './vinculosTransportadorasPuro.js';

// Vínculo de nome exclusivo da conciliação "Enviado x Realizado" (Painel de
// Descontos Obtidos). Reaproveita só as funções puras de normalização do
// vínculo de Ferramentas > Transportadoras — não a tabela nem o cadastro em
// si, porque as duas bases usam universos de nomes diferentes (CT-e/tabela
// de negociação vs. financeiro/SAP) e um vínculo validado pra uma não ajuda
// na outra.
export { criarMapaVinculosTransportadoras as criarMapaVinculosConciliacaoDescontos, aplicarVinculoTransportadora as aplicarVinculoConciliacaoDescontos };

const LOCAL_KEY = 'vinculos-conciliacao-descontos-obtidos-v1';
const TABELA = 'descontos_obtidos_vinculos';

function getLocalVinculos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setLocalVinculos(lista = []) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(lista || []));
  } catch {
    // localStorage pode falhar em modo privado; mantém operação online.
  }
}

export function carregarVinculosConciliacaoDescontosLocal() {
  return getLocalVinculos().map(normalizarVinculo).filter((item) => item.nomeCte && item.nomeTabela);
}

export async function carregarVinculosConciliacaoDescontos() {
  const locais = carregarVinculosConciliacaoDescontosLocal();
  if (!isSupabaseConfigured()) return locais;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABELA)
    .select('id, nome_enviado, nome_realizado, origem, created_at, updated_at')
    .order('nome_enviado', { ascending: true });

  if (error) {
    console.warn('Vínculos de conciliação de descontos indisponíveis; usando localStorage.', error.message || error);
    return locais;
  }

  const online = (data || [])
    .map((item) => normalizarVinculo({
      id: item.id,
      nomeCte: item.nome_enviado,
      nomeTabela: item.nome_realizado,
      origem: item.origem,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }))
    .filter((item) => item.nomeCte && item.nomeTabela);

  if (online.length) setLocalVinculos(online);
  return online.length ? online : locais;
}

export async function salvarVinculosConciliacaoDescontos(lista = []) {
  const normalizados = (lista || []).map(normalizarVinculo).filter((item) => item.nomeCte && item.nomeTabela);

  const dedup = [];
  const chaves = new Set();
  normalizados.forEach((item) => {
    const chave = item.nomeCteNormalizado;
    if (!chave || chaves.has(chave)) return;
    chaves.add(chave);
    dedup.push(item);
  });

  setLocalVinculos(dedup);

  if (!isSupabaseConfigured()) {
    return { ok: true, modo: 'local', total: dedup.length, vinculos: dedup };
  }

  const supabase = getSupabaseClient();
  const payload = dedup.map((item) => ({
    nome_enviado: item.nomeCte,
    nome_realizado: item.nomeTabela,
    nome_enviado_normalizado: item.nomeCteNormalizado,
    nome_realizado_normalizado: item.nomeTabelaNormalizado,
    origem: item.origem || 'manual',
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from(TABELA)
    .upsert(payload, { onConflict: 'nome_enviado_normalizado' })
    .select('nome_enviado_normalizado');

  if (error) {
    throw new Error(`Não consegui salvar vínculos no Supabase. Rode a migration supabase/migrations/20260922_003_descontos_obtidos_vinculos.sql. Detalhe: ${error.message}`);
  }

  return { ok: true, modo: 'supabase', total: dedup.length, vinculos: dedup };
}
