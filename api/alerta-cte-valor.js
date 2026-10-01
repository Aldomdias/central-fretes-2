/**
 * Envio por e-mail dos CT-e de valor alto (alerta de anomalia).
 *
 * POST /api/alerta-cte-valor
 * Pega os alertas ainda nao enviados (cte_alertas_valor.email_enviado_em is null),
 * manda UM e-mail resumo para os destinatarios cadastrados na tela e marca como enviados.
 * Nao aceita destinatario nem conteudo do cliente: tudo vem do banco, entao a rota
 * nao serve para disparar e-mail para terceiros.
 *
 * Envio: funcao resend-email da Central de Solicitacoes (padrao) ou Resend proprio se houver
 * RESEND_API_KEY. Variaveis no Vercel: SUPABASE_SERVICE_ROLE_KEY e (opcional)
 * ALERTA_EMAIL_FROM (ex.: "Central de Fretes <alertas@seudominio.com.br>"),
 * APP_URL (link para a tela no e-mail).
 */
import { createClient } from '@supabase/supabase-js';

const MAX_LINHAS_EMAIL = 100;

function getClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error('Variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const num = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');

function blocoVerum(a) {
  if (a.valor_calculado_verum == null) {
    return '<span style="color:#b45309;font-weight:600">Sem cálculo na Verum</span>';
  }
  const dif = Number(a.diferenca_verum || 0);
  const pct = Number(a.valor_calculado_verum) > 0 ? (dif / Number(a.valor_calculado_verum)) * 100 : 0;
  const cor = Math.abs(dif) <= 1 ? '#15803d' : '#b91c1c';
  const rotulo = Math.abs(dif) <= 1 ? 'bate com o cobrado' : (dif > 0 ? 'cobrado acima do calculado' : 'cobrado abaixo do calculado');
  return `Calculado: <strong>${brl(a.valor_calculado_verum)}</strong><br><span style="color:${cor}">${dif >= 0 ? '+' : ''}${brl(dif)} (${pct.toFixed(1)}%) — ${rotulo}</span>`;
}

function csvAnexo(alertas) {
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const n = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
  const cab = ['CT-e', 'Emissão', 'Transportadora', 'Canal', 'Origem', 'UF origem', 'Destino', 'UF destino', 'Peso (kg)', 'Valor NF', 'Valor cobrado', 'Calculado Verum', 'Diferença vs Verum', 'Chave CT-e'];
  const linhas = alertas.map((a) => [
    a.numero_cte, dataBr(a.data_emissao), a.transportadora, a.canal, a.cidade_origem, a.uf_origem, a.cidade_destino, a.uf_destino,
    n(a.peso), n(a.valor_nf), n(a.valor_cte), a.valor_calculado_verum == null ? 'SEM CÁLCULO' : n(a.valor_calculado_verum), n(a.diferenca_verum), a.chave_cte,
  ].map(cel).join(';'));
  const texto = `﻿${[cab.map(cel).join(';'), ...linhas].join('\r\n')}`;
  return Buffer.from(texto, 'utf8').toString('base64');
}

function resumoTexto(alertas, limiar) {
  const total = alertas.reduce((s, a) => s + Number(a.valor_cte || 0), 0);
  const verum = (a) => (a.valor_calculado_verum == null
    ? 'sem cálculo Verum'
    : `Verum ${brl(a.valor_calculado_verum)} (dif. ${brl(a.diferenca_verum)})`);
  const linhas = alertas.slice(0, 30).map((a) => `CT-e ${a.numero_cte || '—'} | ${a.transportadora || '—'} | ${a.canal || '—'} | ${num(a.peso)} kg | NF ${brl(a.valor_nf)} | cobrado ${brl(a.valor_cte)} | ${verum(a)}`);
  const resto = alertas.length > 30 ? ` (+ ${alertas.length - 30} CT-e(s) na tela de alertas)` : '';
  return `${alertas.length} CT-e(s) acima de ${brl(limiar)}, somando ${brl(total)}${resto}. ${linhas.join(' • ')}`;
}

function montarHtml(alertas, limiar, link) {
  const total = alertas.reduce((s, a) => s + Number(a.valor_cte || 0), 0);
  const exibidos = alertas.slice(0, MAX_LINHAS_EMAIL);
  const th = 'text-align:left;padding:6px 8px;background:#f1f5f9;border-bottom:1px solid #cbd5e1;font-size:12px;white-space:nowrap';
  const td = 'padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;vertical-align:top';
  const linhas = exibidos.map((a) => `<tr>
<td style="${td}"><strong>${esc(a.numero_cte || '—')}</strong><br><span style="color:#64748b">${dataBr(a.data_emissao)}</span></td>
<td style="${td}">${esc(a.transportadora || '—')}</td>
<td style="${td}">${esc(a.canal || '—')}</td>
<td style="${td}">${esc([a.cidade_origem, a.uf_origem].filter(Boolean).join('/') || '—')}<br>→ ${esc([a.cidade_destino, a.uf_destino].filter(Boolean).join('/') || '—')}</td>
<td style="${td};text-align:right">${num(a.peso)} kg</td>
<td style="${td};text-align:right">${brl(a.valor_nf)}</td>
<td style="${td};text-align:right"><strong>${brl(a.valor_cte)}</strong></td>
<td style="${td}">${blocoVerum(a)}</td>
</tr>`).join('');
  const resto = alertas.length - exibidos.length;
  return `<div style="font-family:Arial,sans-serif;color:#0f172a">
<h2 style="margin:0 0 6px">CT-e acima de ${brl(limiar)} na importação</h2>
<p style="margin:0 0 14px;color:#475569">${alertas.length} CT-e(s) somando <strong>${brl(total)}</strong>. Confira se há anomalia antes do fechamento.</p>
<table style="border-collapse:collapse;width:100%"><thead><tr>
<th style="${th}">CT-e</th><th style="${th}">Transportadora</th><th style="${th}">Canal</th><th style="${th}">Rota</th>
<th style="${th}">Peso</th><th style="${th}">Valor da NF</th><th style="${th}">Valor cobrado</th><th style="${th}">Cálculo Verum</th>
</tr></thead><tbody>${linhas}</tbody></table>
${resto > 0 ? `<p style="color:#475569">+ ${resto} CT-e(s) não listados aqui — veja todos na planilha em anexo.</p>` : ''}
${link ? `<p style="margin-top:14px"><a href="${esc(link)}">Abrir a tela de alertas</a></p>` : ''}
</div>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }
  try {

    const supabase = getClient();
    const { data: cfg } = await supabase.from('cte_alerta_config').select('*').eq('id', 1).maybeSingle();
    if (!cfg?.ativo || !cfg?.enviar_email) return res.status(200).json({ ok: true, enviados: 0, aviso: 'Envio de e-mail desativado.' });

    const destinatarios = String(cfg.emails || '').split(/[;,\s]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!destinatarios.length) return res.status(200).json({ ok: true, enviados: 0, aviso: 'Nenhum e-mail destinatário cadastrado.' });

    const { data: alertas, error } = await supabase
      .from('cte_alertas_valor')
      .select('*')
      .is('email_enviado_em', null)
      .order('valor_cte', { ascending: false })
      .limit(1000);
    if (error) throw error;
    if (!alertas?.length) return res.status(200).json({ ok: true, enviados: 0 });

    const limiar = Number(cfg.limiar || 10000);
    const appUrl = process.env.APP_URL || (req.headers.host ? `https://${req.headers.host}` : '');
    const assunto = `[Alerta] ${alertas.length} CT-e acima de ${brl(limiar)} na importação`;
    const html = montarHtml(alertas, limiar, appUrl);
    const anexo = { filename: `cte-acima-${limiar}-${new Date().toISOString().slice(0, 10)}.csv`, content: csvAnexo(alertas) };

    if (process.env.RESEND_API_KEY) {
      // Resend proprio (HTML completo + planilha anexa).
      const resposta = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.ALERTA_EMAIL_FROM || 'Central de Fretes <onboarding@resend.dev>',
          to: destinatarios,
          subject: assunto,
          html,
          attachments: [anexo],
        }),
      });
      if (!resposta.ok) {
        const detalhe = await resposta.text().catch(() => '');
        return res.status(502).json({ ok: false, erro: `Provedor de e-mail recusou o envio (${resposta.status}). ${detalhe.slice(0, 300)}` });
      }
    } else {
      // Envio da Central de Solicitacoes (funcao "resend-email" do Supabase dela).
      // Ela aceita {to, nome, protocolo, status, mensagem, link}; html/anexo vao junto e
      // so aparecem se a funcao for estendida para usa-los.
      const centralUrl = process.env.CENTRAL_SOLICITACOES_SUPABASE_URL || process.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_URL || 'https://zejguyckbnmyxkuagsyj.supabase.co';
      const centralKey = process.env.CENTRAL_SOLICITACOES_SUPABASE_KEY || process.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_KEY || 'sb_publishable_J0i_Olz3JBp_86-Xcd4MPQ_uH5vnHUS';
      const mensagem = resumoTexto(alertas, limiar);
      for (const to of destinatarios) {
        const resposta = await fetch(`${centralUrl}/functions/v1/resend-email`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${centralKey}`, apikey: centralKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to, nome: 'Controle de CT-e', protocolo: `ALERTA-CTE-${new Date().toISOString().slice(0, 10)}`,
            status: assunto, mensagem, link: appUrl, subject: assunto, html, attachments: [anexo],
          }),
        });
        if (!resposta.ok) {
          const detalhe = await resposta.text().catch(() => '');
          return res.status(502).json({ ok: false, erro: `Envio da Central de Solicitações recusou (${resposta.status}). ${detalhe.slice(0, 300)}` });
        }
      }
    }

    const ids = alertas.map((a) => a.id);
    await supabase.from('cte_alertas_valor').update({ email_enviado_em: new Date().toISOString() }).in('id', ids);
    return res.status(200).json({ ok: true, enviados: alertas.length, destinatarios: destinatarios.length });
  } catch (error) {
    return res.status(500).json({ ok: false, erro: error?.message || 'Erro ao enviar alerta.' });
  }
}
