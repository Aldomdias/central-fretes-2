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
//   (versao 2) aceita tambem from_name (nome exibido do remetente), reply_to e cc; o ENDERECO do remetente
//   continua sendo o de ALERTA_EMAIL_FROM (dominio verificado no Resend). {"ping":true} responde a versao.
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

  let corpo: { to?: string | string[]; cc?: string | string[]; reply_to?: string | string[]; from_name?: string; ping?: boolean; subject?: string; html?: string; attachments?: { filename: string; content: string }[] };
  try { corpo = await req.json(); } catch { return json({ erro: 'JSON inválido.' }, 400); }
  if (corpo.ping) return json({ ok: true, versao: 2 });

  const lista = (v?: string | string[]) => (Array.isArray(v) ? v : [v || '']).map((e) => String(e).trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  const para = (Array.isArray(corpo.to) ? corpo.to : [corpo.to || '']).map((e) => String(e).trim()).filter(Boolean);
  if (!para.length || !corpo.subject || !corpo.html) return json({ erro: 'Informe to, subject e html.' }, 400);

  const permitidos = (Deno.env.get('ALERTA_DOMINIOS') || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (permitidos.length && para.some((e) => !permitidos.includes(e.split('@')[1]?.toLowerCase()))) {
    return json({ erro: 'Destinatário fora dos domínios permitidos.' }, 403);
  }

  // Nome exibido do remetente (ex.: "Paulo Ricardo - Auditoria de Fretes"); o endereco e o de ALERTA_EMAIL_FROM.
  const enderecoFrom = (from.match(/<([^>]+)>/)?.[1] || from).trim();
  const nomeExibido = String(corpo.from_name || '').replace(/[<>"\r\n]/g, '').trim().slice(0, 80);
  const remetente = nomeExibido ? `${nomeExibido} <${enderecoFrom}>` : from;
  const cc = lista(corpo.cc).filter((e) => !para.includes(e));
  const replyTo = lista(corpo.reply_to);
  if (permitidos.length && cc.some((e) => !permitidos.includes(e.split('@')[1]?.toLowerCase()))) {
    return json({ erro: 'Destinatário em cópia fora dos domínios permitidos.' }, 403);
  }

  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: remetente, to: para, ...(cc.length ? { cc } : {}), ...(replyTo.length ? { reply_to: replyTo } : {}),
      subject: corpo.subject, html: corpo.html, attachments: corpo.attachments || [],
    }),
  });
  const texto = await resposta.text();
  if (!resposta.ok) return json({ erro: `Resend recusou (${resposta.status}): ${texto.slice(0, 300)}` }, 502);
  return json({ ok: true });
});
