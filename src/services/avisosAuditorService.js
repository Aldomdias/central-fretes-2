import { getSupabaseClient } from '../lib/supabaseClient';

// Respostas que a transportadora deu pelo portal e que viram aviso pro auditor
// dono da fatura (auditor_nome / auditor_email da fatura).
export const ACOES_RESPOSTA_TRANSPORTADORA = {
  CONFIRMACAO_TRANSPORTADOR_PORTAL: { rotulo: 'Transportadora confirmou a fatura', cor: '#15803d', positivo: true },
  CONTESTACAO_TRANSPORTADOR_PORTAL: { rotulo: 'Transportadora contestou / respondeu com divergência', cor: '#b45309', positivo: false },
  JUSTIFICATIVA_CTE_SEM_NF_PORTAL: { rotulo: 'Transportadora justificou CT-e sem NF', cor: '#0369a1', positivo: true },
  RESPOSTA_ENTREGA_PORTAL: { rotulo: 'Transportadora respondeu comprovante de entrega', cor: '#0369a1', positivo: true },
};

const JANELA_DIAS = 45;
const norm = (valor) => String(valor || '').trim().toLowerCase();

export async function listarRespostasTransportadoraNaoVistas({ nome = '', email = '' } = {}) {
  const meuNome = norm(nome);
  const meuEmail = norm(email);
  if (!meuNome && !meuEmail) return [];
  const client = getSupabaseClient();
  const desde = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString();
  const { data, error } = await client
    .from('auditoria_fatura_historico')
    .select('id, fatura_id, acao, descricao, usuario_nome, created_at, fatura:faturas(id, numero_fatura, transportadora, auditor_nome, auditor_email, valor_fatura)')
    .in('acao', Object.keys(ACOES_RESPOSTA_TRANSPORTADORA))
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Erro ao buscar respostas da transportadora: ${error.message}`);
  const minhas = (data || []).filter((row) => {
    const f = row.fatura || {};
    return (meuEmail && norm(f.auditor_email) === meuEmail) || (meuNome && norm(f.auditor_nome) === meuNome);
  });
  if (!minhas.length) return [];
  const { data: vistos, error: erroVistos } = await client
    .from('auditor_avisos_ciencia')
    .select('historico_id')
    .in('historico_id', minhas.map((row) => row.id));
  // Migration 20261111_003 ainda nao aplicada: sem aviso (nao enche a tela com o historico todo).
  if (erroVistos) return [];
  const jaVistos = new Set((vistos || []).map((row) => row.historico_id));
  return minhas.filter((row) => !jaVistos.has(row.id));
}

export async function marcarCienciaRespostasTransportadora(ids = [], usuarioNome = '') {
  const lista = ids.filter(Boolean);
  if (!lista.length) return;
  const agora = new Date().toISOString();
  const { error } = await getSupabaseClient()
    .from('auditor_avisos_ciencia')
    .upsert(lista.map((id) => ({ historico_id: id, ciente_por: usuarioNome || null, ciente_em: agora })), { onConflict: 'historico_id' });
  if (error) throw new Error(`Erro ao marcar ciencia: ${error.message}`);
}

const ROTULO_RESULTADO_PORTAL_CTE = {
  concordou_desconto: 'concordou com desconto',
  concordou_cancelamento: 'concordou em cancelar e reemitir',
  nao_concordou: 'não concordou',
  em_analise: 'em análise',
};

// Respostas ao laudo da Auditoria de CT-e (portal CT-e a CT-e) ainda pendentes de
// validacao e nao vistas, agrupadas por processo/laudo do auditor.
export async function listarRespostasLaudoCteNaoVistas({ id = '', nome = '' } = {}) {
  const meuId = String(id || '').trim();
  const meuNome = norm(nome);
  if (!meuId && !meuNome) return [];
  const { data, error } = await getSupabaseClient()
    .from('auditoria_cte_portal_respostas')
    .select('id, processo_id, chave_cte, numero_cte, transportadora, resultado, valor_proposto, respondido_em, respondido_por, processo:auditoria_cte_processos(id, codigo, competencia, transportadora, auditor_id, auditor_nome, enviado_por, laudo_gerado_por)')
    .eq('status_validacao', 'PENDENTE')
    .is('ciencia_auditor_em', null)
    .order('respondido_em', { ascending: false })
    .limit(1000);
  // Migration 20261111_004 ainda nao aplicada: sem aviso.
  if (error) return [];
  const minhas = (data || []).filter((row) => {
    const p = row.processo || {};
    return (meuId && String(p.auditor_id || '') === meuId)
      || (meuNome && [p.auditor_nome, p.enviado_por, p.laudo_gerado_por].some((v) => norm(v) === meuNome));
  });
  const grupos = new Map();
  minhas.forEach((row) => {
    const chave = row.processo_id || `sem-processo:${row.transportadora || ''}`;
    const g = grupos.get(chave) || { id: chave, processo: row.processo, transportadora: row.processo?.transportadora || row.transportadora, respondido_em: row.respondido_em, respondido_por: row.respondido_por, ids: [], contagem: {}, valorProposto: 0 };
    g.ids.push(row.id);
    g.contagem[row.resultado] = (g.contagem[row.resultado] || 0) + 1;
    g.valorProposto += Number(row.valor_proposto || 0);
    if (String(row.respondido_em || '') > String(g.respondido_em || '')) { g.respondido_em = row.respondido_em; g.respondido_por = row.respondido_por; }
    grupos.set(chave, g);
  });
  return [...grupos.values()].map((g) => ({
    ...g,
    resumo: Object.entries(g.contagem).map(([res, qtd]) => `${qtd} ${ROTULO_RESULTADO_PORTAL_CTE[res] || res}`).join(' · '),
    positivo: Boolean(g.contagem.concordou_desconto || g.contagem.concordou_cancelamento),
  }));
}

export async function marcarCienciaRespostasLaudoCte(ids = []) {
  const lista = ids.filter(Boolean);
  if (!lista.length) return;
  const { error } = await getSupabaseClient()
    .from('auditoria_cte_portal_respostas')
    .update({ ciencia_auditor_em: new Date().toISOString() })
    .in('id', lista);
  if (error) throw new Error(`Erro ao marcar ciencia: ${error.message}`);
}
