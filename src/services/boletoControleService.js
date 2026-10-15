import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'fatura_boleto_controle';
const CHAVE_LOCAL = 'central_fretes_boleto_controle_v1';

export const STATUS_BOLETO = { NA_PASTA: 'NA_PASTA', DISPENSADO: 'DISPENSADO' };

function lerLocal() {
  try { return JSON.parse(localStorage.getItem(CHAVE_LOCAL) || '[]'); } catch { return []; }
}

function gravarLocal(lista) {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(lista)); } catch { /* sem armazenamento local */ }
}

// Sem a migration 20261014_001 aplicada a tabela nao existe: a confirmacao fica so
// neste navegador ate a tabela existir, sem travar o painel.
const tabelaAusente = (error) => ['42P01', 'PGRST205'].includes(error?.code) || /does not exist|schema cache/i.test(error?.message || '');

export async function listarControleBoletos() {
  if (!isSupabaseConfigured()) return { lista: lerLocal(), local: true };
  const { data, error } = await getSupabaseClient().from(TABELA).select('*').order('confirmado_em', { ascending: false }).limit(10000);
  if (error) {
    if (tabelaAusente(error)) return { lista: lerLocal(), local: true };
    throw new Error(`Erro ao carregar controle de boletos: ${error.message}`);
  }
  return { lista: data || [], local: false };
}

// faturas: [{ id, numero_fatura, transportadora }]. status: NA_PASTA | DISPENSADO.
export async function confirmarBoletos(faturas, { status = STATUS_BOLETO.NA_PASTA, metodo = 'MANUAL', observacao = '', usuario = {} } = {}) {
  const agora = new Date().toISOString();
  const registros = faturas.map((f) => ({
    fatura_id: String(f.id),
    numero_fatura: f.numero_fatura || null,
    transportadora: f.transportadora || null,
    status,
    metodo,
    observacao: observacao || null,
    confirmado_por: usuario.nome || usuario.email || '',
    confirmado_email: usuario.email || '',
    confirmado_em: agora,
  }));
  if (!registros.length) return { registros, local: false };
  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    let tabelaFaltando = false;
    for (let i = 0; i < registros.length; i += 200) {
      const { error } = await client.from(TABELA).upsert(registros.slice(i, i + 200), { onConflict: 'fatura_id' });
      if (error) {
        if (tabelaAusente(error)) { tabelaFaltando = true; break; }
        throw new Error(`Erro ao salvar confirmacao de boleto: ${error.message}`);
      }
    }
    if (!tabelaFaltando) return { registros, local: false };
  }
  const lista = lerLocal();
  registros.forEach((r) => {
    const i = lista.findIndex((x) => x.fatura_id === r.fatura_id);
    if (i >= 0) lista[i] = r; else lista.unshift(r);
  });
  gravarLocal(lista);
  return { registros, local: true };
}

export async function desfazerConfirmacaoBoleto(faturaId) {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseClient().from(TABELA).delete().eq('fatura_id', String(faturaId));
    if (!error) return;
    if (!tabelaAusente(error)) throw new Error(`Erro ao desfazer confirmacao: ${error.message}`);
  }
  gravarLocal(lerLocal().filter((r) => r.fatura_id !== String(faturaId)));
}
