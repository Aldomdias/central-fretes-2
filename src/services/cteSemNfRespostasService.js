import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

// Respostas da transportadora (portal da fatura) para os CT-es sem vinculo de NF apontados pelo Robo Auditor.
// Ver supabase/migrations/20261105_002_fatura_cte_sem_nf_respostas.sql.
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

export const ROTULO_RESPOSTA_SEM_NF = {
  RETIRAR: 'Autorizou retirar da fatura',
  COMPLEMENTAR: 'CT-e complementar',
  OUTRO: 'Outra justificativa',
};

export const ROTULO_STATUS_SEM_NF = {
  APLICADO: 'CT-e retirado (inativado)',
  ACEITO: 'Justificativa aceita',
  PENDENTE: 'Aguardando validacao',
  REJEITADO: 'Rejeitada',
};

export const ROTULO_FORMA_COBRANCA = {
  BOLETO: 'Novo boleto com o valor atualizado',
  PIX: 'Pix/deposito pelo valor atualizado',
};

export async function listarRespostasSemNf(faturaId) {
  if (!isSupabaseConfigured() || !faturaId) return [];
  try {
    const { data, error } = await getSupabaseClient().from('fatura_cte_sem_nf_respostas')
      .select('*').eq('fatura_id', String(faturaId)).order('respondido_em', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn('[CT-e sem NF] respostas indisponiveis.', error?.message || error);
    return [];
  }
}

// Aceita ou rejeita a justificativa. Aceita: o CT-e sai da lista "sem NF" do robo (laudo/desconto deixam de cobrar
// a retirada) e o robo nao volta a aponta-lo. Rejeitada: o portal pede nova resposta.
export async function validarRespostaSemNf(resposta, { aceitar, observacao = '', usuarioNome = '' }) {
  const db = getSupabaseClient();
  const agora = new Date().toISOString();
  const { error } = await db.from('fatura_cte_sem_nf_respostas').update({
    status_validacao: aceitar ? 'ACEITO' : 'REJEITADO',
    validado_por: usuarioNome || null,
    validado_em: agora,
    observacao_validacao: observacao || null,
  }).eq('id', resposta.id);
  if (error) throw new Error(`Erro ao validar a justificativa: ${error.message}`);
  if (aceitar) {
    const { data } = await db.from('auditor_robo_execucoes').select('ctes_sem_nf').eq('fatura_id', String(resposta.fatura_id)).maybeSingle();
    const lista = Array.isArray(data?.ctes_sem_nf) ? data.ctes_sem_nf : [];
    const resto = lista.filter((c) => soDigitos(c.chave_cte) !== soDigitos(resposta.chave_cte));
    if (resto.length !== lista.length) {
      await db.from('auditor_robo_execucoes').update({ ctes_sem_nf: resto }).eq('fatura_id', String(resposta.fatura_id));
    }
  }
  await db.from('auditoria_fatura_historico').insert({
    fatura_id: resposta.fatura_id,
    created_at: agora,
    acao: aceitar ? 'JUSTIFICATIVA_CTE_SEM_NF_ACEITA' : 'JUSTIFICATIVA_CTE_SEM_NF_REJEITADA',
    descricao: `Justificativa do CT-e ${resposta.numero_cte || resposta.chave_cte} (sem vinculo com a NF) ${aceitar ? 'ACEITA' : 'REJEITADA'} pelo auditor${observacao ? `: ${observacao}` : ''}.`,
    usuario_nome: usuarioNome || 'Auditor',
  });
}
