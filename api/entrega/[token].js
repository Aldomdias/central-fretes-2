/**
 * Portal de comprovantes de entrega da transportadora.
 *
 * Usa o mesmo token do link de confirmacao da fatura (faturas.confirmacao_transportador_token),
 * entao o laudo so precisa trocar /api/portal-fatura/ por /api/entrega/.
 * Funcao serverless com service_role: a transportadora so ve os CT-es sem
 * entrega da fatura dela, nunca dados de outras faturas/transportadoras.
 *
 * GET  /api/entrega/<token>  -> pagina com a lista de CT-es sem entrega
 * POST /api/entrega/<token>  JSON { acao: 'assinar' | 'enviar', ... }
 *   assinar: devolve URLs de upload temporarias (bucket privado, 4 MB, PDF/imagem/Excel)
 *   enviar : grava a resposta por CT-e (fica PENDENTE ate o auditor validar)
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const BUCKET = 'entrega-comprovantes';
const LIMITE_BYTES = 4 * 1024 * 1024;
const MAX_ARQUIVOS = 4;
const EXTENSOES = new Set(['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'xls']);
const RESPOSTAS = {
  ENTREGUE: 'Entregue — comprovante anexado',
  NAO_ENTREGUE: 'Não entregue / em devolução',
  EM_ANALISE: 'Ainda em análise',
};

function getClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error('Portal indisponível: variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function paginaErro(titulo, detalhe) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.box{max-width:520px;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:32px;text-align:center}
h1{margin:0 0 10px;font-size:20px}p{color:#475569;line-height:1.5}</style></head>
<body><div class="box"><h1>${esc(titulo)}</h1><p>${esc(detalhe)}</p></div></body></html>`;
}

async function carregarContexto(supabase, token) {
  const { data: fatura, error } = await supabase
    .from('faturas')
    .select('id, numero_fatura, transportadora, data_vencimento')
    .eq('confirmacao_transportador_token', token)
    .maybeSingle();
  if (error) throw error;
  if (!fatura) return { erro: { titulo: 'Link inválido', detalhe: 'Este link não foi encontrado. Solicite um novo link ao time de auditoria.' } };
  const { data: pendencias } = await supabase.from('entrega_pendencias').select('*').eq('fatura_id', fatura.id).order('numero_cte');
  const { data: respostas } = await supabase.from('entrega_respostas').select('chave, resposta, justificativa, anexos, respondido_em, status_validacao, observacao_validacao').eq('fatura_id', fatura.id).order('respondido_em', { ascending: false });
  const ultima = new Map();
  (respostas || []).forEach((r) => { if (!ultima.has(r.chave)) ultima.set(r.chave, r); });
  // CT-e ja aprovado como entregue sai da lista.
  const abertas = (pendencias || []).filter((p) => !(ultima.get(p.chave)?.status_validacao === 'APROVADO' && ultima.get(p.chave)?.resposta === 'ENTREGUE'));
  return { fatura, pendencias: abertas, respostas: ultima };
}

function paginaPortal({ fatura, pendencias, respostas }) {
  const linhas = pendencias.map((p, i) => {
    const anterior = respostas.get(p.chave);
    const rotuloStatus = p.entrega_status === 'SEM_TRACKING' ? 'sem rastreamento' : 'não entregue no rastreamento';
    const opcoes = Object.entries(RESPOSTAS).map(([v, l]) => `<option value="${v}"${anterior?.resposta === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
    const aviso = anterior
      ? `<div class="prev">Última resposta: <b>${esc(RESPOSTAS[anterior.resposta] || anterior.resposta)}</b> (${anterior.status_validacao === 'REJEITADO' ? 'rejeitada — envie novamente' : anterior.status_validacao === 'APROVADO' ? 'aprovada' : 'aguardando conferência'})${anterior.status_validacao === 'REJEITADO' && anterior.observacao_validacao ? ` — ${esc(anterior.observacao_validacao)}` : ''}</div>`
      : '';
    return `<tr class="linha" data-chave="${esc(p.chave)}" data-idx="${i}">
      <td><strong>${esc(p.numero_cte || '-')}</strong><div class="chave">${esc(p.chave)}</div><div class="st">${esc(rotuloStatus)}</div></td>
      <td>
        <select class="resp">${'<option value="">Selecione...</option>'}${opcoes}</select>
        <textarea class="just" rows="2" placeholder="Justificativa (ex.: entregue em dd/mm, recebido por fulano)">${esc(anterior?.justificativa || '')}</textarea>
        <input class="arq" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls">
        <div class="dica">PDF, imagem ou Excel · até 4 MB por arquivo · máx. ${MAX_ARQUIVOS} arquivos</div>
        ${aviso}
      </td></tr>`;
  }).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comprovantes de entrega — ${esc(fatura.transportadora || 'Transportadora')}</title>
<style>
body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
.page{max-width:980px;margin:24px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}
header{padding:26px 30px;background:#06183d;color:#fff}header h1{margin:0 0 6px;font-size:22px}header p{margin:3px 0;color:#cbd5e1;font-size:14px}
.intro{padding:18px 30px;line-height:1.55}
.ok{margin:0 30px 16px;padding:14px;background:#dcfce7;border:1px solid #86efac;border-radius:9px;color:#065f46;font-weight:700}
.err{margin:0 30px 16px;padding:14px;background:#fee2e2;border:1px solid #fca5a5;border-radius:9px;color:#7f1d1d;font-weight:700}
.lista{padding:0 30px 24px}table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;background:#f1f5f9;padding:10px;border-bottom:1px solid #cbd5e1;font-size:12px}
td{padding:10px;border-bottom:1px solid #e2e8f0;vertical-align:top}
.chave{font-size:10px;color:#94a3b8;font-family:monospace;overflow-wrap:anywhere}.st{font-size:12px;color:#b91c1c;margin-top:4px}
.prev{margin-top:6px;font-size:12px;color:#334155}.dica{font-size:11px;color:#64748b;margin-top:4px}
select,textarea,input[type=text]{box-sizing:border-box;width:100%;margin-top:4px;padding:8px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;font-size:13px;font-family:inherit}
input[type=file]{margin-top:6px;font-size:12px}
.acoes{position:sticky;bottom:0;display:flex;align-items:center;gap:12px;padding:16px 30px;background:#fff;border-top:1px solid #e2e8f0;flex-wrap:wrap}
.acoes .quem{flex:1;min-width:220px}
button{border:0;border-radius:9px;background:#0f6b3e;color:#fff;font-weight:700;padding:13px 22px;cursor:pointer;font-size:15px}
button:disabled{background:#94a3b8;cursor:not-allowed}
footer{padding:16px 30px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0}
@media(max-width:760px){table,thead,tbody,tr,td,th{display:block}th{display:none}}
</style></head><body><main class="page">
<header><h1>Comprovantes de entrega</h1><p>Fatura ${esc(fatura.numero_fatura)} — ${esc(fatura.transportadora || 'Transportadora')}</p></header>
<div class="intro"><p>Os CT-es abaixo não constam como entregues na nossa base de rastreamento. O pagamento da fatura só é liberado com todos os CT-es entregues. Para cada CT-e, informe a situação, escreva uma justificativa e, se tiver, anexe o comprovante de entrega (canhoto, POD ou planilha). Sua resposta é conferida pelo time de auditoria.</p></div>
<div id="msg"></div>
${pendencias.length ? `<div class="lista"><table><thead><tr><th>CT-e</th><th>Sua resposta</th></tr></thead><tbody>${linhas}</tbody></table></div>
<div class="acoes"><div class="quem"><small>Quem está respondendo (nome e e-mail)</small><input type="text" id="quem" placeholder="Nome — email@transportadora.com.br"></div>
<button id="enviar" type="button">Enviar respostas</button></div>` : '<div class="ok">✅ Não há CT-es pendentes de comprovação nesta fatura.</div>'}
<footer>Central Fretes · Este link é exclusivo desta fatura e não dá acesso a nenhum outro dado.</footer></main>
<script>
(function(){
  var LIM=${LIMITE_BYTES},MAXQ=${MAX_ARQUIVOS},EXT=['pdf','jpg','jpeg','png','xlsx','xls'];
  var btn=document.getElementById('enviar'),msg=document.getElementById('msg');
  if(!btn)return;
  function aviso(t,ok){msg.innerHTML='<div class="'+(ok?'ok':'err')+'">'+t+'</div>';window.scrollTo({top:0,behavior:'smooth'})}
  function ext(n){var p=String(n).toLowerCase().split('.');return p.length>1?p.pop():''}
  async function post(corpo){var r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo)});var j=await r.json().catch(function(){return{}});if(!r.ok||j.erro)throw new Error(j.erro||'Falha na comunicação.');return j}
  btn.addEventListener('click',async function(){
    var quem=document.getElementById('quem').value.trim();
    if(!quem){aviso('Informe quem está respondendo.');return}
    var itens=[];
    var linhas=document.querySelectorAll('tr.linha');
    for(var i=0;i<linhas.length;i++){
      var tr=linhas[i],resp=tr.querySelector('.resp').value,just=tr.querySelector('.just').value.trim(),files=Array.prototype.slice.call(tr.querySelector('.arq').files);
      if(!resp&&!just&&!files.length)continue;
      if(!resp){aviso('Escolha a situação do CT-e '+tr.querySelector('strong').textContent+'.');return}
      if(resp==='ENTREGUE'&&!files.length&&!just){aviso('CT-e '+tr.querySelector('strong').textContent+': informe uma justificativa ou anexe o comprovante.');return}
      if(files.length>MAXQ){aviso('Máximo de '+MAXQ+' arquivos por CT-e.');return}
      for(var k=0;k<files.length;k++){
        if(files[k].size>LIM){aviso('O arquivo "'+files[k].name+'" passa de 4 MB.');return}
        if(EXT.indexOf(ext(files[k].name))<0){aviso('Tipo não permitido: "'+files[k].name+'". Use PDF, imagem ou Excel.');return}
      }
      itens.push({chave:tr.getAttribute('data-chave'),resposta:resp,justificativa:just,files:files});
    }
    if(!itens.length){aviso('Preencha ao menos um CT-e.');return}
    btn.disabled=true;btn.textContent='Enviando...';
    try{
      var envio=[];
      for(var a=0;a<itens.length;a++){
        var it=itens[a],anexos=[];
        if(it.files.length){
          var ass=await post({acao:'assinar',chave:it.chave,arquivos:it.files.map(function(f){return{nome:f.name,tamanho:f.size}})});
          for(var b=0;b<it.files.length;b++){
            var fd=new FormData();fd.append('cacheControl','3600');fd.append('',it.files[b]);
            var up=await fetch(ass.urls[b].url,{method:'PUT',body:fd});
            if(!up.ok)throw new Error('Falha ao enviar "'+it.files[b].name+'".');
            anexos.push({nome:it.files[b].name,tamanho:it.files[b].size,path:ass.urls[b].path});
          }
        }
        envio.push({chave:it.chave,resposta:it.resposta,justificativa:it.justificativa,anexos:anexos});
      }
      await post({acao:'enviar',respondido_por:quem,respostas:envio});
      aviso('✅ Respostas recebidas. O time de auditoria vai conferir e dar sequência. Você pode fechar esta página ou reenviar se precisar corrigir algo.',true);
      btn.textContent='Enviado';
      setTimeout(function(){location.reload()},2500);
    }catch(e){aviso(e.message||String(e));btn.disabled=false;btn.textContent='Enviar respostas'}
  });
})();
</script></body></html>`;
}

function nomeSeguro(nome) {
  return String(nome || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

function extensao(nome) {
  const partes = String(nome || '').toLowerCase().split('.');
  return partes.length > 1 ? partes.pop() : '';
}

export default async function handler(req, res) {
  const { token } = req.query;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const html = (status, corpo) => { res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(corpo); };
  const json = (status, corpo) => { res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8'); return res.send(JSON.stringify(corpo)); };

  if (!token) return html(400, paginaErro('Link inválido', 'Token não informado.'));

  let supabase;
  try { supabase = getClient(); } catch (error) { return html(500, paginaErro('Portal indisponível', error.message)); }

  try {
    const contexto = await carregarContexto(supabase, token);
    if (contexto.erro) return req.method === 'POST' ? json(404, { erro: contexto.erro.detalhe }) : html(404, paginaErro(contexto.erro.titulo, contexto.erro.detalhe));
    const { fatura, pendencias } = contexto;

    if (req.method === 'GET') return html(200, paginaPortal(contexto));

    if (req.method === 'POST') {
      const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const chavesValidas = new Set(pendencias.map((p) => p.chave));

      if (corpo.acao === 'assinar') {
        const chave = String(corpo.chave || '');
        if (!chavesValidas.has(chave)) return json(400, { erro: 'CT-e não pertence a esta fatura.' });
        const arquivos = Array.isArray(corpo.arquivos) ? corpo.arquivos : [];
        if (!arquivos.length || arquivos.length > MAX_ARQUIVOS) return json(400, { erro: `Envie de 1 a ${MAX_ARQUIVOS} arquivos por CT-e.` });
        const urls = [];
        for (const arquivo of arquivos) {
          if (!EXTENSOES.has(extensao(arquivo.nome))) return json(400, { erro: `Tipo não permitido: ${arquivo.nome}. Use PDF, imagem ou Excel.` });
          if (Number(arquivo.tamanho) > LIMITE_BYTES) return json(400, { erro: `O arquivo ${arquivo.nome} passa de 4 MB.` });
          const path = `${fatura.id}/${randomUUID()}/${nomeSeguro(arquivo.nome)}`;
          const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
          if (error) return json(500, { erro: `Não foi possível preparar o envio: ${error.message}. Confirme se a migration do portal de entrega foi aplicada.` });
          urls.push({ url: data.signedUrl, path });
        }
        return json(200, { urls });
      }

      if (corpo.acao === 'enviar') {
        const respondidoPor = String(corpo.respondido_por || '').slice(0, 200);
        const respostas = Array.isArray(corpo.respostas) ? corpo.respostas : [];
        const novas = [];
        for (const r of respostas) {
          const chave = String(r.chave || '');
          if (!chavesValidas.has(chave) || !RESPOSTAS[r.resposta]) continue;
          const anexos = (Array.isArray(r.anexos) ? r.anexos : [])
            .filter((a) => typeof a.path === 'string' && a.path.startsWith(`${fatura.id}/`) && !a.path.includes('..'))
            .slice(0, MAX_ARQUIVOS)
            .map((a) => ({ nome: String(a.nome || '').slice(0, 200), tamanho: Number(a.tamanho) || 0, path: a.path }));
          novas.push({
            fatura_id: fatura.id,
            chave,
            numero_cte: pendencias.find((p) => p.chave === chave)?.numero_cte || null,
            resposta: r.resposta,
            justificativa: String(r.justificativa || '').slice(0, 1000) || null,
            anexos,
            respondido_por: respondidoPor || null,
            status_validacao: 'PENDENTE',
          });
        }
        if (!novas.length) return json(400, { erro: 'Nenhuma resposta válida para gravar.' });
        // Reenvio substitui a resposta anterior ainda nao conferida; o que o auditor ja validou fica no historico.
        await supabase.from('entrega_respostas').delete().eq('fatura_id', fatura.id).eq('status_validacao', 'PENDENTE').in('chave', novas.map((n) => n.chave));
        const { error } = await supabase.from('entrega_respostas').insert(novas);
        if (error) throw error;
        await supabase.from('auditoria_fatura_historico').insert({
          fatura_id: fatura.id,
          created_at: new Date().toISOString(),
          acao: 'RESPOSTA_ENTREGA_PORTAL',
          descricao: `Transportadora respondeu ${novas.length} CT-e(s) sem entrega pelo portal${respondidoPor ? ` (${respondidoPor})` : ''}. Aguardando conferência do auditor.`,
          usuario_nome: respondidoPor || 'Portal da transportadora',
        });
        return json(200, { ok: true, gravadas: novas.length });
      }
      return json(400, { erro: 'Ação inválida.' });
    }
    return html(405, paginaErro('Método não permitido', 'Use o link enviado no laudo.'));
  } catch (error) {
    return req.method === 'POST' ? json(500, { erro: error.message || String(error) }) : html(500, paginaErro('Erro ao processar', error.message || String(error)));
  }
}
