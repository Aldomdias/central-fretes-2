/**
 * Integracao AMD Log -> Verum OMS (tratativa e envio de faturas de frete ao SAP).
 * Contrato: integracao-amd-verum-oms-faturas.md (v1, VLOG-3813).
 *
 * POST /api/oms-faturas   Authorization: Bearer <access_token do usuario logado no Supabase>
 *   { acao: 'preparar', faturas: [...], performedByName }  -> divide em lotes (1.000 faturas) com requestId; NAO chama o OMS
 *   { acao: 'enviar',   lote: { requestId, invoices }, performedByName }  -> envia UM lote (reenvio = mesmo corpo, mesmo requestId)
 *   { acao: 'lote',     batchId }      -> acompanha o lote
 *   { acao: 'fatura',   invoiceId }    -> situacao antes de liberar (200/409 viram pendencia: true/false)
 *   { acao: 'motivos' }                -> motivos de valor e de entrega (cache de 1 dia no cliente)
 *
 * Variaveis (Vercel): OMS_BASE_URL, OMS_CLIENT_SECRET, OMS_CLIENT_ID (opcional, padrao amd-log),
 * SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY (para validar o usuario).
 * O secret fica so aqui: nunca em resposta, log ou URL. performedBy.id vem do usuario autenticado
 * (id interno, nunca e-mail/CPF); o navegador nao escolhe quem aprovou.
 * Esta funcao faz UMA tentativa por chamada; quem reenvia (1,2,4,8,16 min) e o chamador, com o mesmo requestId.
 */
import { createClient } from '@supabase/supabase-js';
import { criarClienteOms, lerConfigOms, montarLotes, OmsError, ESPERAS_RETENTATIVA_MIN } from './_omsFreteAudit.mjs';

export const config = { maxDuration: 90 };

function corpoDe(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

// O cliente vive no processo da funcao: reaproveita o token entre chamadas "quentes" (limite de emissoes por minuto).
let clienteCache = null;
function clienteOms() {
  if (!clienteCache) clienteCache = criarClienteOms(lerConfigOms());
  return clienteCache;
}

async function usuarioAutenticado(req) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!m) return null;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas.');
  const db = createClient(url, chave, { auth: { persistSession: false } });
  const { data, error } = await db.auth.getUser(m[1]);
  if (error || !data?.user) return null;
  return data.user;
}

const limpar = (v, max) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Metodo nao permitido.' });

  try {
    const user = await usuarioAutenticado(req);
    if (!user) return res.status(401).json({ ok: false, erro: 'Sessao invalida. Entre novamente.' });

    const body = corpoDe(req);
    const performedBy = {
      id: limpar(user.id, 64),
      name: limpar(body.performedByName || user.user_metadata?.nome || user.user_metadata?.name, 120),
    };
    const oms = clienteOms();

    switch (body.acao) {
      case 'preparar': {
        if (!performedBy.name) return res.status(400).json({ ok: false, erro: 'Informe o nome do auditor (performedByName).' });
        const lotes = montarLotes(body.faturas, { performedBy });
        return res.status(200).json({ ok: true, lotes, esperasRetentativaMin: ESPERAS_RETENTATIVA_MIN });
      }
      case 'enviar': {
        if (!performedBy.name) return res.status(400).json({ ok: false, erro: 'Informe o nome do auditor (performedByName).' });
        const lote = body.lote || {};
        // Sempre o operador autenticado, mesmo que o corpo traga outro.
        const r = await oms.enviarLote({ requestId: lote.requestId, performedBy, invoices: lote.invoices });
        return res.status(200).json({ ok: true, ...r });
      }
      case 'lote':
        if (!body.batchId) return res.status(400).json({ ok: false, erro: 'Informe batchId.' });
        return res.status(200).json({ ok: true, lote: await oms.consultarLote(String(body.batchId)) });
      case 'fatura':
        if (!body.invoiceId) return res.status(400).json({ ok: false, erro: 'Informe invoiceId.' });
        return res.status(200).json({ ok: true, fatura: await oms.consultarFatura(String(body.invoiceId)) });
      case 'motivos':
        return res.status(200).json({ ok: true, motivos: await oms.listarMotivos() });
      default:
        return res.status(400).json({ ok: false, erro: 'Acao desconhecida.' });
    }
  } catch (e) {
    if (e instanceof OmsError) {
      // 401 do OMS = credencial nossa; nao devolver como 401 para nao deslogar o usuario no front.
      const status = e.status === 401 ? 502 : e.status >= 400 && e.status < 600 ? e.status : e.network ? 504 : 502;
      if (e.status === 401 || e.status >= 500) console.error('[oms-faturas]', e.code, e.status, e.correlationId || '');
      return res.status(status).json({ ok: false, erro: e.message, ...e.toJSON() });
    }
    console.error('[oms-faturas]', e?.message);
    return res.status(500).json({ ok: false, erro: e?.message || 'Falha inesperada.' });
  }
}
