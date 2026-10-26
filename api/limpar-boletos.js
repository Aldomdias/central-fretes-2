// Cron diario: apaga do Storage o PDF dos boletos de faturas ja pagas e mantem a informacao
// (valor, vencimento, linha digitavel, nome do arquivo) em fatura_boleto_controle.
// Paga = mesma regra de faturaPaga (src/services/auditorRoboService.js).
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'boletos-financeiro';
const STATUS_PAGAS = ['PAGA', 'PAGA_COM_DESCONTO', 'PAGA_COM_DIVERGENCIA'];
const paga = (f = {}) => STATUS_PAGAS.includes(f.status) || Boolean(f.data_pagamento) || Number(f.valor_pago || 0) > 0
  || String(f.partida || '').trim().startsWith('200');

export default async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (segredo && req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ error: 'Nao autorizado.' });
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !chave) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas.');
    const db = createClient(url, chave, { auth: { persistSession: false } });

    const { data: guardados, error } = await db.from('fatura_boleto_controle').select('fatura_id,boleto_arquivo_path').not('boleto_arquivo_path', 'is', null).limit(5000);
    if (error) throw new Error(error.message);
    let apagados = 0;
    for (let i = 0; i < (guardados || []).length; i += 200) {
      const bloco = guardados.slice(i, i + 200);
      const { data: faturas, error: erroFat } = await db.from('faturas').select('id,status,data_pagamento,valor_pago,partida').in('id', bloco.map((b) => b.fatura_id));
      if (erroFat) throw new Error(erroFat.message);
      const pagas = new Set((faturas || []).filter(paga).map((f) => String(f.id)));
      const alvos = bloco.filter((b) => pagas.has(String(b.fatura_id)));
      if (!alvos.length) continue;
      const { error: erroRm } = await db.storage.from(BUCKET).remove(alvos.map((b) => b.boleto_arquivo_path));
      if (erroRm) throw new Error(erroRm.message);
      await db.from('fatura_boleto_controle').update({ boleto_arquivo_path: null, boleto_apagado_em: new Date().toISOString(), boleto_apagado_motivo: 'PAGA' })
        .in('fatura_id', alvos.map((b) => b.fatura_id));
      apagados += alvos.length;
    }
    return res.status(200).json({ ok: true, verificados: (guardados || []).length, apagados });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
