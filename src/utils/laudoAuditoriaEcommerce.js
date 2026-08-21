function numero(valor) { return Number(valor || 0); }
function moeda(valor) { return numero(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function inteiro(valor) { return numero(valor).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function decimal(valor, casas = 2) { return numero(valor).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); }
function percentual(valor) { return `${numero(valor).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function escapar(valor) { return String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

function competencia(data) {
  if (!data) return 'Sem competência';
  const valor = new Date(data);
  if (Number.isNaN(valor.getTime())) return 'Sem competência';
  return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}`;
}

function agrupar(itens, obterChave) {
  const mapa = new Map();
  itens.forEach((item) => {
    const chave = obterChave(item) || 'Não identificado';
    const atual = mapa.get(chave) || { nome: chave, pedidos: 0, desvios: 0, perda: 0, pago: 0, ideal: 0 };
    atual.pedidos += 1;
    atual.pago += numero(item.valorPago);
    atual.ideal += numero(item.valorIdeal);
    if (numero(item.perda) > 0) { atual.desvios += 1; atual.perda += numero(item.perda); }
    mapa.set(chave, atual);
  });
  return [...mapa.values()].map((item) => ({ ...item, perda: Number(item.perda.toFixed(2)) }));
}

export function consolidarLaudoAuditoriaEcommerce(itens = []) {
  const desvios = itens.filter((item) => numero(item.perda) > 0);
  const totalPago = itens.reduce((soma, item) => soma + numero(item.valorPago), 0);
  const totalIdeal = itens.reduce((soma, item) => soma + numero(item.valorIdeal), 0);
  const perda = desvios.reduce((soma, item) => soma + numero(item.perda), 0);
  const comPeso = desvios.filter((item) => item.diferencaPeso);
  const comCampanha = desvios.filter((item) => item.campanha);
  const comTributo = desvios.filter((item) => numero(item.adicionalTributario) > 0);
  return {
    totalPedidos: itens.length, totalDesvios: desvios.length,
    totalPago: Number(totalPago.toFixed(2)), totalIdeal: Number(totalIdeal.toFixed(2)), perda: Number(perda.toFixed(2)),
    perdaPercentual: totalPago > 0 ? (perda / totalPago) * 100 : 0,
    comPeso: { quantidade: comPeso.length, perda: Number(comPeso.reduce((s, i) => s + numero(i.perda), 0).toFixed(2)) },
    comCampanha: { quantidade: comCampanha.length, perda: Number(comCampanha.reduce((s, i) => s + numero(i.perda), 0).toFixed(2)), descontos: Number(comCampanha.reduce((s, i) => s + numero(i.descontoCampanha), 0).toFixed(2)) },
    comTributo: { quantidade: comTributo.length, perda: Number(comTributo.reduce((s, i) => s + numero(i.perda), 0).toFixed(2)), adicionais: Number(comTributo.reduce((s, i) => s + numero(i.adicionalTributario), 0).toFixed(2)) },
    pesoInconsistente: itens.filter((item) => item.pesoPossivelmenteInconsistente).length,
    competencias: agrupar(itens, (item) => competencia(item.dataCriacao)).sort((a, b) => a.nome.localeCompare(b.nome)),
    transportadoras: agrupar(itens, (item) => item.transportadoraUsada).sort((a, b) => b.perda - a.perda).slice(0, 10),
    origens: agrupar(itens, (item) => item.origemUsada).sort((a, b) => b.perda - a.perda).slice(0, 10),
    principais: [...desvios].sort((a, b) => numero(b.perda) - numero(a.perda)).slice(0, 50),
  };
}

function linhasRanking(itens) {
  return itens.map((item) => `<tr><td>${escapar(item.nome)}</td><td>${inteiro(item.pedidos)}</td><td>${inteiro(item.desvios)}</td><td class="money">${moeda(item.perda)}</td></tr>`).join('');
}

export function gerarHtmlLaudoAuditoriaEcommerce(itens = [], opcoes = {}) {
  const r = consolidarLaudoAuditoriaEcommerce(itens);
  const titulo = opcoes.titulo || 'Laudo de Auditoria E-commerce';
  const cenario = opcoes.cenario === 'faturado' ? 'Peso faturado — cenário financeiro' : 'Peso cotado — decisão da venda';
  const comps = r.competencias.map((item) => item.nome).filter((nome) => nome !== 'Sem competência');
  const periodo = opcoes.periodo || (comps.length ? `${comps[0]} a ${comps[comps.length - 1]}` : 'Período não informado');
  const linhasCompetencia = r.competencias.map((item) => `<tr><td>${escapar(item.nome)}</td><td>${inteiro(item.pedidos)}</td><td>${moeda(item.pago)}</td><td>${moeda(item.ideal)}</td><td>${inteiro(item.desvios)}</td><td class="money">${moeda(item.perda)}</td><td>${percentual(item.pago ? item.perda / item.pago * 100 : 0)}</td></tr>`).join('');
  const linhasDetalhe = r.principais.map((item) => `<tr><td>${escapar(item.pedido || '-')}</td><td>${escapar(competencia(item.dataCriacao))}</td><td>${escapar(item.transportadoraUsada || '-')}</td><td>${escapar(item.transportadoraIdeal || '-')}</td><td>${decimal(item.pesoCotado)} kg</td><td>${decimal(item.pesoFaturado)} kg</td><td>${item.campanha ? 'Sim' : 'Não'}</td><td>${moeda(item.adicionalTributario)}</td><td>${moeda(item.valorPago)}</td><td>${moeda(item.valorIdeal)}</td><td class="money">${moeda(item.perda)}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title><style>
  :root{--navy:#071b49;--blue:#1d4ed8;--red:#b91c1c;--muted:#64748b;--line:#dbe3ef;--soft:#f5f8fc}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;margin:0;background:#eef2f7;font-size:12px}.page{width:1120px;margin:24px auto;background:#fff;padding:36px 42px;box-shadow:0 8px 30px #0002}.header{border-bottom:4px solid var(--navy);padding-bottom:18px;display:flex;justify-content:space-between;gap:24px}.eyebrow{color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:.08em}.header h1{font-size:28px;color:var(--navy);margin:5px 0}.meta{text-align:right;color:var(--muted);line-height:1.65}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0}.card{border:1px solid var(--line);border-radius:9px;padding:13px;background:var(--soft)}.card span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;font-weight:700}.card strong{display:block;font-size:20px;color:var(--navy);margin-top:5px}.card.danger strong{color:var(--red)}h2{font-size:17px;color:var(--navy);margin:24px 0 9px;border-left:4px solid var(--blue);padding-left:9px}.callout{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:13px;line-height:1.55}.causas{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.causa{border:1px solid var(--line);border-radius:8px;padding:12px}.causa strong{display:block;font-size:17px;color:var(--navy);margin:4px 0}.causa small{color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:10px}th{background:var(--navy);color:#fff;text-align:left;padding:7px 6px}td{border-bottom:1px solid var(--line);padding:6px;vertical-align:top}.money{font-weight:700;color:var(--red)}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}.note{color:var(--muted);font-size:10px;line-height:1.5}.footer{margin-top:24px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:9px}.print{position:fixed;right:22px;top:18px;background:var(--blue);color:#fff;border:0;border-radius:6px;padding:10px 16px;cursor:pointer}@media print{body{background:#fff}.page{width:auto;margin:0;padding:18px;box-shadow:none}.print{display:none}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}@page{size:A4 landscape;margin:9mm}}
  </style></head><body><button class="print" onclick="window.print()">Imprimir / Salvar PDF</button><main class="page">
  <div class="header"><div><div class="eyebrow">AMD Log • Parecer técnico-financeiro</div><h1>${escapar(titulo)}</h1><div>${escapar(periodo)} • ${escapar(cenario)}</div></div><div class="meta">Emitido em ${escapar(new Date().toLocaleString('pt-BR'))}<br>${inteiro(r.totalPedidos)} pedidos analisados<br>${inteiro(r.totalDesvios)} desvios financeiros</div></div>
  <div class="cards"><div class="card"><span>Valor pago auditado</span><strong>${moeda(r.totalPago)}</strong></div><div class="card"><span>Valor ideal calculado</span><strong>${moeda(r.totalIdeal)}</strong></div><div class="card danger"><span>Desvio recuperável / evitável</span><strong>${moeda(r.perda)}</strong></div><div class="card"><span>Desvio sobre o pago</span><strong>${percentual(r.perdaPercentual)}</strong></div></div>
  <h2>Conclusão executiva</h2><div class="callout">No recorte analisado, foram identificados <strong>${inteiro(r.totalDesvios)} pedidos com oportunidade financeira</strong>, totalizando <strong>${moeda(r.perda)}</strong>. O valor representa ${percentual(r.perdaPercentual)} do frete pago auditado. O montante é uma oportunidade técnica apurada pela comparação entre o custo real e a alternativa ideal disponível na malha; a recuperação efetiva depende de validação documental e contratual.</div>
  <h2>Principais vetores do desvio</h2><div class="causas"><div class="causa">Divergência de peso<strong>${moeda(r.comPeso.perda)}</strong><small>${inteiro(r.comPeso.quantidade)} desvios relacionados • ${inteiro(r.pesoInconsistente)} pesos com possível inconsistência</small></div><div class="causa">Campanhas de frete<strong>${moeda(r.comCampanha.perda)}</strong><small>${inteiro(r.comCampanha.quantidade)} desvios • ${moeda(r.comCampanha.descontos)} em descontos informados</small></div><div class="causa">Adicionais tributários<strong>${moeda(r.comTributo.adicionais)}</strong><small>${inteiro(r.comTributo.quantidade)} desvios com adicional • perda associada ${moeda(r.comTributo.perda)}</small></div></div>
  <h2>Evolução por competência</h2><table><thead><tr><th>Competência</th><th>Pedidos</th><th>Pago</th><th>Ideal</th><th>Desvios</th><th>Oportunidade</th><th>% sobre pago</th></tr></thead><tbody>${linhasCompetencia || '<tr><td colspan="7">Sem dados.</td></tr>'}</tbody></table>
  <div class="grid2"><div><h2>Transportadoras utilizadas</h2><table><thead><tr><th>Transportadora</th><th>Pedidos</th><th>Desvios</th><th>Oportunidade</th></tr></thead><tbody>${linhasRanking(r.transportadoras)}</tbody></table></div><div><h2>Origens utilizadas</h2><table><thead><tr><th>Origem</th><th>Pedidos</th><th>Desvios</th><th>Oportunidade</th></tr></thead><tbody>${linhasRanking(r.origens)}</tbody></table></div></div>
  <h2>Principais ocorrências</h2><table><thead><tr><th>Pedido</th><th>Competência</th><th>Usada</th><th>Alternativa ideal</th><th>Peso cotado</th><th>Peso faturado</th><th>Campanha</th><th>Adic. tributário</th><th>Pago</th><th>Ideal</th><th>Desvio</th></tr></thead><tbody>${linhasDetalhe || '<tr><td colspan="11">Nenhum desvio no recorte.</td></tr>'}</tbody></table>
  <h2>Metodologia e ressalvas</h2><p class="note">O laudo considera apenas pedidos com ressimulação concluída (status OK) e respeita o cenário de peso e todos os filtros ativos na tela. “Desvio” é reconhecido quando a transportadora efetivamente usada difere da alternativa ideal e o custo real supera o valor simulado. Peso, campanha e adicional tributário são marcadores associados à ocorrência; não devem ser interpretados isoladamente como causa comprovada. Recomenda-se anexar CT-e, pedido, memória de cálculo, tabela vigente e regra da campanha antes de formalizar contestação ou cobrança.</p>
  <div class="footer">Documento gerado pela Auditoria E-commerce AMD Log. Base sujeita à qualidade do cruzamento Pedido → Tracking → CT-e e à vigência das tabelas cadastradas.</div></main></body></html>`;
}

export function abrirLaudoAuditoriaEcommerce(itens = [], opcoes = {}) {
  const janela = window.open('', '_blank', 'width=1280,height=900');
  if (!janela) throw new Error('O navegador bloqueou a abertura do laudo. Libere pop-ups e tente novamente.');
  janela.document.open(); janela.document.write(gerarHtmlLaudoAuditoriaEcommerce(itens, opcoes)); janela.document.close(); janela.focus();
}
