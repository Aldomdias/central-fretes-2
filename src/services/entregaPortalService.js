import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

// Portal de comprovantes de entrega (api/entrega/<token>): o laudo grava aqui os
// CT-es sem entrega da fatura, a transportadora responde pelo portal e o auditor
// valida a resposta. Falha aqui nunca pode travar a geracao do laudo.

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

// Mesma chave usada em auditoriaEntregaCteService.chaveEntregaRegistro.
export const chaveEntregaPortal = (item = {}) => soDigitos(item.chave_cte) || String(item.numero_cte || '');

export function urlPortalEntrega(linkConfirmacao) {
  return linkConfirmacao ? String(linkConfirmacao).replace('/api/portal-fatura/', '/api/entrega/') : '';
}

export function urlAnexoEntrega(path) {
  return `/api/entrega-anexo?path=${encodeURIComponent(path)}`;
}

// Registra (ou atualiza) os CT-es sem entrega da fatura pra o portal listar.
export async function salvarPendenciasEntrega(fatura, itens = []) {
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
        entrega_status: item.entrega_status || 'NAO_ENTREGUE',
        atualizado_em: new Date().toISOString(),
      }))
      .filter((linha) => linha.chave);
    const { error } = await client.from('entrega_pendencias').upsert(linhas, { onConflict: 'fatura_id,chave' });
    if (error) throw error;
    return true;
  } catch (error) {
    console.warn('[Entrega portal] pendencias nao gravadas (migration aplicada?).', error?.message || error);
    return false;
  }
}

export async function carregarRespostasEntregaFatura(faturaId) {
  if (!isSupabaseConfigured() || !faturaId) return [];
  try {
    const { data, error } = await getSupabaseClient().from('entrega_respostas').select('*').eq('fatura_id', faturaId).order('respondido_em', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn('[Entrega portal] respostas indisponiveis.', error?.message || error);
    return [];
  }
}

export async function validarRespostaEntrega({ id, aprovar, observacao, usuarioNome }) {
  const { error } = await getSupabaseClient().from('entrega_respostas').update({
    status_validacao: aprovar ? 'APROVADO' : 'REJEITADO',
    validado_por: usuarioNome || null,
    validado_em: new Date().toISOString(),
    observacao_validacao: observacao || null,
  }).eq('id', id);
  if (error) throw new Error(`Erro ao validar resposta: ${error.message}`);
}

// Chaves (CT-e) com resposta ENTREGUE aprovada pelo auditor: passam a contar como entregues.
export async function carregarEntregasAprovadas(chaves = []) {
  const aprovadas = new Map();
  if (!isSupabaseConfigured() || !chaves.length) return aprovadas;
  try {
    const client = getSupabaseClient();
    const unicas = [...new Set(chaves.filter(Boolean))];
    for (let i = 0; i < unicas.length; i += 150) {
      const { data, error } = await client.from('entrega_respostas')
        .select('chave, validado_em, validado_por')
        .eq('status_validacao', 'APROVADO').eq('resposta', 'ENTREGUE')
        .in('chave', unicas.slice(i, i + 150));
      if (error) throw error;
      (data || []).forEach((row) => aprovadas.set(row.chave, row));
    }
  } catch (error) {
    console.warn('[Entrega portal] aprovacoes indisponiveis; segue so com o tracking.', error?.message || error);
  }
  return aprovadas;
}
