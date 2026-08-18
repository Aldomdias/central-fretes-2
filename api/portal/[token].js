/**
 * Portal de resposta da transportadora (Fases 14/15).
 *
 * Por que isso é uma função serverless e não uma página do app:
 * o SPA carrega a chave anon do Supabase no bundle, e as tabelas do
 * projeto usam RLS aberta. Se a transportadora abrisse qualquer página
 * do app, teria acesso a TODOS os dados de TODAS as transportadoras.
 * Aqui a service_role fica no servidor e a transportadora só recebe
 * HTML já renderizado com os CT-es do processo dela.
 *
 * GET  /api/portal/<token>  -> devolve a página de conferência
 * POST /api/portal/<token>  -> grava a resposta (fica PENDENTE de validação)
 */
import { createClient } from '@supabase/supabase-js';

const RESULTADOS_VALIDOS = new Set([
  'concordou_desconto',
  'concordou_cancelamento',
  'nao_concordou',
  'em_analise',
]);

const RESULTADO_LABEL = {
  concordou_desconto: 'Concordo — conceder desconto na fatura',
  concordou_cancelamento: 'Concordo — cancelar e reemitir o CT-e',
  nao_concordou: 'Não concordo com a divergência',
  em_analise: 'Ainda em análise',
};

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

function paginaErro(titulo, detalhe) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<style>body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.box{max-width:520px;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:32px;text-align:center}
h1{margin:0 0 10px;font-size:20px}p{color:#475569;line-height:1.5}</style></head>
<body><div class="box"><h1>${esc(titulo)}</h1><p>${esc(detalhe)}</p></div></body></html>`;
}

/** Busca token + processo + CT-es, validando expiração/revogação. */
async function carregarContexto(supabase, token) {
  const { data: tokenRow, error: erroToken } = await supabase
    .from('auditoria_cte_portal_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (erroToken) throw erroToken;
  if (!tokenRow) return { erro: { titulo: 'Link inválido', detalhe: 'Este link de conferência não foi encontrado. Solicite um novo link ao time de auditoria.' } };
  if (tokenRow.revogado) return { erro: { titulo: 'Link cancelado', detalhe: 'Este link foi cancelado pelo time de auditoria. Solicite um novo link.' } };
  if (tokenRow.expira_em && new Date(tokenRow.expira_em) < new Date()) {
    return { erro: { titulo: 'Link expirado', detalhe: 'O prazo deste link de conferência terminou. Solicite um novo link ao time de auditoria.' } };
  }

  const { data: processo } = await supabase
    .from('auditoria_cte_processos')
    .select('*')
    .eq('id', tokenRow.processo_id)
    .maybeSingle();

  const { data: ctes } = await supabase
    .from('auditoria_cte_processo_ctes')
    .select('*')
    .eq('processo_id', tokenRow.processo_id);

  const { data: respostas } = await supabase
    .from('auditoria_cte_portal_respostas')
    .select('chave_cte, resultado, justificativa, valor_proposto')
    .eq('token_id', tokenRow.id);

  return { tokenRow, processo, ctes: ctes || [], respostas: respostas || [] };
}

export function paginaPortal({ tokenRow, processo, ctes, respostas, enviado }) {
  const respostaPorChave = new Map((respostas || []).map((r) => [r.chave_cte, r]));
  const totalDivergencia = ctes.reduce((acc, c) => acc + Math.abs(Number(c.diferenca || 0)), 0);

  const linhas = ctes.map((cte, idx) => {
    const anterior = respostaPorChave.get(cte.chave_cte);
    const opcoes = Object.entries(RESULTADO_LABEL).map(([valor, label]) => (
      `<option value="${valor}"${anterior?.resultado === valor ? ' selected' : ''}>${esc(label)}</option>`
    )).join('');
    return `<tr>
      <td><strong>${esc(cte.numero_cte || '-')}</strong><div class="chave">${esc(cte.chave_cte)}</div></td>
      <td class="num">${dinheiro(cte.valor_cte)}</td>
      <td class="num">${dinheiro(cte.valor_calculado)}</td>
      <td class="num destaque">${dinheiro(cte.diferenca)}</td>
      <td>
        <input type="hidden" name="chave_${idx}" value="${esc(cte.chave_cte)}">
        <input type="hidden" name="numero_${idx}" value="${esc(cte.numero_cte || '')}">
        <select name="resultado_${idx}" required>
          <option value="">Selecione...</option>
          ${opcoes}
        </select>
        <input type="text" name="justificativa_${idx}" placeholder="Justificativa / observação"
               value="${esc(anterior?.justificativa || '')}">
      </td>
    </tr>`;
  }).join('');

  const aviso = enviado
    ? `<div class="ok">✅ Resposta recebida com sucesso. O time de auditoria vai conferir e dar sequência. Você pode fechar esta página — ou revisar e reenviar, se precisar corrigir algo.</div>`
    : '';

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conferência de CT-es — ${esc(tokenRow.transportadora || 'Transportadora')}</title>
<style>
body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
.page{max-width:1100px;margin:24px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}
header{padding:26px 30px;background:#06183d;color:#fff}
header h1{margin:0 0 6px;font-size:22px}header p{margin:3px 0;color:#cbd5e1;font-size:14px}
.resumo{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:18px 30px;background:#f8fafc}
.card{padding:12px;border:1px solid #dbe3ef;border-radius:9px;background:#fff}
.card small{display:block;color:#64748b;margin-bottom:4px}.card strong{font-size:18px}
.intro{padding:18px 30px;line-height:1.55}
.ok{margin:0 30px 16px;padding:14px;background:#dcfce7;border:1px solid #86efac;border-radius:9px;color:#065f46;font-weight:700}
.lista{padding:0 30px 24px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;background:#f1f5f9;padding:10px;border-bottom:1px solid #cbd5e1;font-size:12px}
td{padding:10px;border-bottom:1px solid #e2e8f0;vertical-align:top}
.num{text-align:right;white-space:nowrap}.destaque{color:#b91c1c;font-weight:700}
.chave{font-size:10px;color:#94a3b8;font-family:monospace;overflow-wrap:anywhere}
select,input[type=text]{box-sizing:border-box;width:100%;min-width:230px;margin-top:4px;padding:8px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;font-size:13px}
.acoes{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:16px 30px;background:#fff;border-top:1px solid #e2e8f0;flex-wrap:wrap}
.acoes .quem{flex:1;min-width:220px}
button{border:0;border-radius:9px;background:#0f6b3e;color:#fff;font-weight:700;padding:13px 22px;cursor:pointer;font-size:15px}
button:hover{background:#0c5732}
footer{padding:16px 30px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0}
@media(max-width:760px){.resumo{grid-template-columns:1fr}table,thead,tbody,tr,td,th{display:block}
th{display:none}td{border:0;padding:6px 10px}tr{border-bottom:1px solid #e2e8f0;padding:8px 0}
.num{text-align:left}}
</style></head><body>
<main class="page">
  <header>
    <h1>Conferência de CT-es</h1>
    <p>${esc(tokenRow.transportadora || 'Transportadora')}</p>
    <p>Processo ${esc(processo?.codigo || '-')} · Competência ${esc(processo?.competencia || 'não informada')}</p>
  </header>
  <div class="resumo">
    <div class="card"><small>CT-es para conferir</small><strong>${ctes.length}</strong></div>
    <div class="card"><small>Total cobrado</small><strong>${dinheiro(ctes.reduce((a, c) => a + Number(c.valor_cte || 0), 0))}</strong></div>
    <div class="card"><small>Divergência apontada</small><strong class="destaque">${dinheiro(totalDivergencia)}</strong></div>
  </div>
  ${aviso}
  <div class="intro">
    <p>Prezados, identificamos as divergências abaixo na auditoria dos CT-es emitidos. Pedimos a conferência de cada documento e o retorno com a tratativa escolhida.</p>
    <p>Sua resposta é registrada no sistema e conferida pelo time de auditoria antes de qualquer ajuste em fatura.</p>
  </div>
  <form method="POST" class="lista">
    <table>
      <thead><tr><th>CT-e</th><th class="num">Cobrado</th><th class="num">Cálculo</th><th class="num">Diferença</th><th>Sua resposta</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <input type="hidden" name="total" value="${ctes.length}">
    <div class="acoes">
      <div class="quem">
        <label for="respondido_por"><small>Quem está respondendo (nome e e-mail)</small></label>
        <input type="text" id="respondido_por" name="respondido_por" placeholder="Nome — email@transportadora.com.br" required>
      </div>
      <button type="submit">Enviar resposta</button>
    </div>
  </form>
  <footer>Central Fretes · Este link é exclusivo desta auditoria e não dá acesso a nenhum outro dado.</footer>
</main></body></html>`;
}

/** Vercel entrega o body de form urlencoded já parseado, mas nem sempre. */
function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return Object.fromEntries(new URLSearchParams(req.body));
  return {};
}

export default async function handler(req, res) {
  const { token } = req.query;
  res.setHeader('Cache-Control', 'no-store');
  // Sem indexação: link de terceiro não deve acabar em buscador.
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
    const contexto = await carregarContexto(supabase, token);
    if (contexto.erro) {
      res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaErro(contexto.erro.titulo, contexto.erro.detalhe));
    }
    const { tokenRow, processo, ctes, respostas } = contexto;

    if (req.method === 'GET') {
      const agora = new Date().toISOString();
      await supabase
        .from('auditoria_cte_portal_tokens')
        .update({
          acessos: Number(tokenRow.acessos || 0) + 1,
          ultimo_acesso_em: agora,
          primeiro_acesso_em: tokenRow.primeiro_acesso_em || agora,
        })
        .eq('id', tokenRow.id);

      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaPortal({ tokenRow, processo, ctes, respostas, enviado: false }));
    }

    if (req.method === 'POST') {
      const corpo = lerCorpo(req);
      const total = Number(corpo.total || 0);
      const respondidoPor = String(corpo.respondido_por || '').slice(0, 200);
      const chavesDoProcesso = new Set(ctes.map((c) => c.chave_cte));
      const cteByChave = new Map(ctes.map((c) => [c.chave_cte, c]));

      const novas = [];
      for (let i = 0; i < total; i += 1) {
        const chave = String(corpo[`chave_${i}`] || '').trim();
        const resultado = String(corpo[`resultado_${i}`] || '').trim();
        if (!chave || !resultado) continue;
        // Só aceita CT-e que pertence a este processo e resultado do enum —
        // impede que um POST forjado grave resposta para outro CT-e.
        if (!chavesDoProcesso.has(chave) || !RESULTADOS_VALIDOS.has(resultado)) continue;
        novas.push({
          token_id: tokenRow.id,
          processo_id: tokenRow.processo_id,
          chave_cte: chave,
          numero_cte: String(corpo[`numero_${i}`] || '') || cteByChave.get(chave)?.numero_cte || null,
          transportadora: tokenRow.transportadora || null,
          resultado,
          justificativa: String(corpo[`justificativa_${i}`] || '').slice(0, 1000) || null,
          respondido_por: respondidoPor || null,
          status_validacao: 'PENDENTE',
        });
      }

      if (novas.length) {
        // Reenvio substitui a resposta anterior ainda não validada; o que o
        // auditor já aplicou/rejeitou fica preservado como histórico.
        await supabase
          .from('auditoria_cte_portal_respostas')
          .delete()
          .eq('token_id', tokenRow.id)
          .eq('status_validacao', 'PENDENTE');

        const { error: erroInsert } = await supabase
          .from('auditoria_cte_portal_respostas')
          .insert(novas);
        if (erroInsert) throw erroInsert;

        await supabase
          .from('auditoria_cte_portal_tokens')
          .update({ respondido_em: new Date().toISOString() })
          .eq('id', tokenRow.id);

        await supabase.from('audit_historico_eventos').insert({
          processo_id: tokenRow.processo_id,
          acao: 'RESPOSTA_PORTAL_RECEBIDA',
          comentario: `Transportadora respondeu ${novas.length} CT-e(s) pelo portal. Aguardando validação do auditor.`,
          user_name: respondidoPor || 'Portal da transportadora',
          origem_tela: 'portal-transportadora',
        });
      }

      const atualizadas = await carregarContexto(supabase, token);
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaPortal({
        tokenRow: atualizadas.tokenRow,
        processo: atualizadas.processo,
        ctes: atualizadas.ctes,
        respostas: atualizadas.respostas,
        enviado: true,
      }));
    }

    res.status(405).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Método não suportado', 'Use o link enviado no laudo.'));
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Erro ao carregar a conferência', error.message || 'Tente novamente mais tarde.'));
  }
}
