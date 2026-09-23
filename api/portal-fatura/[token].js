/**
 * Portal de confirmacao de fatura pelo fornecedor/transportador.
 *
 * Mesma razao de ser do api/portal/[token].js (CT-es): funcao serverless com
 * a service_role no servidor, pra transportadora nao ter acesso ao app nem
 * a dados de outras transportadoras — so ve o resumo desta fatura.
 *
 * GET  /api/portal-fatura/<token>  -> pagina de confirmacao
 * POST /api/portal-fatura/<token>  -> transportador clicou "OK" -> aplica
 *                                      direto na fatura (sem validacao manual
 *                                      do auditor, diferente do portal de CT-es).
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

function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBr(valor) {
  if (!valor) return '-';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : String(valor);
}

function paginaErro(titulo, detalhe) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<style>body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.box{max-width:520px;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:32px;text-align:center}
h1{margin:0 0 10px;font-size:20px}p{color:#475569;line-height:1.5}</style></head>
<body><div class="box"><h1>${esc(titulo)}</h1><p>${esc(detalhe)}</p></div></body></html>`;
}

async function carregarFatura(supabase, token) {
  const { data: fatura, error } = await supabase
    .from('faturas')
    .select('id, numero_fatura, transportadora, valor_fatura, valor_calculado, diferenca, data_vencimento, status, confirmacao_transportador_status, confirmacao_transportador_em, confirmacao_transportador_por, confirmacao_transportador_token')
    .eq('confirmacao_transportador_token', token)
    .maybeSingle();
  if (error) throw error;
  if (!fatura) return { erro: { titulo: 'Link inválido', detalhe: 'Este link de confirmação não foi encontrado. Solicite um novo link ao time de auditoria.' } };
  return { fatura };
}

function paginaPortalFatura({ fatura, enviado }) {
  const saldo = Math.max(Number(fatura.diferenca || 0), 0);
  const jaAprovada = fatura.confirmacao_transportador_status === 'APROVADO';
  const aviso = enviado
    ? `<div class="ok">✅ Confirmação recebida. Obrigado! O time de auditoria já foi notificado e vai seguir com o pagamento.</div>`
    : (jaAprovada
      ? `<div class="ok">✅ Esta fatura já foi confirmada em ${esc(dataBr(fatura.confirmacao_transportador_em))}${fatura.confirmacao_transportador_por ? ` por ${esc(fatura.confirmacao_transportador_por)}` : ''}. Não é necessário confirmar de novo.</div>`
      : '');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirmação de fatura — ${esc(fatura.transportadora || 'Transportadora')}</title>
<style>
body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
.page{max-width:640px;margin:24px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}
header{padding:26px 30px;background:#06183d;color:#fff}
header h1{margin:0 0 6px;font-size:22px}header p{margin:3px 0;color:#cbd5e1;font-size:14px}
.resumo{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:18px 30px;background:#f8fafc}
.card{padding:12px;border:1px solid #dbe3ef;border-radius:9px;background:#fff}
.card small{display:block;color:#64748b;margin-bottom:4px}.card strong{font-size:18px}
.destaque{color:#b91c1c}
.intro{padding:18px 30px;line-height:1.55}
.ok{margin:0 30px 16px;padding:14px;background:#dcfce7;border:1px solid #86efac;border-radius:9px;color:#065f46;font-weight:700}
form{padding:0 30px 26px}
.quem{margin-bottom:14px}
.quem label{display:block;font-size:12px;color:#64748b;margin-bottom:4px}
.quem input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px}
button{border:0;border-radius:9px;background:#0f6b3e;color:#fff;font-weight:700;padding:14px 22px;cursor:pointer;font-size:15px;width:100%}
button:hover{background:#0c5732}
button:disabled{background:#94a3b8;cursor:not-allowed}
footer{padding:16px 30px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0}
</style></head><body>
<main class="page">
  <header>
    <h1>Confirmação de fatura</h1>
    <p>Fatura ${esc(fatura.numero_fatura)} — ${esc(fatura.transportadora || 'Transportadora')}</p>
    <p>Vencimento ${esc(dataBr(fatura.data_vencimento))}</p>
  </header>
  <div class="resumo">
    <div class="card"><small>Valor cobrado</small><strong>${dinheiro(fatura.valor_fatura)}</strong></div>
    <div class="card"><small>Calculado pela auditoria</small><strong>${dinheiro(fatura.valor_calculado)}</strong></div>
    <div class="card"><small>Desconto identificado</small><strong class="${saldo > 0 ? 'destaque' : ''}">${dinheiro(saldo)}</strong></div>
    <div class="card"><small>Status atual</small><strong>${esc((fatura.status || '').replaceAll('_', ' '))}</strong></div>
  </div>
  ${aviso}
  <div class="intro">
    <p>${saldo > 0
      ? `Identificamos cobrança a maior de <b>${dinheiro(saldo)}</b> nesta fatura em relação ao valor calculado pela auditoria. Ao confirmar, você concorda que esse desconto seja aplicado no pagamento.`
      : 'Esta fatura já foi auditada e o valor calculado bate com o valor cobrado. Ao confirmar, você reconhece a fatura para seguirmos com o pagamento.'}</p>
  </div>
  ${!jaAprovada ? `<form method="POST">
    <div class="quem">
      <label for="respondido_por">Quem está confirmando (nome e e-mail)</label>
      <input type="text" id="respondido_por" name="respondido_por" placeholder="Nome — email@transportadora.com.br" required>
    </div>
    <button type="submit">OK, confirmo esta fatura</button>
  </form>` : ''}
  <footer>Central Fretes · Este link é exclusivo desta fatura e não dá acesso a nenhum outro dado.</footer>
</main></body></html>`;
}

function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return Object.fromEntries(new URLSearchParams(req.body));
  return {};
}

export default async function handler(req, res) {
  const { token } = req.query;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!token) {
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Link inválido', 'Token não informado.'));
  }

  let supabase;
  try {
    supabase = getClient();
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Portal indisponível', error.message));
  }

  try {
    const contexto = await carregarFatura(supabase, token);
    if (contexto.erro) {
      res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaErro(contexto.erro.titulo, contexto.erro.detalhe));
    }

    if (req.method === 'GET') {
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaPortalFatura({ fatura: contexto.fatura, enviado: false }));
    }

    if (req.method === 'POST') {
      const { fatura } = contexto;
      if (fatura.confirmacao_transportador_status !== 'APROVADO') {
        const corpo = lerCorpo(req);
        const respondidoPor = String(corpo.respondido_por || '').slice(0, 200) || null;
        const agora = new Date().toISOString();
        await supabase
          .from('faturas')
          .update({
            confirmacao_transportador_status: 'APROVADO',
            confirmacao_transportador_em: agora,
            confirmacao_transportador_por: respondidoPor,
            updated_at: agora,
          })
          .eq('id', fatura.id);

        await supabase.from('auditoria_fatura_historico').insert({
          fatura_id: fatura.id,
          created_at: agora,
          acao: 'CONFIRMACAO_TRANSPORTADOR_PORTAL',
          descricao: `Transportador confirmou a fatura pelo link de conferência${respondidoPor ? ` (${respondidoPor})` : ''}.`,
          usuario_nome: respondidoPor || 'Portal do transportador',
        });
      }

      const atualizado = await carregarFatura(supabase, token);
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaPortalFatura({ fatura: atualizado.fatura, enviado: true }));
    }

    res.status(405).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Método não permitido', 'Use o link enviado por e-mail.'));
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Erro ao processar', error.message || String(error)));
  }
}
