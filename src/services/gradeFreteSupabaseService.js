import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  carregarGradeFrete,
  salvarGradeFrete,
  restaurarGradeFretePadrao,
  normalizarGradeFrete,
  GRADE_FRETE_PADRAO,
} from '../utils/gradeFreteConfig';

const TABELA_CONFIG = 'simulador_configuracoes';
const CHAVE_GRADE = 'grade_frete_simulador';

function erroTabelaInexistente(error) {
  const msg = String(error?.message || error?.details || '').toLowerCase();
  const code = String(error?.code || '');
  return code === '42P01' || msg.includes('does not exist') || msg.includes('schema cache');
}

export async function carregarGradeFreteCentralizada() {
  const gradeLocal = carregarGradeFrete();

  if (!isSupabaseConfigured()) {
    return { grade: gradeLocal, fonte: 'local', mensagem: 'Supabase não configurado; usando grade local deste navegador.' };
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(TABELA_CONFIG)
      .select('valor, updated_at')
      .eq('chave', CHAVE_GRADE)
      .maybeSingle();

    if (error) throw error;

    if (data?.valor) {
      const grade = salvarGradeFrete(normalizarGradeFrete(data.valor));
      return { grade, fonte: 'supabase', mensagem: `Grade carregada do Supabase${data.updated_at ? ` em ${new Date(data.updated_at).toLocaleString('pt-BR')}` : ''}.` };
    }

    return { grade: gradeLocal, fonte: 'local', mensagem: 'Nenhuma grade central no Supabase; usando grade local. Clique em Salvar grade atual para publicar.' };
  } catch (error) {
    return {
      grade: gradeLocal,
      fonte: 'local',
      mensagem: erroTabelaInexistente(error)
        ? 'Tabela simulador_configuracoes ainda não existe; rode o SQL e salve a grade atual.'
        : `Erro ao carregar grade do Supabase; usando local. ${error.message || ''}`,
    };
  }
}

export async function salvarGradeFreteCentralizada(grade) {
  const normalizada = salvarGradeFrete(normalizarGradeFrete(grade));

  if (!isSupabaseConfigured()) {
    return { grade: normalizada, fonte: 'local', mensagem: 'Grade salva apenas neste navegador. Supabase não configurado.' };
  }

  const supabase = getSupabaseClient();
  const payload = {
    chave: CHAVE_GRADE,
    valor: normalizada,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from(TABELA_CONFIG)
    .upsert(payload, { onConflict: 'chave' });

  if (error) {
    if (erroTabelaInexistente(error)) {
      return { grade: normalizada, fonte: 'local', mensagem: 'Grade salva localmente, mas falta rodar o SQL simulador_configuracoes no Supabase.' };
    }
    throw error;
  }

  return { grade: normalizada, fonte: 'supabase', mensagem: 'Grade salva no Supabase e sincronizada para todos os ambientes.' };
}

export async function restaurarGradeFreteCentralizadaPadrao() {
  const grade = restaurarGradeFretePadrao();
  return salvarGradeFreteCentralizada(grade || GRADE_FRETE_PADRAO);
}
