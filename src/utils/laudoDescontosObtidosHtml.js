const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const ORDEM_SERIE_ANO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoedaJs() {
  return `function formatMoeda(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function formatMoedaCompacta(v){var a=Math.abs(Number(v||0));if(a>=1000000)return 'R$ '+(v/1000000).toLocaleString('pt-BR',{maximumFractionDigits:1})+'M';if(a>=1000)return 'R$ '+(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:0})+'k';return formatMoeda(v);}
function formatInt(v){return Number(v||0).toLocaleString('pt-BR');}`;
}

function baixarArquivoBrowser(conteudo, nomeArquivo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

export function nomeArquivoLaudoDescontosObtidos() {
  const agora = new Date();
  const carimbo = `${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}`;
  return `laudo-descontos-obtidos-${carimbo}.html`;
}

/**
 * Gera um HTML autônomo (sem chamadas de rede, sem dependência do app) com
 * os dados embutidos e um mini "BI" navegável em JS puro: troca de ano,
 * clique em mês filtra transportadoras, clique em transportadora filtra a
 * evolução mensal dela — mesma interação do painel dentro do sistema, só que
 * portátil para quem recebe por e-mail e não tem acesso ao Central de Fretes.
 */
export function montarHtmlLaudoDescontosObtidos(linhas = [], historico = []) {
  const dados = linhas.map((l) => ({
    a: Number(l.ano),
    m: Number(l.mes),
    t: String(l.transportadora_nome || 'Não identificado'),
    v: Number(l.valor || 0),
    r: l.regra_aplicada,
    dt: l.data_lancamento || null,
  }));
  const hist = historico.map((h) => ({ t: h.transportadora, aud: h.auditor_nome, dt: h.atribuido_em }));

  const geradoEm = new Date().toLocaleString('pt-BR');
  const dadosJson = JSON.stringify(dados);
  const histJson = JSON.stringify(hist);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Laudo — Descontos Obtidos</title>
<style>
  :root {
    --surface: #fcfcfb; --page: #f9f9f7; --ink: #0b0b0b; --ink2: #52514e; --muted: #898781;
    --grade: #e1e0d9; --eixo: #c3c2b7; --border: rgba(11,11,11,0.10);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .shell { max-width: 1180px; margin: 0 auto; padding: 28px 20px 60px; }
  .header { margin-bottom: 20px; }
  .brand { font-size: 11px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 4px 0 6px; font-size: 26px; }
  .sub { color: var(--ink2); font-size: 13px; margin: 0; }
  .tabs { display: flex; gap: 8px; margin: 20px 0 16px; }
  .tab-btn { border: 1px solid var(--border); background: var(--surface); color: var(--ink2); border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; font-weight: 600; }
  .tab-btn.active { background: #4a3aa7; color: #fff; border-color: #4a3aa7; }
  select { border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 13px; background: var(--surface); color: var(--ink); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
  .card h2 { font-size: 14px; margin: 0 0 4px; }
  .card p.hint { font-size: 12px; color: var(--ink2); margin: 0 0 10px; }
  .stat-label { font-size: 13px; color: var(--ink2); display: block; }
  .stat-value { font-size: 24px; font-weight: 600; display: block; margin-top: 2px; }
  .stat-sub { font-size: 12px; color: var(--muted); display: block; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--grade); }
  th { color: var(--ink2); font-weight: 600; font-size: 12px; }
  tbody tr:hover { background: rgba(74,58,167,0.06); cursor: pointer; }
  tbody tr.selected { background: rgba(74,58,167,0.12); }
  .table-wrap { max-height: 420px; overflow-y: auto; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; font-size: 12px; color: var(--ink2); }
  .legend span.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
  .filtro-ativo { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #eef0fb; border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
  .filtro-ativo button { border: none; background: none; color: #4a3aa7; font-weight: 600; cursor: pointer; font-size: 13px; }
  .footer-note { color: var(--muted); font-size: 11px; margin-top: 30px; }
  .hidden { display: none !important; }
  @media (max-width: 860px) { .grid2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="shell">
  <div class="header">
    <div class="brand">AMD Log • Descontos de Auditoria de Fretes (SAP)</div>
    <h1>Laudo de Descontos Obtidos</h1>
    <p class="sub">Gerado em ${escaparHtml(geradoEm)} • Descontos financeiros efetivamente concedidos e comprovados no SAP.</p>
  </div>

  <div class="tabs">
    <button class="tab-btn active" id="btn-tab-mensal">Mensal</button>
    <button class="tab-btn" id="btn-tab-anual">Ano a ano</button>
    <button class="tab-btn" id="btn-tab-auditor">Por auditor</button>
    <span style="flex:1"></span>
    <select id="sel-ano"></select>
  </div>

  <div id="view-mensal"></div>
  <div id="view-anual" class="hidden"></div>
  <div id="view-auditor" class="hidden"></div>

  <div class="footer-note">Laudo gerado automaticamente pelo Central de Fretes — dados sujeitos a reimportação/atualização. Arquivo autocontido, não requer conexão para ser visualizado.</div>
</div>

<script>
var DADOS = ${dadosJson};
var HIST = ${histJson};
var NOMES_MES = ${JSON.stringify(NOMES_MES)};
var CORES = ${JSON.stringify(ORDEM_SERIE_ANO)};
var INICIO_AUDITORIA = '2026-07-01';
${formatMoedaJs()}

var estado = { aba: 'mensal', ano: null, mes: null, transp: null, auditor: null };

// O nome da transportadora no SAP quase nunca bate exatamente com o nome no
// cadastro de carteiras (ex.: "TAM LINHAS AEREAS S/A." vs "TAM LINHAS
// AEREAS"). Normaliza removendo acentos/pontuacao/sufixos societarios.
function normalizarNomeTransportadora(nome) {
  var texto = String(nome || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  texto = texto.replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  var sufixo = /\s+(S\s?A|LTDA|LTD|ME|EPP|EIRELI|CIA|EM RECUPERACAO( JUDICIAL)?)$/;
  var anterior;
  do {
    anterior = texto;
    texto = texto.replace(sufixo, '').trim();
  } while (texto !== anterior);
  return texto;
}

var HIST_POR_TRANSP = {};
HIST.forEach(function (h) {
  var chave = normalizarNomeTransportadora(h.t);
  if (!chave) return;
  if (!HIST_POR_TRANSP[chave]) HIST_POR_TRANSP[chave] = [];
  HIST_POR_TRANSP[chave].push(h);
});
// Carteiras foram cadastradas agora (ago/2026); a 1a atribuicao de cada
// transportadora vale retroativa a partir de INICIO_AUDITORIA, senao a data
// real do cadastro nao puxaria nenhum lancamento anterior a ela. Trocas de
// carteira reais que vierem depois respeitam a propria data.
Object.keys(HIST_POR_TRANSP).forEach(function (t) {
  var lista = HIST_POR_TRANSP[t];
  lista.sort(function (a, b) { return new Date(a.dt) - new Date(b.dt); });
  var inicio = new Date(INICIO_AUDITORIA).getTime();
  lista.forEach(function (h, idx) {
    var real = new Date(h.dt).getTime();
    h.efetivoDesde = idx === 0 ? Math.min(real, inicio) : real;
  });
  lista.sort(function (a, b) { return b.efetivoDesde - a.efetivoDesde; });
});
function auditorNaData(transportadora, dataIso) {
  var lista = HIST_POR_TRANSP[normalizarNomeTransportadora(transportadora)];
  if (!lista) return null;
  var alvo = new Date(dataIso).getTime();
  for (var i = 0; i < lista.length; i++) {
    if (lista[i].efetivoDesde <= alvo) return lista[i].aud;
  }
  return null;
}

function anosDisponiveis() {
  var s = {};
  DADOS.forEach(function (d) { s[d.a] = true; });
  return Object.keys(s).map(Number).sort(function (a, b) { return b - a; });
}

function el(tag, attrs, children) {
  var node = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach(function (k) {
    if (k === 'text') node.textContent = attrs[k];
    else if (k === 'html') node.innerHTML = attrs[k];
    else if (k === 'onClick') node.addEventListener('click', attrs[k]);
    else if (k === 'class') node.className = attrs[k];
    else node.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(function (c) { if (c) node.appendChild(c); });
  return node;
}

function svgEl(tag, attrs) {
  var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
  return node;
}

function montarSelectAno() {
  var sel = document.getElementById('sel-ano');
  sel.innerHTML = '';
  anosDisponiveis().forEach(function (a) {
    var opt = el('option', { value: a, text: String(a) });
    if (a === estado.ano) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = function () { estado.ano = Number(sel.value); estado.mes = null; estado.transp = null; render(); };
}

function renderMensal() {
  var container = document.getElementById('view-mensal');
  container.innerHTML = '';
  var linhasAno = DADOS.filter(function (d) { return d.a === estado.ano; });

  if (estado.mes || estado.transp) {
    var texto = 'Filtro ativo: ';
    if (estado.mes) texto += NOMES_MES[estado.mes - 1] + '/' + estado.ano;
    if (estado.mes && estado.transp) texto += ' + ';
    if (estado.transp) texto += estado.transp;
    var barra = el('div', { class: 'filtro-ativo' });
    barra.appendChild(el('span', { text: texto }));
    barra.appendChild(el('button', { text: 'Limpar filtro', onClick: function () { estado.mes = null; estado.transp = null; render(); } }));
    container.appendChild(barra);
  }

  var linhasTransp = estado.transp ? linhasAno.filter(function (d) { return d.t === estado.transp; }) : linhasAno;
  var totalCard = linhasTransp.reduce(function (s, d) { return s + d.v; }, 0);
  var linhasMes = estado.mes ? linhasAno.filter(function (d) { return d.m === estado.mes; }) : linhasAno;

  var stats = el('div', { class: 'stats' });
  stats.appendChild(statTile('Total' + (estado.transp ? ' (' + estado.transp + ')' : ' no ano'), formatMoeda(totalCard), linhasTransp.length + ' lançamento(s)'));

  var mapaMes = {};
  for (var m = 1; m <= 12; m++) mapaMes[m] = 0;
  linhasTransp.forEach(function (d) { mapaMes[d.m] += d.v; });
  var porMes = [];
  for (var mm = 1; mm <= 12; mm++) porMes.push({ mes: mm, valor: mapaMes[mm] });
  var maiorMes = Math.max(1, Math.max.apply(null, porMes.map(function (p) { return p.valor; })));

  var mapaTransp = {};
  linhasMes.forEach(function (d) { mapaTransp[d.t] = (mapaTransp[d.t] || 0) + d.v; });
  var porTransp = Object.keys(mapaTransp).map(function (t) { return { nome: t, valor: mapaTransp[t] }; }).sort(function (a, b) { return b.valor - a.valor; });
  var maiorTransp = Math.max(1, Math.max.apply(null, porTransp.map(function (p) { return p.valor; }).concat([1])));

  stats.appendChild(statTile('Transportadoras' + (estado.mes ? ' em ' + NOMES_MES[estado.mes - 1] : ''), formatInt(porTransp.length), 'com desconto'));
  container.appendChild(stats);

  var grid = el('div', { class: 'grid2' });

  var cardMes = el('div', { class: 'card' });
  cardMes.appendChild(el('h2', { text: 'Desconto por mês' + (estado.transp ? ' — ' + estado.transp : '') }));
  cardMes.appendChild(el('p', { class: 'hint', text: 'Ano ' + estado.ano + '. Clique num mês para filtrar as transportadoras ao lado.' }));
  var tblMes = el('table');
  var theadMes = el('thead'); theadMes.appendChild(el('tr', {}, [el('th', { text: 'Mês' }), el('th', { text: 'Valor' }), el('th', {})]));
  tblMes.appendChild(theadMes);
  var tbodyMes = el('tbody');
  porMes.forEach(function (p) {
    var tr = el('tr', { onClick: p.valor ? function () { estado.mes = estado.mes === p.mes ? null : p.mes; render(); } : null });
    if (estado.mes === p.mes) tr.className = 'selected';
    tr.appendChild(el('td', { text: NOMES_MES[p.mes - 1] }));
    tr.appendChild(el('td', { text: formatMoeda(p.valor) }));
    var tdBar = el('td', { style: 'width:40%' });
    tdBar.appendChild(barraHorizontal(p.valor, maiorMes, '#4a3aa7'));
    tr.appendChild(tdBar);
    tbodyMes.appendChild(tr);
  });
  tblMes.appendChild(tbodyMes);
  cardMes.appendChild(el('div', { class: 'table-wrap' }, [tblMes]));
  grid.appendChild(cardMes);

  var cardTransp = el('div', { class: 'card' });
  cardTransp.appendChild(el('h2', { text: 'Desconto por transportadora' + (estado.mes ? ' — ' + NOMES_MES[estado.mes - 1] + '/' + estado.ano : '') }));
  cardTransp.appendChild(el('p', { class: 'hint', text: 'Clique numa transportadora para ver a evolução dela mês a mês.' }));
  var tblT = el('table');
  var theadT = el('thead'); theadT.appendChild(el('tr', {}, [el('th', { text: 'Transportadora' }), el('th', { text: 'Desconto obtido' }), el('th', {})]));
  tblT.appendChild(theadT);
  var tbodyT = el('tbody');
  porTransp.forEach(function (p) {
    var tr = el('tr', { onClick: function () { estado.transp = estado.transp === p.nome ? null : p.nome; render(); } });
    if (estado.transp === p.nome) tr.className = 'selected';
    tr.appendChild(el('td', { text: p.nome }));
    tr.appendChild(el('td', { text: formatMoeda(p.valor) }));
    var tdBar2 = el('td', { style: 'width:30%' });
    tdBar2.appendChild(barraHorizontal(p.valor, maiorTransp, '#1baf7a'));
    tr.appendChild(tdBar2);
    tbodyT.appendChild(tr);
  });
  tblT.appendChild(tbodyT);
  cardTransp.appendChild(el('div', { class: 'table-wrap' }, [tblT]));
  grid.appendChild(cardTransp);

  container.appendChild(grid);

  if (estado.mes || estado.transp) {
    var linhasFiltro = linhasAno.filter(function (d) {
      return (!estado.mes || d.m === estado.mes) && (!estado.transp || d.t === estado.transp);
    });
    var cardLanc = el('div', { class: 'card' });
    cardLanc.appendChild(el('h2', { text: 'Lançamentos (' + linhasFiltro.length + ')' }));
    var tblL = el('table');
    var theadL = el('thead'); theadL.appendChild(el('tr', {}, [el('th', { text: 'Mês' }), el('th', { text: 'Transportadora' }), el('th', { text: 'Valor' }), el('th', { text: 'Regra' })]));
    tblL.appendChild(theadL);
    var tbodyL = el('tbody');
    linhasFiltro.slice(0, 500).forEach(function (d) {
      tbodyL.appendChild(el('tr', {}, [
        el('td', { text: NOMES_MES[d.m - 1] }),
        el('td', { text: d.t }),
        el('td', { text: formatMoeda(d.v) }),
        el('td', { text: d.r === 'fretes_carretos' ? 'Fretes e Carretos' : 'Desc. Fin. Obtidos' }),
      ]));
    });
    tblL.appendChild(tbodyL);
    cardLanc.appendChild(el('div', { class: 'table-wrap' }, [tblL]));
    container.appendChild(cardLanc);
  }
}

function statTile(label, value, sub) {
  var card = el('div', { class: 'card' });
  card.appendChild(el('span', { class: 'stat-label', text: label }));
  card.appendChild(el('strong', { class: 'stat-value', text: value }));
  if (sub) card.appendChild(el('span', { class: 'stat-sub', text: sub }));
  return card;
}

function barraHorizontal(valor, maximo, cor) {
  var largura = maximo ? Math.max(2, Math.round((valor / maximo) * 100)) : 0;
  var track = el('div', { style: 'height:10px;border-radius:999px;background:rgba(0,0,0,0.08);overflow:hidden' });
  track.appendChild(el('div', { style: 'height:100%;width:' + largura + '%;border-radius:999px;background:' + cor }));
  return track;
}

function renderAnual() {
  var container = document.getElementById('view-anual');
  container.innerHTML = '';
  var anos = anosDisponiveis().slice().sort(function (a, b) { return a - b; });

  var totalPorAno = anos.map(function (a) {
    return { ano: a, valor: DADOS.filter(function (d) { return d.a === a; }).reduce(function (s, d) { return s + d.v; }, 0) };
  });

  var seriesPorMes = anos.map(function (a, idx) {
    var mapa = {}; var presentes = {};
    for (var m = 1; m <= 12; m++) mapa[m] = 0;
    DADOS.filter(function (d) { return d.a === a; }).forEach(function (d) { mapa[d.m] += d.v; presentes[d.m] = true; });
    var valores = [];
    for (var mm = 1; mm <= 12; mm++) valores.push({ mes: mm, valor: mapa[mm], presente: !!presentes[mm] });
    return { ano: a, valores: valores, cor: CORES[idx % CORES.length] };
  });

  var anoRecente = anos[anos.length - 1];
  var linhasRecente = DADOS.filter(function (d) { return d.a === anoRecente; });
  var totalRecente = linhasRecente.reduce(function (s, d) { return s + d.v; }, 0);
  var mapaTranspRecente = {};
  linhasRecente.forEach(function (d) { mapaTranspRecente[d.t] = (mapaTranspRecente[d.t] || 0) + d.v; });
  var liderArr = Object.keys(mapaTranspRecente).map(function (t) { return [t, mapaTranspRecente[t]]; }).sort(function (a, b) { return b[1] - a[1]; });
  var lider = liderArr[0];

  var stats = el('div', { class: 'stats' });
  stats.appendChild(statTile('Total ' + anoRecente, formatMoeda(totalRecente), linhasRecente.length + ' lançamento(s)'));
  stats.appendChild(statTile('Líder em ' + anoRecente, lider ? lider[0] : '—', lider ? formatMoeda(lider[1]) : ''));
  container.appendChild(stats);

  var grid = el('div', { class: 'grid2' });

  var cardBarra = el('div', { class: 'card' });
  cardBarra.appendChild(el('h2', { text: 'Total de desconto obtido por ano' }));
  cardBarra.appendChild(desenharBarraAnos(totalPorAno));
  grid.appendChild(cardBarra);

  var cardLinha = el('div', { class: 'card' });
  cardLinha.appendChild(el('h2', { text: 'Comparação mês a mês entre anos' }));
  cardLinha.appendChild(desenharLinhaMeses(seriesPorMes));
  grid.appendChild(cardLinha);

  container.appendChild(grid);

  var mapaRegra = { desc_fin_obtidos: 0, fretes_carretos: 0 };
  DADOS.forEach(function (d) { mapaRegra[d.r] = (mapaRegra[d.r] || 0) + d.v; });
  var totalRegra = mapaRegra.desc_fin_obtidos + mapaRegra.fretes_carretos;
  var cardRegra = el('div', { class: 'card' });
  cardRegra.appendChild(el('h2', { text: 'De onde vêm os lançamentos' }));
  var barraRegra = el('div', { style: 'display:flex;height:14px;border-radius:999px;overflow:hidden;gap:2px;margin-top:8px' });
  barraRegra.appendChild(el('div', { style: 'width:' + (totalRegra ? mapaRegra.desc_fin_obtidos / totalRegra * 100 : 0) + '%;background:#4a3aa7' }));
  barraRegra.appendChild(el('div', { style: 'width:' + (totalRegra ? mapaRegra.fretes_carretos / totalRegra * 100 : 0) + '%;background:#1baf7a' }));
  cardRegra.appendChild(barraRegra);
  var legenda = el('div', { class: 'legend' });
  legenda.appendChild(el('span', {}, [el('span', { class: 'swatch', style: 'background:#4a3aa7' }), document.createTextNode('Desc. Fin. Obtidos — ' + formatMoeda(mapaRegra.desc_fin_obtidos))]));
  legenda.appendChild(el('span', {}, [el('span', { class: 'swatch', style: 'background:#1baf7a' }), document.createTextNode('Fretes e Carretos — ' + formatMoeda(mapaRegra.fretes_carretos))]));
  cardRegra.appendChild(legenda);
  container.appendChild(cardRegra);

  var mapaPivot = {};
  DADOS.forEach(function (d) {
    if (!mapaPivot[d.t]) mapaPivot[d.t] = { nome: d.t, total: 0, porAno: {} };
    mapaPivot[d.t].total += d.v;
    mapaPivot[d.t].porAno[d.a] = (mapaPivot[d.t].porAno[d.a] || 0) + d.v;
  });
  var pivot = Object.keys(mapaPivot).map(function (k) { return mapaPivot[k]; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 20);

  var cardPivot = el('div', { class: 'card' });
  cardPivot.appendChild(el('h2', { text: 'Top transportadoras — total por ano' }));
  var tbl = el('table');
  var thead = el('thead');
  var trh = el('tr', {}, [el('th', { text: 'Transportadora' })]);
  anos.forEach(function (a) { trh.appendChild(el('th', { text: String(a) })); });
  trh.appendChild(el('th', { text: 'Total' }));
  thead.appendChild(trh);
  tbl.appendChild(thead);
  var tbody = el('tbody');
  pivot.forEach(function (item) {
    var tr = el('tr', {}, [el('td', { text: item.nome })]);
    anos.forEach(function (a) { tr.appendChild(el('td', { text: item.porAno[a] ? formatMoeda(item.porAno[a]) : '—' })); });
    tr.appendChild(el('td', { html: '<strong>' + formatMoeda(item.total) + '</strong>' }));
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  cardPivot.appendChild(el('div', { class: 'table-wrap' }, [tbl]));
  container.appendChild(cardPivot);
}

function desenharBarraAnos(dados) {
  var largura = 520, altura = 220;
  var margem = { top: 24, right: 16, bottom: 32, left: 16 };
  var areaL = largura - margem.left - margem.right, areaA = altura - margem.top - margem.bottom;
  var maximo = Math.max(1, Math.max.apply(null, dados.map(function (d) { return d.valor; }).concat([1])));
  var larguraBarra = Math.min(56, dados.length ? (areaL / dados.length) * 0.5 : 0);
  var svg = svgEl('svg', { viewBox: '0 0 ' + largura + ' ' + altura, style: 'width:100%;height:auto' });

  for (var i = 0; i <= 4; i++) {
    var y = margem.top + areaA * (1 - i / 4);
    svg.appendChild(svgEl('line', { x1: margem.left, x2: largura - margem.right, y1: y, y2: y, stroke: '#e1e0d9', 'stroke-width': 1 }));
  }
  svg.appendChild(svgEl('line', { x1: margem.left, x2: largura - margem.right, y1: margem.top + areaA, y2: margem.top + areaA, stroke: '#c3c2b7', 'stroke-width': 1 }));

  dados.forEach(function (d, idx) {
    var alturaBarra = maximo ? (d.valor / maximo) * areaA : 0;
    var passo = areaL / dados.length;
    var x = margem.left + idx * passo + (passo - larguraBarra) / 2;
    var y = margem.top + areaA - alturaBarra;
    var cor = CORES[idx % CORES.length];
    var rect = svgEl('rect', { x: x, y: y, width: larguraBarra, height: Math.max(1, alturaBarra), rx: 4, fill: cor });
    rect.appendChild(svgEl('title', {}));
    rect.querySelector('title').textContent = d.ano + ': ' + formatMoeda(d.valor);
    svg.appendChild(rect);
    var t1 = svgEl('text', { x: x + larguraBarra / 2, y: y - 8, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: '#0b0b0b' });
    t1.textContent = formatMoedaCompacta(d.valor);
    svg.appendChild(t1);
    var t2 = svgEl('text', { x: x + larguraBarra / 2, y: margem.top + areaA + 20, 'text-anchor': 'middle', 'font-size': 12, fill: '#52514e' });
    t2.textContent = d.ano;
    svg.appendChild(t2);
  });
  return svg;
}

function desenharLinhaMeses(series) {
  var wrap = document.createElement('div');
  var legenda = el('div', { class: 'legend', style: 'margin-bottom:8px' });
  series.forEach(function (s) {
    legenda.appendChild(el('span', {}, [el('span', { class: 'swatch', style: 'background:' + s.cor }), document.createTextNode(String(s.ano))]));
  });
  wrap.appendChild(legenda);

  var largura = 520, altura = 240;
  var margem = { top: 16, right: 16, bottom: 28, left: 16 };
  var areaL = largura - margem.left - margem.right, areaA = altura - margem.top - margem.bottom;
  var maximo = Math.max(1, Math.max.apply(null, series.reduce(function (acc, s) { return acc.concat(s.valores.map(function (v) { return v.valor; })); }, []).concat([1])));
  var passoX = areaL / 11;
  function ponto(i, v) { return [margem.left + i * passoX, margem.top + areaA - (v / maximo) * areaA]; }

  var svg = svgEl('svg', { viewBox: '0 0 ' + largura + ' ' + altura, style: 'width:100%;height:auto' });
  for (var g = 0; g <= 4; g++) {
    var yy = margem.top + areaA * (1 - g / 4);
    svg.appendChild(svgEl('line', { x1: margem.left, x2: largura - margem.right, y1: yy, y2: yy, stroke: '#e1e0d9', 'stroke-width': 1 }));
  }
  svg.appendChild(svgEl('line', { x1: margem.left, x2: largura - margem.right, y1: margem.top + areaA, y2: margem.top + areaA, stroke: '#c3c2b7', 'stroke-width': 1 }));
  NOMES_MES.forEach(function (nome, i) {
    var x = ponto(i, 0)[0];
    var t = svgEl('text', { x: x, y: margem.top + areaA + 18, 'text-anchor': 'middle', 'font-size': 10, fill: '#52514e' });
    t.textContent = nome;
    svg.appendChild(t);
  });

  series.forEach(function (s) {
    var grupos = []; var atual = [];
    s.valores.forEach(function (v) {
      if (v.presente) atual.push(v);
      else if (atual.length) { grupos.push(atual); atual = []; }
    });
    if (atual.length) grupos.push(atual);
    grupos.forEach(function (grupo) {
      var pontos = grupo.map(function (v) { var p = ponto(v.mes - 1, v.valor); return p[0] + ',' + p[1]; }).join(' ');
      svg.appendChild(svgEl('polyline', { points: pontos, fill: 'none', stroke: s.cor, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    });
    s.valores.filter(function (v) { return v.presente; }).forEach(function (v) {
      var p = ponto(v.mes - 1, v.valor);
      var c = svgEl('circle', { cx: p[0], cy: p[1], r: 4, fill: s.cor, stroke: '#fcfcfb', 'stroke-width': 2 });
      c.appendChild(svgEl('title', {}));
      c.querySelector('title').textContent = NOMES_MES[v.mes - 1] + '/' + s.ano + ': ' + formatMoeda(v.valor);
      svg.appendChild(c);
    });
  });
  wrap.appendChild(svg);
  return wrap;
}

function renderAuditor() {
  var container = document.getElementById('view-auditor');
  container.innerHTML = '';

  var aviso = el('div', { class: 'card', style: 'background:#eef0fb;font-size:13px;color:#52514e' });
  aviso.appendChild(document.createTextNode('Considera só lançamentos a partir de julho/2026. A primeira atribuição de cada transportadora vale retroativa desde 01/07/2026 (as carteiras foram cadastradas agora); trocas de carteira futuras respeitam a própria data da troca. A transportadora é casada pelo nome exatamente como aparece no SAP — divergências de grafia podem cair em "Sem auditor definido".'));
  container.appendChild(aviso);

  var elegiveis = DADOS.filter(function (d) { return d.dt && d.dt >= INICIO_AUDITORIA; });
  var comAuditor = elegiveis.map(function (d) {
    var aud = auditorNaData(d.t, d.dt) || 'Sem auditor definido';
    return { t: d.t, v: d.v, auditor: aud };
  });

  var mapaAud = {};
  comAuditor.forEach(function (d) {
    if (!mapaAud[d.auditor]) mapaAud[d.auditor] = { nome: d.auditor, total: 0, transp: {} };
    mapaAud[d.auditor].total += d.v;
    mapaAud[d.auditor].transp[d.t] = (mapaAud[d.auditor].transp[d.t] || 0) + d.v;
  });
  var porAuditor = Object.keys(mapaAud).map(function (k) { return mapaAud[k]; }).sort(function (a, b) { return b.total - a.total; });
  var totalGeral = comAuditor.reduce(function (s, d) { return s + d.v; }, 0);
  var totalSemAuditor = (mapaAud['Sem auditor definido'] || { total: 0 }).total;

  var stats = el('div', { class: 'stats' });
  stats.appendChild(statTile('Total atribuído (jul/2026+)', formatMoeda(totalGeral - totalSemAuditor), (porAuditor.length - (mapaAud['Sem auditor definido'] ? 1 : 0)) + ' auditor(es)'));
  stats.appendChild(statTile('Sem auditor definido', formatMoeda(totalSemAuditor), 'transportadora sem carteira registrada na data'));
  container.appendChild(stats);

  var maiorAud = Math.max(1, porAuditor.length ? porAuditor[0].total : 1);
  var cardAud = el('div', { class: 'card' });
  cardAud.appendChild(el('h2', { text: 'Desconto obtido por auditor' }));
  cardAud.appendChild(el('p', { class: 'hint', text: 'Clique num auditor para ver as transportadoras dele.' }));
  var tbl = el('table');
  var thead = el('thead'); thead.appendChild(el('tr', {}, [el('th', { text: 'Auditor' }), el('th', { text: 'Desconto obtido' }), el('th', { text: 'Transportadoras' }), el('th', {})]));
  tbl.appendChild(thead);
  var tbody = el('tbody');
  porAuditor.forEach(function (a) {
    var tr = el('tr', { onClick: function () { estado.auditor = estado.auditor === a.nome ? null : a.nome; render(); } });
    if (estado.auditor === a.nome) tr.className = 'selected';
    tr.appendChild(el('td', { text: a.nome }));
    tr.appendChild(el('td', { text: formatMoeda(a.total) }));
    tr.appendChild(el('td', { text: String(Object.keys(a.transp).length) }));
    var tdBar = el('td', { style: 'width:25%' });
    tdBar.appendChild(barraHorizontal(a.total, maiorAud, '#4a3aa7'));
    tr.appendChild(tdBar);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  cardAud.appendChild(el('div', { class: 'table-wrap' }, [tbl]));
  container.appendChild(cardAud);

  if (estado.auditor && mapaAud[estado.auditor]) {
    var detalhe = mapaAud[estado.auditor];
    var cardDet = el('div', { class: 'card' });
    cardDet.appendChild(el('h2', { text: 'Transportadoras — ' + detalhe.nome }));
    var tbl2 = el('table');
    var thead2 = el('thead'); thead2.appendChild(el('tr', {}, [el('th', { text: 'Transportadora' }), el('th', { text: 'Desconto obtido' })]));
    tbl2.appendChild(thead2);
    var tbody2 = el('tbody');
    Object.keys(detalhe.transp).sort(function (x, y) { return detalhe.transp[y] - detalhe.transp[x]; }).forEach(function (nome) {
      tbody2.appendChild(el('tr', {}, [el('td', { text: nome }), el('td', { text: formatMoeda(detalhe.transp[nome]) })]));
    });
    tbl2.appendChild(tbody2);
    cardDet.appendChild(el('div', { class: 'table-wrap' }, [tbl2]));
    container.appendChild(cardDet);
  }
}

function render() {
  document.getElementById('btn-tab-mensal').className = 'tab-btn' + (estado.aba === 'mensal' ? ' active' : '');
  document.getElementById('btn-tab-anual').className = 'tab-btn' + (estado.aba === 'anual' ? ' active' : '');
  document.getElementById('btn-tab-auditor').className = 'tab-btn' + (estado.aba === 'auditor' ? ' active' : '');
  document.getElementById('view-mensal').className = estado.aba === 'mensal' ? '' : 'hidden';
  document.getElementById('view-anual').className = estado.aba === 'anual' ? '' : 'hidden';
  document.getElementById('view-auditor').className = estado.aba === 'auditor' ? '' : 'hidden';
  document.getElementById('sel-ano').style.display = estado.aba === 'mensal' ? '' : 'none';
  if (estado.aba === 'mensal') renderMensal();
  else if (estado.aba === 'anual') renderAnual();
  else renderAuditor();
}

document.getElementById('btn-tab-mensal').onclick = function () { estado.aba = 'mensal'; render(); };
document.getElementById('btn-tab-anual').onclick = function () { estado.aba = 'anual'; render(); };
document.getElementById('btn-tab-auditor').onclick = function () { estado.aba = 'auditor'; render(); };

estado.ano = anosDisponiveis()[0] || new Date().getFullYear();
montarSelectAno();
render();
</script>
</body>
</html>`;
}

export function baixarLaudoDescontosObtidosHtml(linhas = [], historico = []) {
  const html = montarHtmlLaudoDescontosObtidos(linhas, historico);
  baixarArquivoBrowser(html, nomeArquivoLaudoDescontosObtidos(), 'text/html;charset=utf-8');
  return true;
}

/**
 * Texto pronto para colar no corpo do e-mail — resumo executivo, o laudo HTML
 * navegável vai anexado separadamente (mesmo padrão dos outros laudos do
 * sistema: texto de e-mail + arquivo anexo).
 */
export function montarEmailLaudoDescontosObtidos(linhas = []) {
  const porAno = new Map();
  linhas.forEach((l) => {
    porAno.set(l.ano, (porAno.get(l.ano) || 0) + Number(l.valor || 0));
  });
  const anos = Array.from(porAno.keys()).sort((a, b) => b - a);
  const anoRecente = anos[0];
  const anoAnterior = anos[1];
  const totalRecente = porAno.get(anoRecente) || 0;
  const totalAnterior = anoAnterior ? porAno.get(anoAnterior) : null;

  const linhasRecente = linhas.filter((l) => l.ano === anoRecente);
  const porTransp = new Map();
  linhasRecente.forEach((l) => {
    const nome = l.transportadora_nome || 'Não identificado';
    porTransp.set(nome, (porTransp.get(nome) || 0) + Number(l.valor || 0));
  });
  const top5 = Array.from(porTransp.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const assunto = `Laudo de Descontos Obtidos — ${anoRecente}`;

  let corpo = `Segue o laudo de descontos financeiros obtidos junto às transportadoras, comprovados no extrato contábil do SAP.\n\n`;
  corpo += `Total em ${anoRecente}: ${fmt(totalRecente)}\n`;
  if (totalAnterior != null) {
    const variacao = totalAnterior ? ((totalRecente - totalAnterior) / totalAnterior) * 100 : null;
    corpo += `Total em ${anoAnterior}: ${fmt(totalAnterior)}${variacao !== null ? ` (${variacao >= 0 ? '+' : ''}${variacao.toFixed(1)}%)` : ''}\n`;
  }
  corpo += `\nTop 5 transportadoras em ${anoRecente}:\n`;
  top5.forEach(([nome, valor], i) => {
    corpo += `${i + 1}. ${nome} — ${fmt(valor)}\n`;
  });
  corpo += `\nO laudo completo, navegável (por mês e por transportadora), está anexado em HTML — pode ser aberto em qualquer navegador, sem precisar de acesso ao sistema.`;

  return { assunto, corpo };
}
