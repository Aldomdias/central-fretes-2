import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABLE_NAME = 'usuarios_central';

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
    .select('id,nome,email,senha,perfil,ativo,criado_em,atualizado_em,ultimo_login_em')
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
    .select('id,nome,email,senha,perfil,ativo,criado_em,atualizado_em,ultimo_login_em');

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
    .select('id,nome,email,senha,perfil,ativo,criado_em,atualizado_em,ultimo_login_em')
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao registrar login do usuário: ${error.message}`);
  }

  return data ? usuarioFromDb(data) : null;
}
