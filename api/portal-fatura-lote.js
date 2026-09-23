/**
 * Confirmacao em lote de varias faturas pelo transportador — usada pelo botao
 * "Confirmar todas" do laudo consolidado/em lote (api/portal-fatura/[token].js
 * cobre uma fatura por vez; abrir 11 links um a um nao e razoavel).
 *
 * POST /api/portal-fatura-lote  body: { tokens: string[], respondido_por: string }
 *
 * CORS aberto (Access-Control-Allow-Origin: *) porque o laudo e um arquivo
 * HTML baixado — abre como file:// ou anexo de e-mail, origem "null" — e
 * precisa chamar esse endpoint via fetch() de fora do dominio do app. A
 * seguranca continua sendo o token em si (32 bytes aleatorios por fatura),
 * igual ao portal individual.
 */
import { createClient } from '@supabase/supabase-js';

function getClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error('Portal indisponível: variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Metodo nao permitido.' });
  }

  let supabase;
  try {
    supabase = getClient();
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }

  const corpo = lerCorpo(req);
  const tokens = Array.isArray(corpo.tokens)
    ? [...new Set(corpo.tokens.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
  const respondidoPor = String(corpo.respondido_por || '').slice(0, 200) || null;

  if (!tokens.length) {
    return res.status(400).json({ erro: 'Nenhum token informado.' });
  }
  if (tokens.length > 200) {
    return res.status(400).json({ erro: 'Lote grande demais (maximo 200 faturas por chamada).' });
  }

  try {
    const { data: faturas, error: erroBusca } = await supabase
      .from('faturas')
      .select('id, numero_fatura, confirmacao_transportador_status, confirmacao_transportador_token')
      .in('confirmacao_transportador_token', tokens);
    if (erroBusca) throw erroBusca;

    const encontrados = new Set((faturas || []).map((item) => item.confirmacao_transportador_token));
    const pendentes = (faturas || []).filter((item) => item.confirmacao_transportador_status !== 'APROVADO');
    const jaConfirmadas = (faturas || []).length - pendentes.length;
    const invalidos = tokens.filter((token) => !encontrados.has(token)).length;

    const agora = new Date().toISOString();
    if (pendentes.length) {
      const { error: erroUpdate } = await supabase
        .from('faturas')
        .update({
          confirmacao_transportador_status: 'APROVADO',
          confirmacao_transportador_em: agora,
          confirmacao_transportador_por: respondidoPor,
          updated_at: agora,
        })
        .in('id', pendentes.map((item) => item.id));
      if (erroUpdate) throw erroUpdate;

      const historico = pendentes.map((item) => ({
        fatura_id: item.id,
        created_at: agora,
        acao: 'CONFIRMACAO_TRANSPORTADOR_PORTAL_LOTE',
        descricao: `Transportador confirmou a fatura pelo laudo em lote${respondidoPor ? ` (${respondidoPor})` : ''}.`,
        usuario_nome: respondidoPor || 'Portal do transportador',
      }));
      await supabase.from('auditoria_fatura_historico').insert(historico);
    }

    return res.status(200).json({
      confirmadas: pendentes.length,
      ja_confirmadas: jaConfirmadas,
      invalidos,
      total_recebido: tokens.length,
    });
  } catch (error) {
    return res.status(500).json({ erro: error.message || String(error) });
  }
}
