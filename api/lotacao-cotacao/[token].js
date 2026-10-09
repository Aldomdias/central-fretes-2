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
 *   bruto = liquido / (1 - aliquota)      icms = bruto - liquido   (pedagio e pago pela Cantu, fora da cotacao)
 */
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

const VALIDADE_ACESSO_MS = 8 * 60 * 60 * 1000;
const UF_SUL_SUDESTE = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);
// Aliquotas internas de referencia (conferir na tela ICMS UF; a tabela do sistema tem prioridade).
const ALIQUOTA_INTERNA_UF = {
  AC: 19, AL: 20, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19, MA: 23, MG: 18, MS: 17, MT: 17,
  PA: 19, PB: 20, PE: 20.5, PI: 22.5, PR: 19.5, RJ: 22, RN: 20, RO: 19.5, RR: 20, RS: 17, SC: 17, SE: 19, SP: 18, TO: 20,
};

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
  // Par fora da tabela do sistema: aplica a legislacao (Resolucao do Senado 22/89
  // para o interestadual; aliquota interna da UF de origem para o intramunicipal/UF).
  if (uo === ud) {
    const interna = ALIQUOTA_INTERNA_UF[uo];
    return interna ? { aliquota: interna, fonte: 'estimada_interna' } : { aliquota: null, fonte: 'sem_uf' };
  }
  const para7 = UF_SUL_SUDESTE.has(uo) && !UF_SUL_SUDESTE.has(ud);
  return { aliquota: para7 ? 7 : 12, fonte: 'legislacao_interestadual' };
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
<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"></script>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif;font-size:15px}
.page{width:98%;max-width:1800px;margin:16px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}
header{padding:22px 30px;background:#06183d;color:#fff}header h1{margin:0 0 6px;font-size:24px}header p{margin:3px 0;color:#cbd5e1;font-size:15px}
.corpo{padding:20px 26px}label{display:block;font-size:14px;font-weight:bold;margin:12px 0 4px;color:#334155}
input,textarea{width:100%;padding:10px 11px;border:1px solid #94a3b8;border-radius:8px;font-size:15px;background:#fff}
button{background:#185FA5;color:#fff;border:0;border-radius:8px;padding:11px 20px;font-size:15px;font-weight:bold;cursor:pointer}
button.sec{background:#fff;color:#185FA5;border:2px solid #185FA5}button:disabled{opacity:.5;cursor:default}
.id{max-width:480px}.msg{padding:12px 15px;border-radius:8px;margin:12px 0;font-size:15px;line-height:1.45}
.erro{background:#fee2e2;color:#991b1b}.ok{background:#dcfce7;color:#166534}.info{background:#e0f2fe;color:#075985}
.regra{background:#f8fafc;border:1px solid #dbe3ef;border-radius:10px;padding:14px 18px;font-size:14px;line-height:1.6;margin-bottom:14px}
.ferr{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:12px;background:#f0f7ff;border:1px solid #bcd7f2;border-radius:10px}
.ferr input[type=text]{width:260px;margin-left:auto}
.tw{overflow:auto;max-height:68vh;border:1px solid #cbd5e1;border-radius:8px}
table{border-collapse:separate;border-spacing:0;width:100%;font-size:14px;min-width:1500px}
th{background:#1E3A5F;color:#fff;padding:10px 8px;text-align:center;position:sticky;top:0;z-index:2;white-space:nowrap;font-size:13px}
th.pre{background:#b45309}th.calc{background:#475569}
td{padding:6px 8px;border-bottom:1px solid #e2e8f0;vertical-align:middle;background:#fff}td.n{text-align:right;white-space:nowrap}
tbody tr:nth-child(even) td{background:#f8fafc}
td input{padding:8px 9px;font-size:15px;min-width:120px;text-align:right;border:2px solid #fcd34d;background:#fffbeb}td input.t{text-align:left}
.fixo{font-weight:bold}.bruto{font-weight:bold;color:#06183d;background:#e0f0ff!important;font-size:15px}
.barra{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:14px 0 0;position:sticky;bottom:0;background:#fff;padding:12px 0;border-top:2px solid #e2e8f0}
.pill{font-size:11px;padding:2px 7px;border-radius:99px;background:#fef3c7;color:#92400e;margin-left:4px}
tr.feita td{background:#ecfdf3!important}
.fl{font-size:14px;font-weight:bold;color:#334155;display:flex;align-items:center;gap:6px;margin:0}.fl select{padding:9px;border:1px solid #94a3b8;border-radius:8px;font-size:14px;min-width:200px;max-width:280px}
.eixos{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;padding:10px 14px;background:#fffbeb;border:2px solid #fcd34d;border-radius:10px;font-size:14px}.eixos label{display:flex;align-items:center;gap:8px;font-weight:bold;margin:0}.eixos select{padding:8px;border:1px solid #94a3b8;border-radius:8px;font-size:15px}.ok1{color:#166534}.aten{color:#b45309;font-weight:bold}tr.feita td.bruto{background:#c9f0d9!important}
@media(max-width:700px){.corpo,header{padding:14px}}
</style></head><body><div class="page">
<header><h1>Cotação de lotação</h1><p><b>${esc(convite.transportadora)}</b> · ${esc(cotacao.nome)}</p>
${cotacao.prazo_resposta ? `<p>Responder até ${esc(String(cotacao.prazo_resposta).slice(0, 10).split('-').reverse().join('/'))}</p>` : ''}
${convite.expira_em ? `<p>Este link vale até ${esc(new Date(convite.expira_em).toLocaleDateString('pt-BR'))}</p>` : ''}</header>
<div class="corpo" id="app">
${encerrada ? '<div class="msg erro">Esta cotação foi encerrada e não aceita mais respostas.</div>' : `
<div id="telaId" class="id">
  <div class="msg info">Para liberar suas rotas, informe os dados abaixo. O <b>CNPJ é obrigatório</b> e fica registrado junto com a cotação de <b>${esc(convite.transportadora)}</b>.</div>
  <label for="cnpj">CNPJ da transportadora</label><input id="cnpj" inputmode="numeric" placeholder="00.000.000/0000-00" autocomplete="off">
  <label for="nome">Seu nome</label><input id="nome" autocomplete="name">
  <label for="email">Seu e-mail</label><input id="email" type="email" autocomplete="email">
  <div id="erroId"></div>
  <p><button id="btnId" onclick="identificar()">Acessar minhas rotas</button></p>
</div>
<div id="telaTab" style="display:none"></div>`}
</div></div>
<script>
var TOKEN=${JSON.stringify(convite.token)},NOMETRANSP=${JSON.stringify(convite.transportadora)},ACESSO='',EIXOS=5,ROTAS=[],PROP={},fmt=function(n){return Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})};
function num(v){if(v===''||v==null)return null;var t=String(v).replace(/R\\$/gi,'').replace(/\\s/g,'');if(t.indexOf(',')>=0)t=t.replace(/\\./g,'').replace(',','.');var n=Number(t);return isFinite(n)?n:null}
function fmt1(n){return Number(n).toLocaleString('pt-BR',{maximumFractionDigits:1})}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function sa(s){return String(s==null?'':s).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim()}
function kc(s){return sa(s).replace(/\\s*\\/\\s*[A-Z][A-Z]$/,'').trim()}
function api(corpo){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.erro||'Erro');return j})})}
function identificar(){var b=document.getElementById('btnId');document.getElementById('erroId').innerHTML='';
  var cnpj=document.getElementById('cnpj').value,nome=document.getElementById('nome').value.trim(),email=document.getElementById('email').value.trim();
  if(!nome||!email||cnpj.replace(/\\D/g,'').length!==14){document.getElementById('erroId').innerHTML='<div class="msg erro">Informe CNPJ (14 dígitos), nome e e-mail.</div>';return}
  b.disabled=true;api({acao:'identificar',cnpj:cnpj,nome:nome,email:email}).then(function(j){ACESSO=j.acesso;EIXOS=j.eixos||5;ROTAS=j.rotas;PROP={};j.propostas.forEach(function(p){PROP[p.chave]=p});
    document.getElementById('telaId').style.display='none';montar(j.status)}).catch(function(e){document.getElementById('erroId').innerHTML='<div class="msg erro">'+esc(e.message)+'</div>';b.disabled=false})}
function montar(status){var t=document.getElementById('telaTab');t.style.display='block';
  var h='<div class="regra"><b>Como preencher</b><br>• Informe o <b>valor líquido</b> do frete (sem ICMS) por rota e tipo de veículo. O tipo de veículo é fixo. O pedágio é pago pela Cantu e <b>não entra</b> na cotação.<br>• O <b>ICMS</b> é calculado automaticamente pela origem/destino e o <b>valor bruto total</b> = líquido ÷ (1 − alíquota ICMS).<br>• Prefere trabalhar no Excel? <b>Baixe o modelo</b>, preencha e <b>importe</b> de volta. Confira os valores e clique em <b>Enviar cotação</b>.<br>• Deixe em branco as rotas que você não atende. O volume é a média mensal do histórico, apenas referência de potencial — não é garantia de contratação.</div>'
  +(status==='ENVIADO'?'<div class="msg ok">Você já enviou esta cotação. Se alterar valores, clique em enviar novamente para atualizar.</div>':'')
  +'<div class="ferr"><button class="sec" onclick="baixarModelo()">⬇ Baixar modelo (Excel)</button><button class="sec" onclick="document.getElementById(\\'arq\\').click()">⬆ Importar planilha preenchida</button><input type="file" id="arq" accept=".xlsx,.xls,.csv" style="display:none" onchange="importar(this)"><label class="fl">Origem <select id="fo" onchange="filtrar(1)"></select></label><label class="fl">Destino <select id="fd" onchange="filtrar(1)"></select></label><span id="nvis" class="fl"></span></div>'
  +'<div class="eixos"><label>Eixos do veículo <select id="eixos" onchange="mudaEixos()"><option value="5">5 eixos</option><option value="6">6 eixos</option></select></label><span id="avEixos"></span></div>'
  +'<div id="msgTab"></div><div class="tw"><table><thead><tr><th>Origem</th><th>Destino</th><th>Veículo</th><th>KM</th><th>Média mensal (viagens)</th><th class="pre">Valor líquido (R$)</th><th class="calc">ICMS %</th><th class="calc">ICMS (R$)</th><th class="calc">Valor bruto total (R$)</th><th class="pre">Prazo (dias)</th><th class="pre">Obs.</th></tr></thead><tbody>';
  ROTAS.forEach(function(r,i){var p=PROP[r.chave]||{};
    h+='<tr id="l'+i+'"><td class="fixo">'+esc(r.origem)+(r.uf_origem?'/'+esc(r.uf_origem):'')+'</td><td class="fixo">'+esc(r.destino)+(r.uf_destino?'/'+esc(r.uf_destino):'')+'</td><td class="fixo">'+esc(r.tipo_veiculo)+'</td><td class="n">'+(r.km?fmt(r.km).replace(/,00$/,''):'-')+'</td><td class="n">'+(r.viagens?fmt1(r.viagens):'-')+'</td>'
    +'<td><input id="liq'+i+'" value="'+(p.valor_liquido!=null?fmt(p.valor_liquido):'')+'" oninput="calc('+i+')" inputmode="decimal"></td>'
    +'<td class="n" id="al'+i+'">'+(r.aliquota!=null?fmt(r.aliquota)+'%':'<span class="pill">sem alíquota</span>')+(r.aliquota_fonte&&r.aliquota_fonte.indexOf('estimada')===0?'<span class="pill">estimada</span>':'')+'</td>'
    +'<td class="n" id="ic'+i+'">-</td><td class="n bruto" id="br'+i+'">-</td>'
    +'<td><input id="pz'+i+'" value="'+(p.prazo_dias!=null?p.prazo_dias:'')+'" inputmode="numeric" style="min-width:80px"></td>'
    +'<td><input class="t" id="ob'+i+'" value="'+esc(p.observacao||'')+'" style="min-width:180px"></td></tr>'});
  h+='</tbody></table></div><div class="barra"><button class="sec" onclick="enviar(false)">Salvar rascunho</button><button onclick="enviar(true)">Enviar cotação</button><span id="cont"></span></div>';
  t.innerHTML=h;document.getElementById('eixos').value=String(EIXOS);mudaEixos();montaFiltros();ROTAS.forEach(function(r,i){calc(i)})}
function mudaEixos(){var e=document.getElementById('eixos');EIXOS=Number(e.value)||5;document.getElementById('avEixos').innerHTML=EIXOS===5?' <span class="ok1">99% dos nossos embarques são com 5 eixos: sua tabela será comparada com os valores de 5 eixos.</span>':' <span class="aten">Atenção: 99% dos nossos embarques são com 5 eixos. Com 6 eixos a comparação usa a tabela ANTT de 6 eixos.</span>'}
function montaFiltros(){var fo=document.getElementById('fo'),fd=document.getElementById('fd'),vo=fo.value,vd=fd.value,O={},D={};
  ROTAS.forEach(function(r){if(!vd||sa(r.destino)===vd)O[sa(r.origem)]=r.origem;if(!vo||sa(r.origem)===vo)D[sa(r.destino)]=r.destino});
  var mk=function(M,tod){var k=Object.keys(M).sort(function(a,b){return a<b?-1:1});return '<option value="">'+tod+'</option>'+k.map(function(x){return '<option value="'+esc(x)+'">'+esc(M[x])+'</option>'}).join('')};
  fo.innerHTML=mk(O,'Todas as origens');fd.innerHTML=mk(D,'Todos os destinos');fo.value=O[vo]?vo:'';fd.value=D[vd]?vd:''}
function filtrar(q){if(q)montaFiltros();var vo=document.getElementById('fo').value,vd=document.getElementById('fd').value,n=0;
  ROTAS.forEach(function(r,i){var ok=(!vo||sa(r.origem)===vo)&&(!vd||sa(r.destino)===vd);document.getElementById('l'+i).style.display=ok?'':'none';if(ok)n++});
  document.getElementById('nvis').textContent=n+' de '+ROTAS.length+' rotas'}
function calc(i){var r=ROTAS[i],liq=num(document.getElementById('liq'+i).value),a=r.aliquota;
  var ic=document.getElementById('ic'+i),br=document.getElementById('br'+i),tr=document.getElementById('l'+i);
  if(liq>0){var base=liq,bruto=(a>0&&a<100)?base/(1-a/100):base;br.textContent=fmt(bruto);ic.textContent=fmt(bruto-base);tr.className='feita'}else{br.textContent='-';ic.textContent='-';tr.className=''}
  var n=0;ROTAS.forEach(function(x,k){if(num(document.getElementById('liq'+k).value)>0)n++});document.getElementById('cont').textContent=n+' de '+ROTAS.length+' rotas preenchidas'}
function baixarModelo(){
  if(!window.XLSX){alert('Não foi possível carregar o recurso de Excel. Verifique sua conexão e tente de novo.');return}
  var HR=4,NC=13,L='CBD5E1';
  var cab=['Origem','UF origem','Destino','UF destino','Veículo','KM','Média mensal (viagens)','ICMS %','Valor líquido (R$)','Valor bruto total (R$)','Prazo (dias)','Observação','CHAVE (não alterar)'];
  var tipo=['f','f','f','f','f','f','f','c','i','c','i','i','f'];
  var aoa=[['COTAÇÃO DE LOTAÇÃO — '+NOMETRANSP],['Preencha somente as colunas AMARELAS: Valor líquido (sem ICMS), Prazo e Observação. O ICMS e o Valor bruto total são calculados. O tipo de veículo é fixo. Deixe em branco as rotas que você não atende.'],['Legenda:   AMARELO = você preenche   ·   CINZA = informação da rota (não alterar)   ·   AZUL = calculado automaticamente'],['EIXOS DO VEÍCULO (5 ou 6)  →','','',EIXOS],cab];
  ROTAS.forEach(function(r,i){
    aoa.push([r.origem,r.uf_origem||'',r.destino,r.uf_destino||'',r.tipo_veiculo,r.km||'',r.viagens?Math.round(r.viagens*10)/10:'',r.aliquota!=null?r.aliquota:'',num(document.getElementById('liq'+i).value)||'','',document.getElementById('pz'+i).value||'',document.getElementById('ob'+i).value||'',r.chave])});
  var ws=XLSX.utils.aoa_to_sheet(aoa);
  var borda={top:{style:'thin',color:{rgb:L}},bottom:{style:'thin',color:{rgb:L}},left:{style:'thin',color:{rgb:L}},right:{style:'thin',color:{rgb:L}}};
  function est(r,c,s,z){var a=XLSX.utils.encode_cell({r:r,c:c});if(!ws[a])ws[a]={t:'s',v:''};ws[a].s=s;if(z)ws[a].z=z}
  est(0,0,{font:{bold:true,sz:16,color:{rgb:'FFFFFF'}},fill:{patternType:'solid',fgColor:{rgb:'06183D'}},alignment:{vertical:'center',horizontal:'left'}});
  for(var c0=1;c0<NC;c0++)est(0,c0,{fill:{patternType:'solid',fgColor:{rgb:'06183D'}}});
  est(1,0,{font:{sz:11,color:{rgb:'334155'}},alignment:{wrapText:true,vertical:'center'}});
  est(2,0,{font:{bold:true,sz:11,color:{rgb:'92400E'}},fill:{patternType:'solid',fgColor:{rgb:'FEF3C7'}},alignment:{vertical:'center'}});
  est(3,0,{font:{bold:true,sz:11,color:{rgb:'92400E'}},fill:{patternType:'solid',fgColor:{rgb:'FEF3C7'}},alignment:{vertical:'center'}});est(3,1,{fill:{patternType:'solid',fgColor:{rgb:'FEF3C7'}}});est(3,2,{fill:{patternType:'solid',fgColor:{rgb:'FEF3C7'}}});est(3,3,{font:{bold:true,sz:12},fill:{patternType:'solid',fgColor:{rgb:'FFF7CC'}},alignment:{horizontal:'center',vertical:'center'},border:borda});
  var corCab={f:'1E3A5F',i:'B45309',c:'475569'},corCel={f:'F1F5F9',i:'FFF7CC',c:'E0F0FF'};
  for(var c=0;c<NC;c++){est(HR,c,{font:{bold:true,sz:11,color:{rgb:'FFFFFF'}},fill:{patternType:'solid',fgColor:{rgb:corCab[tipo[c]]}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:borda})}
  for(var k=HR+1;k<aoa.length;k++){var ex=k+1;
    ws['J'+ex]={t:'n',f:'IF(I'+ex+'>0,I'+ex+'/(1-N(H'+ex+')/100),"")'};
    for(var c2=0;c2<NC;c2++){
      var z=(c2===8||c2===9)?'#,##0.00':(c2===7?'0.00"%"':((c2===5||c2===6||c2===10)?'#,##0':null));
      var numerico=(c2>=5&&c2<=10);
      est(k,c2,{font:{sz:11,bold:(c2===0||c2===2||c2===4||c2===9),color:{rgb:c2===12?'94A3B8':'0F172A'}},fill:{patternType:'solid',fgColor:{rgb:corCel[tipo[c2]]}},alignment:{horizontal:numerico?'right':'left',vertical:'center'},border:(tipo[c2]==='i'?{top:{style:'thin',color:{rgb:'F59E0B'}},bottom:{style:'thin',color:{rgb:'F59E0B'}},left:{style:'thin',color:{rgb:'F59E0B'}},right:{style:'thin',color:{rgb:'F59E0B'}}}:borda)},z)}}
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:9}},{s:{r:1,c:0},e:{r:1,c:11}},{s:{r:2,c:0},e:{r:2,c:11}},{s:{r:3,c:0},e:{r:3,c:2}}];
  ws['!rows']=[{hpt:32},{hpt:36},{hpt:22},{hpt:24},{hpt:34}];
  ws['!cols']=[{wch:28},{wch:9},{wch:28},{wch:9},{wch:18},{wch:8},{wch:12},{wch:9},{wch:19},{wch:21},{wch:12},{wch:32},{wch:40,hidden:true}];
  ws['!autofilter']={ref:'A'+(HR+1)+':M'+aoa.length};
  ws['!freeze']={xSplit:0,ySplit:HR+1};
  ws['!views']=[{state:'frozen',ySplit:HR+1,xSplit:0}];
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Cotacao');
  XLSX.writeFile(wb,'cotacao-lotacao-'+NOMETRANSP.replace(/[^a-z0-9]+/gi,'-')+'.xlsx')}
function dataIso(v){if(v===''||v==null)return '';
  if(typeof v==='number'&&v>20000){return new Date(Math.round((v-25569)*86400000)).toISOString().slice(0,10)}
  var s=String(v).trim(),m=s.match(/^(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})$/);
  if(m)return m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);
  return /^\\d{4}-\\d{2}-\\d{2}/.test(s)?s.slice(0,10):''}
function importar(inp){var f=inp.files&&inp.files[0],m=document.getElementById('msgTab');if(!f)return;
  if(!window.XLSX){m.innerHTML='<div class="msg erro">Não foi possível carregar o recurso de Excel. Verifique sua conexão.</div>';return}
  var rd=new FileReader();rd.onload=function(ev){try{
    var wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}),hi=-1;
    for(var r=0;r<Math.min(rows.length,15);r++){var j=rows[r].map(sa).join('|');if(j.indexOf('CHAVE')>=0||(j.indexOf('ORIGEM')>=0&&j.indexOf('DESTINO')>=0)){hi=r;break}}
    if(hi<0){m.innerHTML='<div class="msg erro">Não encontrei o cabeçalho. Use o modelo baixado nesta tela.</div>';return}
    for(var q=0;q<hi;q++){var rw=rows[q];for(var z=0;z<rw.length;z++){if(sa(rw[z]).indexOf('EIXOS')===0){for(var z2=z+1;z2<rw.length;z2++){var ev=Number(rw[z2]);if(ev===5||ev===6){document.getElementById('eixos').value=String(ev);mudaEixos()}}}}}
    var cab=rows[hi].map(sa),col=function(re){for(var c=0;c<cab.length;c++)if(re.test(cab[c]))return c;return -1};
    var cCh=col(/^CHAVE/),cO=col(/^ORIGEM/),cD=col(/^DESTINO/),cV=col(/^VEICULO|^TIPO/),cL=col(/LIQUIDO/),cZ=col(/^PRAZO/),cOb=col(/^OBS/);
    if(cL<0){m.innerHTML='<div class="msg erro">Coluna "Valor líquido" não encontrada. Use o modelo baixado nesta tela.</div>';return}
    var idx={};ROTAS.forEach(function(x,i){idx[x.chave]=i});
    var ok=0,perdidas=0;
    for(var r2=hi+1;r2<rows.length;r2++){var row=rows[r2],i=-1;
      if(cCh>=0&&row[cCh]!==''&&idx[row[cCh]]!==undefined)i=idx[row[cCh]];
      else if(cO>=0&&cD>=0&&cV>=0){var k=kc(row[cO])+'|'+kc(row[cD])+'|CARRETA';if(idx[k]!==undefined)i=idx[k]}
      var liq=num(row[cL]);
      if(i<0){if(liq>0)perdidas++;continue}
      if(!(liq>0))continue;
      document.getElementById('liq'+i).value=fmt(liq);
      if(cZ>=0&&row[cZ]!=='')document.getElementById('pz'+i).value=parseInt(row[cZ],10)||'';
      if(cOb>=0&&row[cOb]!=='')document.getElementById('ob'+i).value=String(row[cOb]);
      calc(i);ok++}
    m.innerHTML='<div class="msg '+(ok?'ok':'erro')+'">'+ok+' rota(s) importada(s) da planilha.'+(perdidas?' '+perdidas+' linha(s) não bateram com nenhuma rota e foram ignoradas.':'')+(ok?' Confira os valores e clique em <b>Enviar cotação</b>.':'')+'</div>';
  }catch(e){m.innerHTML='<div class="msg erro">Não consegui ler a planilha: '+esc(e.message)+'</div>'}inp.value=''};
  rd.readAsArrayBuffer(f)}
function enviar(final){var itens=[],m=document.getElementById('msgTab');m.innerHTML='';
  for(var i=0;i<ROTAS.length;i++){var liq=num(document.getElementById('liq'+i).value);
    var tem=liq!=null||document.getElementById('pz'+i).value||document.getElementById('ob'+i).value;
    if(!tem)continue;
    if(!(liq>0)){m.innerHTML='<div class="msg erro">Linha '+(i+1)+' ('+esc(ROTAS[i].origem)+' → '+esc(ROTAS[i].destino)+'): informe o valor líquido.</div>';document.getElementById('l'+i).scrollIntoView({block:'center'});return}
    itens.push({chave:ROTAS[i].chave,liquido:liq,prazo:document.getElementById('pz'+i).value,obs:document.getElementById('ob'+i).value})}
  if(final){if(!itens.length){m.innerHTML='<div class="msg erro">Preencha ao menos uma rota antes de enviar.</div>';return}
    if(!confirm('Enviar '+itens.length+' rota(s) para análise? Os valores líquidos serão somados ao ICMS para formar o bruto.'))return}
  api({acao:'salvar',acesso:ACESSO,itens:itens,enviar:final,eixos:EIXOS}).then(function(j){m.innerHTML='<div class="msg ok">'+(final?'✅ Cotação enviada com '+j.salvas+' rota(s). Obrigado! O time de suprimentos já recebeu.':'Rascunho salvo ('+j.salvas+' rota(s)).')+'</div>';window.scrollTo(0,0)}).catch(function(e){m.innerHTML='<div class="msg erro">'+esc(e.message)+'</div>'})}
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
    if (!convite || (convite.tipo && convite.tipo !== 'TRANSPORTADOR')) return enviarHtml(res, 404, paginaErro('Link inválido', 'Este link de cotação não foi encontrado. Solicite um novo link ao time de suprimentos.'));
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
      return enviarJson(res, 200, { acesso: gerarAcesso(token, segredo), rotas, propostas: propostas || [], status: convite.status, eixos: convite.eixos || 5 });
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
        const pedagio = 0; // pedagio e pago pela Cantu: fora da cotacao
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
      if ([5, 6].includes(Number(body.eixos))) {
        // coluna eixos so existe apos a migration; sem ela o update e ignorado
        await supabase.from('lotacao_cotacao_convites').update({ eixos: Number(body.eixos) }).eq('id', convite.id);
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
