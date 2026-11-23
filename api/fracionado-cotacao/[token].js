/**
 * Portal de tabelas de frete FRACIONADO para o transportador.
 *
 * Mesmo modelo do portal de lotacao (api/lotacao-cotacao): funcao serverless com a
 * service_role no servidor; o transportador nao acessa o app nem dados de terceiros.
 *
 * Fluxo:
 *   GET  /api/fracionado-cotacao/<token>   -> pagina (so o shell)
 *   POST acao=identificar (cnpj, nome, email) -> valida o CNPJ; devolve a configuracao do
 *        convite (canais, modalidade, faixas), o que ja foi salvo e um "acesso" assinado (8h)
 *   POST acao=salvar (acesso, canais{B2C:{gerais,linhas}}, enviar) -> grava rascunho/envio
 *
 * Modelo padrao (mesmo layout dos templates Cantu importados em "Importar Template"):
 *   PERCENTUAL : UF destino x regiao (CAPITAL, INTERIOR 1..9, METROPOLITANA) -> frete % + minimo R$
 *   FAIXA_PESO : UF destino x faixa de peso x regiao -> frete R$ (faixa aberta = R$/kg excedente)
 * Dados gerais por canal: prazo, GRIS, ad valorem (+ minimo), pedagio, TAS, TDA, ICMS incluso, vigencia.
 */
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

const VALIDADE_ACESSO_MS = 8 * 60 * 60 * 1000;
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const REGIOES = ['CAPITAL', 'INTERIOR 1', 'INTERIOR 2', 'INTERIOR 3', 'INTERIOR 4', 'INTERIOR 5', 'INTERIOR 6', 'INTERIOR 7', 'INTERIOR 8', 'INTERIOR 9', 'METROPOLITANA'];
const FAIXAS_PADRAO = {
  B2C: '0-2, 2-5, 5-10, 10-20, 20-30, 30-50, 50-100, 100+',
  ATACADO: '0-10, 10-20, 20-30, 30-50, 50-70, 70-100, 100-150, 150-200, 200-300, 300-500, 500-1000, 1000+',
};
const CHAVES_GERAIS = ['prazo', 'gris', 'advalorem', 'advalorem_min', 'pedagio', 'tas', 'tda', 'icms_incluso', 'vigencia'];

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

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).replace(/R\$/gi, '').replace(/%/g, '').replace(/\s/g, '');
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

// ---- Configuracao do convite ------------------------------------------------
function canaisDoConvite(convite) {
  const c = String(convite.canal || 'AMBOS').toUpperCase();
  if (c === 'B2C') return ['B2C'];
  if (c === 'ATACADO') return ['ATACADO'];
  return ['B2C', 'ATACADO'];
}

// "0-2, 2-5, 100+" -> [{label,min,max}] (max null = faixa aberta; o label segue o parser do importador)
function parseFaixas(texto) {
  const out = [];
  for (const parte of String(texto || '').split(/[;,]/)) {
    const p = parte.trim().replace(/\s+/g, '');
    if (!p) continue;
    const aberta = p.match(/^(\d+(?:\.\d+)?)\+$/);
    if (aberta) { const min = Number(aberta[1]); out.push({ min, max: null, label: `Acima de ${min} kg` }); continue; }
    const m = p.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (!m) return [];
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (!(max > min)) return [];
    out.push({ min, max, label: `${min} a ${max} kg` });
  }
  return out.sort((a, b) => a.min - b.min);
}

function faixasDoConvite(convite) {
  const out = {};
  for (const canal of canaisDoConvite(convite)) {
    const f = parseFaixas(convite.faixas?.[canal]);
    out[canal] = f.length ? f : parseFaixas(FAIXAS_PADRAO[canal]);
  }
  return out;
}

function configDoConvite(convite) {
  return {
    canais: canaisDoConvite(convite),
    modalidade: convite.modalidade === 'FAIXA_PESO' ? 'FAIXA_PESO' : 'PERCENTUAL',
    faixas: faixasDoConvite(convite),
    ufs: UFS,
    regioes: REGIOES,
    origem: convite.origem || '',
  };
}

// ---- Paginas ---------------------------------------------------------------
function paginaErro(titulo, detalhe) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.box{max-width:520px;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:32px;text-align:center}h1{margin:0 0 10px;font-size:20px}p{color:#475569;line-height:1.5}</style></head>
<body><div class="box"><h1>${esc(titulo)}</h1><p>${esc(detalhe)}</p></div></body></html>`;
}

function paginaPortal({ convite }) {
  const cancelado = convite.status === 'CANCELADO';
  const canaisTxt = canaisDoConvite(convite).map((c) => (c === 'ATACADO' ? 'Atacado' : 'B2C')).join(' + ');
  const modTxt = convite.modalidade === 'FAIXA_PESO' ? 'Frete por faixa de peso' : 'Frete percentual';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Tabela de frete fracionado — ${esc(convite.transportadora)}</title>
<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"></script>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif;font-size:15px}
.page{width:98%;max-width:1800px;margin:16px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}
header{padding:22px 30px;background:#06183d;color:#fff}header h1{margin:0 0 6px;font-size:24px}header p{margin:3px 0;color:#cbd5e1;font-size:15px}
.corpo{padding:20px 26px}label{display:block;font-size:14px;font-weight:bold;margin:12px 0 4px;color:#334155}
input,select{width:100%;padding:9px 10px;border:1px solid #94a3b8;border-radius:8px;font-size:15px;background:#fff}
button{background:#185FA5;color:#fff;border:0;border-radius:8px;padding:11px 20px;font-size:15px;font-weight:bold;cursor:pointer}
button.sec{background:#fff;color:#185FA5;border:2px solid #185FA5}button:disabled{opacity:.5;cursor:default}
.id{max-width:480px}.msg{padding:12px 15px;border-radius:8px;margin:12px 0;font-size:15px;line-height:1.45}
.erro{background:#fee2e2;color:#991b1b}.ok{background:#dcfce7;color:#166534}.info{background:#e0f2fe;color:#075985}.aviso{background:#fef3c7;color:#92400e}
.regra{background:#f8fafc;border:1px solid #dbe3ef;border-radius:10px;padding:14px 18px;font-size:14px;line-height:1.6;margin-bottom:14px}
.abas{display:flex;gap:8px;margin:0 0 12px;flex-wrap:wrap}.abas button{background:#fff;color:#185FA5;border:2px solid #185FA5}.abas button.on{background:#185FA5;color:#fff}
.ferr{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:12px;background:#f0f7ff;border:1px solid #bcd7f2;border-radius:10px}
.ger{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;padding:12px;background:#fffbeb;border:2px solid #fcd34d;border-radius:10px;margin:0 0 12px}
.ger label{margin:0 0 3px;font-size:13px}.ger input,.ger select{border:2px solid #fcd34d}
.tw{overflow:auto;max-height:66vh;border:1px solid #cbd5e1;border-radius:8px}
table{border-collapse:separate;border-spacing:0;font-size:14px}
th{background:#1E3A5F;color:#fff;padding:8px;text-align:center;position:sticky;top:0;z-index:2;white-space:nowrap;font-size:13px;border-right:1px solid #fff3}
th.sub{background:#b45309;top:34px;font-size:12px}
td{padding:4px;border-bottom:1px solid #e2e8f0;background:#fff}td.fixo{font-weight:bold;background:#f1f5f9;position:sticky;left:0;z-index:1;padding:6px 10px;white-space:nowrap}
td input{width:96px;padding:7px 8px;font-size:14px;text-align:right;border:2px solid #fcd34d;background:#fffbeb}
td input.cheio{background:#ecfdf3;border-color:#86efac}
.barra{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:14px 0 0;position:sticky;bottom:0;background:#fff;padding:12px 0;border-top:2px solid #e2e8f0}
.fl{font-size:14px;font-weight:bold;color:#334155;display:flex;align-items:center;gap:6px;margin:0}.fl select{width:auto;min-width:200px}
@media(max-width:700px){.corpo,header{padding:14px}}
</style></head><body><div class="page">
<header><h1>Tabela de frete fracionado</h1><p><b>${esc(convite.transportadora)}</b> · ${esc(canaisTxt)} · ${esc(modTxt)}${convite.campanha ? ` · ${esc(convite.campanha)}` : ''}</p>
${convite.origem ? `<p>Origem: ${esc(convite.origem)}</p>` : ''}
${convite.expira_em ? `<p>Este link vale até ${esc(new Date(convite.expira_em).toLocaleDateString('pt-BR'))}</p>` : ''}</header>
<div class="corpo" id="app">
${cancelado ? '<div class="msg erro">Este link foi cancelado. Solicite um novo link ao time de suprimentos.</div>' : `
<div id="telaId" class="id">
  <div class="msg info">Para liberar a tabela, informe os dados abaixo. O <b>CNPJ é obrigatório</b> e fica registrado junto com o envio de <b>${esc(convite.transportadora)}</b>.</div>
  <label for="cnpj">CNPJ da transportadora</label><input id="cnpj" inputmode="numeric" placeholder="00.000.000/0000-00" autocomplete="off">
  <label for="nome">Seu nome</label><input id="nome" autocomplete="name">
  <label for="email">Seu e-mail</label><input id="email" type="email" autocomplete="email">
  <div id="erroId"></div>
  <p><button id="btnId" onclick="identificar()">Acessar a tabela</button></p>
</div>
<div id="telaTab" style="display:none"></div>`}
</div></div>
<script>
var TOKEN=${JSON.stringify(convite.token)},NOME=${JSON.stringify(convite.transportadora)},CFG=null,ACESSO='',ST={},CANAL='',UFSEL='',CNPJ='',RESP={nome:'',email:''};
var GER=[['prazo','Prazo médio (dias)'],['gris','GRIS (%)'],['advalorem','Ad valorem (%)'],['advalorem_min','Ad valorem mínimo (R$)'],['pedagio','Pedágio (R$)'],['tas','TAS (R$)'],['tda','TDA (R$)']];
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function sa(s){return String(s==null?'':s).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim()}
function num(v){if(v===''||v==null)return null;if(typeof v==='number')return isFinite(v)?v:null;var t=String(v).replace(/R\\$/gi,'').replace(/%/g,'').replace(/\\s/g,'');if(t.indexOf(',')>=0)t=t.replace(/\\./g,'').replace(',','.');var n=Number(t);return isFinite(n)?n:null}
function fmtIn(n){return n==null||n===''?'':String(n).replace('.',',')}
function nomeCanal(c){return c==='ATACADO'?'Atacado':'B2C'}
function api(corpo){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.erro||'Erro');return j})})}
function cheio(x){return !!(x&&(x.v||x.p||x.m))}
function identificar(){var b=document.getElementById('btnId');document.getElementById('erroId').innerHTML='';
  var cnpj=document.getElementById('cnpj').value,nome=document.getElementById('nome').value.trim(),email=document.getElementById('email').value.trim();
  if(!nome||!email||cnpj.replace(/\\D/g,'').length!==14){document.getElementById('erroId').innerHTML='<div class="msg erro">Informe CNPJ (14 dígitos), nome e e-mail.</div>';return}
  b.disabled=true;api({acao:'identificar',cnpj:cnpj,nome:nome,email:email}).then(function(j){
    ACESSO=j.acesso;CFG=j.config;CNPJ=cnpj;RESP={nome:nome,email:email};ST={};
    CFG.canais.forEach(function(c){ST[c]={g:Object.assign({},(j.gerais||{})[c]||{}),c:{}}});
    (j.linhas||[]).forEach(function(l){var s=ST[l.canal];if(!s)return;var fi='';
      if(CFG.modalidade==='FAIXA_PESO'){fi=-1;(CFG.faixas[l.canal]||[]).forEach(function(f,i){if(f.label===l.faixa)fi=i});if(fi<0)return}
      s.c[l.uf_destino+'|'+l.regiao+'|'+fi]={v:fmtIn(l.frete_valor),p:fmtIn(l.frete_percentual),m:fmtIn(l.frete_minimo)}});
    document.getElementById('telaId').style.display='none';montar(j.status)}).catch(function(e){document.getElementById('erroId').innerHTML='<div class="msg erro">'+esc(e.message)+'</div>';b.disabled=false})}
function montar(status){var t=document.getElementById('telaTab');t.style.display='block';CANAL=CFG.canais[0];UFSEL=CFG.ufs[0];
  var pct=CFG.modalidade==='PERCENTUAL';
  var h='<div class="regra"><b>Como preencher</b><br>• '+(pct?'Informe, por <b>UF de destino</b> e <b>região</b> (Capital, Interior 1 a 9, Metropolitana), o <b>frete em % sobre o valor da NF</b> e o <b>mínimo em R$</b>.':'Escolha a <b>UF de destino</b> e informe o <b>frete em R$</b> de cada <b>faixa de peso</b> por <b>região</b> (Capital, Interior 1 a 9, Metropolitana). Na última linha (faixa aberta) informe o <b>R$ por kg excedente</b>. Use <b>Copiar para as demais UFs</b> se a tabela for igual.')+'<br>• Preencha também os <b>dados gerais</b> (prazo, GRIS, ad valorem, pedágio, TAS, TDA) e informe se os valores <b>já incluem ICMS</b>.<br>• Deixe em branco o que você não atende. Prefere o Excel? <b>Baixe o modelo</b>, preencha e <b>importe</b> de volta.<br>• Clique em <b>Salvar rascunho</b> para continuar depois (o link vale até a data indicada) e em <b>Enviar tabela</b> quando concluir.</div>'
  +(status==='ENVIADO'?'<div class="msg ok">Você já enviou esta tabela. Se alterar valores, clique em enviar novamente para atualizar.</div>':'')
  +'<div class="abas" id="abas"></div><div id="msgTab"></div><div id="conteudo"></div>'
  +'<div class="barra"><button class="sec" onclick="enviar(false)">Salvar rascunho</button><button onclick="enviar(true)">Enviar tabela</button><span id="cont"></span></div>';
  t.innerHTML=h;render()}
function abas(){var a=document.getElementById('abas');if(CFG.canais.length<2){a.innerHTML='';return}
  a.innerHTML=CFG.canais.map(function(c){return '<button class="'+(c===CANAL?'on':'')+'" onclick="setCanal(\\''+c+'\\')">'+nomeCanal(c)+'</button>'}).join('')}
function setCanal(c){CANAL=c;render()}
function render(){abas();var s=ST[CANAL],h='';
  h+='<div class="ferr"><button class="sec" onclick="baixarModelo()">⬇ Baixar modelo (Excel) — '+nomeCanal(CANAL)+'</button><button class="sec" onclick="document.getElementById(\\'arq\\').click()">⬆ Importar planilha preenchida</button><input type="file" id="arq" accept=".xlsx,.xls,.csv" style="display:none" onchange="importar(this)"><span id="resumo" class="fl"></span></div>';
  h+='<div class="ger">'+GER.map(function(g){return '<div><label>'+g[1]+'</label><input data-g="'+g[0]+'" value="'+esc(s.g[g[0]]||'')+'" inputmode="decimal"></div>'}).join('')
    +'<div><label>Valores já incluem ICMS?</label><select data-g="icms_incluso"><option value="">Selecione…</option><option value="SIM"'+(s.g.icms_incluso==='SIM'?' selected':'')+'>Sim, já incluem</option><option value="NAO"'+(s.g.icms_incluso==='NAO'?' selected':'')+'>Não, ICMS por fora</option></select></div>'
    +'<div><label>Vigência a partir de</label><input type="date" data-g="vigencia" value="'+esc(s.g.vigencia||'')+'"></div></div>';
  h+=CFG.modalidade==='PERCENTUAL'?gradePct():gradeFaixa();
  var c=document.getElementById('conteudo');c.innerHTML=h;
  c.oninput=function(ev){var t=ev.target;if(t.getAttribute('data-g')){ST[CANAL].g[t.getAttribute('data-g')]=t.value;return}
    var k=t.getAttribute('data-k');if(!k)return;var f=t.getAttribute('data-f'),x=ST[CANAL].c[k]||(ST[CANAL].c[k]={});x[f]=t.value;t.className=t.value?'cheio':'';resumo()};
  c.onchange=function(ev){var t=ev.target;if(t.getAttribute('data-g'))ST[CANAL].g[t.getAttribute('data-g')]=t.value};
  resumo()}
function gradePct(){var s=ST[CANAL],R=CFG.regioes,h='<div class="tw"><table><thead><tr><th rowspan="2" style="left:0;z-index:3">UF destino</th>'+R.map(function(r){return '<th colspan="2">'+r+'</th>'}).join('')+'</tr><tr>'+R.map(function(){return '<th class="sub">Frete (%)</th><th class="sub">Mínimo (R$)</th>'}).join('')+'</tr></thead><tbody>';
  CFG.ufs.forEach(function(uf){h+='<tr><td class="fixo">'+uf+'</td>';R.forEach(function(r){var k=uf+'|'+r+'|',x=s.c[k]||{};
    h+='<td><input data-k="'+k+'" data-f="p" class="'+(x.p?'cheio':'')+'" value="'+esc(x.p||'')+'" inputmode="decimal"></td><td><input data-k="'+k+'" data-f="m" class="'+(x.m?'cheio':'')+'" value="'+esc(x.m||'')+'" inputmode="decimal"></td>'});h+='</tr>'});
  return h+'</tbody></table></div>'}
function ufTem(uf){var s=ST[CANAL],r=false;Object.keys(s.c).forEach(function(k){if(k.indexOf(uf+'|')===0&&cheio(s.c[k]))r=true});return r}
function gradeFaixa(){var s=ST[CANAL],R=CFG.regioes,F=CFG.faixas[CANAL];
  var h='<div class="ferr"><label class="fl">UF destino <select id="ufsel" onchange="UFSEL=this.value;render()">'+CFG.ufs.map(function(u){return '<option value="'+u+'"'+(u===UFSEL?' selected':'')+'>'+u+(ufTem(u)?' ✔':'')+'</option>'}).join('')+'</select></label><button class="sec" onclick="copiarUf()">Copiar esta UF para as demais UFs</button></div>';
  h+='<div class="tw"><table><thead><tr><th style="left:0;z-index:3">Faixa de peso</th>'+R.map(function(r){return '<th>'+r+'</th>'}).join('')+'</tr></thead><tbody>';
  F.forEach(function(f,i){h+='<tr><td class="fixo">'+esc(f.max==null?f.label+' (R$/kg excedente)':f.label)+'</td>';R.forEach(function(r){var k=UFSEL+'|'+r+'|'+i,x=s.c[k]||{};
    h+='<td><input data-k="'+k+'" data-f="v" class="'+(x.v?'cheio':'')+'" value="'+esc(x.v||'')+'" inputmode="decimal"></td>'});h+='</tr>'});
  return h+'</tbody></table></div>'}
function copiarUf(){var s=ST[CANAL];if(!ufTem(UFSEL)){alert('Preencha a UF '+UFSEL+' antes de copiar.');return}
  if(!confirm('Copiar os valores de '+UFSEL+' para TODAS as outras UFs? Valores já digitados nelas serão substituídos.'))return;
  var origem={};Object.keys(s.c).forEach(function(k){if(k.indexOf(UFSEL+'|')===0&&cheio(s.c[k]))origem[k.slice(UFSEL.length)]=s.c[k]});
  CFG.ufs.forEach(function(uf){if(uf===UFSEL)return;Object.keys(s.c).forEach(function(k){if(k.indexOf(uf+'|')===0)delete s.c[k]});Object.keys(origem).forEach(function(suf){s.c[uf+suf]={v:origem[suf].v,p:origem[suf].p,m:origem[suf].m}})});render()}
function resumo(){var r=document.getElementById('resumo'),ct=document.getElementById('cont');var linhas=[];
  CFG.canais.forEach(function(c){var s=ST[c],ufs={},n=0;Object.keys(s.c).forEach(function(k){if(cheio(s.c[k])){n++;ufs[k.split('|')[0]]=1}});linhas.push(nomeCanal(c)+': '+Object.keys(ufs).length+' de '+CFG.ufs.length+' UFs · '+n+' células')});
  if(ct)ct.textContent=linhas.join('   |   ');if(r){var s2=ST[CANAL],u2={};Object.keys(s2.c).forEach(function(k){if(cheio(s2.c[k]))u2[k.split('|')[0]]=1});r.textContent=Object.keys(u2).length+' de '+CFG.ufs.length+' UFs com dados'}}
function montarPayload(){var out={};CFG.canais.forEach(function(c){var s=ST[c],linhas=[];
  Object.keys(s.c).forEach(function(k){var x=s.c[k],p=k.split('|'),v=num(x.v),pc=num(x.p),m=num(x.m);if(v==null&&pc==null&&m==null)return;
    var fi=p[2]===''?null:Number(p[2]);linhas.push({uf:p[0],regiao:p[1],faixa:fi==null?'':(CFG.faixas[c][fi]||{}).label,v:v,p:pc,m:m})});
  out[c]={gerais:s.g,linhas:linhas}});return out}
function validar(final){var out=[];CFG.canais.forEach(function(c){var s=ST[c];var n=0;Object.keys(s.c).forEach(function(k){var x=s.c[k];if(cheio(x)){n++;
    ['v','p','m'].forEach(function(f){if(x[f]&&!(num(x[f])>=0))out.push(nomeCanal(c)+': valor inválido em '+k.replace(/\\|/g,' / ')+'.')});
    if(num(x.p)>100)out.push(nomeCanal(c)+': percentual acima de 100% em '+k.replace(/\\|/g,' / ')+'.')}});
    if(final){if(!n)out.push(nomeCanal(c)+': preencha ao menos uma célula da tabela.');if(!s.g.icms_incluso)out.push(nomeCanal(c)+': informe se os valores já incluem ICMS.')}});return out}
function enviar(final){var m=document.getElementById('msgTab');m.innerHTML='';var erros=validar(final);
  if(erros.length){m.innerHTML='<div class="msg erro">'+erros.slice(0,6).map(esc).join('<br>')+'</div>';window.scrollTo(0,0);return}
  if(final&&!confirm('Enviar a tabela para análise? Você poderá reenviar enquanto o link estiver válido.'))return;
  api({acao:'salvar',acesso:ACESSO,canais:montarPayload(),enviar:final,origem_envio:'PORTAL'}).then(function(j){
    m.innerHTML='<div class="msg ok">'+(final?'✅ Tabela enviada ('+j.salvas+' células). Obrigado! O time de suprimentos já recebeu.':'Rascunho salvo ('+j.salvas+' células).')+'</div>';window.scrollTo(0,0)}).catch(function(e){m.innerHTML='<div class="msg erro">'+esc(e.message)+'</div>';window.scrollTo(0,0)})}
// ---- Excel (mesmo layout dos templates padrao Cantu: FICHA DE CADASTRO + TABELA) ----
function baixarModelo(){if(!window.XLSX){alert('Não foi possível carregar o recurso de Excel. Verifique sua conexão.');return}
  var s=ST[CANAL],g=s.g,R=CFG.regioes,pct=CFG.modalidade==='PERCENTUAL',F=CFG.faixas[CANAL];
  var ficha=[['FICHA DE CADASTRO',''],['Transportadora',NOME],['CNPJ',CNPJ],['Canal',CANAL],['Origem',CFG.origem||''],['Prazo médio (dias)',g.prazo||''],['GRIS (%)',g.gris||''],['Ad valorem mínimo (R$)',g.advalorem_min||''],['Ad valorem (%)',g.advalorem||''],['Pedágio (R$)',g.pedagio||''],['TAS (R$)',g.tas||''],['TDA (R$)',g.tda||''],['ICMS incluso nos valores (SIM ou NAO)',g.icms_incluso||''],['Vigência a partir de',g.vigencia||'']];
  var aoa=[],merges=[],cols=[];
  function v(k,f){var x=s.c[k];var n=x?num(x[f]):null;return n==null?'':n}
  if(pct){var r0=[''],r1=['ESTADO DESTINO'];R.forEach(function(r,i){r0.push(r,'');r1.push('FRETE (%)','MÍNIMO (R$)');merges.push({s:{r:0,c:1+i*2},e:{r:0,c:2+i*2}})});
    aoa.push(r0,r1,[]);CFG.ufs.forEach(function(uf){var row=[uf];R.forEach(function(r){row.push(v(uf+'|'+r+'|','p'),v(uf+'|'+r+'|','m'))});aoa.push(row)});
    cols=[{wch:16}].concat(R.map(function(){return [{wch:12},{wch:13}]}).reduce(function(a,b){return a.concat(b)},[]))}
  else{var r0b=['',''],r1b=['ESTADO DESTINO','FAIXA PESO'];R.forEach(function(r,i){r0b.push(r,'','');r1b.push('FRETE (R$)','AD VALOREM (%)','AD VALOREM MÍNIMO (R$)');merges.push({s:{r:0,c:2+i*3},e:{r:0,c:4+i*3}})});
    aoa.push(r0b,r1b);CFG.ufs.forEach(function(uf){F.forEach(function(f,i){var row=[uf,f.label];R.forEach(function(r){row.push(v(uf+'|'+r+'|'+i,'v'),f.max==null?'':(num(g.advalorem)==null?'':num(g.advalorem)),f.max==null?'':(num(g.advalorem_min)==null?'':num(g.advalorem_min)))});aoa.push(row)})});
    cols=[{wch:16},{wch:20}].concat(R.map(function(){return [{wch:12},{wch:14},{wch:16}]}).reduce(function(a,b){return a.concat(b)},[]))}
  var ws=XLSX.utils.aoa_to_sheet(aoa),wf=XLSX.utils.aoa_to_sheet(ficha);ws['!merges']=merges;ws['!cols']=cols;wf['!cols']=[{wch:38},{wch:30}];
  var hd={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{patternType:'solid',fgColor:{rgb:'1E3A5F'}},alignment:{horizontal:'center',vertical:'center',wrapText:true}};
  var nHead=pct?2:2;for(var r=0;r<nHead;r++){for(var c=0;c<cols.length;c++){var a=XLSX.utils.encode_cell({r:r,c:c});if(!ws[a])ws[a]={t:'s',v:''};ws[a].s=hd}}
  for(var q=0;q<ficha.length;q++){var a2=XLSX.utils.encode_cell({r:q,c:0});if(wf[a2])wf[a2].s={font:{bold:true}}}
  ws['!freeze']={xSplit:pct?1:2,ySplit:pct?2:2};ws['!views']=[{state:'frozen',xSplit:pct?1:2,ySplit:2}];
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,wf,'FICHA DE CADASTRO');XLSX.utils.book_append_sheet(wb,ws,'TABELA');
  XLSX.writeFile(wb,'tabela-fracionado-'+(pct?'percentual':'faixa-peso')+'-'+CANAL.toLowerCase()+'-'+NOME.replace(/[^a-z0-9]+/gi,'-')+'.xlsx')}
function detReg(v){var n=sa(v).replace(/[-_\\s]/g,'');for(var i=0;i<CFG.regioes.length;i++){if(CFG.regioes[i].replace(' ','')===n)return CFG.regioes[i]}return null}
function importar(inp){var f=inp.files&&inp.files[0],m=document.getElementById('msgTab');if(!f)return;
  if(!window.XLSX){m.innerHTML='<div class="msg erro">Não foi possível carregar o recurso de Excel. Verifique sua conexão.</div>';return}
  var rd=new FileReader();rd.onload=function(ev){try{
    var wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'}),nomes=wb.SheetNames;
    var nTab=nomes.filter(function(n){return sa(n).indexOf('TABELA')>=0})[0]||nomes[nomes.length>1?1:0],nFic=nomes.filter(function(n){return /FICHA|CADASTRO/.test(sa(n))})[0];
    var M=XLSX.utils.sheet_to_json(wb.Sheets[nTab],{header:1,defval:''}),s=ST[CANAL],ok=0,aviso='';
    if(nFic){XLSX.utils.sheet_to_json(wb.Sheets[nFic],{header:1,defval:''}).forEach(function(row){var k=sa(row[0]),val=row[1];if(val===''||val==null)return;
      if(k.indexOf('CANAL')===0){var cv=sa(val);if((cv.indexOf('ATACADO')>=0||cv.indexOf('B2B')>=0)&&CANAL!=='ATACADO')aviso='A ficha da planilha indica ATACADO, mas você está na aba '+nomeCanal(CANAL)+'.';if(cv.indexOf('B2C')>=0&&CANAL!=='B2C')aviso='A ficha da planilha indica B2C, mas você está na aba '+nomeCanal(CANAL)+'.';return}
      if(k.indexOf('PRAZO')===0)s.g.prazo=fmtIn(num(val));else if(k.indexOf('GRIS')===0)s.g.gris=fmtIn(num(val));
      else if(k.indexOf('AD VALOREM MIN')===0)s.g.advalorem_min=fmtIn(num(val));else if(k.indexOf('AD VALOREM')===0||k.indexOf('ADVALOREM')===0)s.g.advalorem=fmtIn(num(val));
      else if(k.indexOf('PEDAGIO')===0)s.g.pedagio=fmtIn(num(val));else if(k.indexOf('TAS')===0)s.g.tas=fmtIn(num(val));else if(k.indexOf('TDA')===0)s.g.tda=fmtIn(num(val));
      else if(k.indexOf('ICMS')===0){var iv=sa(val);s.g.icms_incluso=(iv==='SIM'||iv==='S')?'SIM':(iv==='NAO'||iv==='N')?'NAO':s.g.icms_incluso}
      else if(k.indexOf('VIGENCIA')===0&&/^\\d{4}-\\d{2}-\\d{2}/.test(String(val)))s.g.vigencia=String(val).slice(0,10)})}
    if(CFG.modalidade==='PERCENTUAL'){var ri=-1;for(var i=0;i<Math.min(M.length,15);i++){if(M[i].some(function(c){return detReg(c)})){ri=i;break}}
      if(ri<0)throw new Error('Não encontrei a linha de regiões (CAPITAL, INTERIOR 1…). Use o modelo baixado nesta tela.');
      var map=[];M[ri].forEach(function(c,ci){var rg=detReg(c);if(!rg)return;var cp=ci,cm=ci+1;if(sa((M[ri+1]||[])[ci]).indexOf('MIN')>=0){cp=ci+1;cm=ci}map.push({r:rg,p:cp,m:cm})});
      for(var j=ri+2;j<M.length;j++){var row=M[j],uf=sa(row[0]);if(CFG.ufs.indexOf(uf)<0)continue;map.forEach(function(x){var p=num(row[x.p]),mi=num(row[x.m]);if(p==null&&mi==null)return;s.c[uf+'|'+x.r+'|']={p:fmtIn(p),m:fmtIn(mi),v:''};ok++})}}
    else{var hi=-1;for(var i2=1;i2<Math.min(M.length,20);i2++){var js=M[i2].map(sa).join('|');if(js.indexOf('ESTADO DESTINO')>=0&&js.indexOf('FAIXA PESO')>=0){hi=i2;break}}
      if(hi<0)throw new Error('Não encontrei o cabeçalho (ESTADO DESTINO / FAIXA PESO). Use o modelo baixado nesta tela.');
      var maps=[];M[hi-1].forEach(function(c,ci){var rg=detReg(c);if(!rg)return;var cf=-1;for(var cc=ci;cc<Math.min(ci+3,M[hi].length);cc++){if(sa(M[hi][cc]).indexOf('FRETE')===0){cf=cc;break}}if(cf>=0)maps.push({r:rg,c:cf})});
      var FX=CFG.faixas[CANAL],perd=0;
      for(var j2=hi+1;j2<M.length;j2++){var rw=M[j2],uf2=sa(rw[0]);if(CFG.ufs.indexOf(uf2)<0)continue;var mm=String(rw[1]).match(/[0-9][0-9.,]*/);if(!mm){continue}var mn=num(mm[0]),fi=-1;FX.forEach(function(ff,ix){if(ff.min===mn)fi=ix});
        if(fi<0){perd++;continue}maps.forEach(function(x){var vv=num(rw[x.c]);if(vv==null)return;s.c[uf2+'|'+x.r+'|'+fi]={v:fmtIn(vv),p:'',m:''};ok++})}
      if(perd)aviso=(aviso?aviso+' ':'')+perd+' linha(s) com faixa de peso diferente das deste convite foram ignoradas.'}
    render();m=document.getElementById('msgTab');
    m.innerHTML='<div class="msg '+(ok?'ok':'erro')+'">'+ok+' célula(s) importada(s) da planilha.'+(ok?' Confira os valores e clique em <b>Enviar tabela</b>.':'')+'</div>'+(aviso?'<div class="msg aviso">'+esc(aviso)+'</div>':'');
  }catch(e){m.innerHTML='<div class="msg erro">Não consegui ler a planilha: '+esc(e.message)+'</div>'}inp.value=''};
  rd.readAsArrayBuffer(f)}
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

function limparGerais(g) {
  const out = {};
  for (const k of CHAVES_GERAIS) {
    const v = g?.[k];
    if (v === undefined || v === null || v === '') continue;
    if (k === 'icms_incluso') { if (v === 'SIM' || v === 'NAO') out[k] = v; continue; }
    if (k === 'vigencia') { if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out[k] = String(v); continue; }
    const n = numero(v);
    if (n !== null && n >= 0) out[k] = n;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const token = String(req.query?.token || '').replace(/[^a-zA-Z0-9]/g, '');
  if (!token) return enviarHtml(res, 400, paginaErro('Link inválido', 'O link está incompleto.'));

  let ctx;
  try { ctx = getClient(); } catch (e) { return enviarHtml(res, 500, paginaErro('Portal indisponível', e.message)); }
  const { supabase, segredo } = ctx;

  try {
    const { data: convite, error } = await supabase.from('fracionado_convites').select('*').eq('token', token).maybeSingle();
    if (error) throw error;
    if (!convite) return enviarHtml(res, 404, paginaErro('Link inválido', 'Este link não foi encontrado. Solicite um novo link ao time de suprimentos.'));

    const expirado = convite.expira_em && new Date(convite.expira_em).getTime() < Date.now();
    if (expirado) {
      if (req.method === 'GET') return enviarHtml(res, 410, paginaErro('Link expirado', 'O prazo deste link terminou. Solicite um novo link ao time de suprimentos.'));
      return enviarJson(res, 410, { erro: 'Link expirado. Solicite um novo link ao time de suprimentos.' });
    }

    if (req.method === 'GET') return enviarHtml(res, 200, paginaPortal({ convite }));
    if (req.method !== 'POST') return enviarJson(res, 405, { erro: 'Método não permitido.' });
    if (convite.status === 'CANCELADO') return enviarJson(res, 409, { erro: 'Este link foi cancelado.' });

    const body = lerCorpo(req);
    const config = configDoConvite(convite);

    if (body.acao === 'identificar') {
      const cnpj = soDigitos(body.cnpj);
      const nome = String(body.nome || '').trim().slice(0, 120);
      const email = String(body.email || '').trim().slice(0, 160);
      if (!cnpjValido(cnpj)) return enviarJson(res, 400, { erro: 'Informe um CNPJ válido (14 dígitos).' });
      if (!nome || !email.includes('@')) return enviarJson(res, 400, { erro: 'Informe seu nome e um e-mail válido.' });
      const raizes = Array.isArray(convite.cnpj_raizes) ? convite.cnpj_raizes.filter(Boolean) : [];
      if (raizes.length && !raizes.includes(cnpj.slice(0, 8))) {
        return enviarJson(res, 403, { erro: 'Este CNPJ não confere com o da transportadora convidada. Confira o número ou solicite um novo link.' });
      }
      const agora = new Date().toISOString();
      await supabase.from('fracionado_convites').update({
        respondente_nome: nome, respondente_email: email, respondente_cnpj: cnpj,
        primeiro_acesso_em: convite.primeiro_acesso_em || agora, ultimo_acesso_em: agora,
        status: convite.status === 'ENVIADO' ? 'ENVIADO' : 'EM_PREENCHIMENTO',
      }).eq('id', convite.id);
      const { data: linhas, error: eLin } = await supabase.from('fracionado_respostas').select('canal,uf_destino,regiao,faixa,frete_valor,frete_percentual,frete_minimo').eq('convite_id', convite.id).limit(50000);
      if (eLin) throw eLin;
      return enviarJson(res, 200, { acesso: gerarAcesso(token, segredo), config, gerais: convite.dados_gerais || {}, linhas: linhas || [], status: convite.status });
    }

    if (body.acao === 'salvar') {
      if (!acessoValido(token, body.acesso, segredo)) return enviarJson(res, 401, { erro: 'Sessão expirada. Recarregue a página e se identifique novamente.' });
      const agora = new Date().toISOString();
      const pct = config.modalidade === 'PERCENTUAL';
      const gerais = { ...(convite.dados_gerais || {}) };
      const linhas = [];
      for (const canal of config.canais) {
        const bloco = body.canais?.[canal];
        if (!bloco) continue;
        gerais[canal] = limparGerais(bloco.gerais);
        const faixas = new Map((config.faixas[canal] || []).map((f) => [f.label, f]));
        const vistos = new Set();
        for (const it of Array.isArray(bloco.linhas) ? bloco.linhas.slice(0, 20000) : []) {
          const uf = String(it.uf || '').toUpperCase();
          const regiao = String(it.regiao || '').toUpperCase();
          if (!UFS.includes(uf) || !REGIOES.includes(regiao)) continue;
          let faixa = '';
          let faixaCfg = null;
          if (!pct) {
            faixaCfg = faixas.get(String(it.faixa || ''));
            if (!faixaCfg) continue;
            faixa = faixaCfg.label;
          }
          const chave = `${canal}|${uf}|${regiao}|${faixa}`;
          if (vistos.has(chave)) continue;
          const v = pct ? null : numero(it.v);
          const p = pct ? numero(it.p) : null;
          const m = pct ? numero(it.m) : null;
          if (v === null && p === null && m === null) continue;
          if ([v, p, m].some((n) => n !== null && n < 0) || (p !== null && p > 100)) continue;
          vistos.add(chave);
          linhas.push({
            convite_id: convite.id, canal, uf_destino: uf, regiao, faixa,
            peso_inicial: faixaCfg ? faixaCfg.min : null, peso_final: faixaCfg ? faixaCfg.max : null,
            frete_valor: v, frete_percentual: p, frete_minimo: m, updated_at: agora,
          });
        }
        // o que esta na tela e a verdade: apaga o canal e regrava
        const { error: eDel } = await supabase.from('fracionado_respostas').delete().eq('convite_id', convite.id).eq('canal', canal);
        if (eDel) throw eDel;
      }
      for (let i = 0; i < linhas.length; i += 500) {
        const { error: eIns } = await supabase.from('fracionado_respostas').insert(linhas.slice(i, i + 500));
        if (eIns) throw eIns;
      }
      const atualiza = { dados_gerais: gerais, ultimo_acesso_em: agora };
      if (body.enviar) {
        if (!linhas.length) return enviarJson(res, 400, { erro: 'Preencha ao menos uma célula antes de enviar.' });
        const semIcms = config.canais.filter((c) => gerais[c] && !gerais[c].icms_incluso);
        if (semIcms.length) return enviarJson(res, 400, { erro: 'Informe se os valores já incluem ICMS.' });
        Object.assign(atualiza, { status: 'ENVIADO', enviado_em: agora, qtd_envios: (convite.qtd_envios || 0) + 1 });
      }
      const { error: eUp } = await supabase.from('fracionado_convites').update(atualiza).eq('id', convite.id);
      if (eUp) throw eUp;
      if (body.enviar) {
        await supabase.from('fracionado_envios').insert({
          convite_id: convite.id, enviado_em: agora, respondente_nome: convite.respondente_nome, respondente_email: convite.respondente_email,
          respondente_cnpj: convite.respondente_cnpj, qtd_linhas: linhas.length, origem_envio: body.origem_envio === 'ADMIN' ? 'ADMIN' : 'PORTAL',
        });
      }
      return enviarJson(res, 200, { ok: true, salvas: linhas.length });
    }

    return enviarJson(res, 400, { erro: 'Ação inválida.' });
  } catch (e) {
    console.error('[fracionado-cotacao]', e);
    const msg = String(e?.message || e);
    return enviarJson(res, 500, { erro: /does not exist|schema cache/i.test(msg) ? 'Portal ainda não habilitado (migration pendente).' : 'Erro ao processar. Tente novamente.' });
  }
}
