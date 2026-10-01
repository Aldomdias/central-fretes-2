/**
 * Envio por e-mail dos CT-e de valor alto (alerta de anomalia).
 *
 * POST /api/alerta-cte-valor
 * Pega os alertas ainda nao enviados (cte_alertas_valor.email_enviado_em is null),
 * manda UM e-mail resumo para os destinatarios cadastrados na tela, com uma planilha
 * Excel anexa (todas as colunas da base), e marca como enviados.
 * Nao aceita destinatario nem conteudo do cliente: tudo vem do banco, entao a rota
 * nao serve para disparar e-mail para terceiros.
 *
 * Envio (modelo proprio + Excel anexo): Resend direto (RESEND_API_KEY + ALERTA_EMAIL_FROM) ou a
 * funcao "alerta-cte-email" do Supabase da Central (ALERTA_EMAIL_TOKEN; supabase/central-solicitacoes/).
 * Sem nenhum dos dois, cai no "resend-email" da Central de Solicitacoes (modelo fixo de chamado,
 * so texto, sem anexo).
 * Variaveis no Vercel: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ALERTA_EMAIL_FROM, APP_URL.
 */
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const LINHAS_NO_CORPO = 10;
const COLUNAS_OCULTAS = new Set(['id', 'raw', 'created_at', 'updated_at', 'inserted_at']);

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

// Verum "inconsistente": calculado muito diferente do cobrado costuma ser dado ruim, nao frete.
function verumSuspeito(a) {
  const calc = Number(a.valor_calculado_verum);
  const cobrado = Number(a.valor_cte);
  return calc > 0 && cobrado > 0 && (calc > cobrado * 3 || calc < cobrado / 3);
}

function textoVerum(a) {
  if (a.valor_calculado_verum == null) return 'Sem cálculo na Verum';
  const dif = Number(a.diferenca_verum || 0);
  return `${brl(a.valor_calculado_verum)} (${dif >= 0 ? '+' : ''}${brl(dif)})${verumSuspeito(a) ? ' — conferir' : ''}`;
}

// Planilha com TODAS as colunas que a base tem do CT-e, mais as colunas de analise na frente.
async function xlsxAnexo(supabase, alertas) {
  const porChave = new Map();
  const chaves = alertas.map((a) => a.chave_cte).filter(Boolean);
  for (let i = 0; i < chaves.length; i += 150) {
    const { data } = await supabase.from('realizado_local_ctes').select('*').in('chave_cte', chaves.slice(i, i + 150));
    (data || []).forEach((r) => porChave.set(r.chave_cte, r));
  }

  const linhas = alertas.map((a) => {
    const base = porChave.get(a.chave_cte) || {};
    const linha = {
      'CT-e': a.numero_cte,
      'Emissão': dataBr(a.data_emissao),
      Transportadora: a.transportadora,
      Canal: a.canal,
      'Valor cobrado': Number(a.valor_cte),
      'Valor da NF': a.valor_nf == null ? null : Number(a.valor_nf),
      'Peso (kg)': a.peso == null ? null : Number(a.peso),
      'Cálculo Verum': a.valor_calculado_verum == null ? 'SEM CÁLCULO' : Number(a.valor_calculado_verum),
      'Diferença vs Verum': a.diferenca_verum == null ? null : Number(a.diferenca_verum),
      'Verum para conferir': verumSuspeito(a) ? 'SIM' : '',
      Origem: [a.cidade_origem, a.uf_origem].filter(Boolean).join('/'),
      Destino: [a.cidade_destino, a.uf_destino].filter(Boolean).join('/'),
      'Status do alerta': a.status,
    };
    Object.entries(base).forEach(([k, v]) => {
      if (COLUNAS_OCULTAS.has(k) || v == null || typeof v === 'object') return;
      linha[`base_${k}`] = v;
    });
    return linha;
  });

  // Une todas as colunas (algumas linhas podem nao ter campos que outras tem).
  const cab = [];
  linhas.forEach((l) => Object.keys(l).forEach((k) => { if (!cab.includes(k)) cab.push(k); }));
  const ws = XLSX.utils.json_to_sheet(linhas, { header: cab });
  ws['!cols'] = cab.map((c) => ({ wch: Math.min(40, Math.max(12, c.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CT-e acima do target');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })).toString('base64');
}

function resumoTexto(alertas, limiar) {
  const total = alertas.reduce((s, a) => s + Number(a.valor_cte || 0), 0);
  const linhas = alertas.slice(0, LINHAS_NO_CORPO).map((a) => `CT-e ${a.numero_cte || '—'} | ${a.transportadora || '—'} | ${a.canal || '—'} | cobrado ${brl(a.valor_cte)} | ${textoVerum(a)}`);
  const resto = alertas.length > LINHAS_NO_CORPO ? ` (+ ${alertas.length - LINHAS_NO_CORPO} na tela de alertas)` : '';
  return `${alertas.length} CT-e(s) acima do target de ${brl(limiar)}, somando ${brl(total)}${resto}. ${linhas.join(' • ')}`;
}

function montarHtml(alertas, limiar, link) {
  const total = alertas.reduce((s, a) => s + Number(a.valor_cte || 0), 0);
  const semVerum = alertas.filter((a) => a.valor_calculado_verum == null).length;
  const conferir = alertas.filter(verumSuspeito).length;
  const exibidos = alertas.slice(0, LINHAS_NO_CORPO);
  const th = 'text-align:left;padding:6px 8px;background:#f1f5f9;border-bottom:1px solid #cbd5e1;font-size:12px;white-space:nowrap';
  const td = 'padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;vertical-align:top';
  const linhas = exibidos.map((a) => `<tr>
<td style="${td}"><strong>${esc(a.numero_cte || '—')}</strong><br><span style="color:#64748b">${dataBr(a.data_emissao)}</span></td>
<td style="${td}">${esc(a.transportadora || '—')}<br><span style="color:#64748b">${esc(a.canal || '—')}</span></td>
<td style="${td};text-align:right">${num(a.peso)} kg</td>
<td style="${td};text-align:right">${brl(a.valor_nf)}</td>
<td style="${td};text-align:right"><strong>${brl(a.valor_cte)}</strong></td>
<td style="${td}">${a.valor_calculado_verum == null ? '<span style="color:#b45309;font-weight:600">Sem cálculo na Verum</span>' : esc(textoVerum(a))}</td>
</tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:900px">
<p style="margin:0 0 10px">Olá,</p>
<p style="margin:0 0 10px">Segue a relação de CT-e emitidos com <strong>valor acima do target de ${brl(limiar)}</strong>, identificados na última importação. Em anexo está a base completa em Excel, com todas as informações disponíveis de cada CT-e.</p>
<ul style="margin:0 0 14px;padding-left:18px">
<li><strong>${alertas.length}</strong> CT-e(s), somando <strong>${brl(total)}</strong></li>
<li><strong>${semVerum}</strong> sem cálculo na Verum${conferir ? `; <strong>${conferir}</strong> com cálculo muito diferente do cobrado (conferir)` : ''}</li>
</ul>
<p style="margin:0 0 6px;color:#475569">Maiores valores (${exibidos.length} de ${alertas.length}):</p>
<table style="border-collapse:collapse;width:100%"><thead><tr>
<th style="${th}">CT-e</th><th style="${th}">Transportadora / canal</th><th style="${th}">Peso</th><th style="${th}">Valor da NF</th><th style="${th}">Valor cobrado</th><th style="${th}">Cálculo Verum</th>
</tr></thead><tbody>${linhas}</tbody></table>
${link ? `<p style="margin-top:14px">Para marcar como verificado ou anomalia, acesse a tela <a href="${esc(link)}">Alerta CT-e valor alto</a>.</p>` : ''}
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

    // Sem ids: so os ainda nao enviados (fluxo da importacao). Com ids (tela): exatamente esses,
    // mesmo os ja enviados antes (reenvio). Os destinatarios sempre vem da configuracao.
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))].slice(0, 2000)
      : null;
    let alertas = [];
    if (ids) {
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from('cte_alertas_valor').select('*').in('id', ids.slice(i, i + 200));
        if (error) throw error;
        alertas.push(...(data || []));
      }
      alertas.sort((x, y) => Number(y.valor_cte) - Number(x.valor_cte));
    } else {
      const { data, error } = await supabase
        .from('cte_alertas_valor')
        .select('*')
        .is('email_enviado_em', null)
        .order('valor_cte', { ascending: false })
        .limit(2000);
      if (error) throw error;
      alertas = data || [];
    }
    if (!alertas.length) return res.status(200).json({ ok: true, enviados: 0 });

    const limiar = Number(cfg.limiar || 10000);
    const appUrl = process.env.APP_URL || (req.headers.host ? `https://${req.headers.host}` : '');
    const hoje = new Date().toISOString().slice(0, 10);
    const assunto = `CT-e acima do target de ${brl(limiar)} — ${alertas.length} CT-e(s) na importação`;
    const html = montarHtml(alertas, limiar, appUrl);

    const centralUrl = process.env.CENTRAL_SOLICITACOES_SUPABASE_URL || process.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_URL || 'https://zejguyckbnmyxkuagsyj.supabase.co';
    const centralKey = process.env.CENTRAL_SOLICITACOES_SUPABASE_KEY || process.env.VITE_CENTRAL_SOLICITACOES_SUPABASE_KEY || 'sb_publishable_J0i_Olz3JBp_86-Xcd4MPQ_uH5vnHUS';

    if (process.env.RESEND_API_KEY || process.env.ALERTA_EMAIL_TOKEN) {
      const anexo = { filename: `cte-acima-do-target-${hoje}.xlsx`, content: await xlsxAnexo(supabase, alertas) };
      const dados = { to: destinatarios, subject: assunto, html, attachments: [anexo] };
      // Resend direto, ou a funcao "alerta-cte-email" do Supabase da Central (usa a chave de la).
      const resposta = process.env.RESEND_API_KEY
        ? await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: process.env.ALERTA_EMAIL_FROM || 'Central de Fretes <onboarding@resend.dev>', ...dados }),
        })
        : await fetch(`${centralUrl}/functions/v1/alerta-cte-email`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${centralKey}`, apikey: centralKey, 'x-alerta-token': process.env.ALERTA_EMAIL_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(dados),
        });
      if (!resposta.ok) {
        const detalhe = await resposta.text().catch(() => '');
        return res.status(502).json({ ok: false, erro: `Provedor de e-mail recusou o envio (${resposta.status}). ${detalhe.slice(0, 300)}` });
      }
    } else {
      // Plano B: funcao "resend-email" da Central de Solicitacoes (modelo fixo, so texto).
      const mensagem = resumoTexto(alertas, limiar);
      for (const to of destinatarios) {
        const resposta = await fetch(`${centralUrl}/functions/v1/resend-email`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${centralKey}`, apikey: centralKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, nome: 'Controle de CT-e', protocolo: `ALERTA-CTE-${hoje}`, status: assunto, mensagem, link: appUrl }),
        });
        if (!resposta.ok) {
          const detalhe = await resposta.text().catch(() => '');
          return res.status(502).json({ ok: false, erro: `Envio da Central de Solicitações recusou (${resposta.status}). ${detalhe.slice(0, 300)}` });
        }
      }
    }

    const enviadosIds = alertas.map((a) => a.id);
    for (let i = 0; i < enviadosIds.length; i += 200) {
      await supabase.from('cte_alertas_valor').update({ email_enviado_em: new Date().toISOString() }).in('id', enviadosIds.slice(i, i + 200));
    }
    return res.status(200).json({ ok: true, enviados: alertas.length, destinatarios: destinatarios.length });
  } catch (error) {
    return res.status(500).json({ ok: false, erro: error?.message || 'Erro ao enviar alerta.' });
  }
}
