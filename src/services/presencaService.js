import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const CANAL_PRESENCA = 'presenca-central-fretes';

let canal = null;
let presenceKeyAtual = null;
let estadoAtual = { id: null, nome: '', email: '', pagina: '', paginaLabel: '', entrouEm: null };
const ouvintes = new Set();
let ultimoRegistroHistorico = null;

function emitirParaOuvintes() {
  if (!canal) return;
  const state = canal.presenceState();
  const usuarios = Object.values(state)
    .map((entradas) => entradas[entradas.length - 1])
    .filter((usuario) => usuario?.id)
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
  ouvintes.forEach((callback) => callback(usuarios));
}

function montarEstado(sessao, pagina, paginaLabel) {
  return {
    id: sessao?.id || null,
    nome: sessao?.nome || sessao?.email || 'Usuário',
    email: sessao?.email || '',
    pagina: pagina || '',
    paginaLabel: paginaLabel || pagina || '',
    entrouEm: estadoAtual.entrouEm || new Date().toISOString(),
  };
}

export function presencaDisponivel() {
  return isSupabaseConfigured();
}

function registrarHistoricoAcesso(sessao, pagina, paginaLabel) {
  if (!sessao?.id) return;
  const chave = `${sessao.id}|${pagina}`;
  if (ultimoRegistroHistorico === chave) return;
  ultimoRegistroHistorico = chave;

  const supabase = getSupabaseClient();
  if (!supabase) return;

  supabase
    .from('historico_acessos')
    .insert({
      usuario_id: sessao.id,
      usuario_nome: sessao.nome || sessao.email || 'Usuário',
      usuario_email: sessao.email || '',
      pagina: pagina || '',
      pagina_label: paginaLabel || pagina || '',
    })
    .then(({ error }) => {
      if (error) console.warn('Não foi possível registrar histórico de acesso:', error.message);
    });
}

export function entrarPresenca(sessao, pagina, paginaLabel) {
  if (!presencaDisponivel() || !sessao?.id) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;

  registrarHistoricoAcesso(sessao, pagina, paginaLabel);

  if (canal && presenceKeyAtual === sessao.id) {
    atualizarPaginaPresenca(pagina, paginaLabel);
    return;
  }

  if (canal) {
    supabase.removeChannel(canal);
    canal = null;
  }

  presenceKeyAtual = sessao.id;
  estadoAtual = montarEstado(sessao, pagina, paginaLabel);

  canal = supabase.channel(CANAL_PRESENCA, {
    config: { presence: { key: sessao.id } },
  });

  canal
    .on('presence', { event: 'sync' }, emitirParaOuvintes)
    .on('presence', { event: 'join' }, emitirParaOuvintes)
    .on('presence', { event: 'leave' }, emitirParaOuvintes);

  canal.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await canal.track(estadoAtual);
    }
  });
}

export function atualizarPaginaPresenca(pagina, paginaLabel) {
  if (!canal) return;
  estadoAtual = { ...estadoAtual, pagina: pagina || '', paginaLabel: paginaLabel || pagina || '' };
  canal.track(estadoAtual);
}

export function sairPresenca() {
  if (!canal) return;
  const supabase = getSupabaseClient();
  canal.untrack();
  supabase?.removeChannel(canal);
  canal = null;
  presenceKeyAtual = null;
}

export function assinarUsuariosAtivos(callback) {
  if (!presencaDisponivel()) return () => {};

  ouvintes.add(callback);
  if (canal) {
    const state = canal.presenceState();
    const usuarios = Object.values(state)
      .map((entradas) => entradas[entradas.length - 1])
      .filter((usuario) => usuario?.id)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
    callback(usuarios);
  }

  return () => {
    ouvintes.delete(callback);
  };
}

export async function listarHistoricoAcessos({ limite = 200, usuarioId = null, desde = null } = {}) {
  if (!presencaDisponivel()) return [];
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  let query = supabase
    .from('historico_acessos')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(limite);

  if (usuarioId) query = query.eq('usuario_id', usuarioId);
  if (desde) query = query.gte('criado_em', desde);

  const { data, error } = await query;
  if (error) {
    console.warn('Não foi possível carregar histórico de acessos:', error.message);
    return [];
  }
  return data || [];
}
