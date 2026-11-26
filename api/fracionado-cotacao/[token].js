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
 *   PERCENTUAL : UF destino x regiao (CAPITAL, INTERIOR 1..9, METROPOLITANA) -> frete % + minimo R$ + kg garantia (R$/kg, opcional)
 *   FAIXA_PESO : UF destino x faixa de peso x regiao -> frete R$ (faixa aberta = R$/kg excedente)
 * Dados gerais por canal (mesmas generalidades do cadastro de tabelas): faturamento, prazo de pagamento, GRIS (+ minimo), ad valorem (+ minimo),
 *   pedagio (fracao 100 kg), TAS, CTRC, cubagem, taxa emergencial, frete minimo geral, composicao do frete, observacoes, taxas adicionais
 *   (R$ CT-e, % NF, R$/kg c/ franquia, R$ por fracao de peso; minimo e UFs), ICMS incluso, vigencia.
 * Por cidade (atendimento): regiao, prazo e as taxas de COLS_ATEND_FRACIONADO (tda/trt/suframa em colunas; demais em taxas_destino jsonb).
 */
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { montarPlanilhaFracionado, COLS_ATEND_FRACIONADO } from '../_fracionadoExcel.mjs';
import { periodoVolumetria, baseVolumetria } from '../_fracionadoVolumetria.mjs';
import { PREMISSAS_FRACIONADO } from '../_fracionadoExcel.mjs';

const VALIDADE_ACESSO_MS = 8 * 60 * 60 * 1000;
// Prazo de pagamento padrao (dias). Abaixo disso o portal marca em vermelho: exige aprovacao da diretoria.
// Meta interna e 28 dias (pratica atual); 35 da folga na negociacao.
const PRAZO_PAGAMENTO_PADRAO = 35;
const MAX_CTES_POR_FATURA = 500; // premissa da negociacao: fatura com no maximo 500 CT-es
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const REGIOES = ['CAPITAL', 'INTERIOR 1', 'INTERIOR 2', 'INTERIOR 3', 'INTERIOR 4', 'INTERIOR 5', 'INTERIOR 6', 'INTERIOR 7', 'INTERIOR 8', 'INTERIOR 9', 'METROPOLITANA'];
const FAIXAS_PADRAO = {
  B2C: '0-2, 2-5, 5-10, 10-20, 20-30, 30-50, 50-100, 100+',
  ATACADO: '0-10, 10-20, 20-30, 30-50, 50-70, 70-100, 100-150, 150-200, 200-300, 300-500, 500-1000, 1000+',
};
const EXT_ANEXO = ['xlsx', 'xls', 'csv', 'pdf', 'doc', 'docx', 'zip'];
const MAX_ANEXO_B64 = 4300000;
const CHAVES_GERAIS = ['generalidades', 'faturamento', 'prazo', 'gris', 'gris_min', 'advalorem', 'advalorem_min', 'pedagio', 'tas', 'ctrc', 'cubagem', 'emergencial', 'frete_min', 'composicao', 'observacoes', 'icms_incluso', 'vigencia'];
// Taxas por cidade do atendimento: colunas proprias (tda/trt/suframa) + jsonb taxas_destino (migration 20261126_002)
const COLS_ATEND_PROPRIAS = COLS_ATEND_FRACIONADO.filter((c) => c[2]);
const COLS_ATEND_JSON = COLS_ATEND_FRACIONADO.filter((c) => !c[2]);

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

// Origens (CDs) do convite. Sem origem cadastrada = uma origem unica sem nome.
function origensDoConvite(convite) {
  const lista = Array.isArray(convite.origens) ? convite.origens.map((x) => String(x || '').replace(/[|]/g, '/').trim()).filter(Boolean) : [];
  if (lista.length) return Array.from(new Set(lista));
  return [String(convite.origem || '').replace(/[|]/g, '/').trim()];
}

// ---- Volumetria (base de CT-es, sem transportadora e sem valor de frete) ----------
// ATACADO = 3 meses fechados anteriores; B2C = 1 mes fechado anterior (base muito maior).
function configDoConvite(convite) {
  return {
    periodos: Object.fromEntries(canaisDoConvite(convite).map((c) => [c, periodoVolumetria(c)])),
    canais: canaisDoConvite(convite),
    modalidade: convite.modalidade === 'FAIXA_PESO' ? 'FAIXA_PESO' : convite.modalidade === 'PROPRIA' ? 'PROPRIA' : 'PERCENTUAL',
    faixas: faixasDoConvite(convite),
    ufs: UFS,
    regioes: REGIOES,
    origens: origensDoConvite(convite),
  };
}

async function todas(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Municipios (IBGE, UF, nome): base do sistema; se incompleta, cai para a API oficial do IBGE.
let CACHE_MUN = null;
async function carregarMunicipios(supabase) {
  if (CACHE_MUN) return CACHE_MUN;
  let lista = [];
  try {
    const rows = await todas(() => supabase.from('ibge_municipios').select('*'));
    lista = rows.map((r) => ({
      i: String(r.codigo_municipio_completo || r.ibge || r.codigo_ibge || r.codigo_municipio || '').replace(/\D/g, '').slice(0, 7),
      u: String(r.uf || r.sigla_uf || '').toUpperCase().slice(0, 2),
      c: String(r.nome_municipio || r.cidade || r.municipio || r.nome || '').trim(),
    })).filter((m) => m.i.length >= 6 && UFS.includes(m.u) && m.c);
  } catch { lista = []; }
  if (lista.length < 5000) {
    try {
      const resp = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome');
      const json = await resp.json();
      const viaApi = (Array.isArray(json) ? json : []).map((m) => ({
        i: String(m.id || ''),
        u: String(m?.microrregiao?.mesorregiao?.UF?.sigla || m?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla || '').toUpperCase(),
        c: String(m.nome || '').trim(),
      })).filter((m) => m.i && UFS.includes(m.u) && m.c);
      if (viaApi.length > lista.length) lista = viaApi;
    } catch { /* segue com o que a base tiver */ }
  }
  lista.sort((a, b) => (a.u === b.u ? a.c.localeCompare(b.c, 'pt-BR') : a.u.localeCompare(b.u)));
  CACHE_MUN = lista;
  return lista;
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
  const modTxt = convite.modalidade === 'FAIXA_PESO' ? 'Frete por faixa de peso' : convite.modalidade === 'PROPRIA' ? 'Tabela própria do transportador' : 'Frete percentual';
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
.ger input.prazo-baixo{border-color:#dc2626;background:#fef2f2;color:#b91c1c;font-weight:bold}.prazo-msg{display:block;margin-top:4px;font-size:12px;line-height:1.3;color:#64748b}.prazo-msg.erro{color:#b91c1c;font-weight:bold}
.tw{overflow:auto;max-height:66vh;border:1px solid #cbd5e1;border-radius:8px}
table{border-collapse:separate;border-spacing:0;font-size:14px}
th{background:#1E3A5F;color:#fff;padding:8px;text-align:center;position:sticky;top:0;z-index:2;white-space:nowrap;font-size:13px;border-right:1px solid #fff3}
th.sub{background:#b45309;top:34px;font-size:12px}
td{padding:4px;border-bottom:1px solid #e2e8f0;background:#fff}td.fixo{font-weight:bold;background:#f1f5f9;position:sticky;left:0;z-index:1;padding:6px 10px;white-space:nowrap}
td input{width:96px;padding:7px 8px;font-size:14px;text-align:right;border:2px solid #fcd34d;background:#fffbeb}
td input.cheio{background:#ecfdf3;border-color:#86efac}
td input.alerta{background:#fff7ed;border:2px solid #f59e0b;color:#9a3412;font-weight:bold}td input.bloq{background:#fef2f2;border:2px solid #dc2626;color:#b91c1c;font-weight:bold}
.excbox{margin:8px 0;padding:10px 12px;background:#eff6ff;border:2px solid #93c5fd;border-radius:10px;font-size:14px;line-height:1.45}
select.fora{background:#fed7aa;border:2px solid #ea580c;color:#9a3412;font-weight:bold}
.ufgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:4px 10px;margin:6px 0 10px}.ufgrid label{display:flex;align-items:center;gap:4px;font-weight:normal;margin:0;font-size:14px;cursor:pointer}.ufgrid input{width:auto;margin:0}
.ufsel{flex-basis:100%;background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px}.ufsel summary{cursor:pointer;font-size:14px}
.taxas{padding:12px;background:#f8fafc;border:2px solid #cbd5e1;border-radius:10px;margin:0 0 12px}.taxas .lin{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap}.taxas input,.taxas select{width:auto}.taxas button.x{background:#fff;color:#b91c1c;border:2px solid #b91c1c;padding:6px 12px}
.barra{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:14px 0 0;position:sticky;bottom:0;background:#fff;padding:12px 0;border-top:2px solid #e2e8f0}
.fl{font-size:14px;font-weight:bold;color:#334155;display:flex;align-items:center;gap:6px;margin:0}.fl select{width:auto;min-width:200px}
@media(max-width:700px){.corpo,header{padding:14px}}
</style></head><body><div class="page">
<header><h1>Tabela de frete fracionado</h1><p><b>${esc(convite.transportadora)}</b> · ${esc(canaisTxt)} · ${esc(modTxt)}${convite.campanha ? ` · ${esc(convite.campanha)}` : ''}</p>
${origensDoConvite(convite).filter(Boolean).length ? `<p>Origem: ${esc(origensDoConvite(convite).filter(Boolean).join(' · '))}</p>` : ''}
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
var TOKEN=${JSON.stringify(convite.token)},NOME=${JSON.stringify(convite.transportadora)},PRAZO_PADRAO=${PRAZO_PAGAMENTO_PADRAO},MAX_CTES=${MAX_CTES_POR_FATURA},PREMISSAS=${JSON.stringify(PREMISSAS_FRACIONADO)};
${montarPlanilhaFracionado.toString()}
var CFG=null,ACESSO='',ST={},CANAL='',ORI=0,VISAO='tabela',UFSEL='',FUF='',CNPJ='',MUN=[],MUNIDX={},FREG='',FBUSCA='',FSEM=false;
var CAD={cnpj_origem:{}},CADABERTO=true,VOLABERTO=false,VOLORI={},VOLUFS={},VOLBUSY=false;
var GER=[['prazo','Prazo de pagamento (dias)'],['gris','GRIS (%)'],['gris_min','GRIS mínimo (R$)'],['advalorem','Ad valorem (%)'],['advalorem_min','Ad valorem mínimo (R$)'],['pedagio','Pedágio (R$ por fração de 100 kg)'],['tas','TAS (R$)'],['ctrc','Taxa por CT-e emitido / CTRC (R$)'],['cubagem','Cubagem (kg/m³)','300'],['emergencial','Taxa emergencial (%)'],['frete_min','Frete mínimo geral (R$)']];
var COLS_A=${JSON.stringify(COLS_ATEND_FRACIONADO)};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function sa(s){return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().trim()}
function num(v){if(v===''||v==null)return null;if(typeof v==='number')return isFinite(v)?v:null;var t=String(v).replace(/R\\$/gi,'').replace(/%/g,'').replace(/\\s/g,'');if(t.indexOf(',')>=0)t=t.replace(/\\./g,'').replace(',','.');var n=Number(t);return isFinite(n)?n:null}
function fmtIn(n){return n==null||n===''?'':String(n).replace('.',',')}
function nomeCanal(c){return c==='ATACADO'?'Atacado':'B2C'}
function oriNome(i){return CFG.origens[i]||''}
function api(corpo){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.erro||'Erro');return j})})}
function prazoBaixo(v){var n=num(v);return n!=null&&n<PRAZO_PADRAO}
function prazoMsg(v){return prazoBaixo(v)?'Abaixo do nosso padrão de '+PRAZO_PADRAO+' dias após o faturamento: precisa de aprovação da diretoria e pode pesar na avaliação da proposta.':'Nosso padrão: '+PRAZO_PADRAO+' dias após o faturamento (semanal ou quinzenal).'}
function campoPrazo(s){var v=s.g.prazo||'',fa=s.g.faturamento||'';return '<div><label>Faturamento</label><select data-g="faturamento"><option value="">Selecione…</option><option value="SEMANAL"'+(fa==='SEMANAL'?' selected':'')+'>Semanal</option><option value="QUINZENAL"'+(fa==='QUINZENAL'?' selected':'')+'>Quinzenal</option></select><small class="prazo-msg erro">Premissa: no máximo '+MAX_CTES+' CT-es por fatura.</small></div><div><label>Prazo de pagamento após faturamento (dias)</label><input data-g="prazo" value="'+esc(v)+'" inputmode="decimal" placeholder="'+PRAZO_PADRAO+'" class="'+(prazoBaixo(v)?'prazo-baixo':'')+'"><small id="prazoMsg" class="prazo-msg'+(prazoBaixo(v)?' erro':'')+'">'+prazoMsg(v)+'</small></div>'}
function checaPrazo(t){var b=prazoBaixo(t.value);t.className=b?'prazo-baixo':'';var m=document.getElementById('prazoMsg');if(m){m.className='prazo-msg'+(b?' erro':'');m.textContent=prazoMsg(t.value)}}
function fmtR(n){return Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
// Faixa aberta (Acima de X kg) = R$ por kg excedente. Bloqueia valor com cara de preço de faixa/tonelada; avisa se fora da curva.
function excInfo(c,k){var p=k.split('|'),F=CFG.faixas[c]||[],fi=Number(p[3]),f=F[fi];if(p[3]===''||!f||f.max!=null)return null;
  var v=num((ST[c].c[k]||{}).v);if(v==null)return null;var ant=F[fi-1],pv=ant?num((ST[c].c[p[0]+'|'+p[1]+'|'+p[2]+'|'+(fi-1)]||{}).v):null,media=pv&&ant.max?pv/ant.max:null;
  if(v>50||(pv&&v>=pv))return{n:'erro',t:'R$ '+fmtR(v)+' não parece R$ por kg excedente (parece o preço da faixa ou valor por tonelada). Informe só quanto cobra por CADA KG acima de '+f.min+' kg'+(pv?'; até '+f.min+' kg o frete já é R$ '+fmtR(pv):'')+'.'};
  if((media&&v>media*3)||(!media&&v>10))return{n:'aviso',t:'R$ '+fmtR(v)+' por kg excedente está alto'+(media?' (na faixa anterior sai R$ '+fmtR(media)+' por kg)':'')+'. Confira se é por kg e não por tonelada.'};
  return null}
function excCel(t){var info=excInfo(CANAL,t.getAttribute('data-k'));t.className=(t.value?'cheio':'')+(info?(info.n==='erro'?' bloq':' alerta'):'');t.title=info?info.t:''}
function excMsg(){var e=document.getElementById('excMsg');if(!e)return;var out=[];document.querySelectorAll('input[data-exc]').forEach(function(t){excCel(t);var info=excInfo(CANAL,t.getAttribute('data-k'));if(info)out.push('<div style="color:'+(info.n==='erro'?'#b91c1c':'#b45309')+';font-weight:bold">'+(info.n==='erro'?'⛔ ':'⚠ ')+esc(t.getAttribute('data-k').split('|')[2])+': '+esc(info.t)+'</div>')});e.innerHTML=out.join('')}
function cheio(x){return !!(x&&(x.v||x.p||x.m||x.k))}
function cnpjOkC(v){var c=String(v||'').replace(/\\D/g,'');if(c.length!==14||/^(\\d)\\1+$/.test(c))return false;function dv(b){var s=0,p=b.length-7;for(var i=0;i<b.length;i++){s+=Number(b[i])*p;p--;if(p<2)p=9}var r=s%11;return r<2?0:11-r}return dv(c.slice(0,12))===Number(c[12])&&dv(c.slice(0,13))===Number(c[13])}
function telOk(v){return String(v||'').replace(/\\D/g,'').length>=10}
function mailOk(v){return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(v||'').trim())}
function faltasCadastro(){var c=CAD,out=[];if(!c.razao)out.push('Informe a RAZÃO SOCIAL');
  if(!c.com_nome||!(telOk(c.com_tel)||telOk(c.com_whats))||!mailOk(c.com_email))out.push('Complete o CONTATO COMERCIAL (nome, telefone ou WhatsApp e e-mail)');
  if(!(telOk(c.op_tel)||telOk(c.op_whats)))out.push('Informe telefone ou WhatsApp do OPERACIONAL (coletas e ocorrências)');
  if(!mailOk(c.fin_email))out.push('Informe o e-mail do FINANCEIRO (faturas)');
  CFG.origens.forEach(function(o){if(!cnpjOkC(c.cnpj_origem[o]))out.push('Informe o CNPJ que vai emitir os CT-es'+(o?' saindo de '+o:''))});return out}
function cadCampo(k,rot,obrig,ph,tipo){var v=CAD[k]||'',ok=!obrig||(tipo==='mail'?mailOk(v):tipo==='tel'?telOk(v):!!String(v).trim());
  return '<div><label>'+rot+(obrig?' <span style="color:#b91c1c">*</span>':'')+'</label><input data-cad="'+k+'" data-tipo="'+(tipo||'')+'" data-obrig="'+(obrig?1:0)+'" value="'+esc(v)+'" placeholder="'+esc(ph||'')+'"'+(tipo==='tel'?' inputmode="tel"':tipo==='mail'?' inputmode="email"':'')+' style="border:2px solid '+(ok?'#cbd5e1':'#fca5a5')+'"></div>'}
function blocoCadastro(){var nOri=CFG.origens,falta=faltasCadastro();
  var h='<div class="taxas" id="cadBox" style="border-color:'+(falta.length?'#fca5a5':'#86efac')+'"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b style="font-size:17px">🪪 Dados cadastrais (pré-cadastro)</b><span id="cadSt" style="font-size:13px;color:'+(falta.length?'#b91c1c':'#166534')+';font-weight:bold">'+(falta.length?falta.length+' pendência(s)':'✅ completo')+'</span><button class="sec" style="padding:4px 10px" onclick="CADABERTO=!CADABERTO;render()">'+(CADABERTO?'Recolher ▴':'Abrir ▾')+'</button></div>';
  h+='<small style="color:#64748b">Tabela: <b>'+CFG.canais.map(nomeCanal).join(' + ')+'</b> · <b>'+(CFG.modalidade==='FAIXA_PESO'?'Frete por faixa de peso':CFG.modalidade==='PROPRIA'?'Tabela própria':'Frete percentual')+'</b>'+(nOri.filter(Boolean).length?' · Origens: <b>'+nOri.map(esc).join(', ')+'</b>':'')+' · CNPJ de acesso: <b>'+esc(CNPJ)+'</b></small>';
  if(!CADABERTO)return h+'</div>';
  h+='<div class="ger" style="background:#fff;margin-top:8px">'+cadCampo('razao','Razão social',true,'Razão social completa')+cadCampo('fantasia','Nome fantasia',false,NOME)+cadCampo('ie','Inscrição estadual',false,'')+cadCampo('endereco','Endereço da matriz',false,'Rua, nº, cidade/UF')+'</div>';
  h+='<div style="font-weight:bold;margin:6px 0 2px">CNPJ que vai emitir os CT-es <span style="color:#b91c1c">*</span> <small style="font-weight:normal;color:#64748b">(filial de cada origem; pode repetir se for o mesmo)</small></div><div class="ger" style="background:#fff">'
    +nOri.map(function(o,i){var v=CAD.cnpj_origem[o]||'',ok=cnpjOkC(v);return '<div><label>'+(o?esc(o):'CNPJ emissor')+'</label><input data-cadori="'+i+'" value="'+esc(v)+'" placeholder="00.000.000/0000-00" inputmode="numeric" style="border:2px solid '+(ok?'#86efac':'#fca5a5')+'">'+(v&&!ok?'<small style="color:#b91c1c;font-weight:bold">CNPJ inválido</small>':'')+'</div>'}).join('')+'</div>';
  h+='<div style="font-weight:bold;margin:6px 0 2px">Contato comercial</div><div class="ger" style="background:#fff">'+cadCampo('com_nome','Nome',true,'')+cadCampo('com_tel','Telefone',false,'(00) 0000-0000','tel')+cadCampo('com_whats','WhatsApp',false,'(00) 00000-0000','tel')+cadCampo('com_email','E-mail',true,'','mail')+'</div>';
  h+='<div style="font-weight:bold;margin:6px 0 2px">Operacional (coletas e ocorrências)</div><div class="ger" style="background:#fff">'+cadCampo('op_nome','Nome',false,'')+cadCampo('op_tel','Telefone',false,'','tel')+cadCampo('op_whats','WhatsApp',false,'','tel')+cadCampo('op_email','E-mail',false,'','mail')+'</div>';
  h+='<div style="font-weight:bold;margin:6px 0 2px">Financeiro (faturas e cobrança)</div><div class="ger" style="background:#fff">'+cadCampo('fin_nome','Nome',false,'')+cadCampo('fin_tel','Telefone',false,'','tel')+cadCampo('fin_email','E-mail',true,'','mail')+'</div>';
  h+='<small style="color:#64748b">Telefone ou WhatsApp: informe ao menos um no comercial e no operacional. Esses dados serão usados no cadastro da transportadora.</small></div>';
  return h}
function ligaCad(){var b=document.getElementById('cadBox');if(!b)return;
  b.oninput=function(ev){var t=ev.target,k=t.getAttribute('data-cad'),o=t.getAttribute('data-cadori');ev.stopPropagation();
    if(k)CAD[k]=t.value;else if(o!==null)CAD.cnpj_origem[CFG.origens[Number(o)]]=t.value;else return;
    if(typeof caixaFaltas==='function')caixaFaltas()};
  b.addEventListener('input',function(ev){var t=ev.target,tp=t.getAttribute('data-tipo'),ob=t.getAttribute('data-obrig')==='1',v=t.value,ok;
    if(t.hasAttribute('data-cadori'))ok=cnpjOkC(v);else ok=!ob||(tp==='mail'?mailOk(v):tp==='tel'?telOk(v):!!v.trim());
    t.style.borderColor=ok?(t.hasAttribute('data-cadori')?'#86efac':'#cbd5e1'):'#fca5a5';
    var f=faltasCadastro(),st=document.getElementById('cadSt');if(st){st.textContent=f.length?f.length+' pendência(s)':'✅ completo';st.style.color=f.length?'#b91c1c':'#166534'}})}
function cidadeOk(x){return !!(x&&x.r&&num(x.p)>0)}
function identificar(){var b=document.getElementById('btnId');document.getElementById('erroId').innerHTML='';
  var cnpj=document.getElementById('cnpj').value,nome=document.getElementById('nome').value.trim(),email=document.getElementById('email').value.trim();
  if(!nome||!email||cnpj.replace(/\\D/g,'').length!==14){document.getElementById('erroId').innerHTML='<div class="msg erro">Informe CNPJ (14 dígitos), nome e e-mail.</div>';return}
  b.disabled=true;api({acao:'identificar',cnpj:cnpj,nome:nome,email:email}).then(function(j){
    ACESSO=j.acesso;CFG=j.config;CNPJ=cnpj;ST={};VOLORI={};CFG.origens.forEach(function(o,i){VOLORI[i]=true});VOLUFS={};CFG.ufs.forEach(function(u){VOLUFS[u]=true});
    CFG.canais.forEach(function(c){ST[c]={g:Object.assign({},(j.gerais||{})[c]||{}),c:{},a:{},f:[]}});CAD=Object.assign({com_nome:nome,com_email:email},(j.gerais||{}).CADASTRO||{});CAD.cnpj_origem=Object.assign({},CAD.cnpj_origem||{});
    (j.anexos||[]).forEach(function(a){if(ST[a.canal])ST[a.canal].f.push(a)});
    (j.linhas||[]).forEach(function(l){var s=ST[l.canal],oi=CFG.origens.indexOf(l.origem||'');if(!s||oi<0)return;var fi='';
      if(CFG.modalidade==='FAIXA_PESO'){fi=-1;(CFG.faixas[l.canal]||[]).forEach(function(f,i){if(f.label===l.faixa)fi=i});if(fi<0)return}
      s.c[oi+'|'+l.uf_destino+'|'+l.regiao+'|'+fi]={v:fmtIn(l.frete_valor),p:fmtIn(l.frete_percentual),m:fmtIn(l.frete_minimo),k:fmtIn(l.frete_kg)}});
    (j.atendimento||[]).forEach(function(a){var s=ST[a.canal],oi=CFG.origens.indexOf(a.origem||'');if(!s||oi<0)return;
      var xa={r:a.regiao||'',p:fmtIn(a.prazo_dias)},td=a.taxas_destino||{};COLS_A.forEach(function(c){xa[c[0]]=fmtIn(c[2]?a[c[2]]:td[c[0]])});s.a[oi+'|'+a.ibge]=xa});
    document.getElementById('telaId').style.display='none';montar(j.status);
    if(CFG.modalidade==='PROPRIA')return;
    api({acao:'municipios',acesso:ACESSO}).then(function(m){MUN=m.m.map(function(x){return{i:x[0],u:x[1],c:x[2],n:sa(x[2])}});MUN.forEach(function(x){MUNIDX[x.i]=x});render()}).catch(function(e){document.getElementById('msgTab').innerHTML='<div class="msg erro">Não consegui carregar a lista de cidades: '+esc(e.message)+'</div>'})
  }).catch(function(e){document.getElementById('erroId').innerHTML='<div class="msg erro">'+esc(e.message)+'</div>';b.disabled=false})}
function montar(status){var t=document.getElementById('telaTab');t.style.display='block';CANAL=CFG.canais[0];UFSEL=CFG.ufs[0];ORI=0;
  var pct=CFG.modalidade==='PERCENTUAL';
  var h=(CFG.modalidade==='PROPRIA'?'<div class="regra"><b>Como funciona</b><br>• Anexe <b>2 arquivos obrigatórios</b>: <b>(1) a sua tabela de frete</b> (Excel, CSV, PDF, Word ou ZIP) e <b>(2) os destinos atendidos</b> em Excel/CSV, com <b>cidade (ou IBGE), rota/região de cada cidade, prazo de entrega e taxas por destino</b> (TDA, TRT etc.). Baixe o modelo de destinos se preferir.<br>• <b>Generalidades</b> (taxas gerais, regras de cobrança, restrições): de preferência na própria tabela; se estiverem em outro arquivo, anexe no item 3. Há também um campo de observações.<br>• O portal confere os arquivos na hora: <b>sem a tabela e os destinos completos não é possível enviar</b>.<br>• As generalidades serão <b>avaliadas pelo time de suprimentos</b> para definir se entram ou não no nosso escopo.<br>• Clique em <b>Salvar rascunho</b> para continuar depois e em <b>Enviar</b> quando concluir.</div>':'<div class="regra"><b>Como preencher (2 passos por canal'+(CFG.origens.length>1?' e por origem':'')+')</b><br>• <b>1. Tabela de frete:</b> '+(pct?'informe, por <b>UF de destino</b> e <b>região</b> (Capital, Interior 1 a 9, Metropolitana), o <b>frete em % sobre o valor da NF</b> e o <b>mínimo em R$</b> e, se você trabalha com ele, o <b>kg garantia (R$/kg)</b>: o frete fica o maior entre % da NF, mínimo e peso × R$/kg.':'escolha a <b>UF de destino</b> e informe o <b>frete em R$</b> de cada <b>faixa de peso</b> por <b>região</b>. Na última linha (faixa aberta) informe o <b>R$ por kg excedente</b>.')+'<br>• <b>2. Atendimento:</b> para cada <b>cidade de destino</b> informe a <b>região (rota)</b> a que ela pertence e o <b>prazo de entrega</b> em dias (as taxas por cidade — TDA, TRT, Suframa, coleta, entrega, pedágio, fluvial, TZR etc. — são opcionais; taxa por destino que não tiver coluna entra em <b>+ Incluir taxa</b> com as UFs). A lista de regiões mostra primeiro as que você preencheu na tabela; se escolher outra, o campo fica <b style="color:#ea580c">laranja</b>. Cidades sem prazo são consideradas não atendidas. Use os filtros de UF, busca e região, e o botão para aplicar região/prazo a várias cidades de uma vez.<br>• Preencha os <b>dados gerais</b> (prazo de pagamento — <b>nosso padrão é '+PRAZO_PADRAO+' dias após o faturamento</b>, semanal ou quinzenal; abaixo disso precisa de aprovação da diretoria. <b>Premissa: no máximo '+MAX_CTES+' CT-es por fatura</b> —, GRIS, ad valorem, pedágio, TAS), inclua outras <b>taxas</b> em <b>+ Incluir taxa</b> e informe se os valores <b>já incluem ICMS</b>. A TDA é por rota final e fica no passo 2 (Atendimento).'+(CFG.origens.length>1?'<br>• Use o filtro <b>Origem</b> para preencher cada origem; <b>Copiar esta origem para as demais</b> vale se a tabela for igual.':'')+'<br>• Prefere o Excel? <b>Baixe o modelo</b> (da origem e do canal selecionados), preencha e <b>importe</b> de volta. Clique em <b>Salvar rascunho</b> para continuar depois e em <b>Enviar tabela</b> quando concluir.</div>')
  +(status==='ENVIADO'?'<div class="msg ok">Você já enviou esta tabela. Se alterar valores, clique em enviar novamente para atualizar.</div>':'')
  +'<div class="abas" id="abas"></div><div id="msgTab"></div><div id="conteudo"></div>'
  +'<div class="barra"><button class="sec" onclick="enviar(false)">Salvar rascunho</button><button onclick="enviar(true)">Enviar tabela</button><span id="cont"></span></div>';
  t.innerHTML=h;render()}
function abas(){var a=document.getElementById('abas');if(CFG.canais.length<2){a.innerHTML='';return}
  a.innerHTML=CFG.canais.map(function(c){return '<button class="'+(c===CANAL?'on':'')+'" onclick="setCanal(\\''+c+'\\')">'+nomeCanal(c)+'</button>'}).join('')}
function setCanal(c){CANAL=c;render()}
function setVisao(v){VISAO=v;render()}
function render(){if(!CFG)return;if(CFG.modalidade==='PROPRIA'){renderPropria();return}abas();var s=ST[CANAL],h=blocoPremissas()+blocoCadastro();
  h+='<div class="ferr">';
  if(CFG.origens.length>1)h+='<label class="fl">Origem <select onchange="ORI=Number(this.value);render()">'+CFG.origens.map(function(o,i){return '<option value="'+i+'"'+(i===ORI?' selected':'')+'>'+esc(o)+'</option>'}).join('')+'</select></label><button class="sec" onclick="copiarOrigem()">Copiar esta origem para as demais</button>';
  else if(CFG.origens[0])h+='<span class="fl">Origem: '+esc(CFG.origens[0])+'</span>';
  h+='<button class="'+(VISAO==='tabela'?'':'sec')+'" onclick="setVisao(\\'tabela\\')">1. Tabela de frete</button><button class="'+(VISAO==='cidades'?'':'sec')+'" onclick="setVisao(\\'cidades\\')">2. Atendimento (cidades, região e prazo)</button></div>';
  h+=blocoVol();
  h+='<div class="ferr"><button class="sec" onclick="baixarModelo()">⬇ Baixar modelo (Excel) — '+nomeCanal(CANAL)+(CFG.origens.length>1?' / '+esc(oriNome(ORI)):'')+'</button><button class="sec" onclick="document.getElementById(\\'arq\\').click()">⬆ Importar planilha preenchida</button><input type="file" id="arq" accept=".xlsx,.xls,.csv" style="display:none" onchange="importar(this)"><span id="resumo" class="fl"></span></div>';
  if(VISAO==='tabela'){
    h+='<div class="ger">'+GER.map(function(g){if(g[0]==='prazo')return campoPrazo(s);return '<div><label>'+g[1]+'</label><input data-g="'+g[0]+'" value="'+esc(s.g[g[0]]||'')+'" inputmode="decimal"'+(g[2]?' placeholder="'+g[2]+'"':'')+'></div>'}).join('')
      +(CFG.modalidade==='PERCENTUAL'?'<div><label>Composição do frete</label><select data-g="composicao"><option value="">Selecione…</option><option value="MAIOR"'+(s.g.composicao==='MAIOR'?' selected':'')+'>Maior entre % NF, mínimo e kg</option><option value="PESO_MAIS_PERCENTUAL"'+(s.g.composicao==='PESO_MAIS_PERCENTUAL'?' selected':'')+'>Soma peso (R$/kg) + % NF</option></select></div>':'')
      +'<div><label>Valores já incluem ICMS?</label><select data-g="icms_incluso"><option value="">Selecione…</option><option value="SIM"'+(s.g.icms_incluso==='SIM'?' selected':'')+'>Sim, já incluem</option><option value="NAO"'+(s.g.icms_incluso==='NAO'?' selected':'')+'>Não, ICMS por fora</option></select></div>'
      +'<div><label>Vigência a partir de</label><input type="date" data-g="vigencia" value="'+esc(s.g.vigencia||'')+'"></div>'
      +'<div style="grid-column:1/-1"><label>Observações / outras condições da tabela</label><textarea data-g="observacoes" rows="2" style="width:100%;padding:8px;border:2px solid #fcd34d;border-radius:8px;font-family:inherit;font-size:14px">'+esc(s.g.observacoes||'')+'</textarea></div></div>';
    h+=blocoTaxas(s);
    h+=CFG.modalidade==='PERCENTUAL'?gradePct():gradeFaixa();
  }else h+=viewCidades();
  var c=document.getElementById('conteudo');c.innerHTML=h;excMsg();ligaCad();
  c.oninput=function(ev){var t=ev.target;if(t.getAttribute('data-g')){ST[CANAL].g[t.getAttribute('data-g')]=t.value;if(t.getAttribute('data-g')==='prazo')checaPrazo(t);return}
    var kt=t.getAttribute('data-t');if(kt!==null&&kt!==undefined){var tx=ST[CANAL].g.taxas||(ST[CANAL].g.taxas=[]);var ti=Number(kt);if(tx[ti])tx[ti][t.getAttribute('data-f')]=t.value;return}
    var ka=t.getAttribute('data-a');if(ka){var xa=ST[CANAL].a[ka]||(ST[CANAL].a[ka]={});xa[t.getAttribute('data-f')]=t.value;if(t.tagName==='INPUT')t.className=t.value?'cheio':'';else if(t.getAttribute('data-f')==='r'){var rt0=regTab(UFSEL);t.className=(t.value&&rt0&&!rt0[t.value])?'fora':''}resumo();return}
    var k=t.getAttribute('data-k');if(!k)return;var f=t.getAttribute('data-f'),x=ST[CANAL].c[k]||(ST[CANAL].c[k]={});x[f]=t.value;t.className=t.value?'cheio':'';if(t.hasAttribute('data-exc')||CFG.modalidade==='FAIXA_PESO')excMsg();resumo()};
  c.onchange=function(ev){var t=ev.target;if(t.getAttribute('data-g'))ST[CANAL].g[t.getAttribute('data-g')]=t.value;else if(t.getAttribute('data-a'))c.oninput(ev);else if(t.hasAttribute('data-t')&&t.getAttribute('data-f')==='u'){c.oninput(ev);render()}};
  if(VISAO==='cidades')filtraCidades();
  resumo()}
function catAnexo(a){var m=/^\\[(DESTINOS|GENERALIDADES)\\]/.exec(a.nome||'');return a.categoria||(m?m[1]:'TABELA')}
function blocoPremissas(){return '<div style="background:#fff7ed;border:3px solid #ea580c;border-radius:12px;padding:12px 16px;margin:0 0 12px"><div style="font-size:19px;font-weight:900;color:#9a3412;margin-bottom:6px">📌 Premissas da negociação — leia antes de preencher</div>'+PREMISSAS.map(function(p){return '<div style="font-size:15px;margin:4px 0;color:#431407">• '+p+'</div>'}).join('')+'<div style="font-size:13px;color:#9a3412;margin-top:6px">Essas condições valem para qualquer tabela enviada e farão parte do termo de aceite.</div></div>'}
var ITENS_DEST=[['cidade','CIDADE (ou código IBGE)'],['rota','ROTA / REGIÃO de cada cidade'],['prazo','PRAZO de entrega'],['taxa','TAXAS por destino (TDA, TRT…)']];
function faltasPropria(c){var s=ST[c],out=[],tab=s.f.filter(function(a){return catAnexo(a)==='TABELA'}),dst=s.f.filter(function(a){return catAnexo(a)==='DESTINOS'});
  if(!tab.length)out.push('Anexe a TABELA DE FRETE');
  if(!dst.length)out.push('Anexe o arquivo de DESTINOS ATENDIDOS (cidade, rota, prazo e taxas)');
  else{var un={};dst.forEach(function(a){var l=a.leitura||{};ITENS_DEST.forEach(function(it){if(l[it[0]])un[it[0]]=1})});var ver=dst.some(function(a){return a.leitura});
    if(ver)ITENS_DEST.forEach(function(it){if(!un[it[0]])out.push('O arquivo de destinos não tem '+it[1])})}
  if(!s.g.faturamento)out.push('Informe o FATURAMENTO (semanal ou quinzenal)');
  if(!s.g.prazo)out.push('Informe o PRAZO DE PAGAMENTO');
  if(!s.g.icms_incluso)out.push('Informe se os valores JÁ INCLUEM ICMS');
  return out}
function caixaFaltas(){var e=document.getElementById('faltaBox');if(!e)return;var linhas=faltasCadastro().map(function(t){return 'Dados cadastrais: '+t});CFG.canais.forEach(function(c){faltasPropria(c).forEach(function(t){linhas.push((CFG.canais.length>1?nomeCanal(c)+': ':'')+t)})});
  e.innerHTML=linhas.length?'<div style="background:#fef2f2;border:3px solid #dc2626;border-radius:12px;padding:14px 18px;color:#b91c1c;margin:12px 0"><div style="font-size:22px;font-weight:900;margin-bottom:6px">⛔ Ainda falta para enviar:</div>'+linhas.map(function(t){return '<div style="font-size:18px;font-weight:bold;margin:3px 0">• '+esc(t)+'</div>'}).join('')+'</div>':'<div style="background:#ecfdf3;border:2px solid #16a34a;border-radius:12px;padding:12px 16px;color:#166534;font-size:17px;font-weight:bold;margin:12px 0">✅ Tudo certo: tabela, destinos e generalidades. Pode clicar em Enviar.</div>'}
function lerPlanilha(f){return new Promise(function(ok,nok){if(!window.XLSX){nok(new Error('Recurso de Excel não carregou. Verifique a conexão.'));return}
  var rd=new FileReader();rd.onload=function(ev){try{var wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'}),r={cidade:false,rota:false,prazo:false,taxa:false,frete:false,linhas:0};
    wb.SheetNames.forEach(function(nm){var M=XLSX.utils.sheet_to_json(wb.Sheets[nm],{header:1,defval:''}),n=0;
      M.slice(0,40).forEach(function(row){row.forEach(function(cel){var t=sa(cel);if(!t||t.length>60)return;
        if(/CIDADE|MUNICIPIO|DESTINO|IBGE|LOCALIDADE/.test(t))r.cidade=true;
        if(/ROTA|REGIAO|PRACA|TARIFA|ZONA|SETOR|CAPITAL|INTERIOR/.test(t))r.rota=true;
        if(/PRAZO|LEAD ?TIME|TRANSIT|DIAS UTEIS/.test(t))r.prazo=true;
        if(/TDA|TRT|TDE|TDR|SUFRAMA|TAXA|RESTRI|DIFICIL|PEDAGIO|GRIS|VALOREM/.test(t))r.taxa=true;
        if(/FRETE|PESO|KG|MINIMO|VALOR|EXCEDENTE|%/.test(t))r.frete=true})});
      M.forEach(function(row){if(row.filter(function(x){return String(x).trim()!==''}).length>=3)n++});if(n>r.linhas)r.linhas=n});
    ok(r)}catch(e){nok(new Error('Não consegui ler o arquivo: '+e.message))}};rd.onerror=function(){nok(new Error('Falha ao ler o arquivo.'))};rd.readAsArrayBuffer(f)})}
function modeloDestinos(){if(!window.XLSX){alert('Recurso de Excel não carregou.');return}var m=document.getElementById('msgTab');m.innerHTML='<div class="msg aviso">Gerando o modelo de destinos…</div>';
  api({acao:'municipios',acesso:ACESSO}).then(function(j){var cab=['IBGE','UF','CIDADE','ROTA / REGIÃO','PRAZO (DIAS)','TDA (R$)','TRT (R$)','SUFRAMA (R$)','OUTRAS TAXAS (nome e valor)'];
    var aoa=[cab].concat(j.m.map(function(x){return [x[0],x[1],x[2],'','','','','','']}));var ws=XLSX.utils.aoa_to_sheet(aoa);ws['!cols']=[{wch:10},{wch:5},{wch:32},{wch:16},{wch:12},{wch:10},{wch:10},{wch:12},{wch:28}];ws['!autofilter']={ref:ws['!ref']};
    var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'DESTINOS');XLSX.writeFile(wb,'modelo-destinos-atendidos-'+CANAL.toLowerCase()+'.xlsx');
    m.innerHTML='<div class="msg ok">Modelo baixado. Preencha ROTA, PRAZO e as taxas das cidades que você atende (apague ou deixe sem prazo as que não atende) e anexe no item 2.</div>'}).catch(function(e){m.innerHTML='<div class="msg erro">'+esc(e.message)+'</div>'})}
function listaAnexos(s,cat){var l=s.f.map(function(a,i){return {a:a,i:i}}).filter(function(x){return catAnexo(x.a)===cat}),h='';
  if(!l.length)return cat==='GENERALIDADES'?'<div style="color:#64748b;font-size:14px">Nenhum arquivo (opcional).</div>':'<div style="color:#b91c1c;font-size:15px;font-weight:bold">Nenhum arquivo anexado ainda (obrigatório).</div>';
  l.forEach(function(x){var a=x.a,lt=a.leitura,info='';
    if(cat==='DESTINOS'&&lt)info=' <span style="font-size:13px">'+ITENS_DEST.map(function(it){return (lt[it[0]]?'✅':'❌')+' '+it[1].split(' ')[0]}).join(' · ')+(lt.linhas?' · ~'+lt.linhas+' linhas':'')+'</span>';
    if(cat==='TABELA'&&lt&&!lt.frete)info=' <span style="font-size:13px;color:#b45309;font-weight:bold">⚠ não achei colunas de frete/peso/valor nesta planilha — confira se é o arquivo certo</span>';
    h+='<div class="lin">📎 <b>'+esc(String(a.nome||'').replace(/^\\[(DESTINOS|GENERALIDADES)\\] /,''))+'</b> <span style="color:#64748b">('+Math.max(1,Math.round((a.tamanho||0)/1024))+' KB)</span>'+info+'<button class="x" onclick="removerAnexo('+x.i+')">Remover</button></div>'});
  return h}
function renderPropria(){abas();var s=ST[CANAL],h='';
  h+=blocoPremissas()+blocoCadastro();
  h+='<div class="msg aviso"><b>Atenção:</b> as generalidades informadas aqui serão <b>avaliadas pelo time de suprimentos</b> para definir se entram ou não no nosso escopo. O envio não garante a aceitação das condições.</div>';
  h+=blocoVol();
  h+='<div class="taxas"><b>1. Tabela de frete — '+nomeCanal(CANAL)+'</b> <span style="color:#b91c1c;font-weight:bold">(obrigatório)</span><br><small style="color:#64748b">A sua tabela de preços: Excel, CSV, PDF, Word ou ZIP · até 3 MB por arquivo.</small><div style="margin:8px 0">'+listaAnexos(s,'TABELA')+'</div>';
  h+='<input type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.zip" onchange="anexar(this,\\'TABELA\\')" style="max-width:420px"></div>';
  h+='<div class="taxas"><b>2. Destinos atendidos — '+nomeCanal(CANAL)+'</b> <span style="color:#b91c1c;font-weight:bold">(obrigatório)</span><br><small style="color:#64748b">Excel ou CSV com uma linha por cidade atendida e as colunas: <b>CIDADE (ou IBGE)</b>, <b>ROTA/REGIÃO</b> a que a cidade pertence, <b>PRAZO</b> de entrega e <b>TAXAS por destino</b> (TDA, TRT, Suframa…; se não cobra, deixe a coluna com 0). O portal confere as colunas ao anexar.</small><div style="margin:8px 0">'+listaAnexos(s,'DESTINOS')+'</div>';
  h+='<input type="file" multiple accept=".xlsx,.xls,.csv" onchange="anexar(this,\\'DESTINOS\\')" style="max-width:420px"> <button class="sec" onclick="modeloDestinos()">⬇ Baixar modelo de destinos (Excel)</button></div>';
  h+='<div class="taxas"><b>3. Generalidades em arquivo</b> <span style="color:#64748b">(opcional — só se não estiverem na própria tabela)</span><br><small style="color:#64748b">Regras de cobrança, taxas gerais, cubagem, restrições, reajuste… Excel, CSV, PDF, Word ou ZIP.</small><div style="margin:8px 0">'+listaAnexos(s,'GENERALIDADES')+'</div>';
  h+='<input type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.zip" onchange="anexar(this,\\'GENERALIDADES\\')" style="max-width:420px"></div>';
  h+='<div class="ger">'+campoPrazo(s)
    +'<div><label>Valores já incluem ICMS?</label><select data-g="icms_incluso"><option value="">Selecione…</option><option value="SIM"'+(s.g.icms_incluso==='SIM'?' selected':'')+'>Sim, já incluem</option><option value="NAO"'+(s.g.icms_incluso==='NAO'?' selected':'')+'>Não, ICMS por fora</option></select></div>'
    +'<div><label>Vigência a partir de</label><input type="date" data-g="vigencia" value="'+esc(s.g.vigencia||'')+'"></div></div>';
  h+=blocoTaxas(s);
  h+='<div class="taxas"><b>4. Observações / generalidades</b> <span style="color:#64748b">(opcional)</span><br><small style="color:#64748b">Algo sobre a tabela que não esteja nos arquivos: condições, restrições de atendimento, exceções, reajustes.</small><textarea data-g="generalidades" rows="9" style="width:100%;margin-top:8px;padding:10px;border:2px solid #fcd34d;border-radius:8px;font-size:15px;font-family:inherit">'+esc(s.g.generalidades||'')+'</textarea></div>';
  h+='<div id="faltaBox"></div>';
  var c=document.getElementById('conteudo');c.innerHTML=h;ligaCad();
  c.oninput=function(ev){var t=ev.target;if(t.getAttribute('data-g')){ST[CANAL].g[t.getAttribute('data-g')]=t.value;if(t.getAttribute('data-g')==='prazo')checaPrazo(t);caixaFaltas();return}
    var kt=t.getAttribute('data-t');if(kt!==null&&kt!==undefined){var tx=ST[CANAL].g.taxas||(ST[CANAL].g.taxas=[]);var ti=Number(kt);if(tx[ti])tx[ti][t.getAttribute('data-f')]=t.value}};
  caixaFaltas();resumo()}
// ---- Volumetria (so volumes/peso/cubagem; sem transportadora e sem valor de frete) ----
function fmtDia(d){var p=String(d).split('-');return p[2]+'/'+p[1]+'/'+p[0]}
function blocoVol(){var p=CFG.periodos&&CFG.periodos[CANAL];if(!p)return '';
  var h='<div class="ferr"><button class="sec" onclick="VOLABERTO=!VOLABERTO;render()">📊 Volumetria '+nomeCanal(CANAL)+' ('+fmtDia(p.inicio)+' a '+fmtDia(p.fim)+')'+(VOLABERTO?' ▴':' ▾')+'</button></div>';
  if(!VOLABERTO)return h;
  h+='<div class="taxas"><b>Volumetria '+nomeCanal(CANAL)+'</b> <span style="color:#64748b;font-size:13px">Últimos '+p.meses+' mês(es) fechado(s): '+fmtDia(p.inicio)+' a '+fmtDia(p.fim)+'. Traz notas, volumes, peso e cubagem por origem, destino e faixa de peso. Não traz transportadora nem valor de frete.</span>';
  var nomeadas=CFG.origens.filter(function(o){return o});
  if(nomeadas.length)h+='<div class="lin"><b>Origens:</b> '+CFG.origens.map(function(o,i){return o?'<label class="fl" style="font-weight:normal"><input type="checkbox" style="width:auto" onchange="VOLORI['+i+']=this.checked"'+(VOLORI[i]?' checked':'')+'> '+esc(o)+'</label>':''}).join(' ')+'<span style="color:#64748b;font-size:13px">(nenhuma marcada = todas as origens deste convite)</span></div>';
  h+='<div class="lin"><b>UFs de destino:</b> <span style="color:#64748b;font-size:13px">(todas vêm marcadas; desmarque as que não quer)</span> <button class="sec" style="padding:4px 10px" onclick="volUfTodas(true)">Marcar todas</button> <button class="sec" style="padding:4px 10px" onclick="volUfTodas(false)">Desmarcar todas</button></div>'
    +'<div class="ufgrid">'+CFG.ufs.map(function(u){return '<label><input type="checkbox" onchange="VOLUFS[\\''+u+'\\']=this.checked"'+(VOLUFS[u]?' checked':'')+'> '+u+'</label>'}).join('')+'</div>';
  h+='<div class="lin"><button onclick="baixarVol()"'+(VOLBUSY?' disabled':'')+'>⬇ Baixar volumetria '+nomeCanal(CANAL)+' (Excel)</button><span id="volst" class="fl"></span></div></div>';
  return h}
function volSt(t,erro){var e=document.getElementById('volst');if(e){e.textContent=t;e.style.color=erro?'#b91c1c':'#334155'}}
function volUfTodas(on){CFG.ufs.forEach(function(u){VOLUFS[u]=on});render()}
function baixarVol(){if(VOLBUSY)return;if(!window.XLSX){alert('Não foi possível carregar o recurso de Excel. Verifique sua conexão.');return}
  var canal=CANAL,idx=[];CFG.origens.forEach(function(o,i){if(!o||VOLORI[i])idx.push(i)});if(!idx.length)CFG.origens.forEach(function(o,i){idx.push(i)});
  var ufs=CFG.ufs.filter(function(u){return VOLUFS[u]});if(!ufs.length){alert('Marque ao menos uma UF de destino.');return}var todasUfs=ufs.length===CFG.ufs.length;
  VOLBUSY=true;volSt('Buscando a volumetria…');var linhas=[],pend=[],per=[];
  api({acao:'volumetria',acesso:ACESSO,canal:canal}).then(function(j){
    var alvos=idx.map(function(i){var it=(j.itens||[])[i]||{pendente:true};it.i=i;return it});
    alvos.forEach(function(a){if(a.pendente)pend.push(oriNome(a.i)||'todas as origens')});
    var ok=alvos.filter(function(a){return !a.pendente});
    var fila=[];ok.forEach(function(a){per.push(a);for(var q=0;q<(a.partes||1);q++)fila.push({a:a,q:q})});
    var tot=fila.length,feitos=0;
    function prox(){if(!fila.length)return Promise.resolve();var f=fila.shift();
      return api({acao:'volumetria',acesso:ACESSO,canal:canal,origem:f.a.i,inicio:f.a.inicio,fim:f.a.fim,parte:f.q}).then(function(r){
        (r.r||[]).forEach(function(x){if(todasUfs||ufs.indexOf(String(x[4]))>=0)linhas.push(x)});feitos++;volSt('Baixando… '+feitos+' de '+tot);return prox()})}
    return prox()}).then(function(){VOLBUSY=false;
    if(!per.length){volSt('A volumetria '+(pend.length?'de '+pend.join(', ')+' ':'')+'ainda está sendo preparada pelo nosso time. Tente novamente mais tarde.',true);return}
    if(!linhas.length){volSt('Nenhuma nota encontrada para as UFs marcadas.',true);return}
    var ini=per.map(function(a){return a.inicio}).sort()[0],fim=per.map(function(a){return a.fim}).sort().pop();
    var rows=linhas.map(function(r){var n=r[7]||1;return{Canal:nomeCanal(canal),Faixa_Peso:r[6],Notas:r[7],Volumes:r[8],Peso_Real:r[9],Peso_Declarado:r[10],Peso_Cubado:r[11],Peso_Considerado:r[12],Cubagem_Total_m3:r[13],Valor_NF:r[14],Origem:r[0],UF_Origem:r[1],Destino:r[3],UF_Destino:r[4],IBGE_Origem:r[2],IBGE_Destino:r[5],Media_Peso_Nota:Math.round(r[12]/n*100)/100,Media_Volumes_Nota:Math.round(r[8]/n*100)/100,Media_Cubagem_Nota:Math.round(r[13]/n*1000)/1000,Media_Valor_NF_Nota:Math.round(r[14]/n*100)/100}});
    var wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=Object.keys(rows[0]).map(function(h){return{wch:Math.min(Math.max(h.length+3,12),30)}});ws['!autofilter']={ref:ws['!ref']};
    XLSX.utils.book_append_sheet(wb,ws,'Volumetria');
    var tot=rows.reduce(function(s2,r){return s2+r.Notas},0);
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{Canal:nomeCanal(canal),Periodo_Inicial:ini,Periodo_Final:fim,Origens:per.map(function(a){return oriNome(a.i)||'Todas'}).join(' | '),UFs_Destino:todasUfs?'Todas':ufs.join(', '),Notas:tot,Linhas:rows.length,Regra_Peso:'Peso_Considerado = maior entre peso real, declarado e cubado (define a faixa)',Regra_Cubagem:'Cubagem_Total_m3 = cubagem x volumes',Regra_Valor_NF:'Valor_NF = valor da nota fiscal'}]),'Resumo');
    XLSX.writeFile(wb,'volumetria-'+canal.toLowerCase()+'-'+ini.slice(0,7)+'-a-'+fim.slice(0,7)+'.xlsx');
    volSt('Pronto: '+tot.toLocaleString('pt-BR')+' notas em '+rows.length.toLocaleString('pt-BR')+' linhas. Arquivo baixado.'+(pend.length?' Ainda em preparação: '+pend.join(', ')+'.':''))
  }).catch(function(e){VOLBUSY=false;volSt('Erro: '+e.message,true)})}
function anexar(inp,cat){var fs=Array.prototype.slice.call(inp.files||[]),canal=CANAL,m=document.getElementById('msgTab');inp.value='';m.innerHTML='';cat=['DESTINOS','GENERALIDADES'].indexOf(cat)>=0?cat:'TABELA';
  fs.forEach(function(f){
    if(f.size>3*1024*1024){m.innerHTML+='<div class="msg erro">'+esc(f.name)+' passa de 3 MB. Compacte (ZIP) ou divida o arquivo.</div>';return}
    var ext=String(f.name).split('.').pop().toLowerCase(),planilha=['xlsx','xls','csv'].indexOf(ext)>=0;
    if(cat==='DESTINOS'&&!planilha){m.innerHTML+='<div class="msg erro" style="font-size:17px">⛔ '+esc(f.name)+': o arquivo de destinos precisa ser Excel ou CSV.</div>';return}
    (planilha?lerPlanilha(f):Promise.resolve(null)).then(function(lt){
      if(cat==='DESTINOS'){var falta=ITENS_DEST.filter(function(it){return !lt[it[0]]}).map(function(it){return it[1]});
        if(falta.length){m.innerHTML+='<div style="background:#fef2f2;border:3px solid #dc2626;border-radius:12px;padding:12px 16px;color:#b91c1c;margin:8px 0"><div style="font-size:20px;font-weight:900">⛔ '+esc(f.name)+' não foi anexado</div><div style="font-size:17px;font-weight:bold">Não encontrei: '+esc(falta.join(', '))+'. Inclua essas colunas (ou use o modelo de destinos) e anexe de novo.</div></div>';return}}
      var rd=new FileReader();rd.onload=function(ev){var b64=String(ev.target.result).split(',')[1]||'';
        api({acao:'anexar',acesso:ACESSO,canal:canal,nome:f.name,tipo:f.type,dados:b64,categoria:cat,leitura:lt}).then(function(j){ST[canal].f.push(j.anexo);render();document.getElementById('msgTab').innerHTML+='<div class="msg ok">'+esc(f.name)+' anexado.</div>'})
          .catch(function(e){document.getElementById('msgTab').innerHTML+='<div class="msg erro">'+esc(f.name)+': '+esc(e.message)+'</div>'})};
      rd.readAsDataURL(f)}).catch(function(e){m.innerHTML+='<div class="msg erro">'+esc(f.name)+': '+esc(e.message)+'</div>'})})}
function removerAnexo(i){var a=ST[CANAL].f[i];if(!a||!confirm('Remover o arquivo '+a.nome+'?'))return;
  api({acao:'remover_anexo',acesso:ACESSO,id:a.id}).then(function(){ST[CANAL].f.splice(i,1);render()}).catch(function(e){document.getElementById('msgTab').innerHTML='<div class="msg erro">'+esc(e.message)+'</div>'})}
function blocoTaxas(s){var tx=s.g.taxas||[];
  var h='<div class="taxas"><b>Taxas adicionais</b> <span style="color:#64748b;font-size:13px">(reentrega, agendamento, TDE, coleta, despacho… Escolha como cobra: R$ por CT-e, % sobre a NF, R$ por kg (com franquia opcional) ou R$ por fração de peso. O mínimo é opcional. Por padrão a taxa vale para todas as UFs; clique em <b>Destinos</b> para desmarcar as que não se aplicam. Taxas por cidade (TDA, TDR, TRT, Suframa, coleta, entrega, pedágio, fluvial, TZR, GRIS/ad valorem do destino) ficam no passo 2; aqui entram as que não têm coluna lá.)</span><datalist id="dlTaxas"><option value="TRT"><option value="Suframa"><option value="TDA"><option value="Reentrega"><option value="Agendamento"><option value="Taxa de despacho"><option value="Paletização"><option value="Devolução"><option value="TDE"><option value="TDR"><option value="Coleta"><option value="Despacho"><option value="Entrega dedicada"><option value="Armazenagem"><option value="Estadia"><option value="Ajudante / descarga"><option value="Restrição de trânsito / ZMRC"></datalist>';
  tx.forEach(function(x,i){h+='<div class="lin"><input list="dlTaxas" data-t="'+i+'" data-f="n" placeholder="Nome da taxa" value="'+esc(x.n||'')+'" style="width:230px"><input data-t="'+i+'" data-f="v" placeholder="Valor" inputmode="decimal" value="'+esc(x.v||'')+'" style="width:110px"><select data-t="'+i+'" data-f="u"><option value="R$"'+(x.u==='R$'||!x.u?' selected':'')+'>R$ por CT-e</option><option value="%"'+(x.u==='%'?' selected':'')+'>% sobre a NF</option><option value="R$/KG"'+(x.u==='R$/KG'?' selected':'')+'>R$ por kg</option><option value="R$/FRACAO"'+(x.u==='R$/FRACAO'?' selected':'')+'>R$ por fração de peso</option></select>'
    +'<input data-t="'+i+'" data-f="min" placeholder="Mínimo R$ (opc.)" inputmode="decimal" value="'+esc(x.min||'')+'" style="width:140px">'
    +(x.u==='R$/KG'||x.u==='R$/FRACAO'?'<input data-t="'+i+'" data-f="fr" placeholder="'+(x.u==='R$/KG'?'Franquia kg (opc.)':'Fração de quantos kg?')+'" inputmode="decimal" value="'+esc(x.fr||'')+'" style="width:170px">':'')
    +'<details class="ufsel"><summary>Destinos: <b>'+(x.ufs?esc(x.ufs.split(',').join(', ')):'todas as UFs')+'</b></summary><div class="ufgrid">'+CFG.ufs.map(function(u){var on=!x.ufs||(','+x.ufs+',').indexOf(','+u+',')>=0;return '<label><input type="checkbox" onchange="taxaUf('+i+',\\''+u+'\\',this)"'+(on?' checked':'')+'> '+u+'</label>'}).join('')+'</div></details><button class="x" onclick="delTaxa('+i+')">Remover</button></div>'});
  return h+'<button class="sec" onclick="addTaxa()">+ Incluir taxa</button></div>'}
function taxaUf(i,uf,el){var t=(ST[CANAL].g.taxas||[])[i];if(!t)return;var sel=t.ufs?t.ufs.split(','):CFG.ufs.slice();sel=sel.filter(function(u){return u!==uf});if(el.checked)sel.push(uf);sel=CFG.ufs.filter(function(u){return sel.indexOf(u)>=0});if(!sel.length){alert('A taxa precisa valer para ao menos uma UF. Se não cobra, remova a taxa.');el.checked=true;return}t.ufs=sel.length===CFG.ufs.length?'':sel.join(',');var b=el.closest('details').querySelector('summary b');if(b)b.textContent=t.ufs?t.ufs.split(',').join(', '):'todas as UFs'}
function addTaxa(){var g=ST[CANAL].g;(g.taxas||(g.taxas=[])).push({n:'',v:'',u:'R$'});render()}
function delTaxa(i){var g=ST[CANAL].g;if(g.taxas)g.taxas.splice(i,1);render()}
function regTab(uf){var s=ST[CANAL],o={},n=0,pre=ORI+'|'+uf+'|';Object.keys(s.c).forEach(function(k){if(k.indexOf(pre)===0&&cheio(s.c[k])){var r=k.split('|')[2];if(!o[r]){o[r]=1;n++}}});return n?o:null}
function regOpts(sel,rt){function op(r){return '<option value="'+r+'"'+(sel===r?' selected':'')+'>'+r+'</option>'}
  if(!rt)return '<option value=""></option>'+CFG.regioes.map(op).join('');
  return '<option value=""></option><optgroup label="Na sua tabela">'+CFG.regioes.filter(function(r){return rt[r]}).map(op).join('')+'</optgroup><optgroup label="Sem valor na tabela (atenção)">'+CFG.regioes.filter(function(r){return !rt[r]}).map(op).join('')+'</optgroup>'}
function gradePct(){var s=ST[CANAL],R=CFG.regioes;
  var h='<div class="ferr"><label class="fl">UF destino <select onchange="FUF=this.value;render()"><option value="">Todas as UFs</option>'+CFG.ufs.map(function(u){return '<option value="'+u+'"'+(u===FUF?' selected':'')+'>'+u+(ufTem(u)?' ✔':'')+'</option>'}).join('')+'</select></label></div>';
  h+='<div class="tw"><table><thead><tr><th rowspan="2" style="left:0;z-index:3">UF destino</th>'+R.map(function(r){return '<th colspan="3">'+r+'</th>'}).join('')+'</tr><tr>'+R.map(function(){return '<th class="sub">Frete (%)</th><th class="sub">Mínimo (R$)</th><th class="sub" title="Opcional: R$ por kg. O frete fica o maior entre % da NF, mínimo e peso x R$/kg">Kg garantia (R$/kg)</th>'}).join('')+'</tr></thead><tbody>';
  CFG.ufs.forEach(function(uf){if(FUF&&uf!==FUF)return;h+='<tr><td class="fixo">'+uf+'</td>';R.forEach(function(r){var k=ORI+'|'+uf+'|'+r+'|',x=s.c[k]||{};
    h+='<td><input data-k="'+k+'" data-f="p" class="'+(x.p?'cheio':'')+'" value="'+esc(x.p||'')+'" inputmode="decimal"></td><td><input data-k="'+k+'" data-f="m" class="'+(x.m?'cheio':'')+'" value="'+esc(x.m||'')+'" inputmode="decimal"></td><td><input data-k="'+k+'" data-f="k" class="'+(x.k?'cheio':'')+'" value="'+esc(x.k||'')+'" inputmode="decimal" placeholder="opcional"></td>'});h+='</tr>'});
  return h+'</tbody></table></div>'}
function ufTem(uf){var s=ST[CANAL],r=false;Object.keys(s.c).forEach(function(k){if(k.indexOf(ORI+'|'+uf+'|')===0&&cheio(s.c[k]))r=true});return r}
function gradeFaixa(){var s=ST[CANAL],R=CFG.regioes,F=CFG.faixas[CANAL];
  var h='<div class="ferr"><label class="fl">UF destino <select id="ufsel" onchange="UFSEL=this.value;render()">'+CFG.ufs.map(function(u){return '<option value="'+u+'"'+(u===UFSEL?' selected':'')+'>'+u+(ufTem(u)?' ✔':'')+'</option>'}).join('')+'</select></label><button class="sec" onclick="copiarUf()">Copiar esta UF para as demais UFs</button></div>';
  h+='<div class="tw"><table><thead><tr><th style="left:0;z-index:3">Faixa de peso</th>'+R.map(function(r){return '<th>'+r+'</th>'}).join('')+'</tr></thead><tbody>';
  F.forEach(function(f,i){var ab=f.max==null;h+='<tr><td class="fixo">'+(ab?esc(f.label)+'<br><b style="color:#b45309">R$ por KG excedente</b>':esc(f.label))+'</td>';R.forEach(function(r){var k=ORI+'|'+UFSEL+'|'+r+'|'+i,x=s.c[k]||{},info=ab?excInfo(CANAL,k):null;
    h+='<td><input data-k="'+k+'" data-f="v"'+(ab?' data-exc="1" placeholder="R$/kg"':'')+' class="'+(x.v?'cheio':'')+(info?(info.n==='erro'?' bloq':' alerta'):'')+'" title="'+esc(info?info.t:'')+'" value="'+esc(x.v||'')+'" inputmode="decimal"></td>'});h+='</tr>'});
  var fa=F[F.length-1],fu=F[F.length-2];
  h+='</tbody></table></div>';
  if(fa&&fa.max==null&&fu)h+='<div class="excbox"><b>Atenção à última linha ('+esc(fa.label)+'):</b> informe só o <b>R$ por KG excedente</b>, não o preço da faixa nem valor por tonelada. Acima de '+fa.min+' kg cobra-se o valor da faixa '+esc(fu.label)+' <b>mais</b> o excedente por kg.<br>Exemplo: se até '+fa.min+' kg o frete é R$ 150,00 e o excedente é R$ 1,20/kg, um envio de '+(fa.min+30)+' kg paga 150,00 + 30 × 1,20 = <b>R$ 186,00</b>.<div id="excMsg"></div></div>';
  return h}
function copiarUf(){var s=ST[CANAL];if(!ufTem(UFSEL)){alert('Preencha a UF '+UFSEL+' antes de copiar.');return}
  if(!confirm('Copiar os valores de '+UFSEL+' para TODAS as outras UFs desta origem? Valores já digitados nelas serão substituídos.'))return;
  var pre=ORI+'|'+UFSEL+'|',origem={};Object.keys(s.c).forEach(function(k){if(k.indexOf(pre)===0&&cheio(s.c[k]))origem[k.slice(pre.length)]=s.c[k]});
  CFG.ufs.forEach(function(uf){if(uf===UFSEL)return;var p2=ORI+'|'+uf+'|';Object.keys(s.c).forEach(function(k){if(k.indexOf(p2)===0)delete s.c[k]});Object.keys(origem).forEach(function(suf){s.c[p2+suf]={v:origem[suf].v,p:origem[suf].p,m:origem[suf].m,k:origem[suf].k}})});render()}
function copiarOrigem(){if(!confirm('Copiar a tabela e o atendimento da origem "'+oriNome(ORI)+'" ('+nomeCanal(CANAL)+') para as demais origens? O que já foi digitado nelas será substituído.'))return;
  var s=ST[CANAL],pre=ORI+'|',ca={},aa={};Object.keys(s.c).forEach(function(k){if(k.indexOf(pre)===0)ca[k.slice(pre.length)]=s.c[k]});Object.keys(s.a).forEach(function(k){if(k.indexOf(pre)===0)aa[k.slice(pre.length)]=s.a[k]});
  CFG.origens.forEach(function(_,oi){if(oi===ORI)return;var p2=oi+'|';Object.keys(s.c).forEach(function(k){if(k.indexOf(p2)===0)delete s.c[k]});Object.keys(s.a).forEach(function(k){if(k.indexOf(p2)===0)delete s.a[k]});
    Object.keys(ca).forEach(function(k){s.c[p2+k]=Object.assign({},ca[k])});Object.keys(aa).forEach(function(k){s.a[p2+k]=Object.assign({},aa[k])})});render()}
// ---- Atendimento por cidade ----
function viewCidades(){var s=ST[CANAL];if(!MUN.length)return '<div class="msg info">Carregando a lista de cidades…</div>';
  var ufs={};MUN.forEach(function(m){ufs[m.u]=1});var lista=CFG.ufs.filter(function(u){return ufs[u]});if(lista.indexOf(UFSEL)<0)UFSEL=lista[0];
  var rt=regTab(UFSEL),nfora=0;MUN.forEach(function(m){if(m.u===UFSEL){var xr=(s.a[ORI+'|'+m.i]||{}).r;if(xr&&rt&&!rt[xr])nfora++}});
  var h=(rt?'<div class="msg '+(nfora?'aviso':'info')+'">Regiões preenchidas na sua tabela para '+UFSEL+': <b>'+Object.keys(rt).join(', ')+'</b>.'+(nfora?' <b>'+nfora+' cidade(s)</b> estão com região sem valor na tabela (campo laranja).':'')+'</div>':'<div class="msg info">Você ainda não preencheu a tabela de frete da UF '+UFSEL+'. Preencha o passo 1 para a lista mostrar só as suas regiões.</div>')+'<div class="ferr"><label class="fl">UF destino <select onchange="UFSEL=this.value;FBUSCA=\\'\\';FREG=\\'\\';render()">'+lista.map(function(u){return '<option value="'+u+'"'+(u===UFSEL?' selected':'')+'>'+u+'</option>'}).join('')+'</select></label>'
    +'<input type="text" id="fbusca" placeholder="Buscar cidade…" value="'+esc(FBUSCA)+'" oninput="FBUSCA=this.value;filtraCidades()" style="width:220px">'
    +'<label class="fl">Região <select id="freg" onchange="FREG=this.value;filtraCidades()"><option value="">Todas</option><option value="__SEM">Sem região</option>'+CFG.regioes.map(function(r){return '<option value="'+r+'"'+(r===FREG?' selected':'')+'>'+r+'</option>'}).join('')+'</select></label>'
    +'<label class="fl"><input type="checkbox" id="fsem" style="width:auto"'+(FSEM?' checked':'')+' onchange="FSEM=this.checked;filtraCidades()"> só sem prazo</label><span id="ncid" class="fl"></span></div>';
  h+='<div class="msg aviso" style="margin:0 0 8px">As taxas por cidade são opcionais. Cobra alguma taxa por destino que não tem coluna aqui? Volte ao passo 1, clique em <b>+ Incluir taxa</b>, informe o nome, como cobra e marque as UFs onde ela vale.</div>';
  h+='<div class="ferr"><b>Aplicar às cidades visíveis (só campos vazios):</b><select id="bkreg" style="width:auto">'+regOpts('',rt)+'</select><input id="bkpz" placeholder="Prazo (dias)" inputmode="numeric" style="width:130px"><button class="sec" onclick="aplicarLote()">Aplicar</button></div>';
  h+='<div class="tw"><table><thead><tr><th style="left:0;z-index:3">IBGE</th><th>Cidade</th><th class="sub">Região (rota)</th><th class="sub">Prazo (dias)</th>'+COLS_A.map(function(c){return '<th class="sub">'+c[1]+'</th>'}).join('')+'</tr></thead><tbody>';
  MUN.forEach(function(m){if(m.u!==UFSEL)return;var k=ORI+'|'+m.i,x=s.a[k]||{};
    h+='<tr data-i="'+m.i+'" data-n="'+esc(m.n)+'"><td class="fixo">'+m.i+'</td><td style="white-space:nowrap;font-weight:bold;padding:4px 10px">'+esc(m.c)+'</td><td><select data-a="'+k+'" data-f="r" class="'+(x.r&&rt&&!rt[x.r]?'fora':'')+'" style="width:140px">'+regOpts(x.r,rt)+'</select></td>'
      +'<td><input data-a="'+k+'" data-f="p" class="'+(x.p?'cheio':'')+'" value="'+esc(x.p||'')+'" inputmode="numeric" style="width:80px"></td>'
      +COLS_A.map(function(c){return '<td><input data-a="'+k+'" data-f="'+c[0]+'" class="'+(x[c[0]]?'cheio':'')+'" value="'+esc(x[c[0]]||'')+'" inputmode="decimal"></td>'}).join('')+'</tr>'});
  return h+'</tbody></table></div>'}
function filtraCidades(){var rows=document.querySelectorAll('#conteudo tbody tr[data-i]'),b=sa(FBUSCA),n=0,tot=rows.length,s=ST[CANAL];
  rows.forEach(function(tr){var x=s.a[ORI+'|'+tr.getAttribute('data-i')]||{},ok=true;
    if(b&&tr.getAttribute('data-n').indexOf(b)<0)ok=false;
    if(FREG==='__SEM'&&x.r)ok=false;else if(FREG&&FREG!=='__SEM'&&x.r!==FREG)ok=false;
    if(FSEM&&num(x.p)>0)ok=false;
    tr.style.display=ok?'':'none';if(ok)n++});
  var e=document.getElementById('ncid');if(e)e.textContent=n+' de '+tot+' cidades'}
function aplicarLote(){var reg=document.getElementById('bkreg').value,pz=document.getElementById('bkpz').value.trim(),s=ST[CANAL],n=0;
  if(!reg&&!pz){alert('Escolha uma região e/ou informe um prazo.');return}
  document.querySelectorAll('#conteudo tbody tr[data-i]').forEach(function(tr){if(tr.style.display==='none')return;var k=ORI+'|'+tr.getAttribute('data-i'),x=s.a[k]||(s.a[k]={});
    if(reg&&!x.r){x.r=reg;n++}if(pz&&!num(x.p)&&num(pz)>0){x.p=pz;n++}});
  render();document.getElementById('msgTab').innerHTML='<div class="msg ok">Aplicado em '+n+' campo(s) das cidades visíveis.</div>'}
function resumo(){var r=document.getElementById('resumo'),ct=document.getElementById('cont');var linhas=[];
  if(CFG.modalidade==='PROPRIA'){if(ct)ct.textContent=CFG.canais.map(function(c){return nomeCanal(c)+': '+ST[c].f.length+' arquivo(s)'}).join('   |   ');return}
  CFG.canais.forEach(function(c){var s=ST[c],n=0,nc=0;Object.keys(s.c).forEach(function(k){if(cheio(s.c[k]))n++});Object.keys(s.a).forEach(function(k){if(cidadeOk(s.a[k]))nc++});linhas.push(nomeCanal(c)+': '+n+' células · '+nc+' cidades com região e prazo')});
  if(ct)ct.textContent=linhas.join('   |   ');
  if(r){var s2=ST[CANAL],pre=ORI+'|',n2=0,c2=0;Object.keys(s2.c).forEach(function(k){if(k.indexOf(pre)===0&&cheio(s2.c[k]))n2++});Object.keys(s2.a).forEach(function(k){if(k.indexOf(pre)===0&&cidadeOk(s2.a[k]))c2++});r.textContent='Esta origem: '+n2+' células · '+c2+' cidades'}}
function montarPayload(){var out={};CFG.canais.forEach(function(c){var s=ST[c],ori={};CFG.origens.forEach(function(nm){ori[nm]={linhas:[],atendimento:[]}});
  Object.keys(s.c).forEach(function(k){var x=s.c[k],p=k.split('|'),v=num(x.v),pc=num(x.p),m=num(x.m),kg=num(x.k);if(v==null&&pc==null&&m==null&&kg==null)return;
    var fi=p[3]===''?null:Number(p[3]);ori[oriNome(Number(p[0]))].linhas.push({uf:p[1],regiao:p[2],faixa:fi==null?'':(CFG.faixas[c][fi]||{}).label,v:v,p:pc,m:m,k:kg})});
  Object.keys(s.a).forEach(function(k){var x=s.a[k],p=k.split('|');if(!x.r&&!(num(x.p)>0))return;
    var it={i:p[1],r:x.r||'',p:num(x.p)};COLS_A.forEach(function(c2){it[c2[0]]=num(x[c2[0]])});ori[oriNome(Number(p[0]))].atendimento.push(it)});
  out[c]={gerais:s.g,origens:ori}});return out}
function validar(final){var out=final?faltasCadastro().map(function(t){return 'Dados cadastrais: '+t}):[];if(CFG.modalidade==='PROPRIA'){if(final){CFG.canais.forEach(function(c){faltasPropria(c).forEach(function(t){out.push(nomeCanal(c)+': '+t)})});caixaFaltas();var fb=document.getElementById('faltaBox');if(out.length&&fb)fb.scrollIntoView({behavior:'smooth',block:'center'})}return out}CFG.canais.forEach(function(c){var s=ST[c],n=0,nc=0;Object.keys(s.c).forEach(function(k){var x=s.c[k];if(cheio(x)){n++;
    ['v','p','m','k'].forEach(function(f){if(x[f]&&!(num(x[f])>=0))out.push(nomeCanal(c)+': valor inválido em '+k.replace(/\\|/g,' / ')+'.')});
    if(num(x.p)>100)out.push(nomeCanal(c)+': percentual acima de 100% em '+k.replace(/\\|/g,' / ')+'.');
    var ei=final?excInfo(c,k):null;if(ei&&ei.n==='erro'){var pk=k.split('|');out.push(nomeCanal(c)+' — '+pk[1]+' / '+pk[2]+': '+ei.t)}}});
    Object.keys(s.a).forEach(function(k){if(cidadeOk(s.a[k]))nc++});
    if(final){if(!n)out.push(nomeCanal(c)+': preencha ao menos uma célula da tabela de frete.');if(!nc)out.push(nomeCanal(c)+': informe região e prazo de ao menos uma cidade (passo 2, Atendimento).');if(!s.g.icms_incluso)out.push(nomeCanal(c)+': informe se os valores já incluem ICMS.')}});return out}
function enviar(final){var m=document.getElementById('msgTab');m.innerHTML='';var erros=validar(final);
  if(erros.length){m.innerHTML='<div class="msg erro">'+erros.slice(0,6).map(esc).join('<br>')+'</div>';window.scrollTo(0,0);return}
  if(final&&!confirm('Enviar a tabela para análise? Você poderá reenviar enquanto o link estiver válido.'))return;
  api({acao:'salvar',acesso:ACESSO,canais:montarPayload(),cadastro:CAD,enviar:final,origem_envio:'PORTAL'}).then(function(j){
    m.innerHTML='<div class="msg ok">'+(final?'✅ Tabela enviada'+(CFG.modalidade==='PROPRIA'?'':' ('+j.salvas+' células e '+j.cidades+' cidades)')+'. Obrigado! O time de suprimentos já recebeu'+(CFG.modalidade==='PROPRIA'?' e vai avaliar as generalidades informadas.':'.'):'Rascunho salvo'+(CFG.modalidade==='PROPRIA'?'.':' ('+j.salvas+' células e '+j.cidades+' cidades).'))+'</div>';window.scrollTo(0,0)}).catch(function(e){m.innerHTML='<div class="msg erro">'+esc(e.message)+'</div>';window.scrollTo(0,0)})}
// ---- Excel (mesmo layout dos templates padrao: FICHA DE CADASTRO + TABELA + ATENDIMENTO) ----
function faixaIdx(label){var fi=-1;CFG.faixas[CANAL].forEach(function(f,i){if(f.label===label)fi=i});return fi}
function baixarModelo(){if(!window.XLSX){alert('Não foi possível carregar o recurso de Excel. Verifique sua conexão.');return}
  if(!MUN.length){alert('Aguarde o carregamento da lista de cidades e tente de novo.');return}
  var s=ST[CANAL],pct=CFG.modalidade==='PERCENTUAL';
  var cidades=MUN.map(function(m){var a=s.a[ORI+'|'+m.i]||{};var tx={};COLS_A.forEach(function(c){tx[c[0]]=num(a[c[0]])});return{ibge:m.i,uf:m.u,cidade:m.c,regiao:a.r||'',prazo:num(a.p),tx:tx}});
  var wb=montarPlanilhaFracionado(XLSX,{transportadora:NOME,cnpj:CNPJ,canal:CANAL,origem:oriNome(ORI),modalidade:CFG.modalidade,faixas:CFG.faixas[CANAL],ufs:CFG.ufs,regioes:CFG.regioes,gerais:s.g,cidades:cidades,colsAtend:COLS_A,premissas:PREMISSAS,cadastro:CAD,
    valor:function(uf,rg,fl){var x=s.c[ORI+'|'+uf+'|'+rg+'|'+(pct?'':faixaIdx(fl))];return x?{p:num(x.p),m:num(x.m),k:num(x.k),v:num(x.v)}:null}});
  XLSX.writeFile(wb,'tabela-fracionado-'+(pct?'percentual':'faixa-peso')+'-'+CANAL.toLowerCase()+(oriNome(ORI)?'-'+oriNome(ORI).replace(/[^a-z0-9]+/gi,'-'):'')+'-'+NOME.replace(/[^a-z0-9]+/gi,'-')+'.xlsx')}
function detReg(v){var n=sa(v).replace(/[-_\\s]/g,'');for(var i=0;i<CFG.regioes.length;i++){if(CFG.regioes[i].replace(' ','')===n)return CFG.regioes[i]}return null}
function importar(inp){var f=inp.files&&inp.files[0],m=document.getElementById('msgTab');if(!f)return;
  if(!window.XLSX){m.innerHTML='<div class="msg erro">Não foi possível carregar o recurso de Excel. Verifique sua conexão.</div>';return}
  var rd=new FileReader();rd.onload=function(ev){try{
    var wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'}),nomes=wb.SheetNames;
    var nTab=nomes.filter(function(n){return sa(n).indexOf('TABELA')>=0})[0],nFic=nomes.filter(function(n){return /FICHA|CADASTRO/.test(sa(n))})[0],nAte=nomes.filter(function(n){return sa(n).indexOf('ATENDIMENTO')>=0})[0];
    if(!nTab)throw new Error('Não encontrei a aba TABELA. Use o modelo baixado nesta tela.');
    var M=XLSX.utils.sheet_to_json(wb.Sheets[nTab],{header:1,defval:''}),s=ST[CANAL],ok=0,okc=0,aviso='';
    if(nFic){XLSX.utils.sheet_to_json(wb.Sheets[nFic],{header:1,defval:''}).forEach(function(row){var k=sa(row[0]),val=row[1];if(val===''||val==null)return;
      if(k.indexOf('CANAL')===0){var cv=sa(val);if((cv.indexOf('ATACADO')>=0||cv.indexOf('B2B')>=0)&&CANAL!=='ATACADO')aviso='A ficha da planilha indica ATACADO, mas você está na aba '+nomeCanal(CANAL)+'.';if(cv.indexOf('B2C')>=0&&CANAL!=='B2C')aviso='A ficha da planilha indica B2C, mas você está na aba '+nomeCanal(CANAL)+'.';return}
      if(k.indexOf('TAXA ADICIONAL')===0){var mt=String(row[0]).match(/:\\s*(.*?)\\s*\\((R\\$\\/KG|R\\$\\/FRACAO|R\\$|%)\\)\\s*$/i);if(mt&&num(val)!=null){s.g.taxas=(s.g.taxas||[]).filter(function(q){return sa(q.n)!==sa(mt[1])});s.g.taxas.push({n:mt[1],v:fmtIn(num(val)),u:mt[2].toUpperCase(),min:fmtIn(num(row[2])),fr:fmtIn(num(row[3])),ufs:String(row[4]||'').toUpperCase()})}return}
      if(k.indexOf('FATURAMENTO')===0){var fv=sa(val);if(fv.indexOf('QUINZ')===0)s.g.faturamento='QUINZENAL';else if(fv.indexOf('SEMAN')===0)s.g.faturamento='SEMANAL'}else if(k.indexOf('PRAZO')===0)s.g.prazo=fmtIn(num(val));else if(k.indexOf('GRIS MIN')===0)s.g.gris_min=fmtIn(num(val));else if(k.indexOf('GRIS')===0)s.g.gris=fmtIn(num(val));
      else if(k.indexOf('CTRC')===0||k.indexOf('TAXA POR CT')===0)s.g.ctrc=fmtIn(num(val));else if(k.indexOf('CUBAGEM')===0)s.g.cubagem=fmtIn(num(val));else if(k.indexOf('TAXA EMERGENCIAL')===0)s.g.emergencial=fmtIn(num(val));
      else if(k.indexOf('FRETE MINIMO')===0)s.g.frete_min=fmtIn(num(val));else if(k.indexOf('OBSERVA')===0)s.g.observacoes=String(val);
      else if(k.indexOf('COMPOSICAO')===0){var cpv=sa(val);if(cpv.indexOf('SOMA')===0)s.g.composicao='PESO_MAIS_PERCENTUAL';else if(cpv.indexOf('MAIOR')===0)s.g.composicao='MAIOR'}
      else if(k.indexOf('AD VALOREM MIN')===0)s.g.advalorem_min=fmtIn(num(val));else if(k.indexOf('AD VALOREM')===0||k.indexOf('ADVALOREM')===0)s.g.advalorem=fmtIn(num(val));
      else if(k.indexOf('PEDAGIO')===0)s.g.pedagio=fmtIn(num(val));else if(k.indexOf('TAS')===0)s.g.tas=fmtIn(num(val));
      else if(k.indexOf('ICMS')===0){var iv=sa(val);s.g.icms_incluso=(iv==='SIM'||iv==='S')?'SIM':(iv==='NAO'||iv==='N')?'NAO':s.g.icms_incluso}
      else if(k.indexOf('VIGENCIA')===0&&/^\\d{4}-\\d{2}-\\d{2}/.test(String(val)))s.g.vigencia=String(val).slice(0,10)})}
    if(CFG.modalidade==='PERCENTUAL'){var ri=-1;for(var i=0;i<Math.min(M.length,15);i++){if(M[i].some(function(c){return detReg(c)})){ri=i;break}}
      if(ri<0)throw new Error('Não encontrei a linha de regiões (CAPITAL, INTERIOR 1…). Use o modelo baixado nesta tela.');
      var map=[],sub=M[ri+1]||[];M[ri].forEach(function(c,ci){var rg=detReg(c);if(!rg)return;var cp=-1,cm=-1,ck=-1;for(var q=ci;q<ci+3;q++){if(q>ci&&detReg(M[ri][q]))break;var hq=sa(sub[q]);if(hq.indexOf('KG')>=0)ck=q;else if(hq.indexOf('MIN')>=0)cm=q;else if(cp<0)cp=q}if(cp<0)cp=ci;if(cm<0)cm=cp+1;map.push({r:rg,p:cp,m:cm,k:ck})});
      for(var j=ri+2;j<M.length;j++){var row=M[j],uf=sa(row[0]);if(CFG.ufs.indexOf(uf)<0)continue;map.forEach(function(x){var p=num(row[x.p]),mi=num(row[x.m]),kq=x.k>=0?num(row[x.k]):null;if(p==null&&mi==null&&kq==null)return;s.c[ORI+'|'+uf+'|'+x.r+'|']={p:fmtIn(p),m:fmtIn(mi),k:fmtIn(kq),v:''};ok++})}}
    else{var hi=-1;for(var i2=1;i2<Math.min(M.length,20);i2++){var js=M[i2].map(sa).join('|');if(js.indexOf('ESTADO DESTINO')>=0&&js.indexOf('FAIXA PESO')>=0){hi=i2;break}}
      if(hi<0)throw new Error('Não encontrei o cabeçalho (ESTADO DESTINO / FAIXA PESO). Use o modelo baixado nesta tela.');
      var maps=[];M[hi-1].forEach(function(c,ci){var rg=detReg(c);if(!rg)return;var cf=-1;for(var cc=ci;cc<Math.min(ci+3,M[hi].length);cc++){if(sa(M[hi][cc]).indexOf('FRETE')===0){cf=cc;break}}if(cf>=0)maps.push({r:rg,c:cf})});
      var FX=CFG.faixas[CANAL],perd=0;
      for(var j2=hi+1;j2<M.length;j2++){var rw=M[j2],uf2=sa(rw[0]);if(CFG.ufs.indexOf(uf2)<0)continue;var mm=String(rw[1]).match(/[0-9][0-9.,]*/);if(!mm){continue}var mn=num(mm[0]),fi=-1;FX.forEach(function(ff,ix){if(ff.min===mn)fi=ix});
        if(fi<0){perd++;continue}maps.forEach(function(x){var vv=num(rw[x.c]);if(vv==null)return;s.c[ORI+'|'+uf2+'|'+x.r+'|'+fi]={v:fmtIn(vv),p:'',m:''};ok++})}
      if(perd)aviso=(aviso?aviso+' ':'')+perd+' linha(s) com faixa de peso diferente das deste convite foram ignoradas.'}
    if(nAte){var A=XLSX.utils.sheet_to_json(wb.Sheets[nAte],{header:1,defval:''}),ha=-1;for(var i3=0;i3<Math.min(A.length,6);i3++){var ja=A[i3].map(sa).join('|');if(ja.indexOf('IBGE')>=0&&ja.indexOf('UF')>=0){ha=i3;break}}
      if(ha>=0){var cab=A[ha].map(sa),col=function(re){for(var q=0;q<cab.length;q++)if(re.test(cab[q]))return q;return -1};
        var cI=col(/^IBGE/),cR=col(/^REGIAO/),cP=col(/^PRAZO/),colP=function(f){for(var q=0;q<cab.length;q++)if(f(cab[q]))return q;return -1},ini=function(h,a){return h.indexOf(a)===0};
        var cA={};COLS_A.forEach(function(c4){var alvo=sa(c4[1]);cA[c4[0]]=colP(function(h){return h===alvo})});
        for(var j3=ha+1;j3<A.length;j3++){var ra=A[j3],ib=cI>=0?String(ra[cI]).replace(/\\D/g,''):'';if(!ib||!MUNIDX[ib])continue;
          var rg2=cR>=0?detReg(ra[cR]):null,pz=cP>=0?num(ra[cP]):null;if(!rg2&&!(pz>0))continue;
          var xi={r:rg2||'',p:fmtIn(pz>0?Math.round(pz):null)};COLS_A.forEach(function(c3){var q3=cA[c3[0]];xi[c3[0]]=fmtIn(q3>=0?num(ra[q3]):null)});s.a[ORI+'|'+ib]=xi;okc++}}}
    render();m=document.getElementById('msgTab');
    m.innerHTML='<div class="msg '+(ok||okc?'ok':'erro')+'">'+ok+' célula(s) da tabela e '+okc+' cidade(s) importadas'+(CFG.origens.length>1?' para a origem '+esc(oriNome(ORI)):'')+'.'+(ok||okc?' Confira os valores e clique em <b>Enviar tabela</b>.':'')+'</div>'+(aviso?'<div class="msg aviso">'+esc(aviso)+'</div>':'');
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

// Dados cadastrais (pre-cadastro da transportadora), gravados em dados_gerais.CADASTRO
const CAMPOS_CADASTRO = ['razao', 'fantasia', 'ie', 'endereco', 'com_nome', 'com_tel', 'com_whats', 'com_email', 'op_nome', 'op_tel', 'op_whats', 'op_email', 'fin_nome', 'fin_tel', 'fin_email'];
function limparCadastro(c, origens) {
  const out = {};
  for (const k of CAMPOS_CADASTRO) { const v = String(c?.[k] ?? '').trim().slice(0, 200); if (v) out[k] = v; }
  const cnpjs = {};
  for (const o of origens) { const d = soDigitos(c?.cnpj_origem?.[o]); if (d) cnpjs[o] = d.slice(0, 14); }
  if (Object.keys(cnpjs).length) out.cnpj_origem = cnpjs;
  return out;
}
function faltasCadastroServidor(cad, origens) {
  const out = [];
  const tel = (v) => soDigitos(v).length >= 10;
  const mail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ''));
  if (!cad.razao) out.push('razão social');
  if (!cad.com_nome || !(tel(cad.com_tel) || tel(cad.com_whats)) || !mail(cad.com_email)) out.push('contato comercial (nome, telefone ou WhatsApp e e-mail)');
  if (!(tel(cad.op_tel) || tel(cad.op_whats))) out.push('telefone ou WhatsApp do operacional');
  if (!mail(cad.fin_email)) out.push('e-mail do financeiro');
  origens.forEach((o) => { if (!cnpjValido(soDigitos(cad.cnpj_origem?.[o]))) out.push(`CNPJ emissor${o ? ` de ${o}` : ''}`); });
  return out;
}

function limparGerais(g) {
  const out = {};
  for (const k of CHAVES_GERAIS) {
    const v = g?.[k];
    if (v === undefined || v === null || v === '') continue;
    if (k === 'generalidades' || k === 'observacoes') { out[k] = String(v).slice(0, 5000); continue; }
    if (k === 'composicao') { if (v === 'MAIOR' || v === 'PESO_MAIS_PERCENTUAL') out[k] = v; continue; }
    if (k === 'icms_incluso') { if (v === 'SIM' || v === 'NAO') out[k] = v; continue; }
    if (k === 'faturamento') { if (v === 'SEMANAL' || v === 'QUINZENAL') out[k] = v; continue; }
    if (k === 'vigencia') { if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out[k] = String(v); continue; }
    const n = numero(v);
    if (n !== null && n >= 0) out[k] = n;
  }
  if (Array.isArray(g?.taxas)) {
    const taxas = [];
    for (const t of g.taxas.slice(0, 30)) {
      const n = String(t?.n || '').trim().slice(0, 60);
      const v = numero(t?.v);
      const u = ['R$', '%', 'R$/KG', 'R$/FRACAO'].includes(String(t?.u)) ? String(t.u) : 'R$';
      if (!n || v === null || v < 0) continue;
      const item = { n, v, u };
      const min = numero(t?.min);
      if (min !== null && min > 0) item.min = min;
      const fr = numero(t?.fr);
      if (fr !== null && fr > 0 && (u === 'R$/KG' || u === 'R$/FRACAO')) item.fr = fr;
      const ufs = String(t?.ufs || '').toUpperCase().split(/[^A-Z]+/).filter((x) => UFS.includes(x));
      if (ufs.length) item.ufs = [...new Set(ufs)].join(',');
      taxas.push(item);
    }
    if (taxas.length) out.taxas = taxas;
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
      const anexos = convite.modalidade === 'PROPRIA'
        ? await todas(() => supabase.from('fracionado_anexos').select('id,canal,nome,tamanho,categoria,leitura').eq('convite_id', convite.id).order('created_at'))
          .catch(() => todas(() => supabase.from('fracionado_anexos').select('id,canal,nome,tamanho').eq('convite_id', convite.id).order('created_at')))
        : [];
      const [linhas, atendimento] = await Promise.all([
        todas(() => supabase.from('fracionado_respostas').select('canal,origem,uf_destino,regiao,faixa,frete_valor,frete_percentual,frete_minimo,frete_kg').eq('convite_id', convite.id).order('id'))
          .catch((e) => (/frete_kg/.test(e?.message || '') ? todas(() => supabase.from('fracionado_respostas').select('canal,origem,uf_destino,regiao,faixa,frete_valor,frete_percentual,frete_minimo').eq('convite_id', convite.id).order('id')) : Promise.reject(e))),
        todas(() => supabase.from('fracionado_atendimento').select('canal,origem,ibge,regiao,prazo_dias,tda,trt,suframa,taxas_destino').eq('convite_id', convite.id).order('id'))
          .catch((e) => (/taxas_destino/.test(e?.message || '') ? todas(() => supabase.from('fracionado_atendimento').select('canal,origem,ibge,regiao,prazo_dias,tda,trt,suframa').eq('convite_id', convite.id).order('id')) : Promise.reject(e))),
      ]);
      return enviarJson(res, 200, { acesso: gerarAcesso(token, segredo), config, gerais: convite.dados_gerais || {}, linhas, atendimento, anexos, status: convite.status });
    }

    if (body.acao === 'municipios') {
      if (!acessoValido(token, body.acesso, segredo)) return enviarJson(res, 401, { erro: 'Sessão expirada. Recarregue a página e se identifique novamente.' });
      const mun = await carregarMunicipios(supabase);
      return enviarJson(res, 200, { m: mun.map((m) => [m.i, m.u, m.c]) });
    }

    // Volumetria pronta (gerada pelo time interno em Portal de tabelas — fracionado). Sem parte: lista o que existe
    // para as origens do canal; com parte: devolve aquele pedaco das linhas. Nunca varre a base de CT-es aqui.
    if (body.acao === 'volumetria') {
      if (!acessoValido(token, body.acesso, segredo)) return enviarJson(res, 401, { erro: 'Sessão expirada. Recarregue a página e se identifique novamente.' });
      const canal = String(body.canal || '');
      if (!config.canais.includes(canal)) return enviarJson(res, 400, { erro: 'Canal inválido.' });
      const faixas = config.faixas[canal] || [];
      const bases = config.origens.map((o) => ({ origem: o, base: baseVolumetria({ canal, origem: o, faixas }) }));
      if (body.parte === undefined || body.parte === null) {
        const itens = [];
        for (const b of bases) {
          const { data, error } = await supabase.from('fracionado_volumetria').select('periodo_inicio,periodo_fim,total_partes,notas,gerado_em')
            .eq('base', b.base).eq('parte', 0).order('periodo_fim', { ascending: false }).limit(1);
          if (error) throw error;
          const r = data?.[0];
          itens.push(r ? { origem: b.origem, inicio: r.periodo_inicio, fim: r.periodo_fim, partes: r.total_partes, notas: r.notas, gerado_em: r.gerado_em } : { origem: b.origem, pendente: true });
        }
        return enviarJson(res, 200, { itens });
      }
      const b = bases[Number(body.origem)];
      const parte = parseInt(body.parte, 10);
      if (!b || !Number.isFinite(parte) || parte < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.inicio || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.fim || ''))) return enviarJson(res, 400, { erro: 'Pedido inválido.' });
      const { data, error } = await supabase.from('fracionado_volumetria').select('linhas')
        .eq('base', b.base).eq('periodo_inicio', body.inicio).eq('periodo_fim', body.fim).eq('parte', parte).limit(1);
      if (error) throw error;
      if (!data?.length) return enviarJson(res, 404, { erro: 'Volumetria não encontrada. Recarregue a página.' });
      return enviarJson(res, 200, { r: data[0].linhas || [] });
    }

    if (body.acao === 'anexar') {
      if (!acessoValido(token, body.acesso, segredo)) return enviarJson(res, 401, { erro: 'Sessão expirada. Recarregue a página e se identifique novamente.' });
      if (config.modalidade !== 'PROPRIA') return enviarJson(res, 400, { erro: 'Este link não aceita anexos.' });
      const canal = String(body.canal || '');
      if (!config.canais.includes(canal)) return enviarJson(res, 400, { erro: 'Canal inválido.' });
      const nome = String(body.nome || '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 180);
      const ext = nome.includes('.') ? nome.split('.').pop().toLowerCase() : '';
      if (!nome || !EXT_ANEXO.includes(ext)) return enviarJson(res, 400, { erro: 'Formato não aceito. Envie Excel, CSV, PDF, Word ou ZIP.' });
      const dados = String(body.dados || '');
      if (!dados || dados.length > MAX_ANEXO_B64 || /[^A-Za-z0-9+/=]/.test(dados)) return enviarJson(res, 400, { erro: 'Arquivo inválido ou maior que 3 MB.' });
      const { count } = await supabase.from('fracionado_anexos').select('id', { count: 'exact', head: true }).eq('convite_id', convite.id);
      if ((count || 0) >= 20) return enviarJson(res, 400, { erro: 'Limite de 20 arquivos atingido.' });
      const tamanho = Math.floor((dados.length * 3) / 4);
      const categoria = ['DESTINOS', 'GENERALIDADES'].includes(body.categoria) ? body.categoria : 'TABELA';
      if (categoria === 'DESTINOS' && !['xlsx', 'xls', 'csv'].includes(ext)) return enviarJson(res, 400, { erro: 'O arquivo de destinos atendidos precisa ser Excel ou CSV (para conferirmos cidade, rota, prazo e taxas).' });
      const lido = body.leitura && typeof body.leitura === 'object' ? body.leitura : null;
      const leitura = lido ? { cidade: !!lido.cidade, rota: !!lido.rota, prazo: !!lido.prazo, taxa: !!lido.taxa, frete: !!lido.frete, linhas: Math.max(0, parseInt(lido.linhas, 10) || 0) } : null;
      if (categoria === 'DESTINOS' && !(leitura && leitura.cidade && leitura.rota && leitura.prazo && leitura.taxa)) return enviarJson(res, 400, { erro: 'O arquivo de destinos precisa ter as colunas de CIDADE (ou IBGE), ROTA/REGIÃO, PRAZO e TAXAS por destino.' });
      let { data: ins, error: eAn } = await supabase.from('fracionado_anexos').insert({
        convite_id: convite.id, canal, nome, tipo: String(body.tipo || '').slice(0, 100), tamanho, conteudo: dados, categoria, leitura,
      }).select('id,canal,nome,tamanho,categoria,leitura').single();
      // migration 20261126_004 ainda nao aplicada: marca a categoria no nome
      if (eAn && /categoria|leitura/.test(eAn.message || '')) {
        ({ data: ins, error: eAn } = await supabase.from('fracionado_anexos').insert({
          convite_id: convite.id, canal, nome: categoria === 'TABELA' ? nome : `[${categoria}] ${nome}`, tipo: String(body.tipo || '').slice(0, 100), tamanho, conteudo: dados,
        }).select('id,canal,nome,tamanho').single());
        if (ins) Object.assign(ins, { categoria, leitura });
      }
      if (eAn) throw eAn;
      await supabase.from('fracionado_convites').update({ ultimo_acesso_em: new Date().toISOString() }).eq('id', convite.id);
      return enviarJson(res, 200, { ok: true, anexo: ins });
    }

    if (body.acao === 'remover_anexo') {
      if (!acessoValido(token, body.acesso, segredo)) return enviarJson(res, 401, { erro: 'Sessão expirada. Recarregue a página e se identifique novamente.' });
      const { error: eRm } = await supabase.from('fracionado_anexos').delete().eq('convite_id', convite.id).eq('id', String(body.id || ''));
      if (eRm) throw eRm;
      return enviarJson(res, 200, { ok: true });
    }

    if (body.acao === 'salvar') {
      if (!acessoValido(token, body.acesso, segredo)) return enviarJson(res, 401, { erro: 'Sessão expirada. Recarregue a página e se identifique novamente.' });
      const agora = new Date().toISOString();
      const pct = config.modalidade === 'PERCENTUAL';
      const gerais = { ...(convite.dados_gerais || {}) };
      const mun = await carregarMunicipios(supabase);
      const munMap = new Map(mun.map((m) => [m.i, m]));
      const linhas = [];
      const atend = [];
      const canaisSalvos = [];
      for (const canal of config.canais) {
        const bloco = body.canais?.[canal];
        if (!bloco) continue;
        canaisSalvos.push(canal);
        gerais[canal] = limparGerais(bloco.gerais);
        if (body.cadastro) gerais.CADASTRO = limparCadastro(body.cadastro, config.origens);
        const faixas = new Map((config.faixas[canal] || []).map((f) => [f.label, f]));
        for (const origem of config.origens) {
          const ob = bloco.origens?.[origem];
          if (!ob) continue;
          const vistos = new Set();
          for (const it of Array.isArray(ob.linhas) ? ob.linhas.slice(0, 20000) : []) {
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
            const chave = `${uf}|${regiao}|${faixa}`;
            if (vistos.has(chave)) continue;
            const v = pct ? null : numero(it.v);
            const p = pct ? numero(it.p) : null;
            const m = pct ? numero(it.m) : null;
            const kg = pct ? numero(it.k) : null;
            if (v === null && p === null && m === null && kg === null) continue;
            if ([v, p, m, kg].some((n) => n !== null && n < 0) || (p !== null && p > 100)) continue;
            vistos.add(chave);
            linhas.push({
              convite_id: convite.id, canal, origem, uf_destino: uf, regiao, faixa,
              peso_inicial: faixaCfg ? faixaCfg.min : null, peso_final: faixaCfg ? faixaCfg.max : null,
              frete_valor: v, frete_percentual: p, frete_minimo: m, frete_kg: kg, updated_at: agora,
            });
          }
          const vistosA = new Set();
          for (const a of Array.isArray(ob.atendimento) ? ob.atendimento.slice(0, 6000) : []) {
            const m = munMap.get(String(a.i));
            if (!m || vistosA.has(m.i)) continue;
            const regiaoRaw = String(a.r || '').toUpperCase();
            const regiao = REGIOES.includes(regiaoRaw) ? regiaoRaw : null;
            const prazoN = parseInt(a.p, 10);
            const prazo = Number.isFinite(prazoN) && prazoN > 0 ? prazoN : null;
            if (!regiao && !prazo) continue;
            vistosA.add(m.i);
            const pos = (x) => { const n = numero(x); return n !== null && n >= 0 ? n : null; };
            const taxasDestino = {};
            COLS_ATEND_JSON.forEach(([k]) => { const n = pos(a[k]); if (n !== null) taxasDestino[k] = n; });
            atend.push({
              convite_id: convite.id, canal, origem, ibge: m.i, uf: m.u, cidade: m.c, regiao, prazo_dias: prazo,
              ...Object.fromEntries(COLS_ATEND_PROPRIAS.map(([k, , col]) => [col, pos(a[k])])),
              taxas_destino: Object.keys(taxasDestino).length ? taxasDestino : null, updated_at: agora,
            });
          }
        }
        // o que esta na tela e a verdade: apaga o canal e regrava
        const { error: eDel } = await supabase.from('fracionado_respostas').delete().eq('convite_id', convite.id).eq('canal', canal);
        if (eDel) throw eDel;
        const { error: eDelA } = await supabase.from('fracionado_atendimento').delete().eq('convite_id', convite.id).eq('canal', canal);
        if (eDelA) throw eDelA;
      }
      for (let i = 0; i < linhas.length; i += 500) {
        let { error: eIns } = await supabase.from('fracionado_respostas').insert(linhas.slice(i, i + 500));
        // migration 20261126_001 ainda nao aplicada: grava sem o kg garantia em vez de perder a tabela
        if (eIns && /frete_kg/.test(eIns.message || '')) {
          ({ error: eIns } = await supabase.from('fracionado_respostas').insert(linhas.slice(i, i + 500).map(({ frete_kg: _kg, ...l }) => l)));
        }
        if (eIns) throw eIns;
      }
      for (let i = 0; i < atend.length; i += 500) {
        let { error: eInsA } = await supabase.from('fracionado_atendimento').insert(atend.slice(i, i + 500));
        // migration 20261126_002 ainda nao aplicada: grava sem as taxas novas por cidade (so tda/trt/suframa)
        if (eInsA && /taxas_destino/.test(eInsA.message || '')) {
          ({ error: eInsA } = await supabase.from('fracionado_atendimento').insert(atend.slice(i, i + 500).map(({ taxas_destino: _td, ...l }) => l)));
        }
        if (eInsA) throw eInsA;
      }
      const atualiza = { dados_gerais: gerais, ultimo_acesso_em: agora };
      if (body.enviar) {
        if (!canaisSalvos.length) return enviarJson(res, 400, { erro: 'Nada para enviar.' });
        const faltaCad = faltasCadastroServidor(gerais.CADASTRO || {}, config.origens);
        if (faltaCad.length) return enviarJson(res, 400, { erro: `Dados cadastrais: falta ${faltaCad.join(', ')}.` });
        for (const c of canaisSalvos) {
          const nome = c === 'ATACADO' ? 'Atacado' : 'B2C';
          if (config.modalidade === 'PROPRIA') {
            const anx = await todas(() => supabase.from('fracionado_anexos').select('id,nome,categoria').eq('convite_id', convite.id).eq('canal', c).order('created_at'))
              .catch(() => todas(() => supabase.from('fracionado_anexos').select('id,nome').eq('convite_id', convite.id).eq('canal', c).order('created_at')));
            const cat = (a) => a.categoria || (/^\[(DESTINOS|GENERALIDADES)\]/.exec(a.nome)?.[1] || 'TABELA');
            if (!anx.some((a) => cat(a) === 'TABELA')) return enviarJson(res, 400, { erro: `${nome}: anexe a tabela de frete.` });
            if (!anx.some((a) => cat(a) === 'DESTINOS')) return enviarJson(res, 400, { erro: `${nome}: anexe o arquivo de destinos atendidos (cidade, rota, prazo e taxas).` });
            if (!gerais[c]?.prazo) return enviarJson(res, 400, { erro: `${nome}: informe o prazo de pagamento.` });
          } else {
            if (!linhas.some((l) => l.canal === c)) return enviarJson(res, 400, { erro: `${nome}: preencha ao menos uma célula da tabela de frete.` });
            if (!atend.some((a) => a.canal === c && a.regiao && a.prazo_dias)) return enviarJson(res, 400, { erro: `${nome}: informe região e prazo de ao menos uma cidade (Atendimento).` });
          }
          if (!gerais[c]?.icms_incluso) return enviarJson(res, 400, { erro: `${nome}: informe se os valores já incluem ICMS.` });
        }
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
      return enviarJson(res, 200, { ok: true, salvas: linhas.length, cidades: atend.length });
    }

    return enviarJson(res, 400, { erro: 'Ação inválida.' });
  } catch (e) {
    console.error('[fracionado-cotacao]', e);
    const msg = String(e?.message || e);
    return enviarJson(res, 500, { erro: /does not exist|schema cache/i.test(msg) ? 'Portal ainda não habilitado (migration pendente).' : 'Erro ao processar. Tente novamente.' });
  }
}
