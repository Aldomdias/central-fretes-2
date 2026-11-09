// Laudo completo da "Simular Saída de Transportadora": consolida o resultado da
// tela (rotas, substitutas, prazos) num documento de decisão para o Transporte —
// continuar ou não com a transportadora — e exporta em HTML imprimível (PDF) e Excel.

const TOL = 0.5; // R$ — diferenças abaixo disso são ruído

function num(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function moeda(v) { return num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function inteiro(v) { return num(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function pct(v) { return `${num(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function dias(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',')} d`;
}
function diasDelta(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  if (Math.abs(v) < 0.05) return 'igual';
  return `${v > 0 ? '+' : '−'}${dias(Math.abs(v))}`;
}
function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function arred(v) { return Math.round(num(v) * 100) / 100; }

export const NIVEL = { CRITICA: 'Crítica', ATENCAO: 'Atenção', OK: 'Sem preocupação' };
export const DECISAO = { MIGRAR: 'Migrar para substituta', MANTER_REAJUSTE: 'Manter (reajuste compensa)', MANTER_SEM_OPCAO: 'Manter (sem alternativa)' };

// Classifica uma rota já agregada pela tela (saída de agregarRotas).
export function analisarRota(linha, pctReajuste = 0) {
  const fator = 1 + num(pctReajuste) / 100;
  const viagens = linha.viagens || [];
  const custoAtual = num(linha.valorPagoTotal);
  const custoReajuste = custoAtual * fator;
  let valorDescoberto = 0; let custoSubCoberto = 0; let pagoCoberto = 0;
  for (const v of viagens) {
    if (v.substituta) { custoSubCoberto += num(v.valorSub); pagoCoberto += num(v.valorPago); } else valorDescoberto += num(v.valorPago);
  }
  const ctesDescobertos = num(linha.semSubstituto);
  const ctesCobertos = num(linha.ctes) - ctesDescobertos;
  // Migrar = CT-es cobertos vão para a substituta; os sem cobertura continuam com a atual, já reajustados.
  const custoMigrar = custoSubCoberto + valorDescoberto * fator;
  const deltaPrazo = (linha.prazoAtualMedio != null && linha.prazoSubMedio != null) ? linha.prazoSubMedio - linha.prazoAtualMedio : null;
  const substitutos = linha.substitutos || [];
  const qtd = substitutos.length;

  // alternativa que não piora prazo (a mais barata entre as que mantêm/melhoram)
  let alternativaSemPiora = null;
  if (deltaPrazo != null && deltaPrazo > 0.05 && linha.prazoAtualMedio != null) {
    alternativaSemPiora = substitutos
      .filter((s) => s.prazoMedio != null && s.prazoMedio <= linha.prazoAtualMedio + 0.05)
      .sort((a, b) => a.custoMedio - b.custoMedio)[0] || null;
  }

  let decisao;
  if (qtd === 0 || ctesCobertos <= 0) decisao = DECISAO.MANTER_SEM_OPCAO;
  else if (custoMigrar < custoReajuste - TOL) decisao = DECISAO.MIGRAR;
  else decisao = DECISAO.MANTER_REAJUSTE;

  const alertas = [];
  if (qtd === 0) alertas.push('Nenhuma transportadora cadastrada cobre a rota');
  else if (ctesDescobertos > 0) alertas.push(`${inteiro(ctesDescobertos)} de ${inteiro(linha.ctes)} CT-e(s) sem cobertura (faixa de peso/tabela)`);
  if (qtd === 1) alertas.push('Dependência de uma única substituta');
  if (deltaPrazo != null && deltaPrazo > 0.05) alertas.push(`Prazo piora ${dias(deltaPrazo)}`);
  if (qtd > 0 && ctesCobertos > 0 && custoMigrar > custoReajuste + TOL) alertas.push('Substituta mais cara que aceitar o reajuste');

  let nivel = NIVEL.OK;
  if (qtd === 0 || ctesDescobertos > 0) nivel = NIVEL.CRITICA;
  else if (alertas.length) nivel = NIVEL.ATENCAO;

  return {
    rotaKey: linha.rotaKey,
    origem: `${linha.cidadeOrigem}/${linha.ufOrigem}`,
    destino: `${linha.cidadeDestino}/${linha.ufDestino}`,
    ctes: num(linha.ctes), ctesCobertos, ctesDescobertos,
    custoAtual: arred(custoAtual), custoReajuste: arred(custoReajuste),
    custoSubstituta: arred(linha.melhorTotal), custoMigrar: arred(custoMigrar),
    custoSubCoberto: arred(custoSubCoberto), pagoCoberto: arred(pagoCoberto), valorDescoberto: arred(valorDescoberto),
    diferenca: arred(num(linha.melhorTotal) - custoAtual),
    diferencaVsReajuste: arred(custoMigrar - custoReajuste),
    prazoAtual: linha.prazoAtualMedio, prazoSub: linha.prazoSubMedio, deltaPrazo,
    substitutoPrincipal: linha.substitutoPrincipal || null,
    qtdSubstitutos: qtd, substitutos,
    alternativaSemPiora,
    decisao, nivel, alertas,
    viagens,
  };
}

export function consolidarLaudoSaida(resultado, contexto = {}) {
  const pctReajuste = num(resultado?.pctReajuste ?? contexto.reajustePct);
  const fator = 1 + pctReajuste / 100;
  const rotas = (resultado?.linhas || []).map((l) => analisarRota(l, pctReajuste));

  const soma = (lista, campo) => lista.reduce((s, r) => s + num(r[campo]), 0);
  const custoAtual = soma(rotas, 'custoAtual');
  const custoReajuste = custoAtual * fator;
  const custoSaidaTotal = soma(rotas, 'custoSubstituta'); // igual ao card da tela
  const valorDescoberto = soma(rotas, 'valorDescoberto');
  const custoCoberto = soma(rotas, 'custoSubCoberto');
  const pagoCoberto = soma(rotas, 'pagoCoberto');
  const custoHibrido = rotas.reduce((s, r) => s + (r.decisao === DECISAO.MIGRAR ? r.custoMigrar : r.custoReajuste), 0);

  const porNivel = Object.values(NIVEL).map((nivel) => {
    const lista = rotas.filter((r) => r.nivel === nivel);
    return { nivel, rotas: lista.length, ctes: soma(lista, 'ctes'), custo: arred(soma(lista, 'custoAtual')), pctCusto: custoAtual ? soma(lista, 'custoAtual') / custoAtual * 100 : 0 };
  });
  const porDecisao = Object.values(DECISAO).map((decisao) => {
    const lista = rotas.filter((r) => r.decisao === decisao);
    return { decisao, rotas: lista.length, ctes: soma(lista, 'ctes'), custoAtual: arred(soma(lista, 'custoAtual')), custoCenario: arred(lista.reduce((s, r) => s + (decisao === DECISAO.MIGRAR ? r.custoMigrar : r.custoReajuste), 0)) };
  });

  const criticas = rotas.filter((r) => r.nivel === NIVEL.CRITICA).sort((a, b) => b.custoAtual - a.custoAtual);
  const impactoPrazo = rotas.filter((r) => r.deltaPrazo != null && r.deltaPrazo > 0.05).sort((a, b) => (b.deltaPrazo - a.deltaPrazo) || (b.ctes - a.ctes));
  const ganhoPrazo = rotas.filter((r) => r.deltaPrazo != null && r.deltaPrazo < -0.05);
  const unicaOpcao = rotas.filter((r) => r.qtdSubstitutos === 1).sort((a, b) => b.custoAtual - a.custoAtual);
  const ctesPrazoPiora = soma(impactoPrazo, 'ctes');

  // Ranking de substitutas: quem assumiria o volume (melhor preço por CT-e) e onde é opção.
  const subs = new Map();
  const pegar = (nome) => {
    if (!subs.has(nome)) subs.set(nome, { transportadora: nome, ctesAssumidos: 0, rotasAssumidas: new Set(), valorAssumido: 0, pagoAtualNosCtes: 0, prazoSubSoma: 0, prazoSubN: 0, prazoAtSoma: 0, prazoAtN: 0, rotasOpcao: 0, rotasUnica: 0 });
    return subs.get(nome);
  };
  for (const r of rotas) {
    for (const s of r.substitutos) {
      const it = pegar(s.transportadora);
      it.rotasOpcao += 1;
      if (r.qtdSubstitutos === 1) it.rotasUnica += 1;
    }
    for (const v of r.viagens) {
      if (!v.substituta) continue;
      const it = pegar(v.substituta);
      it.ctesAssumidos += 1; it.rotasAssumidas.add(r.rotaKey);
      it.valorAssumido += num(v.valorSub); it.pagoAtualNosCtes += num(v.valorPago);
      if (v.prazoSub != null) { it.prazoSubSoma += num(v.prazoSub); it.prazoSubN += 1; }
      if (v.prazoAtual != null) { it.prazoAtSoma += num(v.prazoAtual); it.prazoAtN += 1; }
    }
  }
  const totalCtes = soma(rotas, 'ctes');
  const substitutas = [...subs.values()].map((s) => ({
    transportadora: s.transportadora,
    ctesAssumidos: s.ctesAssumidos,
    pctVolume: totalCtes ? s.ctesAssumidos / totalCtes * 100 : 0,
    rotasAssumidas: s.rotasAssumidas.size,
    rotasOpcao: s.rotasOpcao,
    rotasUnica: s.rotasUnica,
    valorAssumido: arred(s.valorAssumido),
    pagoAtualNosCtes: arred(s.pagoAtualNosCtes),
    variacao: arred(s.valorAssumido - s.pagoAtualNosCtes),
    variacaoPct: s.pagoAtualNosCtes ? (s.valorAssumido - s.pagoAtualNosCtes) / s.pagoAtualNosCtes * 100 : 0,
    prazoSub: s.prazoSubN ? s.prazoSubSoma / s.prazoSubN : null,
    prazoAtual: s.prazoAtN ? s.prazoAtSoma / s.prazoAtN : null,
  })).sort((a, b) => (b.ctesAssumidos - a.ctesAssumidos) || (b.rotasOpcao - a.rotasOpcao));

  const economiaSaidaTotal = custoReajuste - custoSaidaTotal;
  const economiaHibrido = custoReajuste - custoHibrido;
  const pctDescoberto = custoAtual ? valorDescoberto / custoAtual * 100 : 0;
  const rotasMigrar = porDecisao.find((d) => d.decisao === DECISAO.MIGRAR)?.rotas || 0;
  const rotasManter = rotas.length - rotasMigrar;

  let recomendacao; let tom;
  if (!rotas.length) { recomendacao = 'Sem rotas para avaliar.'; tom = 'neutro'; }
  else if (rotasMigrar === 0) {
    recomendacao = 'MANTER a transportadora e negociar o reajuste — nenhuma rota fica mais barata com as substitutas disponíveis do que aceitando o reajuste proposto.';
    tom = 'manter';
  } else if (rotasManter === 0 && valorDescoberto <= TOL) {
    recomendacao = 'SAÍDA VIÁVEL — todas as rotas têm substituta com custo menor que o reajuste proposto.';
    tom = 'sair';
  } else if (economiaHibrido > TOL) {
    recomendacao = `SAÍDA PARCIAL (cenário híbrido) — migrar ${inteiro(rotasMigrar)} rota(s) para as substitutas e manter ${inteiro(rotasManter)} rota(s) com a transportadora atual (sem alternativa ou onde o reajuste ainda compensa).`;
    tom = 'parcial';
  } else {
    recomendacao = 'MANTER a transportadora e negociar o reajuste — a economia das substitutas não compensa as rotas que ficariam sem cobertura.';
    tom = 'manter';
  }

  const pontos = [];
  pontos.push(`Custo atual no recorte: ${moeda(custoAtual)} em ${inteiro(totalCtes)} CT-es e ${inteiro(rotas.length)} rotas. Com o reajuste de ${pct(pctReajuste)}: ${moeda(custoReajuste)}.`);
  pontos.push(`Saída total (substitutas onde houver tabela): ${moeda(custoSaidaTotal)} — ${economiaSaidaTotal >= 0 ? 'economia' : 'custo adicional'} de ${moeda(Math.abs(economiaSaidaTotal))} frente a aceitar o reajuste.`);
  pontos.push(`Cenário híbrido (migra só onde compensa): ${moeda(custoHibrido)} — ${economiaHibrido >= 0 ? 'economia' : 'custo adicional'} de ${moeda(Math.abs(economiaHibrido))} frente ao reajuste.`);
  if (criticas.length) pontos.push(`${inteiro(criticas.length)} rota(s) crítica(s), com ${moeda(valorDescoberto)} (${pct(pctDescoberto)} do custo) sem substituta cadastrada — exigem cotação/nova tabela antes de uma saída.`);
  else pontos.push('Todas as rotas têm pelo menos uma substituta cadastrada.');
  if (unicaOpcao.length) pontos.push(`${inteiro(unicaOpcao.length)} rota(s) dependem de uma única substituta — validar capacidade antes de migrar.`);
  if (impactoPrazo.length) pontos.push(`${inteiro(impactoPrazo.length)} rota(s) (${inteiro(ctesPrazoPiora)} CT-es) pioram o prazo com a substituta principal; ${inteiro(impactoPrazo.filter((r) => r.alternativaSemPiora).length)} delas têm alternativa sem piora de prazo.`);
  else pontos.push('Nenhuma rota piora o prazo de tabela com a substituta principal.');
  if (ganhoPrazo.length) pontos.push(`${inteiro(ganhoPrazo.length)} rota(s) melhoram o prazo com a substituta.`);
  if (substitutas[0]) pontos.push(`Principal substituta: ${substitutas[0].transportadora}, assumindo ${inteiro(substitutas[0].ctesAssumidos)} CT-es (${pct(substitutas[0].pctVolume)} do volume) em ${inteiro(substitutas[0].rotasAssumidas)} rota(s).`);

  return {
    contexto: { ...contexto, pctReajuste },
    totais: {
      rotas: rotas.length, ctes: totalCtes, semIbge: num(resultado?.semIbge),
      custoAtual: arred(custoAtual), custoReajuste: arred(custoReajuste), custoSaidaTotal: arred(custoSaidaTotal), custoHibrido: arred(custoHibrido),
      custoCoberto: arred(custoCoberto), pagoCoberto: arred(pagoCoberto), valorDescoberto: arred(valorDescoberto), pctDescoberto,
      economiaSaidaTotal: arred(economiaSaidaTotal), economiaHibrido: arred(economiaHibrido),
      prazoAtual: resultado?.prazoAtualMedioGeral ?? null, prazoSub: resultado?.prazoSubMedioGeral ?? null,
      rotasCriticas: criticas.length, rotasPrazo: impactoPrazo.length, ctesPrazoPiora, rotasUnica: unicaOpcao.length,
      rotasMigrar, rotasManter,
    },
    recomendacao, tom, pontos,
    porNivel, porDecisao,
    rotas, criticas, impactoPrazo, unicaOpcao, substitutas,
  };
}

// ───────────────────────────── HTML ─────────────────────────────

const COR_NIVEL = { [NIVEL.CRITICA]: 'crit', [NIVEL.ATENCAO]: 'aten', [NIVEL.OK]: 'ok' };
function badge(nivel) { return `<span class="badge ${COR_NIVEL[nivel] || ''}">${esc(nivel)}</span>`; }
function corDif(v) { return v > TOL ? 'neg' : (v < -TOL ? 'pos' : ''); }
function sinal(v) { return v > TOL ? `+${moeda(v)}` : (v < -TOL ? `−${moeda(-v)}` : '—'); }

export function gerarHtmlLaudoSaida(resultado, contexto = {}) {
  const L = consolidarLaudoSaida(resultado, contexto);
  const t = L.totais;
  const c = L.contexto;
  const titulo = `Laudo de Saída de Transportadora — ${c.transportadora || ''}`;
  const emitido = c.geradoEm ? new Date(c.geradoEm) : new Date();

  // Laudo: resposta + números, resumo por situação e uma lista para cada
  // situação (sem substituta, mais cara, prazo maior, substituta única).
  // O detalhamento completo por rota/CT-e fica no Excel.
  const MAX_LINHAS = 60;
  const MAX_SUBS = 15;
  const porCusto = (a, b) => b.custoAtual - a.custoAtual;
  const grupos = {
    sem: L.rotas.filter((r) => r.qtdSubstitutos === 0 || r.ctesDescobertos > 0).sort(porCusto),
    cara: L.rotas.filter((r) => r.qtdSubstitutos > 0 && r.ctesDescobertos === 0 && r.diferenca > TOL).sort((a, b) => b.diferenca - a.diferenca),
    barata: L.rotas.filter((r) => r.qtdSubstitutos > 0 && r.ctesDescobertos === 0 && r.diferenca < -TOL).sort((a, b) => a.diferenca - b.diferenca),
    prazo: L.impactoPrazo,
    unica: L.unicaOpcao,
  };
  const somaG = (lista, campo) => lista.reduce((acc, r) => acc + num(r[campo]), 0);
  const linhaResumo = (rotulo, lista, ancora) => `<tr><td><a href="#${ancora}">${esc(rotulo)}</a></td><td class="c">${inteiro(lista.length)}</td><td class="c">${inteiro(somaG(lista, 'ctes'))}</td><td class="r">${moeda(somaG(lista, 'custoAtual'))}</td><td class="r">${moeda(somaG(lista, 'custoSubstituta'))}</td><td class="r ${corDif(somaG(lista, 'custoSubstituta') - somaG(lista, 'custoAtual'))}">${sinal(somaG(lista, 'custoSubstituta') - somaG(lista, 'custoAtual'))}</td></tr>`;
  const tabResumo = [
    linhaResumo('Sem substituta (total ou parcial)', grupos.sem, 'sem'),
    linhaResumo('Substituta mais cara que hoje', grupos.cara, 'cara'),
    linhaResumo('Substituta mais barata que hoje', grupos.barata, 'barata'),
    linhaResumo('Prazo maior com a substituta', grupos.prazo, 'prazo'),
    linhaResumo('Dependem de uma única substituta', grupos.unica, 'unica'),
  ].join('');
  const cortar = (lista) => lista.slice(0, MAX_LINHAS);
  const notaCorte = (lista) => (lista.length > MAX_LINHAS ? `<p class="small">Mostrando ${MAX_LINHAS} de ${inteiro(lista.length)}. A lista completa está no Excel.</p>` : '');
  const rota = (r) => `${esc(r.origem)} → ${esc(r.destino)}`;
  const tabSem = cortar(grupos.sem).map((r) => `<tr><td>${rota(r)}</td><td class="c">${inteiro(r.ctes)}</td><td class="c">${inteiro(r.ctesDescobertos)}</td><td class="r">${moeda(r.custoAtual)}</td><td class="r">${moeda(r.valorDescoberto)}</td><td>${r.qtdSubstitutos ? esc(r.substitutos.map((x) => x.transportadora).join(', ')) : '<span class="neg">nenhuma</span>'}</td></tr>`).join('');
  const tabDif = (lista) => cortar(lista).map((r) => `<tr><td>${rota(r)}</td><td class="c">${inteiro(r.ctes)}</td><td class="r">${moeda(r.custoAtual)}</td><td class="r">${moeda(r.custoSubstituta)}</td><td class="r ${corDif(r.diferenca)}">${sinal(r.diferenca)}</td><td>${esc(r.substitutoPrincipal || '—')}</td><td class="c">${inteiro(r.qtdSubstitutos)}</td><td class="c">${dias(r.prazoAtual)} → ${dias(r.prazoSub)}</td></tr>`).join('');
  const tabPrazo = cortar(grupos.prazo).map((r) => `<tr><td>${rota(r)}</td><td class="c">${inteiro(r.ctes)}</td><td class="c">${dias(r.prazoAtual)}</td><td class="c">${dias(r.prazoSub)}</td><td class="c neg"><strong>${diasDelta(r.deltaPrazo)}</strong></td><td>${esc(r.substitutoPrincipal || '—')}</td><td>${r.alternativaSemPiora ? `${esc(r.alternativaSemPiora.transportadora)} · ${dias(r.alternativaSemPiora.prazoMedio)} · ${moeda(r.alternativaSemPiora.custoMedio)}/CT-e` : '<span class="muted">sem alternativa</span>'}</td></tr>`).join('');
  const tabUnica = cortar(grupos.unica).map((r) => `<tr><td>${rota(r)}</td><td class="c">${inteiro(r.ctes)}</td><td class="r">${moeda(r.custoAtual)}</td><td>${esc(r.substitutos[0]?.transportadora || '—')}</td><td class="r">${moeda(r.custoSubstituta)}</td><td class="r ${corDif(r.diferenca)}">${sinal(r.diferenca)}</td><td class="c">${dias(r.prazoAtual)} → ${dias(r.prazoSub)}</td></tr>`).join('');
  const subsComVolume = L.substitutas.filter((x) => x.ctesAssumidos > 0);
  const tabSubs = subsComVolume.slice(0, MAX_SUBS).map((s) => `<tr><td><strong>${esc(s.transportadora)}</strong></td><td class="c">${inteiro(s.ctesAssumidos)}</td><td class="c">${pct(s.pctVolume)}</td><td class="r">${moeda(s.pagoAtualNosCtes)}</td><td class="r">${moeda(s.valorAssumido)}</td><td class="r ${corDif(s.variacao)}">${sinal(s.variacao)}</td></tr>`).join('');
  const pontos = L.pontos.slice(3); // os 3 primeiros repetem os cartões
  const vazio = (cols, txt) => `<tr><td colspan="${cols}" class="muted">${txt}</td></tr>`;
  const resumoFiltros = [
    c.filtroRotas ? `Filtro: ${c.filtroRotas}` : '',
    c.variantes?.length > 1 ? `Nomes no CT-e: ${c.variantes.join(' · ')}` : '',
    c.exclusoes?.length ? `Substitutas excluídas: ${c.exclusoes.join(', ')}` : '',
  ].filter(Boolean).join(' • ');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
:root{--navy:#071b49;--blue:#1d4ed8;--red:#b91c1c;--amber:#b45309;--green:#047857;--muted:#64748b;--line:#dbe3ef;--soft:#f5f8fc}
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;margin:0;background:#eef2f7;font-size:11.5px}
.page{max-width:1180px;margin:24px auto;background:#fff;padding:34px 40px;box-shadow:0 8px 30px #0002}
.nav{position:sticky;top:0;z-index:5;display:flex;gap:4px;flex-wrap:wrap;background:#fff;border-bottom:1px solid var(--line);padding:8px 0;margin:-14px 0 16px}
.nav a{color:var(--navy);text-decoration:none;font-weight:700;padding:5px 9px;border-radius:6px;font-size:11px}.nav a:hover{background:var(--soft)}
.header{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid var(--navy);padding-bottom:14px;margin-bottom:16px}
.eyebrow{color:var(--blue);font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase}h1{margin:4px 0;color:var(--navy);font-size:24px}
.meta{text-align:right;color:var(--muted);font-size:11px;line-height:1.6}
h2{color:var(--navy);font-size:15px;margin:26px 0 8px;border-left:4px solid var(--blue);padding-left:8px;page-break-after:avoid}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}.card{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--soft)}
.card span{display:block;color:var(--muted);font-size:10.5px;font-weight:700}.card strong{display:block;font-size:17px;color:var(--navy);margin-top:3px}.card small{color:var(--muted);font-size:10px}
.card.danger strong{color:var(--red)}.card.good strong{color:var(--green)}.card.warn strong{color:var(--amber)}
.parecer{border-radius:10px;padding:14px 16px;margin:10px 0;border:1px solid var(--line)}.parecer.manter{background:#fef2f2;border-color:#fecaca}.parecer.sair{background:#ecfdf5;border-color:#a7f3d0}.parecer.parcial{background:#fffbeb;border-color:#fde68a}
.parecer .rec{font-size:14px;font-weight:800;color:var(--navy);margin-bottom:6px}.parecer ul{margin:6px 0 0 18px;padding:0}.parecer li{margin:3px 0}
table{width:100%;border-collapse:collapse;margin:6px 0 4px}th{background:var(--navy);color:#fff;text-align:left;padding:6px 6px;font-size:10.5px}td{padding:5px 6px;border-bottom:1px solid #edf1f7;vertical-align:top}
tbody tr:nth-child(even){background:#fafbfd}.r{text-align:right;white-space:nowrap}.c{text-align:center;white-space:nowrap}.small{font-size:10px;color:#475569}
.neg{color:var(--red)}.pos{color:var(--green)}.aten-t{color:var(--amber);font-weight:700}.muted{color:var(--muted)}.star{color:#04a383;font-size:9.5px;font-weight:700}
tr.grp td{border-top:2px solid var(--line)}
.badge{display:inline-block;border-radius:10px;padding:1px 8px;font-size:9.5px;font-weight:800;white-space:nowrap}.badge.crit{background:#fee2e2;color:#991b1b}.badge.aten{background:#fef3c7;color:#92400e}.badge.ok{background:#d1fae5;color:#065f46}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}.note{background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:10px 12px;color:#334155;line-height:1.55}
.filtros td:first-child{font-weight:700;width:220px;color:var(--muted)}.footer{margin-top:26px;border-top:1px solid var(--line);padding-top:10px;color:var(--muted);font-size:10px}
.assin{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:40px}.assin div{border-top:1px solid #334155;padding-top:6px;text-align:center;color:#334155;font-size:10.5px}
.print{position:fixed;right:18px;top:18px;z-index:10;background:var(--blue);color:#fff;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px #0003}
@media print{@page{size:A4 landscape;margin:10mm}body{background:#fff;font-size:9.5px}.page{box-shadow:none;margin:0;padding:0;max-width:none}.print,.nav{display:none}h2{margin-top:16px}tr{page-break-inside:avoid}thead{display:table-header-group}.cards{grid-template-columns:repeat(4,1fr)}}
</style></head><body>
<button class="print" onclick="window.print()">Imprimir / Salvar PDF</button><button id="baixarHtml" class="print" style="display:none;top:62px;background:var(--navy)">Baixar HTML</button>
<main class="page">
<div class="header" id="resumo"><div><div class="eyebrow">Central Fretes • Saída de transportadora</div><h1>${esc(titulo)}</h1><div>${esc(c.periodo || 'Período não informado')} • Canal: ${esc(c.canal || 'Todos')} • Reajuste proposto: ${pct(c.pctReajuste)}</div>${resumoFiltros ? `<div class="small" style="margin-top:4px">${esc(resumoFiltros)}</div>` : ''}</div>
<div class="meta">Emitido em ${esc(emitido.toLocaleString('pt-BR'))}<br>${inteiro(t.ctes)} CT-es • ${inteiro(t.rotas)} rotas${c.geradoPor ? `<br>Responsável: ${esc(c.geradoPor)}` : ''}</div></div>

<nav class="nav"><a href="#resumo">Resumo</a><a href="#situacao">Por situação</a><a href="#sem">Sem substituta</a><a href="#cara">Mais cara</a><a href="#barata">Mais barata</a><a href="#prazo">Prazo maior</a><a href="#unica">Substituta única</a><a href="#substitutas">Quem assumiria</a></nav>
<div class="parecer ${L.tom}"><div class="rec">${esc(L.recomendacao)}</div>${pontos.length ? `<ul>${pontos.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div>

<div class="cards">
<div class="card"><span>Hoje (valor pago)</span><strong>${moeda(t.custoAtual)}</strong><small>${inteiro(t.ctes)} CT-es</small></div>
<div class="card danger"><span>Aceitando o reajuste (+${pct(c.pctReajuste)})</span><strong>${moeda(t.custoReajuste)}</strong><small>${sinal(t.custoReajuste - t.custoAtual)} vs. hoje</small></div>
<div class="card ${t.economiaSaidaTotal >= 0 ? 'good' : 'danger'}"><span>Trocando tudo pelas substitutas</span><strong>${moeda(t.custoSaidaTotal)}</strong><small>${t.economiaSaidaTotal >= 0 ? 'economia' : 'custo extra'} de ${moeda(Math.abs(t.economiaSaidaTotal))} vs. reajuste</small></div>
<div class="card ${t.economiaHibrido >= 0 ? 'good' : 'danger'}"><span>Trocando só onde compensa</span><strong>${moeda(t.custoHibrido)}</strong><small>${inteiro(t.rotasMigrar)} rota(s) trocam · ${inteiro(t.rotasManter)} ficam</small></div>
</div>

<h2 id="situacao">Resumo por situação</h2>
<table><thead><tr><th>Situação</th><th class="c">Rotas</th><th class="c">CT-es</th><th class="r">Pago hoje</th><th class="r">Com substituta</th><th class="r">Diferença</th></tr></thead><tbody>${tabResumo}</tbody></table>
<p class="small">Uma rota pode aparecer em mais de uma situação (ex.: mais cara e com prazo maior). Onde não há substituta, o valor "com substituta" é o pago hoje.</p>

<h2 id="sem">Sem substituta (${inteiro(grupos.sem.length)})</h2>
<table><thead><tr><th>Rota</th><th class="c">CT-es</th><th class="c">Sem cobertura</th><th class="r">Pago hoje</th><th class="r">Valor descoberto</th><th>Substitutas existentes</th></tr></thead><tbody>${tabSem || vazio(6, 'Todas as rotas têm substituta para todos os CT-es.')}</tbody></table>${notaCorte(grupos.sem)}

<h2 id="cara">Substituta mais cara que hoje (${inteiro(grupos.cara.length)})</h2>
<table><thead><tr><th>Rota</th><th class="c">CT-es</th><th class="r">Pago hoje</th><th class="r">Com substituta</th><th class="r">Diferença</th><th>Substituta principal</th><th class="c">Opções</th><th class="c">Prazo (at. → sub.)</th></tr></thead><tbody>${tabDif(grupos.cara) || vazio(8, 'Nenhuma rota fica mais cara com a substituta.')}</tbody></table>${notaCorte(grupos.cara)}

<h2 id="barata">Substituta mais barata que hoje (${inteiro(grupos.barata.length)})</h2>
<table><thead><tr><th>Rota</th><th class="c">CT-es</th><th class="r">Pago hoje</th><th class="r">Com substituta</th><th class="r">Diferença</th><th>Substituta principal</th><th class="c">Opções</th><th class="c">Prazo (at. → sub.)</th></tr></thead><tbody>${tabDif(grupos.barata) || vazio(8, 'Nenhuma rota fica mais barata com a substituta.')}</tbody></table>${notaCorte(grupos.barata)}

<h2 id="prazo">Prazo maior com a substituta — impacto de prazo (${inteiro(grupos.prazo.length)})</h2>
<table><thead><tr><th>Rota</th><th class="c">CT-es</th><th class="c">Prazo hoje</th><th class="c">Prazo substituta</th><th class="c">Variação</th><th>Substituta principal</th><th>Alternativa sem piora (prazo · custo médio)</th></tr></thead><tbody>${tabPrazo || vazio(7, 'Nenhuma rota piora o prazo com a substituta principal.')}</tbody></table>${notaCorte(grupos.prazo)}

<h2 id="unica">Dependem de uma única substituta (${inteiro(grupos.unica.length)})</h2>
<table><thead><tr><th>Rota</th><th class="c">CT-es</th><th class="r">Pago hoje</th><th>Única substituta</th><th class="r">Com substituta</th><th class="r">Diferença</th><th class="c">Prazo (at. → sub.)</th></tr></thead><tbody>${tabUnica || vazio(7, 'Nenhuma rota depende de uma única substituta.')}</tbody></table>${notaCorte(grupos.unica)}

<h2 id="substitutas">Quem assumiria o volume</h2>
<table><thead><tr><th>Transportadora</th><th class="c">CT-es</th><th class="c">% do volume</th><th class="r">Pago hoje nesses CT-es</th><th class="r">Custo pela substituta</th><th class="r">Diferença</th></tr></thead><tbody>${tabSubs || vazio(6, 'Nenhuma substituta encontrada.')}</tbody></table>
${subsComVolume.length > MAX_SUBS ? `<p class="small">Mais ${inteiro(subsComVolume.length - MAX_SUBS)} transportadora(s) com volume menor no Excel (aba Substitutas).</p>` : ''}

<div class="note" style="margin-top:18px">
<p><strong>Como ler:</strong> cada CT-e que a transportadora levou no período foi recalculado na tabela mais barata das outras transportadoras da mesma rota, com o mesmo peso e valor de NF. Onde não há substituta, fica o valor pago hoje. Rotas sem substituta precisam de cotação antes de uma saída.</p>
<p><strong>Ressalvas:</strong> valores das substitutas são preço de tabela; capacidade e qualidade de quem assumiria devem ser validadas pela operação. Prazo = prazo de tabela.${t.semIbge ? ` ${inteiro(t.semIbge)} CT-e(s) sem IBGE entraram só no custo de hoje.` : ''} Detalhe por rota, opções e CT-es: Excel.</p>
</div>
<div class="assin"><div>Elaborado por (Fretes)</div><div>Transporte</div><div>Aprovação</div></div>
</main></body></html>`;
}

function nomeArquivoBase(contexto = {}) {
  const t = String(contexto.transportadora || 'transportadora').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_');
  const d = new Date().toISOString().slice(0, 10);
  return `laudo-saida-${t}-${d}`;
}

export function abrirLaudoSaida(resultado, contexto = {}) {
  const html = gerarHtmlLaudoSaida(resultado, contexto);
  const janela = window.open('', '_blank', 'width=1280,height=900');
  if (!janela) throw new Error('O navegador bloqueou a abertura do laudo. Libere pop-ups e tente novamente.');
  janela.document.open(); janela.document.write(html); janela.document.close();
  const botao = janela.document.getElementById('baixarHtml');
  if (botao) {
    botao.style.display = 'block';
    botao.onclick = () => {
      const blob = new janela.Blob([html], { type: 'text/html;charset=utf-8' });
      const link = janela.document.createElement('a');
      link.href = janela.URL.createObjectURL(blob);
      link.download = `${nomeArquivoBase(contexto)}.html`;
      janela.document.body.appendChild(link); link.click(); link.remove();
    };
  }
  janela.focus();
}

// ───────────────────────────── Excel ─────────────────────────────

export function montarAbasExcelLaudoSaida(resultado, contexto = {}) {
  const L = consolidarLaudoSaida(resultado, contexto);
  const t = L.totais; const c = L.contexto;
  const T = (titulo, tipo = 'texto', largura = 16) => ({ titulo, tipo, largura });

  const resumo = {
    nome: 'Resumo',
    colunas: [T('Item', 'texto', 42), T('Valor', 'texto_longo', 110)],
    linhas: [
      ['Transportadora avaliada', c.transportadora || ''],
      ['Nomes unificados no CT-e', (c.variantes || []).join(' · ')],
      ['Período', c.periodo || ''], ['Canal', c.canal || 'Todos'], ['Reajuste proposto', pct(c.pctReajuste)],
      ['Substitutas excluídas', (c.exclusoes || []).join(', ') || 'nenhuma'],
      ['Filtro de origem/destino', c.filtroRotas || 'nenhum'],
      ['RECOMENDAÇÃO', L.recomendacao],
      ...L.pontos.map((p, i) => [`Ponto ${i + 1}`, p]),
      ['Rotas', inteiro(t.rotas)], ['CT-es', inteiro(t.ctes)],
      ['Custo atual', moeda(t.custoAtual)], ['Custo c/ reajuste', moeda(t.custoReajuste)],
      ['Custo saída total', moeda(t.custoSaidaTotal)], ['Custo cenário híbrido', moeda(t.custoHibrido)],
      ['Economia saída total vs. reajuste', moeda(t.economiaSaidaTotal)], ['Economia híbrido vs. reajuste', moeda(t.economiaHibrido)],
      ['Valor sem substituta', `${moeda(t.valorDescoberto)} (${pct(t.pctDescoberto)})`],
      ['Rotas críticas', inteiro(t.rotasCriticas)], ['Rotas com piora de prazo', inteiro(t.rotasPrazo)], ['Rotas com substituta única', inteiro(t.rotasUnica)],
      ['Prazo médio atual → substituta', `${dias(t.prazoAtual)} → ${dias(t.prazoSub)}`],
      ['Emitido em', new Date().toLocaleString('pt-BR')],
    ],
  };

  const rotas = {
    nome: 'Rotas',
    colunas: [T('Nível', 'centro', 16), T('Origem', 'texto', 26), T('Destino', 'texto', 26), T('CT-es', 'inteiro', 9), T('CT-es sem cobertura', 'inteiro', 12),
      T('Custo atual', 'moeda'), T('Custo c/ reajuste', 'moeda'), T('Custo c/ substituta', 'moeda'), T('Diferença vs atual', 'moeda'), T('Custo migrar', 'moeda'), T('Migrar vs reajuste', 'moeda'),
      T('Prazo atual (d)', 'numero', 11), T('Prazo subst. (d)', 'numero', 11), T('Variação prazo (d)', 'numero', 11),
      T('Substituta principal', 'texto', 28), T('Nº opções', 'inteiro', 9), T('Alternativa sem piora de prazo', 'texto', 28), T('Decisão sugerida', 'texto', 28), T('Pontos de atenção', 'texto_longo', 60)],
    linhas: L.rotas.map((r) => [r.nivel, r.origem, r.destino, r.ctes, r.ctesDescobertos, r.custoAtual, r.custoReajuste, r.custoSubstituta, r.diferenca, r.custoMigrar, r.diferencaVsReajuste,
      r.prazoAtual, r.prazoSub, r.deltaPrazo, r.substitutoPrincipal || '', r.qtdSubstitutos, r.alternativaSemPiora?.transportadora || '', r.decisao, r.alertas.join(' · ')]),
  };

  const opcoes = {
    nome: 'Opções por rota',
    colunas: [T('Origem', 'texto', 26), T('Destino', 'texto', 26), T('Transportadora', 'texto', 30), T('Principal', 'centro', 10), T('CT-es cobertos', 'inteiro', 10), T('CT-es da rota', 'inteiro', 10),
      T('Custo médio atual/CT-e', 'moeda'), T('Custo médio subst./CT-e', 'moeda'), T('Variação %', 'percentual', 11), T('Prazo atual (d)', 'numero', 11), T('Prazo subst. (d)', 'numero', 11)],
    linhas: L.rotas.flatMap((r) => r.substitutos.map((s) => {
      const media = r.ctes ? r.custoAtual / r.ctes : 0;
      return [r.origem, r.destino, s.transportadora, s.transportadora === r.substitutoPrincipal ? 'Sim' : '', s.ctesCobertos, r.ctes, media, s.custoMedio, media ? (s.custoMedio - media) / media * 100 : 0, r.prazoAtual, s.prazoMedio];
    })),
  };

  const substitutas = {
    nome: 'Substitutas',
    colunas: [T('Transportadora', 'texto', 32), T('CT-es assumidos', 'inteiro', 11), T('% volume', 'percentual', 10), T('Rotas assumidas', 'inteiro', 11), T('Rotas em que é opção', 'inteiro', 11), T('Única opção em (rotas)', 'inteiro', 11),
      T('Pago hoje nesses CT-es', 'moeda'), T('Custo pela substituta', 'moeda'), T('Variação', 'moeda'), T('Variação %', 'percentual', 11), T('Prazo atual (d)', 'numero', 11), T('Prazo subst. (d)', 'numero', 11)],
    linhas: L.substitutas.map((s) => [s.transportadora, s.ctesAssumidos, s.pctVolume, s.rotasAssumidas, s.rotasOpcao, s.rotasUnica, s.pagoAtualNosCtes, s.valorAssumido, s.variacao, s.variacaoPct, s.prazoAtual, s.prazoSub]),
  };

  const prazo = {
    nome: 'Impacto de prazo',
    colunas: [T('Origem', 'texto', 26), T('Destino', 'texto', 26), T('CT-es', 'inteiro', 9), T('Prazo atual (d)', 'numero', 11), T('Prazo subst. (d)', 'numero', 11), T('Variação (d)', 'numero', 11),
      T('Substituta principal', 'texto', 28), T('Alternativa sem piora', 'texto', 28), T('Prazo alternativa (d)', 'numero', 11), T('Custo médio alternativa', 'moeda'), T('Migrar vs reajuste', 'moeda')],
    linhas: L.impactoPrazo.map((r) => [r.origem, r.destino, r.ctes, r.prazoAtual, r.prazoSub, r.deltaPrazo, r.substitutoPrincipal || '', r.alternativaSemPiora?.transportadora || '', r.alternativaSemPiora?.prazoMedio ?? '', r.alternativaSemPiora?.custoMedio ?? '', r.diferencaVsReajuste]),
  };

  const criticas = {
    nome: 'Rotas críticas',
    colunas: [T('Origem', 'texto', 26), T('Destino', 'texto', 26), T('CT-es', 'inteiro', 9), T('CT-es sem cobertura', 'inteiro', 12), T('Custo atual', 'moeda'), T('Valor sem cobertura', 'moeda'), T('Substitutas existentes', 'texto_longo', 50), T('Decisão sugerida', 'texto', 28)],
    linhas: L.criticas.map((r) => [r.origem, r.destino, r.ctes, r.ctesDescobertos, r.custoAtual, r.valorDescoberto, r.substitutos.map((s) => s.transportadora).join(', ') || 'nenhuma', r.decisao]),
  };

  const ctes = {
    nome: 'CT-es',
    colunas: [T('Origem', 'texto', 24), T('Destino', 'texto', 24), T('Emissão', 'data', 12), T('Chave CT-e', 'texto', 48), T('Valor NF', 'moeda'), T('Peso (kg)', 'numero', 11), T('Frete pago', 'moeda'), T('Tabela atual', 'moeda'),
      T('Substituta', 'texto', 28), T('Valor substituta', 'moeda'), T('Diferença', 'moeda'), T('Prazo atual (d)', 'numero', 11), T('Prazo subst. (d)', 'numero', 11)],
    linhas: L.rotas.flatMap((r) => r.viagens.map((v) => [r.origem, r.destino, v.data || '', v.chave || '', v.nf, v.peso, v.valorPago, v.valorTabelaAtual ?? '', v.substituta || 'sem cobertura', v.valorSub ?? '', v.valorSub != null ? v.valorSub - v.valorPago : '', v.prazoAtual ?? '', v.prazoSub ?? ''])),
  };

  return [resumo, rotas, criticas, prazo, substitutas, opcoes, ctes];
}

export async function exportarExcelLaudoSaida(resultado, contexto = {}) {
  const { exportarExcelMultiAbas } = await import('./exportarExcelFormatado.js');
  return exportarExcelMultiAbas({ nomeArquivo: `${nomeArquivoBase(contexto)}.xlsx`, abas: montarAbasExcelLaudoSaida(resultado, contexto) });
}

