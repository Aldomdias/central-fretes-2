/**
 * Robo Auditor (automatico, na nuvem).
 *
 * GET/POST /api/robo-auditor  — chamado pelo cron da Vercel TODA hora cheia (vercel.json). Quem decide se
 * roda naquela hora e a configuracao da tela (tabela auditor_robo_config: horarios, dias, limites).
 * ?agora=1 ignora o horario (teste manual); chamadas encadeadas tambem seguem direto.
 * Pega as transportadoras ativas na lista do robo (tela Automacao > Robo Auditor), acha as
 * faturas novas (entradas desde UM DIA ANTES da inclusao da transportadora na lista, ainda em auditoria,
 * nunca processadas),
 * calcula os CT-es, apura desconto/entrega e REGISTRA a decisao em auditor_robo_execucoes.
 *
 * E-mail ao transportador/financeiro ainda NAO e enviado (modo sombra). A unica acao real:
 * fatura correta (sem desconto, tudo entregue) vai para a APROVACAO DA GESTAO, marcada "via robo".
 * Nao aceita parametros do cliente; tudo vem do banco. Variaveis no Vercel:
 * SUPABASE_URL (ou VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY e, opcional, CRON_SECRET.
 */
import { createClient } from '@supabase/supabase-js';

// Limites de tempo (plano Pro: maxDuration 300 s). Em teste local da para reduzir por variavel de ambiente.
const ORCAMENTO_MS = Number(process.env.ROBO_ORCAMENTO_MS) || 230000; // nao comeca fatura nova depois disso
const LIMITE_MS = Number(process.env.ROBO_LIMITE_MS) || 280000; // abandona a fatura em andamento (o trabalho ja gravado fica)
const BLOCO_CTES = 10; // CT-es por bloco de calculo (cada bloco e gravado)
const LIMITE_BLOCO_MS = Number(process.env.ROBO_LIMITE_BLOCO_MS) || 75000; // bloco que passa disso e abandonado
const MAX_ENCADEAMENTO = 40; // chamadas seguidas (cada uma continua de onde a outra parou)
const MAX_FATURAS = 60;
const MAX_REAVALIAR = 15;
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (segredo && req.headers.authorization !== `Bearer ${segredo}`) {
    return res.status(401).json({ error: 'Nao autorizado.' });
  }
  const inicio = Date.now();
  let nucleoComCache = null;
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !chave) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas.');
    const db = createClient(url, chave, { auth: { persistSession: false } });

    // Configuracao editavel na tela (Automacao > Robo Auditor). Sem a tabela, vale o padrao.
    let cfgRow = null;
    try { ({ data: cfgRow } = await db.from('auditor_robo_config').select('*').eq('id', 1).maybeSingle()); } catch { cfgRow = null; }
    const cfgRobo = {
      ativo: true, horas: [6, 12, 19], dias_semana: [0, 1, 2, 3, 4, 5, 6], calcular_nuvem: true,
      max_faturas: MAX_FATURAS, bloco_ctes: BLOCO_CTES, limite_bloco_seg: Math.round(LIMITE_BLOCO_MS / 1000),
      ...(cfgRow || {}),
    };
    const encadeada = Number(req.headers['x-robo-encadeamento'] || 0) > 0;
    const forcar = encadeada || /[?&]agora=1\b/.test(String(req.url || ''));
    if (!forcar) {
      const brasilia = new Date(Date.now() - 3 * 3600000); // UTC-3
      const hora = brasilia.getUTCHours();
      const dia = brasilia.getUTCDay();
      if (!cfgRobo.ativo) return res.status(200).json({ ok: true, pulou: true, motivo: 'Robo desligado na configuracao.' });
      if (!(cfgRobo.horas || []).includes(hora)) return res.status(200).json({ ok: true, pulou: true, motivo: `Fora do horario configurado (agora ${hora}h; horarios: ${(cfgRobo.horas || []).join(', ')}h).` });
      if (!(cfgRobo.dias_semana || []).includes(dia)) return res.status(200).json({ ok: true, pulou: true, motivo: 'Dia da semana nao configurado.' });
    }

    // O nucleo (bundle do app) le a conexao de process.env: define antes de importar.
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_ANON_KEY = chave;
    const core = await import('./_robo-core.mjs');
    core.iniciarCacheCalculoRobo(540000); // tabelas de frete das transportadoras ficam em memoria durante esta execucao
    nucleoComCache = core;

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
      .filter((f) => core.dataEntradaFatura(f) >= core.dataInicioRobo(ativas.get(norm(f.transportadora))))
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
    let estourouTempo = false;
    let progressou = false;
    const erros = [];
    const fila = [
      ...novas.slice(0, Number(cfgRobo.max_faturas) || MAX_FATURAS).map((f) => ({ f, anterior: null })),
      ...reavaliar.map((e) => ({ f: porId.get(String(e.fatura_id)), anterior: e })),
    ];
    for (const { f, anterior } of fila) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      try {
        const restante = LIMITE_MS - (Date.now() - inicio);
        const limite = new Promise((_, rej) => { setTimeout(() => rej(new Error('__tempo__')), restante); });
        const registro = await Promise.race([
          core.analisarFaturaRobo(db, f, {
            cfg: ativas.get(norm(f.transportadora)), emailsAuditores, usuario: 'Robo (automatico)', origem: 'automatico', anterior,
            prazoFinal: inicio + LIMITE_MS - 8000, calcular: cfgRobo.calcular_nuvem !== false,
            bloco: Number(cfgRobo.bloco_ctes) || BLOCO_CTES,
            limiteBlocoMs: (Number(cfgRobo.limite_bloco_seg) || 75) * 1000,
          }),
          limite,
        ]);
        const { error } = await db.from('auditor_robo_execucoes').upsert(registro, { onConflict: 'fatura_id' });
        if (error) throw new Error(error.message);
        if (anterior) reavaliadas += 1; else analisadas += 1;
        if (registro.acao_executada) enviadasGestao += 1;
      } catch (e) {
        if (e.message === '__tempo__') { estourouTempo = true; break; }
        if (e.message === '__parcial__') { estourouTempo = true; progressou = true; break; }
        erros.push(`${f.numero_fatura}: ${e.message || e}`);
      }
    }
    const restantes = Math.max(novas.length - analisadas, 0) + Math.max(reavaliar.length - reavaliadas, 0);
    // Plano sem cron frequente: quando sobra trabalho, esta chamada aciona a seguinte (limitada),
    // para o robo terminar tudo sem depender de abrir a tela.
    let encadeou = false;
    const profundidade = Number(req.headers['x-robo-encadeamento'] || 0);
    if ((restantes > 0 || estourouTempo) && (analisadas + reavaliadas > 0 || progressou || profundidade === 0) && profundidade < MAX_ENCADEAMENTO) {
      try {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const cab = { 'x-robo-encadeamento': String(profundidade + 1) };
        if (segredo) cab.authorization = `Bearer ${segredo}`;
        await fetch(`${proto}://${host}/api/robo-auditor`, { headers: cab, signal: AbortSignal.timeout(4000) }).catch(() => {});
        encadeou = true;
      } catch { /* o proximo disparo diario continua */ }
    }
    return res.status(200).json({
      ok: true, analisadas, reavaliadas, enviadasGestao, restantes, encadeou, estourouTempo, erros, ms: Date.now() - inicio,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  } finally {
    try { nucleoComCache?.encerrarCacheCalculoRobo?.(); } catch { /* sem cache aberto */ }
  }
}
