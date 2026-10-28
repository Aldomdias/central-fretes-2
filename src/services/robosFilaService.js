import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { registrarRegistros } from './robosLancamentosService';

// Fila dos robos de lancamento (tabela robos_fila): o que foi mandado para o robo e o que saiu no SAP.
// Sem a tabela (migration pendente), guarda neste navegador.
const TABELA = 'robos_fila';
const CHAVE_LOCAL = 'central_fretes_robo_fila_local_v1';
const LOTE = 200;

function tabelaAusente(mensagem = '') {
  return /relation .* does not exist|could not find the table|schema cache|42P01|PGRST205/i.test(String(mensagem));
}

function lerLocal() {
  try { return JSON.parse(window.localStorage.getItem(CHAVE_LOCAL) || '[]'); } catch { return []; }
}

function gravarLocal(lista) {
  try { window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(lista.slice(-5000))); } catch { /* sem localStorage */ }
}

// Junta o que ja esta na fila com o novo: numero que ja saiu no SAP nao e apagado por um lote sem ele.
function mesclar(antigo, novo, por, agora) {
  const miro = novo.miro || antigo?.miro || '';
  return {
    tipo: novo.tipo,
    chave: novo.chave,
    documento: novo.documento,
    transportadora: novo.transportadora || antigo?.transportadora || null,
    cnpj_transp: novo.cnpj_transp || antigo?.cnpj_transp || null,
    valor: Number(novo.valor ?? antigo?.valor) || 0,
    entrada: novo.entrada || antigo?.entrada || {},
    pedido: novo.pedido || antigo?.pedido || null,
    miro: miro || null,
    motivo: miro ? null : (novo.motivo ?? antigo?.motivo ?? null),
    descartado: novo.descartado ?? (miro ? false : antigo?.descartado ?? false),
    atualizado_em: agora,
    atualizado_por: por || antigo?.atualizado_por || null,
  };
}

// itens: [{ tipo, chave, documento, transportadora, cnpj_transp, valor, entrada, pedido, miro, motivo }]
export async function salvarNaFila(itens = [], por = '') {
  const validos = itens.filter((i) => i && i.tipo && i.chave && i.documento);
  if (!validos.length) return { ok: true, salvos: 0, onde: 'nenhum' };
  const agora = new Date().toISOString();
  const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
  if (supabase) {
    try {
      for (let i = 0; i < validos.length; i += LOTE) {
        const parte = validos.slice(i, i + LOTE);
        const tipo = parte[0].tipo;
        const mesmos = parte.every((p) => p.tipo === tipo);
        let q = supabase.from(TABELA).select('*').in('chave', parte.map((p) => p.chave));
        if (mesmos) q = q.eq('tipo', tipo);
        const { data: existentes, error: e1 } = await q;
        if (e1) throw e1;
        const porChave = new Map((existentes || []).map((r) => [`${r.tipo}|${r.chave}`, r]));
        const linhas = parte.map((p) => mesclar(porChave.get(`${p.tipo}|${p.chave}`), p, por, agora));
        const { error: e2 } = await supabase.from(TABELA).upsert(linhas, { onConflict: 'tipo,chave' });
        if (e2) throw e2;
      }
      return { ok: true, salvos: validos.length, onde: 'banco' };
    } catch (e) {
      if (!tabelaAusente(e?.message)) { console.warn('Fila do robo:', e?.message); return { ok: false, salvos: 0, onde: 'erro', erro: e?.message }; }
    }
  }
  const local = lerLocal();
  const porChave = new Map(local.map((r) => [`${r.tipo}|${r.chave}`, r]));
  validos.forEach((p) => {
    const k = `${p.tipo}|${p.chave}`;
    porChave.set(k, { ...mesclar(porChave.get(k), p, por, agora), criado_em: porChave.get(k)?.criado_em || agora });
  });
  gravarLocal([...porChave.values()]);
  return { ok: true, salvos: validos.length, onde: 'navegador' };
}

// Itens sem MIRO e nao descartados (o que falta lancar), mais recentes primeiro.
export async function listarPendentesFila() {
  const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
  if (supabase) {
    try {
      const { data, error } = await supabase.from(TABELA).select('*')
        .eq('descartado', false).is('miro', null)
        .order('atualizado_em', { ascending: false }).limit(5000);
      if (error) throw error;
      return { ok: true, itens: data || [], onde: 'banco' };
    } catch (e) {
      if (!tabelaAusente(e?.message)) { console.warn('Fila do robo:', e?.message); return { ok: false, itens: [], onde: 'erro', erro: e?.message }; }
    }
  }
  const itens = lerLocal().filter((r) => !r.miro && !r.descartado).sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)));
  return { ok: true, itens, onde: 'navegador' };
}

// Tira da lista de pendentes (ex.: nota que nao vai ser lancada).
export async function descartarDaFila(itens = [], por = '') {
  return salvarNaFila(itens.map((i) => ({ ...i, descartado: true })), por);
}

// Itens da fila destas chaves (para trazer para a tela o que a planilha do robo mandou direto).
export async function buscarNaFila(tipo, chaves = []) {
  const mapa = new Map();
  const unicas = [...new Set(chaves.filter(Boolean))];
  if (!unicas.length) return mapa;
  const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
  if (supabase) {
    try {
      for (let i = 0; i < unicas.length; i += LOTE) {
        const { data, error } = await supabase.from(TABELA).select('chave,pedido,miro,motivo').eq('tipo', tipo).in('chave', unicas.slice(i, i + LOTE));
        if (error) throw error;
        (data || []).forEach((r) => mapa.set(r.chave, r));
      }
      return mapa;
    } catch (e) {
      if (!tabelaAusente(e?.message)) console.warn('Fila do robo:', e?.message);
      return mapa;
    }
  }
  lerLocal().filter((r) => r.tipo === tipo && unicas.includes(r.chave)).forEach((r) => mapa.set(r.chave, r));
  return mapa;
}

// MIRO que chegou na fila pela planilha do robo (sem ninguem importar o resultado) entra no historico.
// Olha os ultimos 90 dias; o historico nao duplica (tipo + MIRO + documento).
export async function sincronizarHistoricoDaFila() {
  const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
  if (!supabase) return { novos: 0 };
  try {
    const desde = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data, error } = await supabase.from(TABELA)
      .select('tipo,documento,transportadora,cnpj_transp,valor,pedido,miro,atualizado_por,registro:entrada->registro')
      .not('miro', 'is', null).gte('atualizado_em', desde).limit(5000);
    if (error) throw error;
    const registros = (data || []).map((r) => ({
      documento: r.documento,
      transportadora: r.transportadora || null,
      cnpj_transp: r.cnpj_transp || null,
      valor: Number(r.valor) || 0,
      ...(r.registro || {}),
      tipo: r.tipo,
      pedido: r.pedido || null,
      miro: String(r.miro),
      lancado_por: r.atualizado_por || null,
    }));
    const res = await registrarRegistros(registros);
    return { novos: res.novos || 0 };
  } catch (e) {
    if (!tabelaAusente(e?.message)) console.warn('Fila do robo (historico):', e?.message);
    return { novos: 0 };
  }
}
