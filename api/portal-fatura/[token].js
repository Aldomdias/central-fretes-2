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

async function carregarDivergencias(supabase, faturaId) {
  try {
    const { data } = await supabase.from('fatura_cte_divergencias').select('*').eq('fatura_id', faturaId).order('numero_cte');
    return data || [];
  } catch { return []; }
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
    .select('id, numero_fatura, transportadora, valor_fatura, valor_calculado, diferenca, data_vencimento, status, confirmacao_transportador_status, confirmacao_transportador_em, confirmacao_transportador_por, confirmacao_transportador_token, confirmacao_transportador_observacao, confirmacao_transportador_evidencias')
    .eq('confirmacao_transportador_token', token)
    .maybeSingle();
  if (error) throw error;
  if (!fatura) return { erro: { titulo: 'Link inválido', detalhe: 'Este link de confirmação não foi encontrado. Solicite um novo link ao time de auditoria.' } };
  return { fatura };
}

function formCtes(divergencias) {
  const linhas = divergencias.map((d, i) => {
    const respondido = d.resposta;
    return `<tr>
      <td><strong>${esc(d.numero_cte || String(d.chave).slice(-9))}</strong><div class="ch">${esc(d.chave)}</div>
        <input type="hidden" name="id_${i}" value="${esc(d.id)}"></td>
      <td>${dinheiro(d.valor_cobrado)}</td>
      <td>${dinheiro(d.valor_calculado)}</td>
      <td class="destaque">${dinheiro(d.diferenca)}</td>
      <td>
        <label class="op"><input type="radio" name="resp_${i}" value="CONCORDO"${respondido === 'CONCORDO' ? ' checked' : ''} onclick="marcar(${i})"> Concordo</label>
        <label class="op"><input type="radio" name="resp_${i}" value="NAO_CONCORDO"${respondido === 'NAO_CONCORDO' ? ' checked' : ''} onclick="marcar(${i})"> Não concordo</label>
        ${d.status_validacao === 'REJEITADO' ? `<div class="rej">Rejeitado pela auditoria${d.observacao_validacao ? ': ' + esc(d.observacao_validacao) : ''}. Responda novamente.</div>` : ''}
        <div id="desc_box_${i}" class="cx">Desconto devido (R$): <input type="text" name="desc_${i}" id="desc_${i}" value="${esc(respondido === 'CONCORDO' && d.valor_desconto != null ? Number(d.valor_desconto).toFixed(2) : Number(d.diferenca).toFixed(2))}" data-max="${Number(d.diferenca).toFixed(2)}" inputmode="decimal"></div>
        <div id="just_box_${i}" class="cx"><input type="text" name="just_${i}" id="just_${i}" placeholder="Motivo (obrigatório se não concorda)" value="${esc(d.justificativa || '')}"></div>
      </td></tr>`;
  }).join('');
  return `<form method="POST" id="frmCtes">
    <div class="quem">
      <label for="respondido_por">Quem está respondendo (nome e e-mail)</label>
      <input type="text" id="respondido_por" name="respondido_por" placeholder="Nome — email@transportadora.com.br">
    </div>
    <p class="dica"><b>${divergencias.length} CT-e(s) com cobrança acima do calculado.</b> Para cada um, informe se concorda (e o desconto devido) ou não concorda (e o motivo).</p>
    <p><button type="button" class="sec" onclick="todos()">Concordo com todos (desconto = diferença)</button></p>
    <div class="tw"><table class="ctes"><thead><tr><th>CT-e</th><th>Cobrado</th><th>Calculado</th><th>Diferença</th><th>Sua resposta</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <input type="hidden" name="acao" value="responder_ctes">
    <input type="hidden" name="total" value="${divergencias.length}">
    <button type="submit" onclick="return validarCtes()">Enviar respostas</button>
  </form>
  <script>
  function marcar(i){var r=document.querySelector('input[name=resp_'+i+']:checked');var c=r&&r.value==='CONCORDO';document.getElementById('desc_box_'+i).style.display=c?'block':'none';document.getElementById('just_box_'+i).style.display=r?'block':'none';}
  function todos(){var n=Number(document.querySelector('input[name=total]').value);for(var i=0;i<n;i++){var c=document.querySelector('input[name=resp_'+i+'][value=CONCORDO]');c.checked=true;var d=document.getElementById('desc_'+i);d.value=d.getAttribute('data-max');marcar(i);}}
  function validarCtes(){var q=document.getElementById('respondido_por');if(!q.value.trim()){q.focus();alert('Informe quem está respondendo.');return false}
    var n=Number(document.querySelector('input[name=total]').value);
    for(var i=0;i<n;i++){var r=document.querySelector('input[name=resp_'+i+']:checked');if(!r){alert('Responda todos os CT-es (falta o CT-e da linha '+(i+1)+').');return false}
      if(r.value==='NAO_CONCORDO'&&!document.getElementById('just_'+i).value.trim()){document.getElementById('just_'+i).focus();alert('Informe o motivo do CT-e da linha '+(i+1)+'.');return false}}
    return true}
  for(var k=0;k<${divergencias.length};k++)marcar(k);
  </script>`;
}

function paginaPortalFatura({ fatura, enviado, acaoEnviada, divergencias = [] }) {
  const saldo = Math.max(Number(fatura.diferenca || 0), 0);
  const jaAprovada = fatura.confirmacao_transportador_status === 'APROVADO';
  const contestada = fatura.confirmacao_transportador_status === 'CONTESTADO';
  const avisoContestacao = contestada
    ? `<div class="contest">⚠ ${enviado && acaoEnviada === 'contestar' ? 'Contestação recebida. O time de auditoria vai analisar sua observação e as evidências e retornar.' : `Esta fatura foi contestada em ${esc(dataBr(fatura.confirmacao_transportador_em))}${fatura.confirmacao_transportador_por ? ` por ${esc(fatura.confirmacao_transportador_por)}` : ''}. Você pode enviar uma nova contestação ou confirmar a fatura abaixo.`}<small><b>Observação:</b> ${esc(fatura.confirmacao_transportador_observacao || '-')}${fatura.confirmacao_transportador_evidencias ? `\n<b>Evidências:</b> ${esc(fatura.confirmacao_transportador_evidencias)}` : ''}</small></div>`
    : '';
  const aviso = contestada ? avisoContestacao : enviado
    ?`<div class="ok">✅ Confirmação recebida. Obrigado! O time de auditoria já foi notificado e vai seguir com o pagamento.</div>`
    : (jaAprovada
      ? `<div class="ok">✅ Esta fatura já foi confirmada em ${esc(dataBr(fatura.confirmacao_transportador_em))}${fatura.confirmacao_transportador_por ? ` por ${esc(fatura.confirmacao_transportador_por)}` : ''}. Não é necessário confirmar de novo.</div>`
      : '');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirmação de fatura — ${esc(fatura.transportadora || 'Transportadora')}</title>
<style>
body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
.page{max-width:900px;margin:24px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}
header{padding:26px 30px;background:#06183d;color:#fff}
header h1{margin:0 0 6px;font-size:22px}header p{margin:3px 0;color:#cbd5e1;font-size:14px}
.resumo{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:18px 30px;background:#f8fafc}
.card{padding:12px;border:1px solid #dbe3ef;border-radius:9px;background:#fff}
.card small{display:block;color:#64748b;margin-bottom:4px}.card strong{font-size:18px}
.destaque{color:#b91c1c}
.intro{padding:18px 30px;line-height:1.55}
.contest{margin:0 30px 16px;padding:14px;background:#fef3c7;border:1px solid #fcd34d;border-radius:9px;color:#78350f;font-weight:700}.contest small{font-weight:400;display:block;margin-top:6px;white-space:pre-wrap}
textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:inherit}
button.recusar{background:#b45309}button.recusar:hover{background:#92400e}.ou{text-align:center;color:#64748b;font-size:12px;margin:16px 0 10px}.contestar-box{padding:14px;border:1px solid #fcd34d;border-radius:10px;background:#fffbeb}
.ok{margin:0 30px 16px;padding:14px;background:#dcfce7;border:1px solid #86efac;border-radius:9px;color:#065f46;font-weight:700}
form{padding:0 30px 26px}
.tw{overflow-x:auto;margin:10px 0 16px}.ctes{width:100%;border-collapse:collapse;font-size:13px}.ctes th,.ctes td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left;vertical-align:top}.ctes th{background:#f1f5f9}.ch{font-size:10px;color:#94a3b8;word-break:break-all}.op{display:block;margin:2px 0;font-size:13px}.cx{display:none;margin-top:6px;font-size:12px}.cx input{padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box}.rej{margin:6px 0;padding:6px 8px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;color:#991b1b;font-size:12px}.dica{font-size:13px;color:#334155}button.sec{background:#475569;width:auto;padding:9px 14px;font-size:13px}
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
  ${!jaAprovada && divergencias.length ? formCtes(divergencias) : ''}
  ${!jaAprovada && !divergencias.length ? `<form method="POST">
    <div class="quem">
      <label for="respondido_por">Quem está respondendo (nome e e-mail)</label>
      <input type="text" id="respondido_por" name="respondido_por" placeholder="Nome — email@transportadora.com.br">
    </div>
    <button type="submit" name="acao" value="confirmar" onclick="return validarQuem()">OK, confirmo esta fatura</button>
    <div class="ou">— ou, se não concorda —</div>
    <div class="contestar-box">
      <div class="quem">
        <label for="observacao">Observação (motivo da recusa / contestação)</label>
        <textarea id="observacao" name="observacao" rows="4" placeholder="Explique o que está incorreto (ex.: peso, tabela, CT-es com os quais discorda)"></textarea>
      </div>
      <div class="quem">
        <label for="evidencias">Evidências / provas (links de arquivos, um por linha)</label>
        <textarea id="evidencias" name="evidencias" rows="3" placeholder="Cole links (Drive, OneDrive etc.) de comprovantes, CT-es, NFs, canhotos"></textarea>
      </div>
      <button type="submit" name="acao" value="contestar" class="recusar" onclick="return validarContestacao()">Não concordo — enviar contestação</button>
    </div>
  </form>
  <script>
  function validarQuem(){var q=document.getElementById('respondido_por');if(!q.value.trim()){q.focus();alert('Informe quem está respondendo.');return false}return true}
  function validarContestacao(){if(!validarQuem())return false;var o=document.getElementById('observacao');if(!o.value.trim()){o.focus();alert('Descreva o motivo da contestação.');return false}return true}
  </script>` : ''}
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
      return res.send(paginaPortalFatura({ fatura: contexto.fatura, enviado: false, divergencias: await carregarDivergencias(supabase, contexto.fatura.id) }));
    }

    if (req.method === 'POST') {
      const { fatura } = contexto;
      const corpo = lerCorpo(req);
      const acao = ['contestar', 'responder_ctes'].includes(corpo.acao) ? corpo.acao : 'confirmar';
      const respondidoPor = String(corpo.respondido_por || '').slice(0, 200) || null;
      const agora = new Date().toISOString();
      if (fatura.confirmacao_transportador_status !== 'APROVADO') {
        if (acao === 'responder_ctes') {
          const divergencias = await carregarDivergencias(supabase, fatura.id);
          const porId = new Map(divergencias.map((d) => [String(d.id), d]));
          const total = Math.min(Number(corpo.total) || 0, divergencias.length);
          const respostas = [];
          for (let i = 0; i < total; i += 1) {
            const d = porId.get(String(corpo[`id_${i}`] || ''));
            const resposta = corpo[`resp_${i}`];
            if (!d || !['CONCORDO', 'NAO_CONCORDO'].includes(resposta)) continue;
            const justificativa = String(corpo[`just_${i}`] || '').trim().slice(0, 1000);
            const bruto = Number(String(corpo[`desc_${i}`] || '0').replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')) || 0;
            const valorDesconto = resposta === 'CONCORDO' ? Math.min(Math.max(bruto, 0), Number(d.diferenca || 0)) : null;
            if (resposta === 'NAO_CONCORDO' && !justificativa) continue;
            respostas.push({ d, resposta, justificativa: justificativa || null, valorDesconto });
          }
          if (!respostas.length || respostas.length < divergencias.length) {
            res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(paginaErro('Respostas incompletas', 'Responda todos os CT-es (e o motivo dos que não concorda) e volte para tentar novamente.'));
          }
          for (const r of respostas) {
            const { error: erroResp } = await supabase.from('fatura_cte_divergencias').update({
              resposta: r.resposta, valor_desconto: r.valorDesconto, justificativa: r.justificativa, respondido_por: respondidoPor, respondido_em: agora,
              status_validacao: 'PENDENTE', validado_por: null, validado_em: null, observacao_validacao: null,
            }).eq('id', r.d.id);
            if (erroResp) throw erroResp;
          }
          const concordam = respostas.filter((r) => r.resposta === 'CONCORDO');
          const discordam = respostas.filter((r) => r.resposta === 'NAO_CONCORDO');
          const totalDesconto = concordam.reduce((acc, r) => acc + Number(r.valorDesconto || 0), 0);
          const resumoTxt = `${concordam.length} CT-e(s) com desconto reconhecido de ${dinheiro(totalDesconto)}; ${discordam.length} CT-e(s) contestado(s)${discordam.length ? ': ' + discordam.map((r) => `${r.d.numero_cte || r.d.chave} (${r.justificativa})`).join(' | ') : ''}.`;
          const { error: erroFat } = await supabase.from('faturas').update({
            confirmacao_transportador_status: discordam.length ? 'CONTESTADO' : 'APROVADO',
            confirmacao_transportador_em: agora,
            confirmacao_transportador_por: respondidoPor,
            confirmacao_transportador_observacao: resumoTxt,
            updated_at: agora,
          }).eq('id', fatura.id);
          if (erroFat) throw erroFat;
          await supabase.from('auditoria_fatura_historico').insert({
            fatura_id: fatura.id,
            created_at: agora,
            acao: discordam.length ? 'CONTESTACAO_TRANSPORTADOR_PORTAL' : 'CONFIRMACAO_TRANSPORTADOR_PORTAL',
            descricao: `Transportador respondeu CT-e a CT-e pelo link de conferência${respondidoPor ? ` (${respondidoPor})` : ''}. ${resumoTxt}`,
            usuario_nome: respondidoPor || 'Portal do transportador',
          });
        } else if (acao === 'contestar') {
          const observacao = String(corpo.observacao || '').trim().slice(0, 4000);
          const evidencias = String(corpo.evidencias || '').trim().slice(0, 4000);
          if (!observacao) {
            res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(paginaErro('Observação obrigatória', 'Descreva o motivo da contestação e volte para tentar novamente.'));
          }
          const { error: erroContestacao } = await supabase
            .from('faturas')
            .update({
              confirmacao_transportador_status: 'CONTESTADO',
              confirmacao_transportador_em: agora,
              confirmacao_transportador_por: respondidoPor,
              confirmacao_transportador_observacao: observacao,
              confirmacao_transportador_evidencias: evidencias || null,
              updated_at: agora,
            })
            .eq('id', fatura.id);
          if (erroContestacao) throw erroContestacao;

          await supabase.from('auditoria_fatura_historico').insert({
            fatura_id: fatura.id,
            created_at: agora,
            acao: 'CONTESTACAO_TRANSPORTADOR_PORTAL',
            descricao: `Transportador contestou a fatura pelo link de conferência${respondidoPor ? ` (${respondidoPor})` : ''}. Observação: ${observacao}${evidencias ? ` | Evidências: ${evidencias}` : ''}`,
            usuario_nome: respondidoPor || 'Portal do transportador',
          });
        } else {
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
      }

      const atualizado = await carregarFatura(supabase, token);
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(paginaPortalFatura({ fatura: atualizado.fatura, enviado: true, acaoEnviada: acao === 'responder_ctes' && atualizado.fatura.confirmacao_transportador_status === 'CONTESTADO' ? 'contestar' : acao, divergencias: await carregarDivergencias(supabase, fatura.id) }));
    }

    res.status(405).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Método não permitido', 'Use o link enviado por e-mail.'));
  } catch (error) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(paginaErro('Erro ao processar', error.message || String(error)));
  }
}
