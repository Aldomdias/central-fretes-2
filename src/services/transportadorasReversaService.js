import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  criarSetTransportadorasReversa,
  marcacaoReversaValida,
  normalizarMarcacaoReversa,
} from '../utils/transportadorasReversa';

// Quais transportadoras fazem logistica reversa. Mesmo padrao do
// origemEquivalenciaService: Supabase quando disponivel, localStorage como
// fallback pra tela nunca quebrar enquanto a migration nao foi aplicada.
const LOCAL_KEY = 'transportadoras-reversa';
const TABELA = 'transportadoras_reversa';
const COLUNAS = 'id, transportadora, transportadora_norm, created_at, updated_at';

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
    // modo privado pode bloquear; segue so online.
  }
}

function ordenar(lista = []) {
  return [...lista].sort((a, b) => (
    String(a.transportadora || '').localeCompare(String(b.transportadora || ''), 'pt-BR')
  ));
}

function normalizarLista(lista = []) {
  const porNorm = new Map();
  (lista || [])
    .map(normalizarMarcacaoReversa)
    .filter(marcacaoReversaValida)
    .forEach((item) => porNorm.set(item.transportadoraNorm, item));
  return ordenar([...porNorm.values()]);
}

// A tabela pode nao existir ainda (migration nao aplicada). A marcacao ja foi
// gravada no localStorage antes de tentar o Supabase, entao nao ha perda: aqui
// so devolvemos o motivo pra tela avisar que a marcacao ficou neste navegador.
function resultadoSemTabela(error, lista) {
  const detalhe = error?.message || String(error || '');
  const tabelaAusente = /does not exist|could not find the table|schema cache/i.test(detalhe)
    || error?.code === '42P01'
    || error?.code === 'PGRST205';
  return {
    ok: true,
    modo: 'local',
    transportadoras: lista,
    motivo: tabelaAusente
      ? 'A tabela transportadoras_reversa ainda nao existe no Supabase — rode a migration pra marcacao valer pra todo mundo.'
      : `Nao consegui gravar no Supabase: ${detalhe}`,
  };
}

export function carregarTransportadorasReversaLocal() {
  return normalizarLista(getLocal());
}

export async function carregarTransportadorasReversa() {
  const locais = carregarTransportadorasReversaLocal();
  if (!isSupabaseConfigured()) return locais;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABELA).select(COLUNAS);

  if (error) {
    // Enquanto a migration nao foi aplicada, nao quebra nada: usa o local.
    console.warn('Marcacao de reversa no Supabase indisponivel; usando localStorage.', error.message || error);
    return locais;
  }

  const online = normalizarLista(data || []);
  setLocal(online);
  return online;
}

// Salva a lista inteira de uma vez — a tela edita por checkbox, entao o estado
// final e a lista completa, e nao um item isolado.
export async function salvarTransportadorasReversa(lista = []) {
  const nova = normalizarLista(lista);
  setLocal(nova);

  if (!isSupabaseConfigured()) return { ok: true, modo: 'local', transportadoras: nova };

  const supabase = getSupabaseClient();
  const norms = nova.map((item) => item.transportadoraNorm);

  // Tira quem foi desmarcado.
  const remocao = norms.length
    ? await supabase.from(TABELA).delete().not('transportadora_norm', 'in', `(${norms.map((n) => `"${n}"`).join(',')})`)
    : await supabase.from(TABELA).delete().neq('transportadora_norm', '');
  if (remocao.error) {
    return resultadoSemTabela(remocao.error, nova);
  }

  if (nova.length) {
    const { error } = await supabase.from(TABELA).upsert(
      nova.map((item) => ({
        transportadora: item.transportadora,
        transportadora_norm: item.transportadoraNorm,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'transportadora_norm' },
    );
    if (error) return resultadoSemTabela(error, nova);
  }

  return { ok: true, modo: 'supabase', transportadoras: nova };
}

export async function carregarSetTransportadorasReversa() {
  return criarSetTransportadorasReversa(await carregarTransportadorasReversa());
}
