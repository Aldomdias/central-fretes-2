import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABLE_NAME = 'usuarios_central';
const SELECT_USUARIOS = 'id,nome,email,senha,perfil,permissoes_paginas,ativo,criado_em,atualizado_em,ultimo_login_em';

function toIso(valor) {
  if (!valor) return null;
  try {
    return new Date(valor).toISOString();
  } catch {
    return null;
  }
}

function normalizarEmail(email = '') {
  return String(email ?? '').trim().toLowerCase();
}

function normalizarPermissoes(valor) {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];

  try {
    const parsed = typeof valor === 'string' ? JSON.parse(valor) : valor;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function usuarioSupabaseDisponivel() {
  return isSupabaseConfigured() && Boolean(getSupabaseClient());
}

export function usuarioFromDb(row = {}) {
  return {
    id: row.id,
    nome: row.nome || '',
    email: normalizarEmail(row.email),
    senha: row.senha || '',
    perfil: row.perfil || 'CONSULTA',
    permissoesPaginas: normalizarPermissoes(row.permissoes_paginas || row.permissoesPaginas),
    ativo: row.ativo !== false,
    criadoEm: row.criado_em || row.criadoEm || null,
    atualizadoEm: row.atualizado_em || row.atualizadoEm || null,
    ultimoLoginEm: row.ultimo_login_em || row.ultimoLoginEm || null,
  };
}

export function usuarioToDb(usuario = {}) {
  return {
    id: usuario.id,
    nome: String(usuario.nome ?? '').trim(),
    email: normalizarEmail(usuario.email),
    senha: String(usuario.senha ?? '').trim(),
    perfil: usuario.perfil || 'CONSULTA',
    permissoes_paginas: normalizarPermissoes(usuario.permissoesPaginas || usuario.permissoes_paginas),
    ativo: usuario.ativo !== false,
    criado_em: toIso(usuario.criadoEm) || new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    ultimo_login_em: toIso(usuario.ultimoLoginEm),
  };
}

function obterClienteObrigatorio() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase não configurado. Confira VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

export async function listarUsuariosSupabase() {
  const supabase = obterClienteObrigatorio();
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select(SELECT_USUARIOS)
    .order('nome', { ascending: true });

  if (error) {
    throw new Error(`Erro ao carregar usuários do Supabase: ${error.message}`);
  }

  return (data || []).map(usuarioFromDb);
}

export async function salvarUsuariosSupabase(usuarios = []) {
  const supabase = obterClienteObrigatorio();
  const rows = usuarios
    .filter((usuario) => usuario?.id && usuario?.email)
    .map(usuarioToDb);

  if (!rows.length) return [];

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(rows, { onConflict: 'id' })
    .select(SELECT_USUARIOS);

  if (error) {
    throw new Error(`Erro ao salvar usuários no Supabase: ${error.message}`);
  }

  return (data || []).map(usuarioFromDb);
}

export async function salvarUsuarioSupabase(usuario) {
  const [salvo] = await salvarUsuariosSupabase([usuario]);
  return salvo || null;
}

export async function registrarUltimoLoginSupabase(usuarioId) {
  if (!usuarioId) return null;
  const supabase = obterClienteObrigatorio();
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update({ ultimo_login_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
    .eq('id', usuarioId)
    .select(SELECT_USUARIOS)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao registrar login do usuário: ${error.message}`);
  }

  return data ? usuarioFromDb(data) : null;
}
