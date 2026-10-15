/**
 * Robo Auditor (automatico, na nuvem).
 *
 * GET/POST /api/robo-auditor  — chamado pelo cron da Vercel (vercel.json).
 * Pega as transportadoras ativas na lista do robo (tela Automacao > Robo Auditor), acha as
 * faturas novas (entradas desde ROBO_DATA_INICIO, ainda em auditoria, nunca processadas),
 * calcula os CT-es, apura desconto/entrega e REGISTRA a decisao em auditor_robo_execucoes.
 *
 * E-mail ao transportador/financeiro ainda NAO e enviado (modo sombra). A unica acao real:
 * fatura correta (sem desconto, tudo entregue) vai para a APROVACAO DA GESTAO, marcada "via robo".
 * Nao aceita parametros do cliente; tudo vem do banco. Variaveis no Vercel:
 * SUPABASE_URL (ou VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY e, opcional, CRON_SECRET.
 */
import { createClient } from '@supabase/supabase-js';

const ORCAMENTO_MS = 45000; // para antes do limite da funcao; o proximo ciclo continua
const MAX_FATURAS = 30;
const MAX_REAVALIAR = 15;
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (segredo && req.headers.authorization !== `Bearer ${segredo}`) {
    return res.status(401).json({ error: 'Nao autorizado.' });
  }
  const inicio = Date.now();
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !chave) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas.');
    // O nucleo (bundle do app) le a conexao de process.env: define antes de importar.
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_ANON_KEY = chave;
    const core = await import('./_robo-core.mjs');
    const db = createClient(url, chave, { auth: { persistSession: false } });

    const { data: lista, error: erroLista } = await db.from('auditor_robo_transportadoras').select('*').eq('ativo', true);
    if (erroLista) throw new Error(`Lista do robo: ${erroLista.message}`);
    const ativas = new Map((lista || []).map((r) => [norm(r.transportadora), r]));
    if (!ativas.size) return res.status(200).json({ ok: true, analisadas: 0, motivo: 'Nenhuma transportadora ativa na lista.' });

    const { data: faturas, error: erroFat } = await db.from('faturas').select('*')
      .in('status', core.STATUS_ROBO_AUDITA).order('created_at', { ascending: false }).limit(3000);
    if (erroFat) throw new Error(`Faturas: ${erroFat.message}`);
    const { data: feitas } = await db.from('auditor_robo_execucoes').select('*').limit(20000);
    const jaFeitas = new Set((feitas || []).map((e) => String(e.fatura_id)));
    const porId = new Map((faturas || []).map((f) => [String(f.id), f]));

    const novas = (faturas || [])
      .filter((f) => ativas.has(norm(f.transportadora)))
      .filter((f) => String(f.importado_em || f.created_at || '').slice(0, 10) >= core.ROBO_DATA_INICIO)
      .filter((f) => !jaFeitas.has(String(f.id)));
    // Casos em revisao (ou laudo ainda sem OK): o robo reavalia a cada ciclo; se ficaram corretos
    // (calculo concluido, entrega comprovada) vao sozinhos para a gestao. Os mais antigos primeiro.
    const reavaliar = (feitas || [])
      .filter((e) => !e.acao_executada && [core.DECISAO.REVISAO_AUDITOR, core.DECISAO.ENVIAR_LAUDO].includes(e.decisao))
      .filter((e) => porId.has(String(e.fatura_id)) && ativas.has(norm(porId.get(String(e.fatura_id)).transportadora)))
      .sort((a, b) => String(a.reavaliado_em || a.executado_em).localeCompare(String(b.reavaliado_em || b.executado_em)))
      .slice(0, MAX_REAVALIAR);

    const emailsAuditores = await core.carregarEmailsAuditores(db);
    let analisadas = 0;
    let reavaliadas = 0;
    let enviadasGestao = 0;
    const erros = [];
    const fila = [
      ...novas.slice(0, MAX_FATURAS).map((f) => ({ f, anterior: null })),
      ...reavaliar.map((e) => ({ f: porId.get(String(e.fatura_id)), anterior: e })),
    ];
    for (const { f, anterior } of fila) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      try {
        const registro = await core.analisarFaturaRobo(db, f, {
          cfg: ativas.get(norm(f.transportadora)), emailsAuditores, usuario: 'Robo (automatico)', origem: 'automatico', anterior,
        });
        const { error } = await db.from('auditor_robo_execucoes').upsert(registro, { onConflict: 'fatura_id' });
        if (error) throw new Error(error.message);
        if (anterior) reavaliadas += 1; else analisadas += 1;
        if (registro.acao_executada) enviadasGestao += 1;
      } catch (e) {
        erros.push(`${f.numero_fatura}: ${e.message || e}`);
      }
    }
    return res.status(200).json({
      ok: true, analisadas, reavaliadas, enviadasGestao, restantes: Math.max(novas.length - analisadas, 0), erros, ms: Date.now() - inicio,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
