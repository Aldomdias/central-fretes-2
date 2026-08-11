const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = (v, casas = 3) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const parseDetalhes = (v) => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return {}; } };
const kv = (label, value, classe = '') => `<div class="kv"><span>${esc(label)}</span><strong class="${classe}">${esc(value)}</strong></div>`;
const bloco = (titulo, conteudo) => `<div class="detail-box"><h3>${esc(titulo)}</h3>${conteudo}</div>`;

export function identificadorCteAuditoria(row = {}, indice = 0) {
  return String(row.chave_cte || row.numero_cte || row.id || `cte-${indice}`);
}

export function cteDivergenteAuditoria(row = {}, ehDivergente) {
  const calculado = Number(row.valor_calculado || 0);
  if (!(calculado > 0)) return false;
  return ehDivergente(Number(row.diferenca ?? (Number(row.valor_cte || 0) - calculado)), calculado);
}

function detalheCte(row, diferenca, ocultarCobrancaAMenor = false) {
  const det = parseDetalhes(row.detalhes_calculo);
  const base = det.componentes_base || det.base_frete || {};
  const taxas = det.taxas || {};
  const tabelaValidada = typeof row.transportadora_validada_atual === 'boolean'
    ? row.transportadora_validada_atual
    : Boolean(row.origem_validada ?? det.origem_validada ?? det.tabela_validada);
  const calculado = Number(row.valor_calculado || 0);
  const resumo = bloco('Resumo do cálculo', [
    kv('Chave do CT-e', row.chave_cte || 'Não informada'),
    kv('Fatura', row.tem_fatura ? ((row.numeros_fatura || []).join(', ') || 'Com fatura') : 'Sem fatura'),
    kv('Validação da tabela', tabelaValidada ? 'Tabela validada' : 'Validação pendente'),
    kv('Motor', 'AMD'),
    kv('Tabela usada', row.transportadora_tabela || det.transportadora_tabela || row.transportadora || '-'),
    kv('Rota/cotação', det.rota_nome || det.rota || '-'), kv('Peso considerado', `${numero(det.peso_considerado ?? row.peso)} kg`),
    kv('Valor da NF', dinheiro(row.valor_nf ?? det.valor_nf)), kv('Frete cobrado', dinheiro(row.valor_cte)),
    kv('Cálculo AMD', calculado > 0 ? dinheiro(calculado) : 'Sem cálculo'), kv('Diferença', ocultarCobrancaAMenor ? dinheiro(0) : dinheiro(diferenca), ocultarCobrancaAMenor ? '' : 'erro'),
  ].join(''));
  const frete = bloco('Base do frete', [
    kv('Percentual aplicado', `${numero(base.percentualAplicado ?? base.percentual_aplicado, 2)}%`),
    kv('Valor percentual', dinheiro(base.valorPercentualCalculado ?? base.valor_percentual)),
    kv('R$/kg aplicado', dinheiro(base.rsKgAplicado ?? base.valor_kg_aplicado)),
    kv('Frete mínimo rota', dinheiro(base.minimoRota ?? base.frete_minimo_rota)),
    kv('Frete mínimo cotação', dinheiro(base.freteMinimoCotacao ?? base.frete_minimo_cotacao)),
    kv('Mínimo aplicável', dinheiro(base.minimoAplicavel ?? base.minimo_aplicavel)),
    kv('Componente vencedor', base.componenteBase || base.componente_vencedor || det.componente_base || '-'),
    kv('Valor base', dinheiro(det.valor_base ?? base.valorBase)),
  ].join(''));
  const total = bloco('ICMS e totalização', [
    kv('Subtotal sem ICMS', dinheiro(det.subtotal ?? det.subtotal_sem_icms ?? base.subtotal)),
    kv('Alíquota ICMS', `${numero(det.aliquota_icms ?? base.aliquotaIcms, 2)}%`),
    kv('Origem da alíquota', det.origem_aliquota_icms || base.origemAliquotaIcms || '-'),
    kv('ICMS', dinheiro(det.icms ?? base.icms)), kv('Total calculado', dinheiro(calculado)),
  ].join(''));
  const taxasHtml = bloco('Taxas', [['Ad Valorem', taxas.adValorem], ['GRIS', taxas.gris], ['Pedágio', taxas.pedagio], ['TAS', taxas.tas], ['CTRC', taxas.ctrc], ['TDA', taxas.tda], ['TDE', taxas.tde], ['TDR', taxas.tdr], ['TRT', taxas.trt], ['Suframa', taxas.suframa], ['Outras', taxas.outras], ['Taxa extra', taxas.taxaExtra]].map(([l, v]) => kv(l, dinheiro(v))).join(''));
  return `${resumo}${frete}${total}${taxasHtml}`;
}

export function gerarHtmlLaudoAuditoriaCtes(rows = [], { competencia = '', observacao = '', mostrarCobrancaAMenor = false } = {}) {
  if (!rows.length) throw new Error('Selecione ao menos um CT-e incorreto para gerar o laudo.');
  const transportadoras = [...new Set(rows.map((r) => r.transportadora).filter(Boolean))].join(', ');
  const soma = (campo) => rows.reduce((s, r) => s + Number(r[campo] || 0), 0);
  const totalDiferenca = rows.reduce((s, r) => {
    const diferenca = Number(r.diferenca ?? (Number(r.valor_cte || 0) - Number(r.valor_calculado || 0)));
    return s + (!mostrarCobrancaAMenor && diferenca < 0 ? 0 : diferenca);
  }, 0);
  const linhas = rows.map((r, index) => {
    const calculado = Number(r.valor_calculado || 0);
    const diferenca = Number(r.diferenca ?? (Number(r.valor_cte || 0) - calculado));
    const ocultarCobrancaAMenor = !mostrarCobrancaAMenor && diferenca < 0;
    const diferencaPublica = ocultarCobrancaAMenor ? 0 : diferenca;
    const statusPublico = ocultarCobrancaAMenor || diferencaPublica === 0
      ? 'OK'
      : diferencaPublica > 0 ? 'COBRADO ACIMA' : 'COBRADO ABAIXO';
    const faturaTexto = r.tem_fatura ? ((r.numeros_fatura || []).join(', ') || 'Com fatura') : 'Sem fatura';
    const tabelaValidada = Boolean(r.origem_validada ?? parseDetalhes(r.detalhes_calculo).origem_validada ?? parseDetalhes(r.detalhes_calculo).tabela_validada);
    const id = `detalhe-${index}`;
    return `<tr class="cte-row" onclick="toggleDetail('${id}')"><td>${esc(r.numero_cte || '-')}</td><td>${esc(r.transportadora || '-')}</td><td>${esc(`${r.cidade_origem || '-'}/${r.uf_origem || '-'} → ${r.cidade_destino || '-'}/${r.uf_destino || '-'}`)}</td><td>${numero(r.peso)} kg</td><td>${dinheiro(r.valor_cte)}</td><td>${calculado > 0 ? dinheiro(calculado) : 'Sem cálculo'}</td><td class="${statusPublico === 'OK' ? '' : 'erro'}">${dinheiro(diferencaPublica)}</td><td><span class="status ${statusPublico === 'OK' ? 'status-ok' : 'status-revisar'}">${statusPublico}</span></td></tr><tr id="${id}" class="detail-row"><td colspan="8"><div class="detail-panel"><div class="detail-title"><strong>Detalhes do cálculo — CT-e ${esc(r.numero_cte || '-')}</strong><span>${esc(r.chave_cte || '')}</span></div><div class="detail-grid">${detalheCte(r, diferenca, ocultarCobrancaAMenor)}</div>${r.motivo_sem_calculo ? `<p class="motivo"><b>Ponto para verificação:</b> ${esc(r.motivo_sem_calculo)}</p>` : ''}<p class="acao"><b>Ação solicitada:</b> verificar a emissão e os valores deste CT-e. Caso a cobrança esteja incorreta e o documento ainda esteja dentro do prazo legal, solicitamos o cancelamento do CT-e e a reemissão correta. Se o cancelamento não for aplicável, favor informar a tratativa adequada.</p></div></td></tr>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Laudo de divergências de CT-e</title><style>body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,sans-serif}.page{max-width:1180px;margin:24px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}header{padding:28px 32px;background:#06183d;color:#fff}header h1{margin:0 0 8px}header p{margin:4px 0;color:#cbd5e1}.resumo{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:20px 32px;background:#f8fafc}.card{padding:12px;border:1px solid #dbe3ef;border-radius:9px}.card small{display:block;color:#64748b;margin-bottom:5px}.card strong{font-size:18px}.intro,.lista{padding:20px 32px}.lista h2{margin-top:0}.note{padding:10px 12px;background:#eff6ff;color:#1e3a8a;border-radius:7px;margin-bottom:10px}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;background:#f1f5f9;padding:9px;border-bottom:1px solid #cbd5e1}td{padding:9px;border-bottom:1px solid #e2e8f0;vertical-align:top}.cte-row{cursor:pointer}.cte-row:hover{background:#eff6ff}.erro{color:#b91c1c}.detail-row{display:none}.detail-row.open{display:table-row}.detail-row>td{padding:0 8px 14px;background:#f8fafc}.detail-panel{border:1px solid #cbd5e1;border-radius:9px;background:#fff;padding:14px}.detail-title{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}.detail-title span{font-size:10px;color:#64748b;overflow-wrap:anywhere}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:10px}.detail-box{padding:11px;border:1px solid #e2e8f0;border-radius:8px;background:#fbfdff}.detail-box h3{font-size:13px;margin:0 0 7px}.kv{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid #edf2f7}.kv span{color:#64748b}.kv strong{text-align:right;overflow-wrap:anywhere}.motivo,.acao{margin:10px 0 0;padding:11px;border-radius:7px}.motivo{background:#fef3c7}.acao{background:#fff7ed;color:#7c2d12}footer{padding:18px 32px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0}@media(max-width:700px){.resumo,.detail-grid{grid-template-columns:1fr}}@media print{body{background:#fff}.page{margin:0;border:0}.detail-row{display:table-row}.detail-panel{break-inside:avoid}}</style></head><body><main class="page"><header><h1>Laudo de divergências de CT-e</h1><p>${esc(transportadoras || 'Transportador')}</p><p>Competência: ${esc(competencia || 'não informada')} · Gerado em ${esc(new Date().toLocaleString('pt-BR'))}</p></header><div class="resumo"><div class="card"><small>CT-es incorretos</small><strong>${rows.length}</strong></div><div class="card"><small>Total cobrado</small><strong>${dinheiro(soma('valor_cte'))}</strong></div><div class="card"><small>Total cálculo AMD</small><strong>${dinheiro(soma('valor_calculado'))}</strong></div><div class="card"><small>Diferença total</small><strong class="erro">${dinheiro(totalDiferenca)}</strong></div></div><div class="intro"><p>Prezados, identificamos divergências nos CT-es abaixo. Solicitamos a conferência individual de cada documento e o retorno com a tratativa.</p>${observacao ? `<p><b>Observação:</b> ${esc(observacao)}</p>` : ''}</div><section class="lista"><h2>CT-es com divergência</h2><div class="note">Clique em um CT-e para abrir ou fechar os detalhes do cálculo AMD.</div><table><thead><tr><th>CT-e</th><th>Transportadora</th><th>Rota</th><th>Peso</th><th>Cobrado</th><th>Cálculo AMD</th><th>Diferença</th><th>Status</th></tr></thead><tbody>${linhas}</tbody></table></section><footer>Documento gerado pela Central Fretes para conferência do transportador.</footer></main><script>function toggleDetail(id){var el=document.getElementById(id);if(el)el.classList.toggle('open')}</script></body></html>`;
}

export function baixarHtmlLaudoAuditoriaCtes(rows, opcoes = {}) {
  const blob = new Blob([gerarHtmlLaudoAuditoriaCtes(rows, opcoes)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `laudo-ctes-incorretos-${opcoes.competencia || new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
