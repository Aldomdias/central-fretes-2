// Meta de lancamento de CT-e no mes (ex.: 95%). Mede o que estava DISPONIVEL para lancar:
// CT-es da competencia que ja tinham entrado na base da plataforma (created_at) ate o corte
// (fim do ultimo dia do mes, horario de Brasilia) x os que foram lancados no SAP dentro do mes.
// CT-e que so chegou depois do corte (ex.: Verum/Sefaz atrasou) nao conta contra a meta.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const int = (v) => Number(v || 0).toLocaleString('pt-BR');
const pctTxt = (v) => `${Number(v || 0).toFixed(1).replace('.', ',')}%`;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesExtenso = (c) => (c ? `${MESES[Number(c.slice(5, 7)) - 1]} de ${c.slice(0, 4)}` : '');
const dataBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export function ultimoDiaCompetencia(competencia) {
  const [a, m] = competencia.split('-').map(Number);
  return `${competencia}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
}

// Dia (AAAA-MM-DD) em horario de Brasilia de um timestamp.
function diaBrasilia(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const b = new Date(d.getTime() - 3 * 3600 * 1000);
  return b.toISOString().slice(0, 10);
}

/**
 * itens: CT-es classificados da competencia (todos, nao so a provisao), com created_at e situacao.
 * corte: AAAA-MM-DD (inclusive, horario de Brasilia). meta: % (ex.: 95).
 */
export function calcularMetaLancamento(itens = [], competencia, corte = ultimoDiaCompetencia(competencia), meta = 95) {
  const vazio = () => ({ qtd: 0, valor: 0 });
  const somar = (a, c) => { a.qtd += 1; a.valor += Number(c.valor_cte || 0); };
  const total = vazio(); const totalNoMes = vazio();
  const disp = vazio(); const dispNoMes = vazio(); const dispNaoNoMes = vazio();
  const depois = vazio(); const depoisNoMes = vazio(); const semData = vazio();
  const chegadaPorDia = new Map();
  const pendentesPorTransp = new Map();
  for (const c of itens) {
    const noMes = c.situacao === 'NO_MES';
    somar(total, c); if (noMes) somar(totalNoMes, c);
    const dia = c.created_at ? diaBrasilia(c.created_at) : '';
    if (!dia) somar(semData, c);
    // Disponivel: entrou na base ate o corte, ou foi lancado no mes (se lancou, estava disponivel).
    // Sem data de entrada: conta como disponivel (conservador).
    const disponivel = !dia || dia <= corte || noMes;
    if (disponivel) {
      somar(disp, c);
      if (noMes) somar(dispNoMes, c);
      else {
        somar(dispNaoNoMes, c);
        const nome = c.transportadora || '(sem nome)';
        const t = pendentesPorTransp.get(nome) || { nome, qtd: 0, valor: 0 };
        t.qtd += 1; t.valor += Number(c.valor_cte || 0);
        pendentesPorTransp.set(nome, t);
      }
    } else {
      somar(depois, c);
      if (noMes) somar(depoisNoMes, c);
      const ch = chegadaPorDia.get(dia) || { dia, qtd: 0, valor: 0, lancadosNoMes: 0 };
      ch.qtd += 1; ch.valor += Number(c.valor_cte || 0); if (noMes) ch.lancadosNoMes += 1;
      chegadaPorDia.set(dia, ch);
    }
  }
  const pct = (a, b) => (b.qtd ? (a.qtd / b.qtd) * 100 : 0);
  const pctMeta = pct(dispNoMes, disp);
  return {
    competencia, corte, meta,
    total, totalNoMes, pctBruto: pct(totalNoMes, total),
    disponiveis: disp, disponiveisNoMes: dispNoMes, disponiveisNaoLancados: dispNaoNoMes,
    pctMeta, atingiu: pctMeta >= meta,
    chegaramDepois: depois, chegaramDepoisLancadosNoMes: depoisNoMes, semDataEntrada: semData,
    chegadaPorDia: [...chegadaPorDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    pendentesPorTransportadora: [...pendentesPorTransp.values()].sort((a, b) => b.qtd - a.qtd),
  };
}

export function gerarLaudoMetaHtml(m, { geradoEm = new Date().toLocaleString('pt-BR'), origem = '' } = {}) {
  const corBarra = m.atingiu ? '#15803d' : '#b91c1c';
  const largura = Math.max(0, Math.min(100, m.pctMeta));
  const tabela = (cols, linhas, total) => `<table><tr>${cols.map((c) => `<th class="${c.d ? 'd' : ''}">${esc(c.t)}</th>`).join('')}</tr>${linhas.map((l) => `<tr>${l.map((v, i) => `<td class="${cols[i].d ? 'd' : ''}">${v}</td>`).join('')}</tr>`).join('')}${total ? `<tr class="tot">${total.map((v, i) => `<td class="${cols[i].d ? 'd' : ''}">${v}</td>`).join('')}</tr>` : ''}</table>`;
  const chegadas = m.chegadaPorDia.length ? tabela(
    [{ t: 'Entrada na base' }, { t: 'CT-es', d: 1 }, { t: 'Valor', d: 1 }],
    m.chegadaPorDia.map((c) => [dataBr(c.dia), int(c.qtd), brl(c.valor)]),
    ['Total que chegou após o corte', int(m.chegaramDepois.qtd), brl(m.chegaramDepois.valor)],
  ) : '<p class="nota">Nenhum CT-e da competência chegou depois do corte.</p>';
  const pend = m.pendentesPorTransportadora.length ? tabela(
    [{ t: 'Transportadora' }, { t: 'CT-es não lançados no mês', d: 1 }, { t: 'Valor', d: 1 }],
    m.pendentesPorTransportadora.slice(0, 20).map((t) => [esc(t.nome), int(t.qtd), brl(t.valor)]),
    ['Total', int(m.disponiveisNaoLancados.qtd), brl(m.disponiveisNaoLancados.valor)],
  ) : '<p class="nota">Todos os CT-es disponíveis foram lançados no mês.</p>';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Laudo da meta de lançamento de CT-e — ${esc(mesExtenso(m.competencia))}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a}
  .pagina{max-width:1000px;margin:24px auto;background:#fff;border-radius:14px;box-shadow:0 4px 18px rgba(15,23,42,.08);overflow:hidden}
  .topo{background:linear-gradient(135deg,#0f766e,#1e3a8a);color:#fff;padding:26px 32px}
  .topo h1{margin:0;font-size:24px}.topo p{margin:6px 0 0;opacity:.85;font-size:13px}
  .conteudo{padding:24px 32px 32px}
  h2{font-size:17px;color:#1e3a8a;border-bottom:2px solid #dbeafe;padding-bottom:6px;margin:28px 0 8px}
  .resultado{border:2px solid ${corBarra};border-radius:14px;padding:18px 22px;background:${m.atingiu ? '#f0fdf4' : '#fef2f2'}}
  .resultado .rot{font-size:13px;color:#475569}.resultado .val{font-size:44px;font-weight:800;color:${corBarra};line-height:1.1}
  .selo{display:inline-block;padding:4px 12px;border-radius:999px;background:${corBarra};color:#fff;font-weight:700;font-size:13px;margin-left:10px;vertical-align:middle}
  .barra{position:relative;height:18px;background:#e2e8f0;border-radius:999px;margin:14px 0 6px;overflow:hidden}
  .barra .ench{height:100%;width:${largura}%;background:${corBarra}}
  .barra .meta{position:absolute;top:-4px;bottom:-4px;left:${Math.min(100, m.meta)}%;width:3px;background:#0f172a}
  .leg{font-size:12px;color:#475569}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0 4px}
  .card{flex:1;min-width:200px;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;background:#f8fafc}
  .card .rot{font-size:12px;color:#64748b}.card .val{font-size:22px;font-weight:800;margin-top:4px}.card .sub{font-size:12px;color:#475569;margin-top:2px}
  table{border-collapse:collapse;width:100%;border:1px solid #e2e8f0;margin:6px 0}
  th{background:#1e3a8a;color:#fff;padding:8px 10px;font-size:12px;text-align:left}
  td{padding:7px 10px;font-size:12px;border-bottom:1px solid #e2e8f0}
  tr:nth-child(odd) td{background:#f8fafc}
  .d{text-align:right}.tot td{background:#dbeafe!important;font-weight:700}
  .nota{font-size:12px;color:#64748b}
  .criterios{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;font-size:12px;color:#475569;line-height:1.6}
  .rodape{font-size:11px;color:#94a3b8;margin-top:24px}
  @media print{body{background:#fff}.pagina{box-shadow:none;margin:0;max-width:none}}
</style></head>
<body><div class="pagina">
  <div class="topo">
    <h1>Laudo da meta de lançamento de CT-e</h1>
    <p>Competência ${esc(mesExtenso(m.competencia))} · corte em ${esc(dataBr(m.corte))} 23:59 · gerado em ${esc(geradoEm)}${origem ? ` · ${esc(origem)}` : ''}</p>
  </div>
  <div class="conteudo">
    <div class="resultado">
      <div class="rot">CT-es lançados no mês sobre os CT-es disponíveis para lançamento até ${esc(dataBr(m.corte))}</div>
      <div class="val">${pctTxt(m.pctMeta)}<span class="selo">${m.atingiu ? 'META ATINGIDA' : 'META NÃO ATINGIDA'}</span></div>
      <div class="barra"><div class="ench"></div><div class="meta"></div></div>
      <div class="leg">Meta: ${pctTxt(m.meta)} · ${int(m.disponiveisNoMes.qtd)} de ${int(m.disponiveis.qtd)} CT-es disponíveis lançados dentro do mês (${brl(m.disponiveisNoMes.valor)} de ${brl(m.disponiveis.valor)})</div>
    </div>

    <div class="cards">
      <div class="card"><div class="rot">Emitidos na competência</div><div class="val">${int(m.total.qtd)}</div><div class="sub">${brl(m.total.valor)}</div></div>
      <div class="card"><div class="rot">Disponíveis até o corte</div><div class="val" style="color:#1e3a8a">${int(m.disponiveis.qtd)}</div><div class="sub">${brl(m.disponiveis.valor)}</div></div>
      <div class="card"><div class="rot">Chegaram depois do corte</div><div class="val" style="color:#c2410c">${int(m.chegaramDepois.qtd)}</div><div class="sub">${brl(m.chegaramDepois.valor)} · não puderam ser lançados no mês</div></div>
      <div class="card"><div class="rot">Resultado bruto (todos os emitidos)</div><div class="val" style="color:#64748b">${pctTxt(m.pctBruto)}</div><div class="sub">${int(m.totalNoMes.qtd)} de ${int(m.total.qtd)} lançados no mês</div></div>
    </div>

    <h2>CT-es que chegaram depois do corte (por data de entrada na base)</h2>
    <p class="nota">Esses CT-es foram emitidos na competência, mas só ficaram disponíveis para lançamento depois de ${esc(dataBr(m.corte))} (atraso na entrega dos documentos pelo Verum/Sefaz). Por isso ficam fora do cálculo da meta.</p>
    ${chegadas}

    <h2>Disponíveis até o corte e não lançados no mês</h2>
    <p class="nota">Estes contam contra a meta.</p>
    ${pend}

    <h2>Critérios</h2>
    <div class="criterios">
      • Competência = data de emissão do CT-e. Só CT-es com tomador do grupo (CPX, ITR, GP Pneus, GRIP, Cantu); EBAZAR fora.<br>
      • Disponível para lançamento = CT-e que já estava na base da plataforma (data de entrada/importação) até ${esc(dataBr(m.corte))} às 23:59 (Brasília), ou que foi lançado dentro do mês.${m.semDataEntrada.qtd ? ` ${int(m.semDataEntrada.qtd)} CT-e(s) sem data de entrada foram considerados disponíveis.` : ''}<br>
      • Lançado no mês = CT-e com partida própria no SAP (CNPJ do emitente + número + série) com data de lançamento até o fim do mês.<br>
      • Resultado da meta = lançados no mês ÷ disponíveis até o corte.
    </div>
    <div class="rodape">Central de Fretes · Auditoria de Fretes</div>
  </div>
</div></body></html>`;
}
