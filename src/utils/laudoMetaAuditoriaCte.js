// Laudo de comprovação da meta da Auditoria CT-e, montado a partir dos
// snapshots mensais (auditoria_cte_resumo_mensal) e da meta configurada.
// Evidências anexadas: imagens entram no apêndice; demais arquivos são
// listados com tamanho e hash SHA-256 para comprovar integridade.

function numero(valor) { return Number(valor || 0); }
function moeda(valor) { return numero(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function inteiro(valor) { return numero(valor).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function percentual(valor, casas = 1) {
  return `${numero(valor).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}
function escapar(valor) {
  return String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function tamanhoArquivo(bytes) {
  const b = numero(bytes);
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  if (b >= 1024) return `${(b / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`;
  return `${b} B`;
}

function taxa(parte, total) { return total > 0 ? (parte / total) * 100 : 0; }

export function consolidarLaudoMeta(resumoMensal = [], meta = {}) {
  const metaCalculo = numero(meta.taxaCalculoMeta);
  const metaAssert = numero(meta.taxaAssertividadeMeta);
  const meses = [...resumoMensal]
    .sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)))
    .map((item) => {
      const total = numero(item.total_ctes);
      const calculados = numero(item.calculados);
      const assertivos = numero(item.assertivos);
      const taxaCalculo = item.taxa_calculo != null ? numero(item.taxa_calculo) : taxa(calculados, total);
      const taxaAssert = item.taxa_assertividade != null ? numero(item.taxa_assertividade) : taxa(assertivos, calculados);
      return {
        competencia: String(item.competencia),
        total,
        calculados,
        semCalculo: numero(item.sem_calculo),
        assertivos,
        divergentes: numero(item.divergentes),
        taxaCalculo,
        taxaAssert,
        valorCte: numero(item.valor_total_cte),
        valorCalculado: numero(item.valor_total_calculado),
        divergencia: numero(item.valor_total_divergencia),
        atingiuCalculo: taxaCalculo >= metaCalculo,
        atingiuAssert: taxaAssert >= metaAssert,
      };
    });

  const soma = (campo) => meses.reduce((s, m) => s + m[campo], 0);
  const total = soma('total');
  const calculados = soma('calculados');
  const assertivos = soma('assertivos');
  const consolidado = {
    total,
    calculados,
    semCalculo: soma('semCalculo'),
    assertivos,
    divergentes: soma('divergentes'),
    taxaCalculo: taxa(calculados, total),
    taxaAssert: taxa(assertivos, calculados),
    valorCte: soma('valorCte'),
    valorCalculado: soma('valorCalculado'),
    divergencia: soma('divergencia'),
  };
  consolidado.atingiuCalculo = consolidado.taxaCalculo >= metaCalculo;
  consolidado.atingiuAssert = consolidado.taxaAssert >= metaAssert;

  return {
    meses,
    consolidado,
    metaCalculo,
    metaAssert,
    mesesCalculoOk: meses.filter((m) => m.atingiuCalculo).length,
    mesesAssertOk: meses.filter((m) => m.atingiuAssert).length,
    mesesAmbosOk: meses.filter((m) => m.atingiuCalculo && m.atingiuAssert).length,
  };
}

async function sha256(arquivo) {
  try {
    const buffer = await arquivo.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

function lerComoDataUrl(arquivo) {
  return new Promise((resolve) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result || ''));
    leitor.onerror = () => resolve('');
    leitor.readAsDataURL(arquivo);
  });
}

export async function prepararAnexosLaudo(arquivos = []) {
  const lista = [];
  for (const arquivo of arquivos) {
    const ehImagem = String(arquivo.type || '').startsWith('image/');
    lista.push({
      nome: arquivo.name,
      tipo: arquivo.type || 'arquivo',
      tamanho: arquivo.size,
      hash: await sha256(arquivo),
      dataUrl: ehImagem ? await lerComoDataUrl(arquivo) : '',
    });
  }
  return lista;
}

function selo(ok) {
  return ok ? '<span class="selo ok">✓ Atingida</span>' : '<span class="selo nok">✗ Não atingida</span>';
}

export function gerarHtmlLaudoMeta(resumoMensal = [], opcoes = {}) {
  const meta = opcoes.meta || {};
  const r = consolidarLaudoMeta(resumoMensal, meta);
  const c = r.consolidado;
  const titulo = opcoes.titulo || 'Laudo de Comprovação de Meta — Auditoria CT-e';
  const periodo = r.meses.length ? `${r.meses[0].competencia} a ${r.meses[r.meses.length - 1].competencia}` : 'Sem competências';
  const anexos = opcoes.anexos || [];
  const ambosConsolidado = c.atingiuCalculo && c.atingiuAssert;

  let conclusao;
  if (ambosConsolidado) {
    conclusao = `No período de <strong>${escapar(periodo)}</strong>, a área <strong>atingiu integralmente a meta</strong> configurada: ${percentual(c.taxaCalculo)} dos CT-es com cálculo (meta ${percentual(r.metaCalculo, 0)}) e ${percentual(c.taxaAssert)} de assertividade nos calculados (meta ${percentual(r.metaAssert, 0)}).`;
  } else if (c.atingiuCalculo) {
    conclusao = `No período de <strong>${escapar(periodo)}</strong>, a <strong>meta de cobertura de cálculo foi atingida</strong> (${percentual(c.taxaCalculo)} frente à meta de ${percentual(r.metaCalculo, 0)}, cumprida em ${r.mesesCalculoOk} de ${r.meses.length} meses). A meta de assertividade (${percentual(r.metaAssert, 0)}) não foi atingida no consolidado: ${percentual(c.taxaAssert)}.`;
  } else if (c.atingiuAssert) {
    conclusao = `No período de <strong>${escapar(periodo)}</strong>, a <strong>meta de assertividade foi atingida</strong> (${percentual(c.taxaAssert)} frente à meta de ${percentual(r.metaAssert, 0)}). A meta de cobertura de cálculo (${percentual(r.metaCalculo, 0)}) não foi atingida no consolidado: ${percentual(c.taxaCalculo)}.`;
  } else {
    conclusao = `No período de <strong>${escapar(periodo)}</strong>, as metas configuradas não foram atingidas no consolidado: cobertura de cálculo ${percentual(c.taxaCalculo)} (meta ${percentual(r.metaCalculo, 0)}) e assertividade ${percentual(c.taxaAssert)} (meta ${percentual(r.metaAssert, 0)}).`;
  }

  const maxCalculo = Math.max(100, ...r.meses.map((m) => m.taxaCalculo));
  const barras = r.meses.map((m) => `<div class="barra-linha"><span class="barra-rotulo">${escapar(m.competencia)}</span><div class="barra-trilho"><i class="${m.atingiuCalculo ? 'ok' : 'nok'}" style="width:${(m.taxaCalculo / maxCalculo) * 100}%"></i><b style="left:${(r.metaCalculo / maxCalculo) * 100}%"></b></div><span class="barra-valor">${percentual(m.taxaCalculo)}</span><div class="barra-trilho"><i class="${m.atingiuAssert ? 'ok' : 'nok'}" style="width:${m.taxaAssert}%"></i><b style="left:${r.metaAssert}%"></b></div><span class="barra-valor">${percentual(m.taxaAssert)}</span></div>`).join('');

  const linhas = r.meses.map((m) => `<tr><td><strong>${escapar(m.competencia)}</strong></td><td>${inteiro(m.total)}</td><td>${inteiro(m.calculados)}</td><td>${inteiro(m.semCalculo)}</td><td>${inteiro(m.assertivos)}</td><td>${inteiro(m.divergentes)}</td><td class="${m.atingiuCalculo ? 'tok' : 'tnok'}">${percentual(m.taxaCalculo)}</td><td class="${m.atingiuAssert ? 'tok' : 'tnok'}">${percentual(m.taxaAssert)}</td><td>${moeda(m.valorCte)}</td><td>${moeda(m.valorCalculado)}</td><td>${moeda(m.divergencia)}</td></tr>`).join('');
  const linhaTotal = `<tr class="total"><td>Consolidado</td><td>${inteiro(c.total)}</td><td>${inteiro(c.calculados)}</td><td>${inteiro(c.semCalculo)}</td><td>${inteiro(c.assertivos)}</td><td>${inteiro(c.divergentes)}</td><td class="${c.atingiuCalculo ? 'tok' : 'tnok'}">${percentual(c.taxaCalculo)}</td><td class="${c.atingiuAssert ? 'tok' : 'tnok'}">${percentual(c.taxaAssert)}</td><td>${moeda(c.valorCte)}</td><td>${moeda(c.valorCalculado)}</td><td>${moeda(c.divergencia)}</td></tr>`;

  const listaAnexos = anexos.length
    ? `<table><thead><tr><th>#</th><th>Arquivo</th><th>Tipo</th><th>Tamanho</th><th>SHA-256</th></tr></thead><tbody>${anexos.map((a, i) => `<tr><td>A${i + 1}</td><td>${escapar(a.nome)}</td><td>${escapar(a.tipo)}</td><td>${tamanhoArquivo(a.tamanho)}</td><td class="hash">${escapar(a.hash || '—')}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nenhuma evidência anexada.</p>';
  const imagens = anexos.filter((a) => a.dataUrl)
    .map((a) => `<figure><img src="${a.dataUrl}" alt="${escapar(a.nome)}"><figcaption>A${anexos.indexOf(a) + 1} — ${escapar(a.nome)}</figcaption></figure>`).join('');

  const observacoes = String(opcoes.observacoes || '').trim();

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title><style>
:root{--navy:#071b49;--green:#15803d;--red:#b91c1c;--muted:#64748b;--line:#dbe3ef}*{box-sizing:border-box}
body{font-family:Arial,sans-serif;color:#172033;margin:0;background:#eef2f7;font-size:12px}
.page{width:1120px;margin:24px auto;background:#fff;padding:36px 42px;box-shadow:0 8px 30px #0002}
.print{position:fixed;right:18px;top:18px;z-index:30;background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}
.header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid var(--navy);padding-bottom:14px;margin-bottom:18px}
.eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}
h1{color:var(--navy);margin:4px 0 6px;font-size:24px}h2{color:var(--navy);font-size:16px;margin:26px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
.meta{text-align:right;color:var(--muted);line-height:1.6}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card span{display:block;color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase}.card strong{display:block;font-size:24px;margin-top:6px;color:var(--navy)}.card small{color:var(--muted)}
.card.ok{border-color:#86efac;background:#f0fdf4}.card.ok strong{color:var(--green)}.card.nok{border-color:#fecaca;background:#fef2f2}.card.nok strong{color:var(--red)}
.callout{border-left:4px solid var(--navy);background:#f5f8fc;padding:12px 14px;line-height:1.6;font-size:13px}.callout.ok{border-color:var(--green);background:#f0fdf4}
.selo{display:inline-block;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11px}.selo.ok{background:#dcfce7;color:var(--green)}.selo.nok{background:#fee2e2;color:var(--red)}
table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border-bottom:1px solid var(--line);padding:7px 6px;text-align:left}th{background:#f5f8fc;color:var(--navy);font-size:11px}
tr.total td{font-weight:700;background:#f5f8fc;border-top:2px solid var(--navy)}.tok{color:var(--green);font-weight:700}.tnok{color:var(--red);font-weight:700}
.hash{font-family:monospace;font-size:9.5px;word-break:break-all}.muted{color:var(--muted)}
.barras-cab,.barra-linha{display:grid;grid-template-columns:80px 1fr 60px 1fr 60px;gap:10px;align-items:center;margin:5px 0}.barras-cab{font-weight:700;color:var(--muted);font-size:11px}
.barra-trilho{position:relative;height:12px;background:#eef2f7;border-radius:6px}.barra-trilho i{position:absolute;left:0;top:0;bottom:0;border-radius:6px}.barra-trilho i.ok{background:#22c55e}.barra-trilho i.nok{background:#f87171}
.barra-trilho b{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--navy)}.barra-valor{text-align:right;font-weight:700}
figure{margin:14px 0;page-break-inside:avoid}figure img{max-width:100%;border:1px solid var(--line)}figcaption{color:var(--muted);font-size:11px;margin-top:4px}
.assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:60px}.assinaturas div{border-top:1px solid #172033;padding-top:6px;text-align:center}
.footer{margin-top:28px;color:var(--muted);font-size:10px;border-top:1px solid var(--line);padding-top:8px}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;width:auto;padding:0}.print{display:none}h2{page-break-after:avoid}tr{page-break-inside:avoid}@page{size:A4 landscape;margin:12mm}}
</style></head><body><button class="print" onclick="window.print()">Imprimir / Salvar PDF</button><button id="baixarHtml" class="print" style="display:none;top:62px;background:#071b49">Baixar HTML</button><main class="page">
<div class="header"><div><div class="eyebrow">AMD Log • Auditoria de Fretes • Laudo de meta</div><h1>${escapar(titulo)}</h1><div>Período: <strong>${escapar(periodo)}</strong> • ${r.meses.length} competência(s)</div></div>
<div class="meta">Emitido em ${escapar(new Date().toLocaleString('pt-BR'))}<br>Responsável: ${escapar(opcoes.responsavel || 'Não informado')}<br>Fonte: auditoria_cte_resumo_mensal</div></div>

<h2>Meta avaliada</h2>
<p>${escapar(meta.descricao || '')}</p>
<div class="cards">
<div class="card"><span>Meta cobertura de cálculo</span><strong>${percentual(r.metaCalculo, 0)}</strong><small>CT-es com cálculo ÷ total de CT-es</small></div>
<div class="card ${c.atingiuCalculo ? 'ok' : 'nok'}"><span>Realizado no período</span><strong>${percentual(c.taxaCalculo)}</strong><small>${inteiro(c.calculados)} de ${inteiro(c.total)} CT-es • ${selo(c.atingiuCalculo)}</small></div>
<div class="card"><span>Meta assertividade</span><strong>${percentual(r.metaAssert, 0)}</strong><small>assertivos ÷ CT-es calculados</small></div>
<div class="card ${c.atingiuAssert ? 'ok' : 'nok'}"><span>Realizado no período</span><strong>${percentual(c.taxaAssert)}</strong><small>${inteiro(c.assertivos)} de ${inteiro(c.calculados)} calculados • ${selo(c.atingiuAssert)}</small></div>
</div>

<h2>Conclusão</h2>
<div class="callout ${ambosConsolidado ? 'ok' : ''}">${conclusao}<br>Meses com meta de cálculo atingida: <strong>${r.mesesCalculoOk}/${r.meses.length}</strong> • meses com meta de assertividade atingida: <strong>${r.mesesAssertOk}/${r.meses.length}</strong> • meses com ambas: <strong>${r.mesesAmbosOk}/${r.meses.length}</strong>.</div>
${observacoes ? `<h2>Observações do responsável</h2><div class="callout">${escapar(observacoes).replace(/\n/g, '<br>')}</div>` : ''}

<h2>Evolução mensal frente à meta</h2>
<div class="barras-cab"><span>Competência</span><span>% Cálculo (linha = meta ${percentual(r.metaCalculo, 0)})</span><span></span><span>% Assertividade (linha = meta ${percentual(r.metaAssert, 0)})</span><span></span></div>
${barras || '<p class="muted">Sem dados.</p>'}

<h2>Memória de cálculo por competência</h2>
<table><thead><tr><th>Competência</th><th>Total CT-es</th><th>Calculados</th><th>Sem cálculo</th><th>Assertivos</th><th>Divergentes</th><th>% Cálculo</th><th>% Assertividade</th><th>Valor CT-e</th><th>Valor calculado</th><th>Divergência</th></tr></thead>
<tbody>${linhas}${r.meses.length > 1 ? linhaTotal : ''}</tbody></table>

<h2>Metodologia</h2>
<p class="muted" style="line-height:1.6">Os números vêm dos snapshots mensais gravados pelo módulo Auditoria CT-e na tabela <code>auditoria_cte_resumo_mensal</code>. <strong>% Cálculo</strong> = CT-es com frete calculado pela tabela vigente ÷ total de CT-es da competência. <strong>% Assertividade</strong> = CT-es cujo valor cobrado bate com o calculado (dentro da tolerância configurada) ÷ CT-es calculados; CT-es sem cálculo não entram no denominador da assertividade. O consolidado do período é ponderado pelo volume (soma das quantidades), e não a média simples dos percentuais mensais.</p>

<h2>Evidências anexadas</h2>
${listaAnexos}
${imagens}

<div class="assinaturas"><div>${escapar(opcoes.responsavel || 'Responsável pela emissão')}<br><span class="muted">Auditoria de Fretes</span></div><div>Aprovação / Gestor<br><span class="muted">Nome e data</span></div></div>
<div class="footer">Documento gerado pela Central de Fretes AMD Log. Os hashes SHA-256 permitem confirmar que os arquivos de evidência não foram alterados após a emissão.</div>
</main></body></html>`;
}

export function abrirLaudoMeta(resumoMensal = [], opcoes = {}) {
  const janela = window.open('', '_blank', 'width=1280,height=900');
  if (!janela) throw new Error('O navegador bloqueou a abertura do laudo. Libere pop-ups e tente novamente.');
  const html = gerarHtmlLaudoMeta(resumoMensal, opcoes);
  janela.document.open(); janela.document.write(html); janela.document.close();
  const botao = janela.document.getElementById('baixarHtml');
  if (botao) {
    botao.style.display = 'block';
    botao.onclick = () => {
      const blob = new janela.Blob([html], { type: 'text/html;charset=utf-8' });
      const link = janela.document.createElement('a');
      link.href = janela.URL.createObjectURL(blob);
      link.download = `laudo-meta-auditoria-cte_${new Date().toISOString().slice(0, 10)}.html`;
      janela.document.body.appendChild(link); link.click(); link.remove();
    };
  }
  janela.focus();
}
