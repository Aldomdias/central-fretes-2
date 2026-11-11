// Laudo visual do Diagnostico de faturas: um HTML autonomo (abre no navegador, imprime em PDF) com o
// recorte da tela. Resume quanto ja foi pago, quanto esta programado no financeiro (protocolo com
// previsao de pagamento) e quanto segue em tratativa, agrupado pela proxima acao.
import { previsaoPagamento, proximaAcao, situacaoPagamento } from './diagnosticoFaturas.js';

const inativa = (f) => ['CANCELADA', 'SUBSTITUIDA'].includes(f.status);
const iso = (v) => (v ? String(v).slice(0, 10) : '');
const escapar = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Situacao de cada fatura no laudo. Canceladas e nao localizadas ficam fora do total (so contadas).
export function dadosDoLaudo(linhas = []) {
  const itens = [];
  let canceladas = 0;
  let naoLocalizadas = 0;
  linhas.forEach((l) => {
    const f = l.fatura;
    if (!f) { naoLocalizadas += 1; return; }
    if (inativa(f)) { canceladas += 1; return; }
    const valor = Number(f.valor_fatura || 0);
    const paga = situacaoPagamento(f).startsWith('PAGA');
    const prev = previsaoPagamento(f);
    const cat = paga ? 'PAGA' : prev ? 'PROGRAMADA' : 'TRAT';
    itens.push({
      n: String(l.numero || f.numero_fatura || ''),
      transportadora: f.transportadora || '',
      venc: iso(f.data_vencimento),
      valor,
      pago: paga ? Number(f.valor_pago ?? valor) || valor : 0,
      dpag: iso(f.data_pagamento),
      prev,
      ctes: Number(f.ctes_totais || 0),
      cat,
      acao: cat === 'PAGA' ? 'Nenhuma (paga)' : cat === 'PROGRAMADA' ? 'Aguardar pagamento' : proximaAcao(l),
    });
  });
  return { itens, canceladas, naoLocalizadas };
}

// Roda dentro do HTML gerado (e serializado com toString): so usa os parametros e o DOM.
/* eslint-disable */
function renderLaudo(DADOS, HOJE) {
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = (v) => (v ? (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0,0') + '%';
  const br = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '-');
  const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const soma = (ls, k) => ls.reduce((s, x) => s + x[k || 'valor'], 0);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const $ = (id) => document.getElementById(id);
  const ROT = { PAGA: 'Paga', PROGRAMADA: 'Programada', TRAT: 'Em tratativa' };
  const variasTransp = new Set(DADOS.map((x) => x.transportadora)).size > 1;
  const total = soma(DADOS);
  const pagas = DADOS.filter((x) => x.cat === 'PAGA');
  const prog = DADOS.filter((x) => x.cat === 'PROGRAMADA');
  const trat = DADOS.filter((x) => x.cat === 'TRAT');
  const grupos = [
    { id: 'PAGA', nome: 'Pago', cor: 'var(--s-pago)', ls: pagas, valor: soma(pagas, 'pago') },
    { id: 'PROGRAMADA', nome: 'Programado no financeiro', cor: 'var(--s-prog)', ls: prog, valor: soma(prog) },
    { id: 'TRAT', nome: 'Em tratativa', cor: 'var(--s-trat)', ls: trat, valor: soma(trat) },
  ];
  const base = grupos.reduce((s, g) => s + g.valor, 0) || 1;
  const atraso = (x) => (x.cat !== 'PAGA' && x.venc && x.venc < HOJE ? dias(x.venc, HOJE) : 0);
  const numeros = (ls) => ls.map((x) => esc(x.n)).join(', ');

  $('m-base').innerHTML = '<strong>' + DADOS.length + '</strong> faturas · ' + DADOS.reduce((s, x) => s + x.ctes, 0).toLocaleString('pt-BR') + ' CT-es';

  const tiles = $('tiles');
  const tile = (lbl, val, sub, cor) => {
    const t = document.createElement('div');
    t.className = 'tile';
    t.innerHTML = '<span class="lbl">' + lbl + '</span><span class="val num">' + val + '</span><span class="sub num">' + sub + '</span>';
    if (cor) t.style.setProperty('--tile', cor);
    tiles.append(t);
  };
  tile('Valor total', brl(total), DADOS.length + ' faturas');
  grupos.forEach((g) => tile(g.nome, brl(g.valor), g.ls.length + ' fatura(s) · ' + pct(g.valor / base) + ' do total', g.cor));

  const tip = $('tip');
  const mostrar = (x, y, html) => { tip.innerHTML = html; tip.style.opacity = 1; tip.style.left = Math.min(window.innerWidth - 270, x + 12) + 'px'; tip.style.top = (y + 14) + 'px'; };
  const esconder = () => { tip.style.opacity = 0; };
  const stack = $('stack');
  grupos.filter((g) => g.valor > 0).forEach((g) => {
    const s = document.createElement('div');
    s.className = 'seg num';
    s.tabIndex = 0;
    s.style.flex = g.valor + ' 1 0';
    s.style.background = g.cor;
    s.setAttribute('aria-label', g.nome + ': ' + brl(g.valor) + ', ' + pct(g.valor / base));
    s.innerHTML = '<span>' + pct(g.valor / base) + '</span>';
    const html = '<strong>' + g.nome + '</strong><br>' + brl(g.valor) + ' · ' + pct(g.valor / base) + '<br>' + g.ls.length + ' fatura(s)';
    s.addEventListener('mousemove', (e) => mostrar(e.clientX, e.clientY, html));
    s.addEventListener('mouseleave', esconder);
    s.addEventListener('focus', () => { const r = s.getBoundingClientRect(); mostrar(r.left, r.bottom - 10, html); });
    s.addEventListener('blur', esconder);
    stack.append(s);
  });
  $('legend').innerHTML = grupos.map((g) => '<span><i style="background:' + g.cor + '"></i>' + g.nome + ' <strong class="num">' + brl(g.valor) + '</strong></span>').join('');
  const resolvido = grupos[0].valor + grupos[1].valor;
  $('comp-txt').innerHTML = 'Pago ou já programado: <strong class="num">' + brl(resolvido) + '</strong> (' + pct(resolvido / base) + '). Ainda em tratativa: <strong class="num">' + brl(grupos[2].valor) + '</strong> (' + pct(grupos[2].valor / base) + ') em ' + trat.length + ' fatura(s).';

  const barra = (titulo, valor, max, cor, detalhe) => '<div class="rowbar"><span class="t">' + titulo + '</span><span class="v num">' + brl(valor) + '</span>'
    + '<span class="bar"><b style="width:' + (max ? (valor / max) * 100 : 0) + '%;background:' + cor + '"></b></span><span class="d num">' + detalhe + '</span></div>';

  const porData = new Map();
  prog.forEach((x) => porData.set(x.prev, (porData.get(x.prev) || []).concat(x)));
  const datas = [...porData].sort((a, b) => a[0].localeCompare(b[0]));
  const maxProg = Math.max(0, ...datas.map((d) => soma(d[1])));
  $('prog').innerHTML = datas.length
    ? datas.map(([d, ls]) => barra('Pagamento previsto ' + br(d), soma(ls), maxProg, 'var(--s-prog)', ls.length + ' fatura(s): ' + numeros(ls))).join('')
    : '<p class="vazio">Nenhuma fatura com previsão de pagamento neste recorte.</p>';

  const porMotivo = new Map();
  trat.forEach((x) => porMotivo.set(x.acao, (porMotivo.get(x.acao) || []).concat(x)));
  const motivos = [...porMotivo].sort((a, b) => soma(b[1]) - soma(a[1]));
  const maxTrat = Math.max(0, ...motivos.map((m) => soma(m[1])));
  $('trat').innerHTML = motivos.length
    ? motivos.map(([m, ls]) => {
      const maxAtraso = Math.max(0, ...ls.map(atraso));
      return barra(esc(m), soma(ls), maxTrat, 'var(--s-trat)', ls.length + ' fatura(s): ' + numeros(ls) + (maxAtraso ? ' · <span class="late">até ' + maxAtraso + ' dias vencidas</span>' : ''));
    }).join('')
    : '<p class="vazio">Nada em tratativa neste recorte.</p>';

  const vencidas = DADOS.filter((x) => atraso(x) > 0);
  const vencTrat = vencidas.filter((x) => x.cat === 'TRAT');
  const vencProg = vencidas.filter((x) => x.cat === 'PROGRAMADA');
  const aVencerProg = prog.filter((x) => !atraso(x));
  $('callout').innerHTML = vencidas.length
    ? '<strong>Vencidas e não pagas: ' + vencidas.length + ' fatura(s), <span class="num">' + brl(soma(vencidas)) + '</span>.</strong> '
      + (vencTrat.length ? vencTrat.length + ' segue(m) em tratativa (<span class="num">' + brl(soma(vencTrat)) + '</span>), a mais antiga com ' + Math.max(...vencTrat.map(atraso)) + ' dias de atraso. ' : '')
      + (vencProg.length ? vencProg.length + (vencProg.length === 1 ? ' já está programada' : ' já estão programadas') + ' (<span class="num">' + brl(soma(vencProg)) + '</span>). ' : '')
      + (aVencerProg.length ? 'As demais ' + aVencerProg.length + ' programadas (<span class="num">' + brl(soma(aVencerProg)) + '</span>) ainda não venceram.' : '')
    : '<strong>Nenhuma fatura vencida em aberto neste recorte.</strong>';

  if (variasTransp) $('th-transp').hidden = false;
  const FILTROS = [{ id: '', t: 'Todas' }, { id: 'PAGA', t: 'Pagas' }, { id: 'PROGRAMADA', t: 'Programadas' }, { id: 'TRAT', t: 'Em tratativa' }];
  const ordem = { TRAT: 0, PROGRAMADA: 1, PAGA: 2 };
  let filtro = '';
  const fbox = $('filters');
  const desenhar = () => {
    const ls = DADOS.filter((x) => !filtro || x.cat === filtro)
      .sort((a, b) => ordem[a.cat] - ordem[b.cat] || a.venc.localeCompare(b.venc) || a.n.localeCompare(b.n, 'pt-BR', { numeric: true }));
    $('tbody').innerHTML = ls.map((x) => {
      const at = atraso(x);
      const quando = x.cat === 'PAGA' ? 'Pago em ' + br(x.dpag) : x.prev ? 'Previsto ' + br(x.prev) : '-';
      return '<tr><td class="num"><strong>' + esc(x.n) + '</strong></td>' + (variasTransp ? '<td>' + esc(x.transportadora) + '</td>' : '')
        + '<td><span class="pill p-' + x.cat + '">' + ROT[x.cat] + '</span></td><td class="num">' + br(x.venc) + '</td>'
        + '<td class="r num">' + (at ? '<span class="late">' + at + ' d</span>' : '-') + '</td><td class="r num">' + brl(x.valor) + '</td>'
        + '<td class="num" style="white-space:nowrap">' + quando + '</td><td class="r num">' + x.ctes + '</td><td>' + esc(x.acao) + '</td></tr>';
    }).join('');
    $('tf-lbl').colSpan = variasTransp ? 5 : 4;
    $('tf-lbl').textContent = ls.length + ' fatura(s)';
    $('tf-val').textContent = brl(soma(ls));
    [...fbox.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === filtro)));
  };
  FILTROS.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = f.t + ' (' + (f.id ? DADOS.filter((x) => x.cat === f.id).length : DADOS.length) + ')';
    b.dataset.id = f.id;
    b.addEventListener('click', () => { filtro = f.id; desenhar(); });
    fbox.append(b);
  });
  desenhar();
}
/* eslint-enable */

const CSS = `/* Laudo gerencial: faixa de resumo -> barra de composição -> programação -> tratativas -> tabela. */
:root {
  --bg: #f3f5f9;
  --surface: #ffffff;
  --ink: #0b1a3a;
  --ink-2: #4a5672;
  --ink-3: #7a849a;
  --line: #dfe4ee;
  --accent: #071d49;
  --s-pago: #2a78d6;
  --s-trat: #eb6834;
  --s-prog: #1baf7a;
  --warn-bg: #fff4ec;
  --late: #b4232a;
  --font-display: "Archivo", "Segoe UI", system-ui, sans-serif;
  --font-body: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0e1424; --surface: #161e33; --ink: #eef1f8; --ink-2: #b6bfd3; --ink-3: #8a94ab; --line: #2a3450;
    --accent: #9fb6ff; --s-pago: #3987e5; --s-trat: #d95926; --s-prog: #199e70; --warn-bg: #2b1d17; --late: #ff8a8f;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0e1424; --surface: #161e33; --ink: #eef1f8; --ink-2: #b6bfd3; --ink-3: #8a94ab; --line: #2a3450;
  --accent: #9fb6ff; --s-pago: #3987e5; --s-trat: #d95926; --s-prog: #199e70; --warn-bg: #2b1d17; --late: #ff8a8f;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 16px; line-height: 1.45; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 32px 20px 56px; display: grid; gap: 28px; }
h1, h2, h3 { font-family: var(--font-display); text-wrap: balance; margin: 0; }
h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.01em; }
h2 { font-size: 19px; font-weight: 700; }
.num { font-variant-numeric: tabular-nums; }
header { display: grid; gap: 8px; border-bottom: 3px solid var(--accent); padding-bottom: 18px; }
.kicker { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); }
.meta { color: var(--ink-2); font-size: 14px; display: flex; flex-wrap: wrap; gap: 6px 18px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: grid; gap: 4px; border-top: 4px solid var(--tile, var(--accent)); }
.tile .lbl { font-size: 14px; color: var(--ink-2); font-weight: 600; }
.tile .val { font-family: var(--font-display); font-size: 26px; font-weight: 800; }
.tile .sub { font-size: 13px; color: var(--ink-3); }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px; display: grid; gap: 14px; }
.panel > p { margin: 0; color: var(--ink-2); max-width: 70ch; }
.stack { display: flex; gap: 2px; height: 46px; border-radius: 6px; overflow: visible; }
.seg { position: relative; border-radius: 4px; min-width: 6px; cursor: default; display: flex; align-items: center; padding: 0 10px; color: #fff; font-weight: 700; font-size: 14px; white-space: nowrap; outline-offset: 2px; }
.seg span { pointer-events: none; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 14px; color: var(--ink-2); }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--surface); padding: 8px 10px; border-radius: 6px; font-size: 13px; line-height: 1.35; opacity: 0; transition: opacity .12s; z-index: 10; max-width: 260px; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.rowbar { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: baseline; }
.rowbar .bar { grid-column: 1 / -1; height: 10px; background: var(--line); border-radius: 4px; overflow: hidden; }
.rowbar .bar b { display: block; height: 100%; border-radius: 4px; }
.rowbar .t { font-weight: 600; }
.rowbar .v { font-weight: 700; }
.rowbar .d { grid-column: 1 / -1; font-size: 13px; color: var(--ink-3); }
.list { display: grid; gap: 14px; }
.pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; border: 1px solid currentColor; }
.p-PAGA { color: var(--s-pago); }
.p-PROGRAMADA { color: var(--s-prog); }
.p-TRAT { color: var(--s-trat); }
.late { color: var(--late); font-weight: 700; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; }
.filters button { font: inherit; font-size: 14px; font-weight: 600; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink-2); cursor: pointer; }
.filters button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--surface); }
.filters button:focus-visible, .seg:focus-visible { outline: 2px solid var(--accent); }
.tablewrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3); font-weight: 700; white-space: nowrap; }
td.r, th.r { text-align: right; }
tfoot td { font-weight: 700; border-bottom: 0; }
.callout { background: var(--warn-bg); border-left: 4px solid var(--s-trat); border-radius: 8px; padding: 12px 14px; color: var(--ink); }
footer { font-size: 13px; color: var(--ink-3); }
@media (max-width: 520px) { h1 { font-size: 24px; } .tile .val { font-size: 22px; } .seg span { display: none; } }
@media (prefers-reduced-motion: reduce) { .tip { transition: none; } }
.vazio { margin: 0; color: var(--ink-3); }
@media print { .filters, .tip { display: none; } body { background: #fff; } .panel, .tile { break-inside: avoid; } }
`;

// HTML completo do laudo. filtros: pares [rotulo, valor] do recorte da tela (vao para o cabecalho).
export function gerarHtmlLaudo({ linhas = [], titulo = 'Faturas', filtros = [], hoje = new Date() } = {}) {
  const { itens, canceladas, naoLocalizadas } = dadosDoLaudo(linhas);
  const hojeIso = isoLocal(hoje);
  const hojeBr = hojeIso.split('-').reverse().join('/');
  const fora = [canceladas && `${canceladas} cancelada(s)/substituída(s)`, naoLocalizadas && `${naoLocalizadas} não localizada(s) na plataforma`].filter(Boolean);
  const filtrosTexto = filtros.filter(([, v]) => v && v !== '-').map(([k, v]) => `${escapar(k)}: ${escapar(v)}`).join(' · ');
  // JSON dentro de <script>: "<" escapado para nenhum texto fechar a tag.
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laudo de faturas ${escapar(titulo)} ${hojeBr}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="kicker">Laudo de faturas · Central de Fretes</div>
    <h1>${escapar(titulo)}: situação das faturas</h1>
    <div class="meta">
      <span>Posição em <strong>${hojeBr}</strong></span>
      <span id="m-base"></span>
      ${filtrosTexto ? `<span>Recorte do Diagnóstico: ${filtrosTexto}</span>` : ''}
    </div>
  </header>
  <section class="tiles" id="tiles" aria-label="Resumo"></section>
  <section class="panel" aria-labelledby="h-comp">
    <h2 id="h-comp">Para onde foi o valor total</h2>
    <div class="stack" id="stack" role="img" aria-label="Composição do valor total por situação"></div>
    <div class="legend" id="legend"></div>
    <p id="comp-txt"></p>
  </section>
  <div class="cols">
    <section class="panel" aria-labelledby="h-prog">
      <h2 id="h-prog">Programado no financeiro, por data prevista</h2>
      <p>Faturas no protocolo com data de pagamento alinhada com o financeiro.</p>
      <div class="list" id="prog"></div>
    </section>
    <section class="panel" aria-labelledby="h-trat">
      <h2 id="h-trat">Em tratativa, sem previsão</h2>
      <p>O que ainda depende de ação, pela próxima ação de cada fatura.</p>
      <div class="list" id="trat"></div>
    </section>
  </div>
  <div class="callout" id="callout"></div>
  <section class="panel" aria-labelledby="h-tab">
    <h2 id="h-tab">Faturas</h2>
    <div class="filters" id="filters" role="group" aria-label="Filtrar por situação"></div>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Fatura</th><th id="th-transp" hidden>Transportadora</th><th>Situação</th><th>Vencimento</th><th class="r">Atraso</th><th class="r">Valor</th><th>Pago / previsto</th><th class="r">CT-es</th><th>Próxima ação</th></tr></thead>
        <tbody id="tbody"></tbody>
        <tfoot><tr><td colspan="4" id="tf-lbl"></td><td class="r num" id="tf-val"></td><td colspan="3"></td></tr></tfoot>
      </table>
    </div>
  </section>
  <footer>Valores da plataforma (valor da fatura; nas pagas, o valor pago). Atraso conta os dias corridos entre o vencimento e ${hojeBr}, só para faturas não pagas. "Programado" = fatura marcada para protocolo com previsão de pagamento gravada.${fora.length ? ` Fora do total: ${fora.join(' e ')}.` : ''}</footer>
</div>
<div class="tip" id="tip" role="tooltip"></div>
<script>(${renderLaudo.toString()})(${json(itens)}, ${json(hojeIso)});</script>
</body>
</html>
`;
}
