import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { chaveEntregaPortal } from './entregaPortalService';

// Portal "Confirmar fatura": o laudo grava aqui os CT-es com cobranca acima (os
// mesmos que compoem o card "Cobranca acima"); a transportadora responde CT-e a
// CT-e (concordo + desconto / nao concordo + motivo). Falha aqui nunca trava o laudo.

const num = (v) => Number(v || 0);

// Mesmo criterio de resumirDetalhesAuditoria -> cobrancaAcima.
export function ctesCobrancaAcima(lista = [], dentroDaTolerancia = () => false) {
  return lista.filter((item) => {
    const dif = num(item.diferenca);
    if (dif <= 0) return false;
    if (item.desconto_sem_tabela) return true;
    return num(item.calculado_frete) > 0 && !dentroDaTolerancia(dif);
  });
}

export async function salvarDivergenciasFatura(fatura, itens = []) {
  if (!isSupabaseConfigured() || !fatura?.id || !itens.length) return false;
  try {
    const client = getSupabaseClient();
    const linhas = itens
      .map((item) => ({
        fatura_id: fatura.id,
        numero_fatura: fatura.numero_fatura || null,
        transportadora: fatura.transportadora || null,
        chave: chaveEntregaPortal(item),
        numero_cte: item.numero_cte || null,
        valor_cobrado: num(item.valor_frete),
        valor_calculado: num(item.calculado_frete),
        diferenca: num(item.diferenca),
        atualizado_em: new Date().toISOString(),
      }))
      .filter((linha) => linha.chave);
    // Nao mexe nas colunas de resposta: reenviar o laudo preserva o que ja foi respondido.
    const { error } = await client.from('fatura_cte_divergencias').upsert(linhas, { onConflict: 'fatura_id,chave' });
    if (error) throw error;
    // Sai da lista o CT-e que deixou de divergir (so se ainda nao respondido).
    const chaves = linhas.map((l) => l.chave).join(',');
    await client.from('fatura_cte_divergencias').delete().eq('fatura_id', fatura.id).is('resposta', null).not('chave', 'in', '(' + chaves + ')');
    return true;
  } catch (error) {
    console.warn('[Divergencias portal] nao gravadas (migration aplicada?).', error?.message || error);
    return false;
  }
}

export async function carregarDivergenciasFatura(faturaId) {
  if (!isSupabaseConfigured() || !faturaId) return [];
  try {
    const { data, error } = await getSupabaseClient().from('fatura_cte_divergencias').select('*').eq('fatura_id', faturaId).order('numero_cte');
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn('[Divergencias portal] indisponiveis.', error?.message || error);
    return [];
  }
}

// Auditor aceita ou rejeita a resposta de um CT-e. Rejeitar reabre a fatura pra
// transportadora (status CONTESTADO => o portal mostra o formulario de novo).
export async function validarRespostaDivergencia({ linha, aprovar, observacao = '', usuarioNome = '' }) {
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const { error } = await client.from('fatura_cte_divergencias').update({
    status_validacao: aprovar ? 'ACEITO' : 'REJEITADO',
    validado_por: usuarioNome || null,
    validado_em: agora,
    observacao_validacao: observacao || null,
  }).eq('id', linha.id);
  if (error) throw error;
  if (!aprovar) {
    const { error: erroFatura } = await client.from('faturas').update({
      confirmacao_transportador_status: 'CONTESTADO',
      confirmacao_transportador_observacao: `Auditoria rejeitou a resposta do CT-e ${linha.numero_cte || linha.chave}: ${observacao}`,
      updated_at: agora,
    }).eq('id', linha.fatura_id);
    if (erroFatura) throw erroFatura;
  }
  await client.from('auditoria_fatura_historico').insert({
    fatura_id: linha.fatura_id,
    created_at: agora,
    acao: aprovar ? 'RESPOSTA_CTE_ACEITA' : 'RESPOSTA_CTE_REJEITADA',
    descricao: `${aprovar ? 'Aceitou' : 'Rejeitou'} a resposta da transportadora no CT-e ${linha.numero_cte || linha.chave} (${linha.resposta === 'CONCORDO' ? `concorda, desconto R$ ${Number(linha.valor_desconto || 0).toFixed(2)}` : 'nao concorda'})${observacao ? `: ${observacao}` : ''}.`,
    usuario_nome: usuarioNome || 'Auditoria',
  });
  return true;
}
