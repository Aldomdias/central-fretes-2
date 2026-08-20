import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  criarMapaEquivalenciasOrigem,
  equivalenciaOrigemValida,
  normalizarEquivalenciaOrigem,
} from '../utils/origemEquivalencia';

// Exceções de origem por transportadora (ex.: TAM, origem Serra, considera
// Vitória). Mesmo padrão de cidadeIbgeAliasService: Supabase quando disponível,
// localStorage como fallback pra nunca quebrar a tela nem o cálculo.
const LOCAL_KEY = 'origem-equivalencias';
const TABELA = 'origem_equivalencias';
const COLUNAS = 'id, transportadora, transportadora_norm, origem_tabela, origem_tabela_norm, origem_cte, origem_cte_norm, uf, ibge_cte, ibge_tabela, created_at, updated_at';

function getLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setLocal(lista = []) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(lista || []));
  } catch {
    // modo privado pode bloquear; segue só online.
  }
}

function ordenar(lista = []) {
  return [...lista].sort((a, b) => (
    String(a.transportadora || '').localeCompare(String(b.transportadora || ''), 'pt-BR')
    || String(a.origemTabela || '').localeCompare(String(b.origemTabela || ''), 'pt-BR')
    || String(a.origemCte || '').localeCompare(String(b.origemCte || ''), 'pt-BR')
  ));
}

export function carregarEquivalenciasOrigemLocal() {
  return ordenar(getLocal().map(normalizarEquivalenciaOrigem).filter(equivalenciaOrigemValida));
}

export async function carregarEquivalenciasOrigem() {
  const locais = carregarEquivalenciasOrigemLocal();
  if (!isSupabaseConfigured()) return locais;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABELA).select(COLUNAS);

  if (error) {
    // Enquanto a migration não foi aplicada, não quebra nada: usa o local.
    console.warn('Exceções de origem no Supabase indisponíveis; usando localStorage.', error.message || error);
    return locais;
  }

  const online = ordenar((data || []).map(normalizarEquivalenciaOrigem).filter(equivalenciaOrigemValida));
  setLocal(online);
  return online;
}

export async function salvarEquivalenciaOrigem(item, listaAtual = []) {
  const equiv = normalizarEquivalenciaOrigem(item);
  if (!equivalenciaOrigemValida(equiv)) {
    throw new Error('Informe a transportadora, a origem da tabela e a origem que aparece no CT-e.');
  }
  if (equiv.origemTabelaNorm === equiv.origemCteNorm) {
    throw new Error('As duas origens são iguais — a exceção não faria diferença.');
  }

  const semDuplicata = (listaAtual || [])
    .map(normalizarEquivalenciaOrigem)
    .filter((e) => e.id !== equiv.id);
  const novaLista = ordenar([...semDuplicata, equiv]);
  setLocal(novaLista);

  if (!isSupabaseConfigured()) return { ok: true, modo: 'local', equivalencias: novaLista };

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(TABELA)
    .upsert({
      transportadora: equiv.transportadora,
      transportadora_norm: equiv.transportadoraNorm,
      origem_tabela: equiv.origemTabela,
      origem_tabela_norm: equiv.origemTabelaNorm,
      origem_cte: equiv.origemCte,
      origem_cte_norm: equiv.origemCteNorm,
      uf: equiv.uf,
      ibge_cte: equiv.ibgeCte,
      ibge_tabela: equiv.ibgeTabela,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'transportadora_norm,origem_tabela_norm,origem_cte_norm' });

  if (error) {
    throw new Error(`Não consegui salvar no Supabase. Rode a migration origem_equivalencias. Detalhe: ${error.message}`);
  }

  return { ok: true, modo: 'supabase', equivalencias: novaLista };
}

export async function removerEquivalenciaOrigem(id, listaAtual = []) {
  const alvo = String(id || '').trim();
  const item = (listaAtual || []).map(normalizarEquivalenciaOrigem).find((e) => e.id === alvo);
  const novaLista = (listaAtual || []).map(normalizarEquivalenciaOrigem).filter((e) => e.id !== alvo);
  setLocal(novaLista);

  if (isSupabaseConfigured() && item) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from(TABELA)
      .delete()
      .eq('transportadora_norm', item.transportadoraNorm)
      .eq('origem_tabela_norm', item.origemTabelaNorm)
      .eq('origem_cte_norm', item.origemCteNorm);
    if (error) throw new Error(`Não consegui remover no Supabase. Detalhe: ${error.message}`);
  }

  return novaLista;
}

export async function carregarMapaEquivalenciasOrigem() {
  return criarMapaEquivalenciasOrigem(await carregarEquivalenciasOrigem());
}

// Origens cadastradas de uma transportadora, buscadas direto no banco.
// O resumo carregado no login traz as origens do sistema inteiro numa consulta
// só, e o Supabase corta em 1000 linhas — cidades no fim do alfabeto (Serra,
// Vitória) somem da lista. Aqui filtramos por transportadora, então cabe.
export async function buscarOrigensDaTransportadora(transportadoraId) {
  const id = String(transportadoraId || '').trim();
  if (!id || !isSupabaseConfigured()) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('origens')
    .select('cidade')
    .eq('transportadora_id', id)
    .order('cidade', { ascending: true });

  if (error) {
    console.warn('Não consegui buscar as origens da transportadora.', error.message || error);
    return null;
  }

  return Array.from(new Set((data || []).map((o) => String(o.cidade || '').trim()).filter(Boolean)));
}
