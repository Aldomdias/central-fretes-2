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
