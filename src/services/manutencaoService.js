import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const POLL_MS = 15000;

export function manutencaoDisponivel() {
  return isSupabaseConfigured();
}

export async function obterStatusManutencao() {
  if (!manutencaoDisponivel()) return { ativo: false };
  const supabase = getSupabaseClient();
  if (!supabase) return { ativo: false };

  const { data, error } = await supabase
    .from('sistema_manutencao')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.warn('Não foi possível verificar o modo manutenção:', error.message);
    return { ativo: false };
  }
  return data || { ativo: false };
}

export async function ativarManutencao(sessao, mensagem, perfisLiberados = null) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase não configurado.');

  const { error } = await supabase
    .from('sistema_manutencao')
    .update({
      ativo: true,
      mensagem: mensagem || 'Estamos em manutenção rápida. Volte em alguns minutos.',
      ativado_por: sessao?.nome || sessao?.email || 'Admin',
      ativado_em: new Date().toISOString(),
      perfis_liberados: perfisLiberados && perfisLiberados.length ? perfisLiberados : null,
    })
    .eq('id', 1);

  if (error) throw new Error(error.message);
}

export async function desativarManutencao() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase não configurado.');

  const { error } = await supabase
    .from('sistema_manutencao')
    .update({ ativo: false })
    .eq('id', 1);

  if (error) throw new Error(error.message);
}

export function assinarManutencao(callback) {
  if (!manutencaoDisponivel()) return () => {};

  let ativo = true;
  const checar = async () => {
    if (!ativo) return;
    const status = await obterStatusManutencao();
    if (ativo) callback(status);
  };

  checar();
  const intervalo = window.setInterval(checar, POLL_MS);

  return () => {
    ativo = false;
    window.clearInterval(intervalo);
  };
}
