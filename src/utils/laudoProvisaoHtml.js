// Laudo da provisao de CT-es (HTML para baixar/anexar) e corpo do e-mail pronto.
// Tudo com estilo inline/simples para abrir bem no navegador e no Outlook.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const int = (v) => Number(v || 0).toLocaleString('pt-BR');
const pct = (q, t) => (t ? `${((q / t) * 100).toFixed(1).replace('.', ',')}%` : '-');
const competenciaBr = (c) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : '');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesExtenso = (c) => (c ? `${MESES[Number(c.slice(5, 7)) - 1]} de ${c.slice(0, 4)}` : '');

const ROTULOS = { NO_MES: 'Lançado no mês', APOS_MES: 'Lançado após o mês', NAO_LANCADO: 'Não lançado' };
const CORES = { NO_MES: '#15803d', APOS_MES: '#c2410c', NAO_LANCADO: '#b91c1c' };

function tabela(colunas, linhas, total = null) {
  const th = colunas.map((c) => `<th style="background:#1e3a8a;color:#fff;padding:8px 10px;font-size:12px;text-align:${c.dir ? 'right' : 'left'};white-space:nowrap">${esc(c.t)}</th>`).join('');
  const tr = linhas.map((l, i) => `<tr style="background:${i % 2 ? '#f1f5f9' : '#fff'}">${l.map((v, j) => `<td style="padding:7px 10px;font-size:12px;border-bottom:1px solid #e2e8f0;text-align:${colunas[j].dir ? 'right' : 'left'}">${v}</td>`).join('')}</tr>`).join('');
  const tt = total ? `<tr style="background:#dbeafe;font-weight:700">${total.map((v, j) => `<td style="padding:8px 10px;font-size:12px;text-align:${colunas[j].dir ? 'right' : 'left'}">${v}</td>`).join('')}</tr>` : '';
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid #e2e8f0;margin:6px 0 4px">${`<tr>${th}</tr>`}${tr}${tt}</table>`;
}

function tabelaEmpresas(porEmpresa, comTracking) {
  const cols = [{ t: 'Empresa' }, { t: 'Centro de custo' }, { t: 'CT-es', dir: 1 }, { t: 'Valor CT-e', dir: 1 }, ...(comTracking ? [{ t: 'NFs sem CT-e', dir: 1 }, { t: 'Frete estimado NFs', dir: 1 }, { t: 'Total a provisionar', dir: 1 }] : [])];
  const linhas = porEmpresa.map((e) => [`<b>${esc(e.empresa)}</b>`, e.cc ? esc(e.cc) : '<span style="color:#b91c1c">sem CC</span>', int(e.qtd), brl(e.valor),
    ...(comTracking ? [int(e.qtd_nf), brl(e.estimado_nf), `<b>${brl(e.valor + e.estimado_nf)}</b>`] : [])]);
  const s = porEmpresa.reduce((a, e) => ({ q: a.q + e.qtd, v: a.v + e.valor, qn: a.qn + e.qtd_nf, en: a.en + e.estimado_nf }), { q: 0, v: 0, qn: 0, en: 0 });
  return tabela(cols, linhas, ['Total Geral', '', int(s.q), brl(s.v), ...(comTracking ? [int(s.qn), brl(s.en), brl(s.v + s.en)] : [])]);
}

function totaisGerais(d) {
  const provisao = d.total.provisao.valor;
  const estimado = d.tracking ? d.tracking.total.pendente.estimado : 0;
  return { provisao, estimado, total: provisao + estimado };
}

/**
 * d: { competencia, geradoEm, origem, total, porEmpresa, porTransportadora, tracking, foraTomador }
 */
export function gerarLaudoProvisaoHtml(d) {
  const t = d.total;
  const g = totaisGerais(d);
  const card = (rot, val, sub, cor) => `<div class="card"><div class="rot">${esc(rot)}</div><div class="val" style="color:${cor}">${val}</div><div class="sub">${sub}</div></div>`;
  const situacoes = tabela(
    [{ t: 'Situação' }, { t: 'CT-es', dir: 1 }, { t: '% dos CT-es', dir: 1 }, { t: 'Valor', dir: 1 }],
    [
      ['Emitidos na competência', int(t.geral.qtd), '100,0%', brl(t.geral.valor)],
      ...Object.keys(ROTULOS).map((k) => [`<span style="color:${CORES[k]};font-weight:700">${ROTULOS[k]}</span>`, int(t[k]?.qtd), pct(t[k]?.qtd, t.geral.qtd), brl(t[k]?.valor)]),
    ],
    ['PROVISÃO (após o mês + não lançado)', int(t.provisao.qtd), pct(t.provisao.qtd, t.geral.qtd), brl(t.provisao.valor)],
  );
  const transp = tabela(
    [{ t: 'Transportadora' }, { t: 'Emitidos', dir: 1 }, { t: 'Lançado no mês', dir: 1 }, { t: 'Após o mês', dir: 1 }, { t: 'Não lançado', dir: 1 }, { t: 'Provisão (valor)', dir: 1 }],
    (d.porTransportadora || []).slice(0, 25).map((x) => [esc(x.nome), int(x.geral.qtd), int(x.NO_MES?.qtd), int(x.APOS_MES?.qtd), int(x.NAO_LANCADO?.qtd), `<b>${brl(x.provisao.valor)}</b>`]),
  );
  let tracking = '';
  if (d.tracking) {
    const tt = d.tracking.total;
    const z = { qtd: 0, valor_nf: 0, estimado: 0 };
    const lin = (rot, o, est = true) => [rot, int(o.qtd), pct(o.qtd, tt.geral.qtd), brl(o.valor_nf), est ? brl(o.estimado) : '-'];
    tracking = `
      <h2>Tracking do mês x CT-e</h2>
      <p class="nota">NFs do tracking com data na competência (canceladas/devolvidas desconsideradas: ${int(d.tracking.canceladas)}). Frete estimado pelo % de frete real da transportadora no mês (CT-es da base sobre o valor das NFs).</p>
      ${tabela([{ t: 'Indicador' }, { t: 'NFs', dir: 1 }, { t: '% das NFs', dir: 1 }, { t: 'Valor NF', dir: 1 }, { t: 'Frete estimado', dir: 1 }], [
        lin('NFs no tracking', tt.geral, false),
        lin('Com CT-e na base', tt.COM_CTE || z, false),
        lin('<b style="color:#b91c1c">Sem CT-e vinculado</b>', tt.SEM_CTE || z),
        lin('<b style="color:#c2410c">CT-e fora da base (não veio da Sefaz)</b>', tt.CTE_FORA_BASE || z),
        lin('Frete por NFS-e (informativo)', tt.NFSE || z),
        lin('CT-e emitido após o mês (competência seguinte, informativo)', tt.CTE_MES_SEGUINTE || z, false),
        lin('Transportadora não cadastrada no SAP (informativo)', tt.SEM_TRANSPORTADORA || z, false),
      ], ['A PROVISIONAR (sem CT-e + fora da base)', int(tt.pendente.qtd), pct(tt.pendente.qtd, tt.geral.qtd), brl(tt.pendente.valor_nf), brl(tt.pendente.estimado)])}
      <h3>Transportadoras com mais NFs pendentes</h3>
      ${tabela([{ t: 'Transportadora (tracking)' }, { t: 'NFs', dir: 1 }, { t: 'Pendentes', dir: 1 }, { t: '% pendente', dir: 1 }, { t: 'Frete estimado', dir: 1 }],
        (d.tracking.porTransportadora || []).filter((x) => x.pendente.qtd > 0).slice(0, 15).map((x) => [esc(x.nome), int(x.geral.qtd), int(x.pendente.qtd), pct(x.pendente.qtd, x.geral.qtd), brl(x.pendente.estimado)]))}`;
  }
  const fora = d.foraTomador?.qtd ? `
      <h2>CT-es fora da provisão</h2>
      <p class="nota">EBAZAR e tomadores fora do grupo (só entram CPX, ITR, GP Pneus, GRIP e Cantu) ou sem tomador.</p>
      ${tabela([{ t: 'Tomador' }, { t: 'CT-es', dir: 1 }, { t: 'Valor', dir: 1 }], d.foraTomador.porTomador.slice(0, 15).map((x) => [esc(x.nome), int(x.qtd), brl(x.valor)]), ['Total', int(d.foraTomador.qtd), brl(d.foraTomador.valor)])}` : '';

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Laudo de provisão de fretes — ${esc(competenciaBr(d.competencia))}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a}
  .pagina{max-width:1100px;margin:24px auto;background:#fff;border-radius:14px;box-shadow:0 4px 18px rgba(15,23,42,.08);overflow:hidden}
  .topo{background:linear-gradient(135deg,#1e3a8a,#312e81);color:#fff;padding:26px 32px}
  .topo h1{margin:0;font-size:24px}.topo p{margin:6px 0 0;opacity:.85;font-size:13px}
  .conteudo{padding:24px 32px 32px}
  h2{font-size:17px;color:#1e3a8a;border-bottom:2px solid #dbeafe;padding-bottom:6px;margin:28px 0 8px}
  h3{font-size:14px;color:#334155;margin:18px 0 4px}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin:4px 0 8px}
  .card{flex:1;min-width:190px;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;background:#f8fafc}
  .card .rot{font-size:12px;color:#64748b}.card .val{font-size:24px;font-weight:800;margin-top:4px}.card .sub{font-size:12px;color:#475569;margin-top:2px}
  .destaque{background:#ede9fe;border-color:#c4b5fd}
  .nota{font-size:12px;color:#64748b;margin:2px 0 6px}
  .criterios{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;font-size:12px;color:#475569;line-height:1.6}
  .rodape{font-size:11px;color:#94a3b8;margin-top:24px}
  @media print{body{background:#fff}.pagina{box-shadow:none;margin:0;max-width:none}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}
</style></head>
<body><div class="pagina">
  <div class="topo">
    <h1>Laudo de provisão de fretes (CT-e)</h1>
    <p>Competência ${esc(mesExtenso(d.competencia))} · gerado em ${esc(d.geradoEm)}${d.origem ? ` · ${esc(d.origem)}` : ''}</p>
  </div>
  <div class="conteudo">
    <div class="cards">
      ${card('CT-es emitidos na competência', int(t.geral.qtd), brl(t.geral.valor), '#1e3a8a')}
      ${card('Lançado no mês', int(t.NO_MES?.qtd), `${brl(t.NO_MES?.valor)} · ${pct(t.NO_MES?.qtd, t.geral.qtd)}`, '#15803d')}
      ${card('Provisão de CT-es', int(t.provisao.qtd), `${brl(t.provisao.valor)} · ${pct(t.provisao.qtd, t.geral.qtd)}`, '#7c3aed')}
      ${d.tracking ? card('NFs sem CT-e (estimado)', int(d.tracking.total.pendente.qtd), brl(g.estimado), '#b91c1c') : ''}
    </div>
    <div class="cards"><div class="card destaque"><div class="rot">TOTAL A PROVISIONAR${d.tracking ? ' (CT-es + estimado das NFs sem CT-e)' : ''}</div><div class="val" style="color:#5b21b6">${brl(g.total)}</div></div></div>

    <h2>Provisão por empresa / centro de custo</h2>
    ${tabelaEmpresas(d.porEmpresa || [], Boolean(d.tracking))}

    <h2>Situação dos CT-es emitidos</h2>
    ${situacoes}

    <h2>Provisão por transportadora (25 maiores)</h2>
    ${transp}
    ${tracking}
    ${fora}

    <h2>Critérios</h2>
    <div class="criterios">
      • Competência = data de emissão do CT-e.<br>
      • Lançado = CT-e com partida própria no SAP (CNPJ do emitente + número + série). Data de lançamento até o fim do mês = lançado no mês.<br>
      • Provisão = CT-es lançados depois do mês + CT-es não lançados, pelo valor do CT-e.<br>
      • Só CT-es com tomador do grupo (CPX, ITR, GP Pneus, GRIP, Cantu); EBAZAR fica fora.<br>
      • Empresa pelo CNPJ do tomador, pela empresa do lançamento SAP, pelo nome do tomador ou pela filial emitente da NF; centro de custo conforme a empresa.<br>
      ${d.tracking ? '• Tracking: NF sem CT-e = sem chave de CT-e e não achada pela chave da NF na base; NFS-e e “transportadora não cadastrada no SAP” ficam fora do total.<br>' : ''}
    </div>
    <div class="rodape">Central de Fretes · Auditoria de Fretes</div>
  </div>
</div></body></html>`;
}

export function corpoEmailProvisao(d) {
  const t = d.total;
  const g = totaisGerais(d);
  const linhaKpi = (rot, val, cor = '#0f172a') => `<tr><td style="padding:6px 12px;font-size:13px;color:#475569;border-bottom:1px solid #e2e8f0">${rot}</td><td style="padding:6px 12px;font-size:13px;font-weight:700;color:${cor};text-align:right;border-bottom:1px solid #e2e8f0">${val}</td></tr>`;
  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;max-width:760px">
  <p style="font-size:14px">Olá,</p>
  <p style="font-size:14px">Segue a provisão de fretes (CT-e) da competência <b>${esc(mesExtenso(d.competencia))}</b>. O laudo completo está anexo.</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;min-width:420px;margin:10px 0">
    <tr><td colspan="2" style="background:#1e3a8a;color:#fff;padding:8px 12px;font-size:13px;font-weight:700">Resumo</td></tr>
    ${linhaKpi('CT-es emitidos na competência', `${int(t.geral.qtd)} · ${brl(t.geral.valor)}`)}
    ${linhaKpi('Lançados no mês', `${int(t.NO_MES?.qtd)} · ${brl(t.NO_MES?.valor)}`, '#15803d')}
    ${linhaKpi('Provisão de CT-es (após o mês + não lançados)', `${int(t.provisao.qtd)} · ${brl(t.provisao.valor)}`, '#7c3aed')}
    ${d.tracking ? linhaKpi('NFs do tracking sem CT-e (frete estimado)', `${int(d.tracking.total.pendente.qtd)} · ${brl(g.estimado)}`, '#b91c1c') : ''}
    <tr><td style="padding:8px 12px;font-size:14px;font-weight:700;background:#ede9fe">Total a provisionar</td><td style="padding:8px 12px;font-size:15px;font-weight:800;color:#5b21b6;text-align:right;background:#ede9fe">${brl(g.total)}</td></tr>
  </table>
  <p style="font-size:14px;margin:16px 0 4px"><b>Por empresa / centro de custo</b></p>
  ${tabelaEmpresas(d.porEmpresa || [], Boolean(d.tracking))}
  <p style="font-size:12px;color:#64748b;margin-top:10px">Competência = emissão do CT-e. Lançado = partida própria no SAP. Só tomadores do grupo (CPX, ITR, GP Pneus, GRIP, Cantu); EBAZAR fora.</p>
  <p style="font-size:14px;margin-top:18px">Atenciosamente,<br>Auditoria de Fretes</p>
</div>`;
}

export function nomeLaudoProvisao(competencia) {
  return `laudo-provisao-fretes-${competencia}.html`;
}

export const assuntoEmailProvisao = (competencia) => `Provisão de fretes (CT-e) - competência ${competenciaBr(competencia)}`;
