/**
 * Acompanhamento automatico dos envios de fatura ao OMS (VLOG-3813, secao 6.3/6.4). Cron da Vercel, a cada minuto.
 * - sem lote aceito: reenvia o MESMO corpo com o mesmo requestId (1, 2, 4, 8, 16 min; depois marca erro);
 * - lote em andamento: consulta a cada 1 min; "failed" no OMS: reenvia ate 3 tentativas;
 * - na fila do SAP: consulta a situacao a cada 15 min ate sentToErp, por ate 72 h (depois marca erro e alerta).
 * Variaveis: OMS_BASE_URL, OMS_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET (opcional).
 * Sem registros pendentes nao chama o OMS (nem pede token).
 */
import { createClient } from '@supabase/supabase-js';
import { criarClienteOms, lerConfigOms, OmsError } from './_omsFreteAudit.mjs';
import { camposDoLote, camposEnvioErpDaFatura, proximaAcao, LIMITE_SAP_HORAS } from '../src/utils/omsEnvioPuro.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (segredo && req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ error: 'Nao autorizado.' });

  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !chave) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas.');
    const db = createClient(url, chave, { auth: { persistSession: false } });

    const desde = new Date(Date.now() - (LIMITE_SAP_HORAS + 1) * 3600 * 1000).toISOString();
    const { data: envios, error } = await db.from('fatura_oms_envios').select('*')
      .eq('sent_to_erp', false).neq('status', 'recusado').gte('created_at', desde)
      .order('updated_at', { ascending: true }).limit(200);
    if (error) throw new Error(`Envios pendentes: ${error.message}`);

    const agora = Date.now();
    const tarefas = (envios || []).map((e) => ({ e, acao: proximaAcao(e, agora) })).filter((t) => t.acao);
    if (!tarefas.length) return res.status(200).json({ ok: true, pendentes: 0 });

    const oms = criarClienteOms(lerConfigOms());
    const resumo = {};
    const salvar = (id, campos) => db.from('fatura_oms_envios').update({ ...campos, updated_at: new Date().toISOString() }).eq('id', id);

    for (const { e, acao } of tarefas) {
      try {
        if (acao === 'esgotar') {
          await salvar(e.id, { status: 'erro', erro: { code: 'REENVIO_ESGOTADO', message: 'Reenvios ao OMS esgotados (1, 2, 4, 8 e 16 min). Alertar o responsavel.' } });
        } else if (acao === 'expirar') {
          await salvar(e.id, { status: 'erro', erro: { code: 'SAP_SEM_LEITURA_72H', message: `O SAP nao leu a fatura em ${LIMITE_SAP_HORAS} h. Alertar o responsavel.` } });
        } else if (acao === 'reenviar') {
          if (!e.payload?.performedBy?.id) {
            await salvar(e.id, { status: 'erro', erro: { code: 'SEM_PERFORMED_BY', message: 'Envio sem operador gravado: reenviar pela tela da fatura.' } });
          } else {
            try {
              const r = await oms.enviarLote(e.payload);
              await salvar(e.id, { status: 'enviado', batch_id: r.batchId, oms_status: null, erro: null, tentativas: (e.tentativas || 0) + 1 });
            } catch (err) {
              if (!(err instanceof OmsError)) throw err;
              const status = err.retryable ? 'enviando' : 'recusado';
              await salvar(e.id, { status, erro: { code: err.code, message: err.message, details: err.details, acao: err.acao }, tentativas: (e.tentativas || 0) + 1 });
            }
          }
        } else if (acao === 'consultar_lote') {
          const lote = await oms.consultarLote(e.batch_id);
          let campos = camposDoLote(lote, e.oms_invoice_id);
          if (campos.sent_to_erp && !e.sent_to_erp_visto_em) campos.sent_to_erp_visto_em = new Date().toISOString();
          await salvar(e.id, campos);
          // Entrou na fila do SAP: registra o envio ao ERP na propria fatura (so se ainda nao houver data).
          const erp = camposEnvioErpDaFatura(e, campos);
          if (erp) await db.from('faturas').update(erp).eq('id', e.fatura_id).is('data_envio_erp', null);
        } else if (acao === 'consultar_fatura') {
          const s = await oms.consultarFatura(e.oms_invoice_id);
          await salvar(e.id, s.state === 'sentToErp' ? { sent_to_erp: true, sent_to_erp_visto_em: new Date().toISOString() } : {});
        }
        resumo[acao] = (resumo[acao] || 0) + 1;
      } catch (err) {
        // Falha de rede/OMS numa fatura nao para as outras; tenta de novo no proximo ciclo.
        resumo[`falha_${acao}`] = (resumo[`falha_${acao}`] || 0) + 1;
        console.error('[oms-acompanhar]', acao, err?.code || '', err?.message);
      }
    }
    return res.status(200).json({ ok: true, pendentes: tarefas.length, resumo });
  } catch (e) {
    console.error('[oms-acompanhar]', e?.message);
    return res.status(500).json({ ok: false, erro: e?.message });
  }
}
