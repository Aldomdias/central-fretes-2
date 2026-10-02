import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'auditoria_demandas';
const CHAVE_LOCAL = 'central_fretes_demandas_auditor_v1';

function lerLocal() {
  try { return JSON.parse(localStorage.getItem(CHAVE_LOCAL) || '[]'); } catch { return []; }
}

function gravarLocal(lista) {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(lista)); } catch { /* sem armazenamento local */ }
}

// Sem a migration 20261002_001 aplicada a tabela nao existe: as demandas ficam so
// neste navegador (localStorage) ate a tabela existir, sem travar o painel.
const tabelaAusente = (error) => ['42P01', 'PGRST205'].includes(error?.code) || /does not exist|schema cache/i.test(error?.message || '');

export async function listarDemandas() {
  if (!isSupabaseConfigured()) return { lista: lerLocal(), local: true };
  const { data, error } = await getSupabaseClient().from(TABELA).select('*').order('created_at', { ascending: false }).limit(3000);
  if (error) {
    if (tabelaAusente(error)) return { lista: lerLocal(), local: true };
    throw new Error(`Erro ao carregar demandas: ${error.message}`);
  }
  return { lista: data || [], local: false };
}

export async function salvarDemanda(demanda) {
  const registro = { ...demanda, id: demanda.id || crypto.randomUUID(), created_at: demanda.created_at || new Date().toISOString() };
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseClient().from(TABELA).upsert(registro, { onConflict: 'id' });
    if (!error) return registro;
    if (!tabelaAusente(error)) throw new Error(`Erro ao salvar demanda: ${error.message}`);
  }
  const lista = lerLocal();
  const indice = lista.findIndex((item) => item.id === registro.id);
  if (indice >= 0) lista[indice] = registro; else lista.unshift(registro);
  gravarLocal(lista);
  return registro;
}

export async function excluirDemanda(id) {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseClient().from(TABELA).delete().eq('id', id);
    if (!error) return;
    if (!tabelaAusente(error)) throw new Error(`Erro ao excluir demanda: ${error.message}`);
  }
  gravarLocal(lerLocal().filter((item) => item.id !== id));
}

// Autorizacoes (Suprimentos / Transporte) ainda pendentes ligadas a faturas dadas, ou enviadas pelo auditor.
export async function carregarAutorizacoesPendentes() {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await getSupabaseClient()
      .from('transporte_autorizacoes')
      .select('id, canal, status, fatura_id, enviado_por, enviado_em')
      .eq('ativo', true)
      .eq('status', 'PENDENTE')
      .order('enviado_em', { ascending: false })
      .limit(3000);
    return error ? [] : (data || []);
  } catch {
    return [];
  }
}

// Data do ultimo evento que colocou cada fatura no status atual (pra "ha quantos dias esta parada").
export async function carregarDesdeStatusAtual(faturas) {
  const mapa = {};
  if (!isSupabaseConfigured() || !faturas.length) return mapa;
  const statusPorId = new Map(faturas.map((f) => [f.id, f.status]));
  const ids = faturas.map((f) => f.id);
  try {
    const client = getSupabaseClient();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await client.from('auditoria_fatura_historico')
        .select('fatura_id, status_novo, created_at')
        .in('fatura_id', ids.slice(i, i + 100))
        .order('created_at', { ascending: false })
        .limit(1000);
      (data || []).forEach((h) => {
        if (!mapa[h.fatura_id] && h.status_novo && h.status_novo === statusPorId.get(h.fatura_id)) mapa[h.fatura_id] = h.created_at;
      });
    }
  } catch { /* sem historico: usa updated_at */ }
  return mapa;
}
