/**
 * Portal de cotacao de lotacao para o transportador.
 *
 * Mesmo modelo dos outros portais (api/portal, api/portal-fatura): funcao
 * serverless com a service_role no servidor; o transportador nao acessa o app
 * nem dados de outras transportadoras.
 *
 * Fluxo:
 *   GET  /api/lotacao-cotacao/<token>   -> pagina (so o shell; nenhuma rota ainda)
 *   POST acao=identificar (cnpj, nome, email) -> confere o CNPJ (raiz) contra o
 *        convite; se bater devolve as rotas + um "acesso" assinado (8h)
 *   POST acao=salvar / enviar (acesso, itens) -> grava as propostas
 *
 * O transportador informa VALOR LIQUIDO + PEDAGIO. O ICMS vem da matriz
 * origem/destino e o bruto e calculado aqui (fonte de verdade), para todas as
 * propostas chegarem na mesma base de comparacao:
 *   bruto = (liquido + pedagio) / (1 - aliquota)      icms = bruto - liquido - pedagio
 */
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

const VALIDADE_ACESSO_MS = 8 * 60 * 60 * 1000;
const UF_SUL_SUDESTE = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);

function getClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error('Portal indisponível: variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  return { supabase: createClient(url, serviceRole, { auth: { persistSession: false } }), segredo: serviceRole };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
function cnpjValido(c) {
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (base) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const d of base) { soma += Number(d) * peso; peso -= 1; if (peso < 2) peso = 9; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}
const arred = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).replace(/R\$/gi, '').replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function assinar(token, exp, segredo) {
  return createHmac('sha256', segredo).update(`${token}.${exp}`).digest('base64url');
}
function gerarAcesso(token, segredo) {
  const exp = Date.now() + VALIDADE_ACESSO_MS;
  return `${exp}.${assinar(token, exp, segredo)}`;
}
function acessoValido(token, acesso, segredo) {
  const [exp, sig] = String(acesso || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const esperado = Buffer.from(assinar(token, exp, segredo));
  const recebido = Buffer.from(sig);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

// ---- ICMS ------------------------------------------------------------------
async function carregarMatrizIcms(supabase) {
  try {
    const { data } = await supabase.from('simulador_configuracoes').select('valor').eq('chave', 'matriz_icms_uf').maybeSingle();
    return Array.isArray(data?.valor) ? data.valor : [];
  } catch { return []; }
}

function aliquotaDaRota(matriz, ufOrigem, ufDestino) {
  const uo = String(ufOrigem || '').toUpperCase();
  const ud = String(ufDestino || '').toUpperCase();
  const candidatas = matriz.filter((m) => String(m.ufOrigem).toUpperCase() === uo && String(m.ufDestino).toUpperCase() === ud && Number(m.aliquota) > 0);
  // Prefere a linha generica (sem transportadora/cidade/canal especificos).
  const generica = candidatas.find((m) => !m.transportadora && !m.cidadeOrigem && !m.canal);
  const achada = generica || candidatas[0];
  if (achada) return { aliquota: Number(achada.aliquota), fonte: 'matriz' };
  if (!uo || !ud) return { aliquota: null, fonte: 'sem_uf' };
  // Sem matriz cadastrada: regra geral do ICMS de transporte.
  if (uo === ud) return { aliquota: 18, fonte: 'estimada_interna' };
  const para7 = UF_SUL_SUDESTE.has(uo) && !UF_SUL_SUDESTE.has(ud);
  return { aliquota: para7 ? 7 : 12, fonte: 'estimada_interestadual' };
}

function calcular(liquido, pedagio, aliquota) {
  const liq = Number(liquido) || 0;
  const ped = Number(pedagio) || 0;
  const base = liq + ped;
  if (!(aliquota > 0) || aliquota >= 100) return { bruto: arred(base), icms: 0 };
  const bruto = arred(base / (1 - aliquota / 100));
  return { bruto, icms: arred(bruto - base) };
}

// ---- Paginas ---------------------------------------------------------------
function paginaErro(titulo, detalhe) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.box{max-width:520px;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:32px;text-align:center}h1{margin:0 0 10px;font-size:20px}p{color:#475569;line-height:1.5}</style></head>
<body><div class="box"><h1>${esc(titulo)}</h1><p>${esc(detalhe)}</p></div></body></html>`;
}

function paginaPortal({ convite, cotacao }) {
  const encerrada = cotacao.status !== 'ABERTA';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Cotação de lotação — ${esc(convite.transportadora)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
.page{max-width:1180px;margin:20px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}
header{padding:24px 30px;background:#06183d;color:#fff}header h1{margin:0 0 6px;font-size:21px}header p{margin:3px 0;color:#cbd5e1;font-size:14px}
.corpo{padding:22px 30px}label{display:block;font-size:13px;font-weight:bold;margin:12px 0 4px;color:#334155}
input,textarea{width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px}
button{background:#185FA5;color:#fff;border:0;border-radius:8px;padding:11px 20px;font-size:15px;font-weight:bold;cursor:pointer}
button.sec{background:#fff;color:#185FA5;border:1px solid #185FA5}button:disabled{opacity:.5;cursor:default}
.id{max-width:460px}.msg{padding:11px 14px;border-radius:8px;margin:12px 0;font-size:14px;line-height:1.45}
.erro{background:#fee2e2;color:#991b1b}.ok{background:#dcfce7;color:#166534}.info{background:#e0f2fe;color:#075985}
.regra{background:#f8fafc;border:1px solid #dbe3ef;border-radius:10px;padding:12px 16px;font-size:13px;line-height:1.55;margin-bottom:14px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th{background:#1E3A5F;color:#fff;padding:8px 6px;text-align:center;position:sticky;top:0;white-space:nowrap}
td{padding:5px 6px;border-bottom:1px solid #e2e8f0;vertical-align:middle}td.n{text-align:right;white-space:nowrap}
td input{padding:6px 7px;font-size:13px;min-width:92px;text-align:right}td input.t{text-align:left}
.fixo{background:#f1f5f9;font-weight:bold}.bruto{font-weight:bold;color:#06183d;background:#f0f7ff}
.barra{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0;position:sticky;bottom:0;background:#fff;padding:10px 0;border-top:1px solid #e2e8f0}
.pill{font-size:11px;padding:2px 7px;border-radius:99px;background:#fef3c7;color:#92400e;margin-left:4px}
tr.feita td{background:#f0fdf4}
@media(max-width:700px){.corpo,header{padding:16px}}
</style></head><body><div class="page">
<header><h1>Cotação de lotação</h1><p><b>${esc(convite.transportadora)}</b> · ${esc(cotacao.nome)}</p>
${cotacao.prazo_resposta ? `<p>Responder até ${esc(String(cotacao.prazo_resposta).slice(0, 10).split('-').reverse().join('/'))}</p>` : ''}</header>
<div class="corpo" id="app">
${encerrada ? '<div class="msg erro">Esta cotação foi encerrada e não aceita mais respostas.</div>' : `
<div id="telaId" class="id">
  <div class="msg info">Para liberar suas rotas, confirme quem está respondendo. O CNPJ é obrigatório e fica registrado junto com a cotação de <b>${esc(convite.transportadora)}</b>.</div>
  <label for="cnpj">CNPJ da transportadora</label><input id="cnpj" inputmode="numeric" placeholder="00.000.000/0000-00" autocomplete="off">
  <label for="nome">Seu nome</label><input id="nome" autocomplete="name">
  <label for="email">Seu e-mail</label><input id="email" type="email" autocomplete="email">
  <div id="erroId"></div>
  <p><button id="btnId" onclick="identificar()">Acessar minhas rotas</button></p>
</div>
<div id="telaTab" style="display:none"></div>`}
</div></div>
<script>
var TOKEN=${JSON.stringify(convite.token)},ACESSO='',ROTAS=[],PROP={},fmt=function(n){return Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})};
function num(v){if(v===''||v==null)return null;var t=String(v).replace(/R\\$/gi,'').replace(/\\s/g,'');if(t.indexOf(',')>=0)t=t.replace(/\\./g,'').replace(',','.');var n=Number(t);return isFinite(n)?n:null}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function api(corpo){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.erro||'Erro');return j})})}
function identificar(){var b=document.getElementById('btnId');document.getElementById('erroId').innerHTML='';
  var cnpj=document.getElementById('cnpj').value,nome=document.getElementById('nome').value.trim(),email=document.getElementById('email').value.trim();
  if(!nome||!email||cnpj.replace(/\\D/g,'').length!==14){document.getElementById('erroId').innerHTML='<div class="msg erro">Informe CNPJ (14 dígitos), nome e e-mail.</div>';return}
  b.disabled=true;api({acao:'identificar',cnpj:cnpj,nome:nome,email:email}).then(function(j){ACESSO=j.acesso;ROTAS=j.rotas;PROP={};j.propostas.forEach(function(p){PROP[p.chave]=p});
    document.getElementById('telaId').style.display='none';montar(j.status)}).catch(function(e){document.getElementById('erroId').innerHTML='<div class="msg erro">'+esc(e.message)+'</div>';b.disabled=false})}
function montar(status){var t=document.getElementById('telaTab');t.style.display='block';
  var h='<div class="regra"><b>Como preencher</b><br>• Informe o <b>valor líquido</b> do frete (sem ICMS) e o <b>pedágio</b> da viagem, por rota e tipo de veículo. O tipo de veículo é fixo.<br>• O <b>ICMS</b> é calculado automaticamente pela origem/destino e o <b>valor bruto total</b> = (líquido + pedágio) ÷ (1 − alíquota ICMS).<br>• Deixe em branco as rotas que você não atende. O volume é histórico, apenas referência de potencial — não é garantia de contratação.</div>'
  +(status==='ENVIADO'?'<div class="msg ok">Você já enviou esta cotação. Se alterar valores, clique em enviar novamente para atualizar.</div>':'')
  +'<div id="msgTab"></div><div class="tw"><table><thead><tr><th>Origem</th><th>Destino</th><th>Veículo</th><th>KM</th><th>Viagens (hist.)</th><th>Valor líquido (R$)</th><th>Pedágio (R$)</th><th>ICMS %</th><th>ICMS (R$)</th><th>Valor bruto total (R$)</th><th>Prazo (dias)</th><th>Validade</th><th>Obs.</th></tr></thead><tbody>';
  ROTAS.forEach(function(r,i){var p=PROP[r.chave]||{};
    h+='<tr id="l'+i+'"><td class="fixo">'+esc(r.origem)+(r.uf_origem?'/'+esc(r.uf_origem):'')+'</td><td class="fixo">'+esc(r.destino)+(r.uf_destino?'/'+esc(r.uf_destino):'')+'</td><td class="fixo">'+esc(r.tipo_veiculo)+'</td><td class="n">'+(r.km?fmt(r.km).replace(/,00$/,''):'-')+'</td><td class="n">'+(r.viagens?Math.round(r.viagens):'-')+'</td>'
    +'<td><input id="liq'+i+'" value="'+(p.valor_liquido!=null?fmt(p.valor_liquido):'')+'" oninput="calc('+i+')" inputmode="decimal"></td>'
    +'<td><input id="ped'+i+'" value="'+(p.pedagio!=null?fmt(p.pedagio):'')+'" oninput="calc('+i+')" inputmode="decimal"></td>'
    +'<td class="n" id="al'+i+'">'+(r.aliquota!=null?fmt(r.aliquota)+'%':'<span class="pill">sem alíquota</span>')+(r.aliquota_fonte&&r.aliquota_fonte.indexOf('estimada')===0?'<span class="pill">estimada</span>':'')+'</td>'
    +'<td class="n" id="ic'+i+'">-</td><td class="n bruto" id="br'+i+'">-</td>'
    +'<td><input id="pz'+i+'" value="'+(p.prazo_dias!=null?p.prazo_dias:'')+'" inputmode="numeric" style="min-width:60px"></td>'
    +'<td><input id="vl'+i+'" type="date" value="'+(p.validade?String(p.validade).slice(0,10):'')+'" style="min-width:130px"></td>'
    +'<td><input class="t" id="ob'+i+'" value="'+esc(p.observacao||'')+'" style="min-width:140px"></td></tr>'});
  h+='</tbody></table></div><div class="barra"><button class="sec" onclick="enviar(false)">Salvar rascunho</button><button onclick="enviar(true)">Enviar cotação</button><span id="cont"></span></div>';
  t.innerHTML=h;ROTAS.forEach(function(r,i){calc(i)})}
function calc(i){var r=ROTAS[i],liq=num(document.getElementById('liq'+i).value),ped=num(document.getElementById('ped'+i).value)||0,a=r.aliquota;
  var ic=document.getElementById('ic'+i),br=document.getElementById('br'+i),tr=document.getElementById('l'+i);
  if(liq>0){var base=liq+ped,bruto=(a>0&&a<100)?base/(1-a/100):base;br.textContent=fmt(bruto);ic.textContent=fmt(bruto-base);tr.className='feita'}else{br.textContent='-';ic.textContent='-';tr.className=''}
  var n=0;ROTAS.forEach(function(x,k){if(num(document.getElementById('liq'+k).value)>0)n++});document.getElementById('cont').textContent=n+' de '+ROTAS.length+' rotas preenchidas'}
function enviar(final){var itens=[],m=document.getElementById('msgTab');m.innerHTML='';
  for(var i=0;i<ROTAS.length;i++){var liq=num(document.getElementById('liq'+i).value),ped=num(document.getElementById('ped'+i).value);
    var tem=liq!=null||ped!=null||document.getElementById('pz'+i).value||document.getElementById('ob'+i).value;
    if(!tem)continue;
    if(!(liq>0)){m.innerHTML='<div class="msg erro">Linha '+(i+1)+' ('+esc(ROTAS[i].origem)+' → '+esc(ROTAS[i].destino)+'): informe o valor líquido.</div>';document.getElementById('l'+i).scrollIntoView({block:'center'});return}
    itens.push({chave:ROTAS[i].chave,liquido:liq,pedagio:ped||0,prazo:document.getElementById('pz'+i).value,validade:document.getElementById('vl'+i).value,obs:document.getElementById('ob'+i).value})}
  if(final){if(!itens.length){m.innerHTML='<div class="msg erro">Preencha ao menos uma rota antes de enviar.</div>';return}
    if(!confirm('Enviar '+itens.length+' rota(s) para análise? Os valores líquidos serão somados ao ICMS e ao pedágio para formar o bruto.'))return}
  api({acao:'salvar',acesso:ACESSO,itens:itens,enviar:final}).then(function(j){m.innerHTML='<div class="msg ok">'+(final?'✅ Cotação enviada com '+j.salvas+' rota(s). Obrigado! O time de suprimentos já recebeu.':'Rascunho salvo ('+j.salvas+' rota(s)).')+'</div>';window.scrollTo(0,0)}).catch(function(e){m.innerHTML='<div class="msg erro">'+esc(e.message)+'</div>'})}
</script></body></html>`;
}

// ---- Handler ---------------------------------------------------------------
function enviarJson(res, status, corpo) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(corpo));
}
function enviarHtml(res, status, html) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

function rotasVisiveis(rotas, convite) {
  const chaves = Array.isArray(convite.chaves) ? new Set(convite.chaves) : null;
  return rotas.filter((r) => !chaves || chaves.has(r.chave));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const token = String(req.query?.token || '').replace(/[^a-zA-Z0-9]/g, '');
  if (!token) return enviarHtml(res, 400, paginaErro('Link inválido', 'O link de cotação está incompleto.'));

  let ctx;
  try { ctx = getClient(); } catch (e) { return enviarHtml(res, 500, paginaErro('Portal indisponível', e.message)); }
  const { supabase, segredo } = ctx;

  try {
    const { data: convite, error } = await supabase.from('lotacao_cotacao_convites').select('*').eq('token', token).maybeSingle();
    if (error) throw error;
    if (!convite) return enviarHtml(res, 404, paginaErro('Link inválido', 'Este link de cotação não foi encontrado. Solicite um novo link ao time de suprimentos.'));
    const { data: cotacao } = await supabase.from('lotacao_cotacoes').select('*').eq('id', convite.cotacao_id).maybeSingle();
    if (!cotacao) return enviarHtml(res, 404, paginaErro('Cotação não encontrada', 'Esta cotação não existe mais.'));

    const expirado = convite.expira_em && new Date(convite.expira_em).getTime() < Date.now();
    if (expirado) {
      if (req.method === 'GET') return enviarHtml(res, 410, paginaErro('Link expirado', 'O prazo deste link terminou. Solicite um novo link ao time de suprimentos.'));
      return enviarJson(res, 410, { erro: 'Link expirado. Solicite um novo link ao time de suprimentos.' });
    }

    if (req.method === 'GET') return enviarHtml(res, 200, paginaPortal({ convite, cotacao }));
    if (req.method !== 'POST') return enviarJson(res, 405, { erro: 'Método não permitido.' });

    const body = lerCorpo(req);
    if (cotacao.status !== 'ABERTA') return enviarJson(res, 409, { erro: 'Esta cotação foi encerrada.' });

    if (body.acao === 'identificar') {
      const cnpj = soDigitos(body.cnpj);
      const nome = String(body.nome || '').trim().slice(0, 120);
      const email = String(body.email || '').trim().slice(0, 160);
      if (!cnpjValido(cnpj)) return enviarJson(res, 400, { erro: 'Informe um CNPJ válido (14 dígitos).' });
      if (!nome || !email.includes('@')) return enviarJson(res, 400, { erro: 'Informe seu nome e um e-mail válido.' });
      await supabase.from('lotacao_cotacao_convites').update({
        respondente_nome: nome, respondente_email: email, respondente_cnpj: cnpj,
        primeiro_acesso_em: convite.primeiro_acesso_em || new Date().toISOString(),
        status: convite.status === 'ENVIADO' ? 'ENVIADO' : 'EM_PREENCHIMENTO',
      }).eq('id', convite.id);

      const [{ data: rotasDb }, { data: propostas }, matriz] = await Promise.all([
        supabase.from('lotacao_cotacao_rotas').select('*').eq('cotacao_id', cotacao.id).limit(20000),
        supabase.from('lotacao_cotacao_propostas').select('*').eq('convite_id', convite.id).limit(20000),
        carregarMatrizIcms(supabase),
      ]);
      const rotas = rotasVisiveis(rotasDb || [], convite)
        .sort((a, b) => Number(b.viagens || 0) - Number(a.viagens || 0) || String(a.origem).localeCompare(String(b.origem), 'pt-BR') || String(a.destino).localeCompare(String(b.destino), 'pt-BR'))
        .map((r) => {
          const a = aliquotaDaRota(matriz, r.uf_origem, r.uf_destino);
          // target e frete medio NUNCA vao para o portal.
          return { chave: r.chave, origem: r.origem, uf_origem: r.uf_origem, destino: r.destino, uf_destino: r.uf_destino, tipo_veiculo: r.tipo_veiculo, km: r.km, viagens: r.viagens, aliquota: a.aliquota, aliquota_fonte: a.fonte };
        });
      return enviarJson(res, 200, { acesso: gerarAcesso(token, segredo), rotas, propostas: propostas || [], status: convite.status });
    }

    if (body.acao === 'salvar') {
      if (!acessoValido(token, body.acesso, segredo)) return enviarJson(res, 401, { erro: 'Sessão expirada. Recarregue a página e se identifique novamente.' });
      const itens = Array.isArray(body.itens) ? body.itens.slice(0, 20000) : [];
      const [{ data: rotasDb }, matriz] = await Promise.all([
        supabase.from('lotacao_cotacao_rotas').select('chave,uf_origem,uf_destino').eq('cotacao_id', cotacao.id).limit(20000),
        carregarMatrizIcms(supabase),
      ]);
      const rotaPorChave = new Map(rotasVisiveis(rotasDb || [], convite).map((r) => [r.chave, r]));
      const agora = new Date().toISOString();
      const linhas = [];
      for (const it of itens) {
        const rota = rotaPorChave.get(String(it.chave));
        const liquido = numero(it.liquido);
        if (!rota || !(liquido > 0)) continue;
        const pedagio = Math.max(numero(it.pedagio) || 0, 0);
        const { aliquota } = aliquotaDaRota(matriz, rota.uf_origem, rota.uf_destino);
        const { bruto, icms } = calcular(liquido, pedagio, aliquota);
        const prazo = parseInt(it.prazo, 10);
        linhas.push({
          convite_id: convite.id, cotacao_id: cotacao.id, chave: String(it.chave),
          valor_liquido: arred(liquido), pedagio: arred(pedagio), aliquota_icms: aliquota, icms_valor: icms, valor_bruto: bruto,
          prazo_dias: Number.isFinite(prazo) && prazo > 0 ? prazo : null,
          validade: /^\d{4}-\d{2}-\d{2}$/.test(String(it.validade || '')) ? it.validade : null,
          observacao: String(it.obs || '').slice(0, 500) || null, updated_at: agora,
        });
      }
      // Linha apagada no portal sai da proposta (o que esta na tela e a verdade).
      const { data: existentes } = await supabase.from('lotacao_cotacao_propostas').select('id,chave').eq('convite_id', convite.id).limit(20000);
      const mantidas = new Set(linhas.map((l) => l.chave));
      const remover = (existentes || []).filter((e) => !mantidas.has(e.chave)).map((e) => e.id);
      for (let i = 0; i < remover.length; i += 200) await supabase.from('lotacao_cotacao_propostas').delete().in('id', remover.slice(i, i + 200));
      for (let i = 0; i < linhas.length; i += 500) {
        const { error: e2 } = await supabase.from('lotacao_cotacao_propostas').upsert(linhas.slice(i, i + 500), { onConflict: 'convite_id,chave' });
        if (e2) throw e2;
      }
      if (body.enviar && linhas.length) {
        await supabase.from('lotacao_cotacao_convites').update({ status: 'ENVIADO', enviado_em: agora }).eq('id', convite.id);
      }
      return enviarJson(res, 200, { ok: true, salvas: linhas.length });
    }

    return enviarJson(res, 400, { erro: 'Ação inválida.' });
  } catch (e) {
    console.error('[lotacao-cotacao]', e);
    const msg = String(e?.message || e);
    return enviarJson(res, 500, { erro: /does not exist|schema cache/i.test(msg) ? 'Cotação ainda não habilitada (migration pendente).' : 'Erro ao processar. Tente novamente.' });
  }
}
