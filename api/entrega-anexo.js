/**
 * Link temporario (5 min) pra abrir um comprovante de entrega do bucket privado.
 * GET /api/entrega-anexo?path=<fatura_id>/<uuid>/<arquivo>  -> redireciona pro arquivo.
 * O path tem um UUID aleatorio e so o app interno o conhece (vem de entrega_respostas).
 */
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const path = String(req.query.path || '');
  if (!path || path.includes('..') || path.length > 400) return res.status(400).send('Caminho inválido.');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return res.status(500).send('Serviço indisponível.');
  try {
    const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });
    // So serve arquivo que esta registrado em alguma resposta de entrega.
    const { data: achou } = await supabase.from('entrega_respostas').select('id').contains('anexos', JSON.stringify([{ path }])).limit(1);
    if (!achou?.length) return res.status(404).send('Arquivo não encontrado.');
    const { data, error } = await supabase.storage.from('entrega-comprovantes').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return res.status(404).send('Arquivo não encontrado.');
    return res.redirect(302, data.signedUrl);
  } catch (error) {
    return res.status(500).send(error.message || 'Erro ao abrir o arquivo.');
  }
}
