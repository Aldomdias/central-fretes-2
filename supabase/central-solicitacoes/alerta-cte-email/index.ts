// Edge Function "alerta-cte-email" -- para publicar no Supabase da CENTRAL DE SOLICITACOES
// (projeto zejguyckbnmyxkuagsyj), ao lado da "resend-email".
//
// Por que existe: a "resend-email" tem modelo fixo de atualizacao de chamado. Esta aqui
// reaproveita a MESMA chave do Resend (secret RESEND_API_KEY do projeto), mas envia o
// e-mail de alerta de CT-e com HTML proprio e anexo Excel, montados pelo sistema de fretes.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   RESEND_API_KEY      -- ja existe (usada pela resend-email)
//   ALERTA_TOKEN        -- NOVO: senha compartilhada com o Vercel (var ALERTA_EMAIL_TOKEN)
//   ALERTA_EMAIL_FROM   -- remetente, ex.: "Controle de Fretes <alguem@cantu.inc>"
//                          (se nao criar, tenta RESEND_FROM / FROM_EMAIL / EMAIL_FROM)
//   ALERTA_DOMINIOS     -- opcional: dominios permitidos como destino, ex.: "cantu.inc,amdlog.com.br"
//
// Publicar com "Verify JWT" DESLIGADO (a seguranca e o x-alerta-token) ou manter ligado:
// o Vercel manda a chave publica do projeto no Authorization e o token no x-alerta-token.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-alerta-token',
};

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);

  const token = Deno.env.get('ALERTA_TOKEN');
  if (!token || req.headers.get('x-alerta-token') !== token) return json({ erro: 'Não autorizado.' }, 401);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('ALERTA_EMAIL_FROM') || Deno.env.get('RESEND_FROM') || Deno.env.get('FROM_EMAIL') || Deno.env.get('EMAIL_FROM');
  if (!apiKey || !from) return json({ erro: 'RESEND_API_KEY ou ALERTA_EMAIL_FROM não configurados nos secrets.' }, 500);

  let corpo: { to?: string | string[]; subject?: string; html?: string; attachments?: { filename: string; content: string }[] };
  try { corpo = await req.json(); } catch { return json({ erro: 'JSON inválido.' }, 400); }

  const para = (Array.isArray(corpo.to) ? corpo.to : [corpo.to || '']).map((e) => String(e).trim()).filter(Boolean);
  if (!para.length || !corpo.subject || !corpo.html) return json({ erro: 'Informe to, subject e html.' }, 400);

  const permitidos = (Deno.env.get('ALERTA_DOMINIOS') || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (permitidos.length && para.some((e) => !permitidos.includes(e.split('@')[1]?.toLowerCase()))) {
    return json({ erro: 'Destinatário fora dos domínios permitidos.' }, 403);
  }

  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: para, subject: corpo.subject, html: corpo.html, attachments: corpo.attachments || [] }),
  });
  const texto = await resposta.text();
  if (!resposta.ok) return json({ erro: `Resend recusou (${resposta.status}): ${texto.slice(0, 300)}` }, 502);
  return json({ ok: true });
});
