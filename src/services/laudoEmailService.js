import { urlBaseApp } from '../utils/urlBaseApp';

function paraBase64(bytes) {
  let bin = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  return btoa(bin);
}

// O laudo HTML pode passar de varios MB; compacta (gzip) para caber no limite de requisicao da Vercel.
async function gzipBase64(texto) {
  if (typeof CompressionStream === 'undefined') throw new Error('Este navegador nao compacta o laudo para envio. Use Chrome ou Edge.');
  const cs = new CompressionStream('gzip');
  const escritor = cs.writable.getWriter();
  escritor.write(new TextEncoder().encode(String(texto || '')));
  escritor.close();
  const buffer = await new Response(cs.readable).arrayBuffer();
  return paraBase64(new Uint8Array(buffer));
}

// Envia o laudo consolidado por e-mail (api/enviar-laudo-robo): destinatarios vem da lista do robo
// no servidor; so sai laudo aprovado pelo auditor e ainda nao enviado.
export async function enviarLaudoPorEmail({ faturaIds, assunto, corpoHtml, anexoHtml, anexoNome, origem = 'manual' }) {
  const resposta = await fetch(`${urlBaseApp()}/api/enviar-laudo-robo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fatura_ids: faturaIds.map(String),
      assunto,
      corpo_html: corpoHtml,
      anexo_nome: anexoNome,
      anexo_gzip_base64: await gzipBase64(anexoHtml),
      origem,
    }),
  });
  let json = null;
  try { json = await resposta.json(); } catch { /* resposta sem JSON */ }
  if (!resposta.ok || !json?.ok) {
    throw new Error(json?.erro || `Falha no envio do e-mail (HTTP ${resposta.status}).`);
  }
  return json; // { ok, faturas, para, copia }
}
