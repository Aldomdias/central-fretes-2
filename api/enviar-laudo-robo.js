/**
 * Envio por e-mail do laudo de auditoria ao transportador (Robo Auditor).
 *
 * POST /api/enviar-laudo-robo
 * body: { fatura_ids: string[], assunto, corpo_html, anexo_nome, anexo_gzip_base64, origem?: 'auto'|'manual' }
 *
 * O laudo (HTML) e o corpo do e-mail sao gerados no navegador (mesmo laudo consolidado da tela de
 * Faturas); aqui so se valida e envia. Seguranca: destinatarios NAO vem do cliente — saem da lista do
 * robo (auditor_robo_transportadoras) e o auditor responsavel vai em copia. So envia faturas cujo
 * laudo foi APROVADO pelo auditor e ainda nao enviado; depois marca como enviado (nao reenvia).
 *
 * Provedor (igual ao alerta de CT-e): Resend direto (RESEND_API_KEY + ALERTA_EMAIL_FROM) ou a funcao
 * "alerta-cte-email" da Central (ALERTA_EMAIL_TOKEN). Variaveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { gunzipSync } from 'node:zlib';

export const config = { maxDuration: 60 };

const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const emailsDe = (texto) => [...new Set(String(texto || '').split(/[;,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function corpoDe(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Metodo nao permitido.' });
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !chave) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas.');
    const db = createClient(url, chave, { auth: { persistSession: false } });

    const body = corpoDe(req);
    const ids = [...new Set((Array.isArray(body.fatura_ids) ? body.fatura_ids : []).map(String).filter(Boolean))];
    const assunto = String(body.assunto || '').trim().slice(0, 300);
    const corpoHtml = String(body.corpo_html || '');
    const origem = body.origem === 'auto' ? 'auto' : 'manual';
    // Reenvio (botao "Reenviar laudo por e-mail"): laudo ja enviado (ou so baixado) volta a sair, agora para os e-mails
    // cadastrados da transportadora. So manual, nunca automatico.
    const reenvio = body.reenvio === true && origem === 'manual';
    if (!ids.length || ids.length > 300) return res.status(400).json({ ok: false, erro: 'Informe de 1 a 300 faturas.' });
    if (!assunto || !corpoHtml) return res.status(400).json({ ok: false, erro: 'Assunto e corpo do e-mail sao obrigatorios.' });

    // 1) todas as faturas precisam ter laudo aprovado e ainda nao enviado
    const { data: execs, error: e1 } = await db.from('auditor_robo_execucoes').select('*').in('fatura_id', ids);
    if (e1) throw new Error(`Execucoes: ${e1.message}`);
    const porId = new Map((execs || []).map((e) => [String(e.fatura_id), e]));
    const invalidas = ids.filter((id) => {
      const e = porId.get(id);
      if (!e || e.decisao !== 'ENVIAR_LAUDO') return true;
      if (reenvio) return !(e.acao_executada || e.aprovado_auditor_em);
      return !e.aprovado_auditor_em || e.acao_executada;
    });
    if (invalidas.length) {
      const nomes = invalidas.map((id) => porId.get(id)?.numero_fatura || id).slice(0, 10).join(', ');
      return res.status(409).json({ ok: false, erro: `Laudo nao aprovado pelo auditor ou ja enviado: fatura(s) ${nomes}.` });
    }

    // 2) uma transportadora por envio
    const transportadoras = [...new Set([...porId.values()].map((e) => norm(e.transportadora)))];
    if (transportadoras.length !== 1) return res.status(400).json({ ok: false, erro: 'O envio deve ser de uma unica transportadora.' });
    const nomeTransp = [...porId.values()][0].transportadora;

    // 3) destinatarios: so da lista do robo
    const { data: cfgs, error: e2 } = await db.from('auditor_robo_transportadoras').select('*');
    if (e2) throw new Error(`Lista do robo: ${e2.message}`);
    const cfg = (cfgs || []).find((c) => norm(c.transportadora) === transportadoras[0]);
    if (!cfg) return res.status(400).json({ ok: false, erro: `${nomeTransp} nao esta na lista do robo.` });
    if (origem === 'auto' && !cfg.email_automatico) return res.status(409).json({ ok: false, erro: `E-mail automatico desligado para ${nomeTransp}.` });
    const para = emailsDe(cfg.emails_transportadora);
    if (!para.length) return res.status(400).json({ ok: false, erro: `Sem e-mail cadastrado para ${nomeTransp}: preencha em Automacao > Robo Auditor.` });
    // Junto em TODO laudo: o(s) auditor(es) responsavel(is) e o grupo padrao da auditoria (historico mesmo sem auditor).
    // Grupo padrao: variavel LAUDO_EMAIL_COPIA_PADRAO na Vercel (aceita varios, separados por ;).
    const copiaPadrao = emailsDe(process.env.LAUDO_EMAIL_COPIA_PADRAO || 'fatura@cantustore.com.br');
    const copia = [...new Set([
      ...emailsDe([...porId.values()].map((e) => e.auditor_email).join(';')),
      ...copiaPadrao,
    ])].filter((e) => !para.includes(e));

    // 4) anexo (laudo HTML vem compactado do navegador para caber no limite de requisicao)
    let anexo = null;
    if (body.anexo_gzip_base64) {
      const html = gunzipSync(Buffer.from(String(body.anexo_gzip_base64), 'base64'));
      anexo = { filename: String(body.anexo_nome || 'laudo.html').replace(/[^\w.\- ]+/g, '_'), content: html.toString('base64') };
    }

    // 5) envio
    const dados = { subject: assunto, html: corpoHtml, ...(anexo ? { attachments: [anexo] } : {}) };
    let resposta;
    if (process.env.RESEND_API_KEY) {
      resposta = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.ALERTA_EMAIL_FROM || 'Central de Fretes <onboarding@resend.dev>',
          to: para, ...(copia.length ? { cc: copia, reply_to: copia[0] } : {}), ...dados,
        }),
      });
    } else if (process.env.ALERTA_EMAIL_TOKEN) {
      const centralUrl = process.env.CENTRAL_SOLICITACOES_SUPABASE_URL || process.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_URL || 'https://zejguyckbnmyxkuagsyj.supabase.co';
      const centralKey = process.env.CENTRAL_SOLICITACOES_SUPABASE_KEY || process.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_KEY || 'sb_publishable_J0i_Olz3JBp_86-Xcd4MPQ_uH5vnHUS';
      // A funcao da Central ainda nao tem campo de copia: o auditor vai junto no "para".
      resposta = await fetch(`${centralUrl}/functions/v1/alerta-cte-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${centralKey}`, apikey: centralKey, 'x-alerta-token': process.env.ALERTA_EMAIL_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [...para, ...copia], ...dados }),
      });
    } else {
      return res.status(500).json({ ok: false, erro: 'Nenhum provedor de e-mail configurado (RESEND_API_KEY ou ALERTA_EMAIL_TOKEN).' });
    }
    if (!resposta.ok) {
      const detalhe = await resposta.text().catch(() => '');
      return res.status(502).json({ ok: false, erro: `Provedor de e-mail recusou o envio (${resposta.status}). ${detalhe.slice(0, 300)}` });
    }

    // 6) marca como enviado e registra no historico de cada fatura
    const agora = new Date().toISOString();
    const { error: e3 } = await db.from('auditor_robo_execucoes')
      .update({ acao_executada: true, modo: 'EMAIL_ENVIADO', executado_por: origem === 'auto' ? 'Robo (e-mail automatico)' : 'Robo (e-mail manual)', executado_em: agora, destinatarios: para.join('; '), copia: copia.join('; ') })
      .in('fatura_id', ids);
    if (e3) console.warn('[enviar-laudo-robo] enviado, mas nao marcou as execucoes:', e3.message);
    const hist = ids.map((id) => ({
      id: globalThis.crypto.randomUUID(), fatura_id: id, created_at: agora, acao: 'LAUDO_ENVIADO_POR_EMAIL',
      descricao: `Laudo ${reenvio ? 'REENVIADO' : 'enviado'} por e-mail ao transportador (${origem === 'auto' ? 'automatico apos o OK do auditor' : (reenvio ? 'reenvio manual pelo robo' : 'envio manual pelo robo')}). Para: ${para.join(', ')}${copia.length ? `. Copia/auditor: ${copia.join(', ')}` : ''}. Assunto: ${assunto}`,
      usuario_nome: 'Robo Auditor', usuario_email: '',
    }));
    const { error: e4 } = await db.from('auditoria_fatura_historico').insert(hist);
    if (e4) console.warn('[enviar-laudo-robo] historico nao registrado:', e4.message);

    return res.status(200).json({ ok: true, faturas: ids.length, para, copia, reenvio });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || String(e) });
  }
}
