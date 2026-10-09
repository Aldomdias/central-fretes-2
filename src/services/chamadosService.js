import { getSupabaseClient } from '../lib/supabaseClient';

export const URGENCIAS_CHAMADO = [
  { chave: 'BAIXA', label: 'Baixa' },
  { chave: 'MEDIA', label: 'Média' },
  { chave: 'ALTA', label: 'Alta' },
  { chave: 'CRITICA', label: 'Crítica (operação parada)' },
];

export const STATUS_CHAMADO = [
  { chave: 'ABERTO', label: 'Aberto' },
  { chave: 'EM_ANALISE', label: 'Em análise' },
  { chave: 'EM_ANDAMENTO', label: 'Em andamento' },
  { chave: 'RESOLVIDO', label: 'Resolvido' },
  { chave: 'CANCELADO', label: 'Cancelado' },
];

function cliente() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase não configurado.');
  return supabase;
}

const BUCKET_ANEXOS = 'chamados-anexos';
const LIMITE_ANEXO_MB = 20;

async function enviarAnexos(arquivos = []) {
  const client = cliente();
  const pasta = `${new Date().toISOString().slice(0, 10)}/${Math.random().toString(36).slice(2, 10)}`;
  const anexos = [];
  for (const arquivo of arquivos) {
    if (arquivo.size > LIMITE_ANEXO_MB * 1024 * 1024) throw new Error(`O arquivo "${arquivo.name}" passa de ${LIMITE_ANEXO_MB} MB.`);
    const nomeSeguro = arquivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${pasta}/${nomeSeguro}`;
    const { error } = await client.storage.from(BUCKET_ANEXOS).upload(path, arquivo, { upsert: false, contentType: arquivo.type || undefined });
    if (error) throw new Error(`Erro ao anexar "${arquivo.name}": ${error.message}. Aplicar a migration 20261009_003_chamados_anexos.sql.`);
    const { data } = client.storage.from(BUCKET_ANEXOS).getPublicUrl(path);
    anexos.push({ nome: arquivo.name, tamanho: arquivo.size, path, url: data?.publicUrl || '' });
  }
  return anexos;
}

export async function abrirChamado({ sessao, tipo, modulo, titulo, descricao, urgencia, paginaOrigem, arquivos = [] }) {
  const anexos = await enviarAnexos(arquivos);
  const { data, error } = await cliente()
    .from('chamados')
    .insert({
      tipo,
      modulo,
      titulo: String(titulo || '').trim(),
      descricao: String(descricao || '').trim(),
      urgencia,
      pagina_origem: paginaOrigem || '',
      usuario_id: sessao?.id ? String(sessao.id) : null,
      usuario_nome: sessao?.nome || sessao?.email || 'Usuário',
      usuario_email: sessao?.email || '',
      anexos,
    })
    .select('id, numero')
    .single();
  if (error) throw new Error(error.message.includes('chamados') ? 'Tabela de chamados ainda não existe no Supabase (aplicar a migration 20261009_002_chamados.sql).' : error.message);
  return data;
}

export async function listarChamados({ sessao, todos = false, limite = 100 }) {
  let q = cliente().from('chamados').select('*').order('created_at', { ascending: false }).limit(limite);
  if (!todos) q = q.eq('usuario_id', String(sessao?.id || ''));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function atualizarChamado(id, { status, resposta, sessao }) {
  const patch = { updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (resposta !== undefined) patch.resposta = resposta;
  if (status === 'RESOLVIDO') {
    patch.resolvido_por = sessao?.nome || sessao?.email || '';
    patch.resolvido_em = new Date().toISOString();
  }
  const { error } = await cliente().from('chamados').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
