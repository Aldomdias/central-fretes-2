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
import XLSX from 'xlsx-js-style';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

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

const OCULTAS_BASE = new Set([
  'numero_cte', 'data_emissao', 'transportadora', 'tomador_servico', 'canal', 'valor_cte', 'valor_nf', 'peso',
  'valor_calculado', 'diferenca', 'cidade_origem', 'uf_origem', 'cidade_destino', 'uf_destino',
]);
const FMT = { moeda: '"R$" #,##0.00;[Red]-"R$" #,##0.00', num: '#,##0.00', int: '#,##0', data: 'dd/mm/yyyy' };

function tipoColunaBase(chave) {
  if (/^(valor|diferenca|frete)/.test(chave)) return 'moeda';
  if (/(peso|cubagem|percentual)/.test(chave)) return 'num';
  if (/^qtd/.test(chave)) return 'int';
  if (/^data/.test(chave)) return 'data';
  return 'texto';
}

function serialData(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 + 25569 : null;
}

// Planilha formatada: cabecalho colorido, linhas zebradas, R$ nos valores, datas reais,
// filtro e titulo congelado. `porChave` traz a linha completa da base de cada CT-e.
function montarPlanilha(alertas, porChave) {
  const colunas = [
    { t: 'CT-e', tipo: 'texto', get: (a) => a.numero_cte },
    { t: 'Emissão', tipo: 'data', get: (a) => a.data_emissao },
    { t: 'Transportadora', tipo: 'texto', get: (a) => a.transportadora },
    { t: 'Tomador', tipo: 'texto', get: (a) => a.tomador_servico },
    { t: 'Canal', tipo: 'texto', get: (a) => a.canal },
    { t: 'Valor cobrado', tipo: 'moeda', get: (a) => Number(a.valor_cte) },
    { t: 'Valor da NF', tipo: 'moeda', get: (a) => a.valor_nf },
    { t: 'Peso (kg)', tipo: 'num', get: (a) => a.peso },
    { t: 'Cálculo Verum', tipo: 'moeda', get: (a) => (a.valor_calculado_verum == null ? 'SEM CÁLCULO' : Number(a.valor_calculado_verum)) },
    { t: 'Diferença vs Verum', tipo: 'moeda', get: (a) => a.diferenca_verum },
    { t: 'Verum para conferir', tipo: 'texto', get: (a) => (verumSuspeito(a) ? 'SIM' : '') },
    { t: 'Origem', tipo: 'texto', get: (a) => [a.cidade_origem, a.uf_origem].filter(Boolean).join('/') },
    { t: 'Destino', tipo: 'texto', get: (a) => [a.cidade_destino, a.uf_destino].filter(Boolean).join('/') },
    { t: 'Status do alerta', tipo: 'texto', get: (a) => a.status },
  ];
  const chavesBase = [];
  alertas.forEach((a) => Object.keys(porChave.get(a.chave_cte) || {}).forEach((k) => {
    if (COLUNAS_OCULTAS.has(k) || OCULTAS_BASE.has(k) || chavesBase.includes(k)) return;
    if (alertas.some((x) => { const v = (porChave.get(x.chave_cte) || {})[k]; return v != null && v !== '' && typeof v !== 'object'; })) chavesBase.push(k);
  }));
  chavesBase.forEach((k) => colunas.push({
    t: k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    tipo: tipoColunaBase(k),
    get: (a) => (porChave.get(a.chave_cte) || {})[k],
  }));

  const borda = { style: 'thin', color: { rgb: 'D9E1F2' } };
  const bordas = { top: borda, bottom: borda, left: borda, right: borda };
  const ws = {};
  colunas.forEach((c, ci) => {
    ws[XLSX.utils.encode_cell({ r: 0, c: ci })] = {
      t: 's', v: c.t,
      s: { font: { bold: true, color: { rgb: 'FFFFFF' }, name: 'Calibri', sz: 11 }, fill: { fgColor: { rgb: '1F3864' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bordas },
    };
  });
  const largura = colunas.map((c) => c.t.length + 4);
  alertas.forEach((a, ri) => {
    const fundo = ri % 2 ? { fgColor: { rgb: 'F2F6FC' } } : { fgColor: { rgb: 'FFFFFF' } };
    colunas.forEach((c, ci) => {
      let v = c.get(a);
      const estilo = { fill: fundo, border: bordas, font: { name: 'Calibri', sz: 10 }, alignment: { vertical: 'top' } };
      let cel;
      if (v == null || v === '') {
        cel = { t: 's', v: '', s: estilo };
      } else if (c.tipo === 'data') {
        const serial = serialData(v);
        cel = serial == null ? { t: 's', v: String(v), s: estilo } : { t: 'n', v: serial, z: FMT.data, s: { ...estilo, alignment: { horizontal: 'center' } } };
      } else if (['moeda', 'num', 'int'].includes(c.tipo) && Number.isFinite(Number(v)) && typeof v !== 'boolean') {
        cel = { t: 'n', v: Number(v), z: FMT[c.tipo], s: estilo };
      } else {
        const texto = String(v);
        cel = { t: 's', v: texto, s: texto === 'SIM' || texto === 'SEM CÁLCULO' ? { ...estilo, font: { ...estilo.font, bold: true, color: { rgb: 'B45309' } } } : estilo };
      }
      if (c.t === 'Valor cobrado') cel.s = { ...cel.s, font: { ...cel.s.font, bold: true } };
      ws[XLSX.utils.encode_cell({ r: ri + 1, c: ci })] = cel;
      largura[ci] = Math.max(largura[ci], Math.min(42, String(cel.t === 'n' ? '99.999.999,99' : cel.v).length + 3));
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: alertas.length, c: colunas.length - 1 } });
  ws['!cols'] = largura.map((wch) => ({ wch }));
  ws['!rows'] = [{ hpt: 30 }];
  ws['!autofilter'] = { ref: ws['!ref'] };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CT-e acima do target');
  return congelarTitulo(Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))).toString('base64');
}

// A biblioteca de estilos nao grava "congelar painel": injeta no XML da planilha
// (cabecalho + 3 primeiras colunas fixos ao rolar).
function congelarTitulo(buffer) {
  try {
    const arquivos = unzipSync(new Uint8Array(buffer));
    const nome = 'xl/worksheets/sheet1.xml';
    const xml = strFromU8(arquivos[nome]).replace(
      /<sheetView workbookViewId="0"\/>/,
      '<sheetView workbookViewId="0"><pane xSplit="3" ySplit="1" topLeftCell="D2" activePane="bottomRight" state="frozen"/></sheetView>',
    );
    arquivos[nome] = strToU8(xml);
    return Buffer.from(zipSync(arquivos));
  } catch {
    return buffer;
  }
}

// Planilha com TODAS as colunas que a base tem do CT-e, mais as colunas de analise na frente.
async function xlsxAnexo(supabase, alertas) {
  const porChave = new Map();
  const chaves = alertas.map((a) => a.chave_cte).filter(Boolean);
  for (let i = 0; i < chaves.length; i += 150) {
    const { data } = await supabase.from('realizado_local_ctes').select('*').in('chave_cte', chaves.slice(i, i + 150));
    (data || []).forEach((r) => porChave.set(r.chave_cte, r));
  }
  return montarPlanilha(alertas, porChave);
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

export { montarPlanilha };

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
