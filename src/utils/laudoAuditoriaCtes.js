const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
const dinheiro = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const numero = (v, casas = 3) =>
  Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const dataEmissao = (row = {}) => {
  const valor = String(row.data_emissao || row.emissao || row.dataEmissao || "").slice(0, 10);
  const partes = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : (valor || "Não informada");
};
const diferencaMonetaria = (row = {}) => {
  const cobrado = Number(row.valor_cte);
  const calculado = Number(row.valor_calculado);
  if (Number.isFinite(cobrado) && Number.isFinite(calculado) && calculado > 0) {
    return Math.round((cobrado - calculado + Number.EPSILON) * 100) / 100;
  }
  return Number(row.diferenca || 0);
};
const parseDetalhes = (v) => {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};
const kv = (label, value, classe = "") =>
  `<div class="kv"><span>${esc(label)}</span><strong class="${classe}">${esc(value)}</strong></div>`;
const bloco = (titulo, conteudo) =>
  `<div class="detail-box"><h3>${esc(titulo)}</h3>${conteudo}</div>`;

export function identificadorCteAuditoria(row = {}, indice = 0) {
  return String(row.chave_cte || row.numero_cte || row.id || `cte-${indice}`);
}

export function cteDivergenteAuditoria(row = {}, ehDivergente) {
  const calculado = Number(row.valor_calculado || 0);
  if (!(calculado > 0)) return false;
  return ehDivergente(
    diferencaMonetaria(row),
    calculado,
  );
}

function detalheCte(row, diferenca, ocultarCobrancaAMenor = false) {
  const det = parseDetalhes(row.detalhes_calculo);
  const base = det.componentes_base || det.base_frete || {};
  const taxas = det.taxas || {};
  const tabelaValidada =
    typeof row.transportadora_validada_atual === "boolean"
      ? row.transportadora_validada_atual
      : Boolean(
          row.origem_validada ?? det.origem_validada ?? det.tabela_validada,
        );
  const calculadoReal = Number(row.valor_calculado || 0);
  const calculado = ocultarCobrancaAMenor ? Number(row.valor_cte || 0) : calculadoReal;
  const resumo = bloco(
    "Resumo do cálculo",
    [
      kv("Data de emissão", dataEmissao(row)),
      kv("Chave do CT-e", row.chave_cte || "Não informada"),
      kv(
        "Fatura",
        row.tem_fatura
          ? (row.numeros_fatura || []).join(", ") || "Com fatura"
          : "Sem fatura",
      ),
      kv(
        "Validação da tabela",
        tabelaValidada ? "Tabela validada" : "Validação pendente",
      ),
      kv("Motor", "AMD"),
      kv(
        "Tabela usada",
        row.transportadora_tabela ||
          det.transportadora_tabela ||
          row.transportadora ||
          "-",
      ),
      kv("Rota/cotação", det.rota_nome || det.rota || "-"),
      kv("Peso considerado", `${numero(det.peso_considerado ?? row.peso)} kg`),
      kv("Valor da NF", dinheiro(row.valor_nf ?? det.valor_nf)),
      kv("Frete cobrado", dinheiro(row.valor_cte)),
      kv("Cálculo AMD", calculado > 0 ? dinheiro(calculado) : "Sem cálculo"),
      kv(
        "Diferença",
        ocultarCobrancaAMenor ? dinheiro(0) : dinheiro(diferenca),
        ocultarCobrancaAMenor ? "" : "erro",
      ),
    ].join(""),
  );
  const frete = bloco(
    "Base do frete",
    [
      kv(
        "Percentual aplicado",
        `${numero(base.percentualAplicado ?? base.percentual_aplicado, 2)}%`,
      ),
      kv(
        "Valor percentual",
        dinheiro(base.valorPercentualCalculado ?? base.valor_percentual),
      ),
      kv(
        "R$/kg aplicado",
        dinheiro(base.rsKgAplicado ?? base.valor_kg_aplicado),
      ),
      kv(
        "Frete mínimo rota",
        dinheiro(base.minimoRota ?? base.frete_minimo_rota),
      ),
      kv(
        "Frete mínimo cotação",
        dinheiro(base.freteMinimoCotacao ?? base.frete_minimo_cotacao),
      ),
      kv(
        "Mínimo aplicável",
        dinheiro(base.minimoAplicavel ?? base.minimo_aplicavel),
      ),
      kv(
        "Componente vencedor",
        base.componenteBase ||
          base.componente_vencedor ||
          det.componente_base ||
          "-",
      ),
      kv("Valor base", dinheiro(det.valor_base ?? base.valorBase)),
    ].join(""),
  );
  const total = bloco(
    "ICMS e totalização",
    [
      kv(
        "Subtotal sem ICMS",
        dinheiro(det.subtotal ?? det.subtotal_sem_icms ?? base.subtotal),
      ),
      kv(
        "Alíquota ICMS",
        `${numero(det.aliquota_icms ?? base.aliquotaIcms, 2)}%`,
      ),
      kv(
        "Origem da alíquota",
        det.origem_aliquota_icms || base.origemAliquotaIcms || "-",
      ),
      kv("ICMS", dinheiro(det.icms ?? base.icms)),
      kv("Total calculado", dinheiro(calculado)),
    ].join(""),
  );
  const taxasHtml = bloco(
    "Taxas",
    [
      ["Ad Valorem", taxas.adValorem],
      ["GRIS", taxas.gris],
      ["Pedágio", taxas.pedagio],
      ["TAS", taxas.tas],
      ["CTRC", taxas.ctrc],
      ["TDA", taxas.tda],
      ["TDE", taxas.tde],
      ["TDR", taxas.tdr],
      ["TRT", taxas.trt],
      ["Suframa", taxas.suframa],
      ["Outras", taxas.outras],
      ["Taxa extra", taxas.taxaExtra],
    ]
      .map(([l, v]) => kv(l, dinheiro(v)))
      .join(""),
  );
  return `${resumo}${frete}${total}${taxasHtml}`;
}

export function gerarHtmlLaudoAuditoriaCtes(
  rows = [],
  { competencia = "", observacao = "", mostrarCobrancaAMenor = false, portais = [] } = {},
) {
  if (!rows.length)
    throw new Error("Selecione ao menos um CT-e incorreto para gerar o laudo.");
  const transportadoras = [
    ...new Set(rows.map((r) => r.transportadora).filter(Boolean)),
  ].join(", ");
  const soma = (campo) => rows.reduce((s, r) => {
    const valor = Number(r[campo] || 0);
    if (campo === "valor_calculado" && !mostrarCobrancaAMenor) {
      return s + Math.min(valor, Number(r.valor_cte || 0));
    }
    return s + valor;
  }, 0);
  const totalDiferenca = rows.reduce((s, r) => {
    const diferenca = diferencaMonetaria(r);
    return s + (!mostrarCobrancaAMenor && diferenca < 0 ? 0 : diferenca);
  }, 0);
  const linhas = rows
    .map((r, index) => {
      const calculado = Number(r.valor_calculado || 0);
      const diferenca = diferencaMonetaria(r);
      const ocultarCobrancaAMenor = !mostrarCobrancaAMenor && diferenca < 0;
      const diferencaPublica = ocultarCobrancaAMenor ? 0 : diferenca;
      const statusPublico =
        ocultarCobrancaAMenor || diferencaPublica === 0
          ? "OK"
          : diferencaPublica > 0
            ? "COBRADO ACIMA"
            : "COBRADO ABAIXO";
      const faturaTexto = r.tem_fatura
        ? (r.numeros_fatura || []).join(", ") || "Com fatura"
        : "Sem fatura";
      const tabelaValidada = Boolean(
        r.origem_validada ??
        parseDetalhes(r.detalhes_calculo).origem_validada ??
        parseDetalhes(r.detalhes_calculo).tabela_validada,
      );
      const id = `detalhe-${index}`;
      const calculadoPublico = ocultarCobrancaAMenor ? Number(r.valor_cte || 0) : calculado;
      return `<tr class="cte-row" onclick="toggleDetail('${id}')"><td>${esc(faturaTexto)}</td><td>${esc(r.numero_cte || "-")}</td><td>${esc(dataEmissao(r))}</td><td>${esc(r.transportadora || "-")}</td><td>${esc(`${r.cidade_origem || "-"}/${r.uf_origem || "-"} → ${r.cidade_destino || "-"}/${r.uf_destino || "-"}`)}</td><td>${numero(r.peso)} kg</td><td>${dinheiro(r.valor_cte)}</td><td>${calculadoPublico > 0 ? dinheiro(calculadoPublico) : "Sem cálculo"}</td><td class="${statusPublico === "OK" ? "" : "erro"}">${dinheiro(diferencaPublica)}</td><td><span class="status ${statusPublico === "OK" ? "status-ok" : "status-revisar"}">${statusPublico}</span></td></tr><tr id="${id}" class="detail-row"><td colspan="10"><div class="detail-panel"><div class="detail-title"><strong>Detalhes do cálculo — CT-e ${esc(r.numero_cte || "-")}</strong><span>${esc(r.chave_cte || "")}</span></div><div class="detail-grid">${detalheCte(r, diferenca, ocultarCobrancaAMenor)}</div>${r.motivo_sem_calculo ? `<p class="motivo"><b>Ponto para verificação:</b> ${esc(r.motivo_sem_calculo)}</p>` : ""}<p class="acao"><b>Ação solicitada:</b> verificar a emissão e os valores deste CT-e. Caso a cobrança esteja incorreta e o documento ainda esteja dentro do prazo legal, solicitamos o cancelamento do CT-e e a reemissão correta. Se o cancelamento não for aplicável, favor informar a tratativa adequada.</p></div></td></tr>`;
    })
    .join("");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Laudo de divergências de CT-e</title><style>body{margin:0;background:#eef3f9;color:#0f172a;font-family:Arial,sans-serif}.page{max-width:1280px;margin:24px auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;overflow:hidden}header{padding:28px 32px;background:#06183d;color:#fff}header h1{margin:0 0 8px}header p{margin:4px 0;color:#cbd5e1}.resumo{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:20px 32px;background:#f8fafc}.card{padding:12px;border:1px solid #dbe3ef;border-radius:9px}.card small{display:block;color:#64748b;margin-bottom:5px}.card strong{font-size:18px}.intro,.lista{padding:20px 32px}.lista h2{margin-top:0}.report-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.note{flex:1;padding:10px 12px;background:#eff6ff;color:#1e3a8a;border-radius:7px}.export-button{border:0;border-radius:8px;background:#0f6b3e;color:#fff;font-weight:700;padding:11px 16px;cursor:pointer;white-space:nowrap}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;background:#f1f5f9;padding:9px;border-bottom:1px solid #cbd5e1}td{padding:9px;border-bottom:1px solid #e2e8f0;vertical-align:top}.cte-row{cursor:pointer}.cte-row:hover{background:#eff6ff}.erro{color:#b91c1c}.detail-row{display:none}.detail-row.open{display:table-row}.detail-row>td{padding:0 8px 14px;background:#f8fafc}.detail-panel{border:1px solid #cbd5e1;border-radius:9px;background:#fff;padding:14px}.detail-title{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}.detail-title span{font-size:10px;color:#64748b;overflow-wrap:anywhere}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:10px}.detail-box{padding:11px;border:1px solid #e2e8f0;border-radius:8px;background:#fbfdff}.detail-box h3{font-size:13px;margin:0 0 7px}.kv{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid #edf2f7}.kv span{color:#64748b}.kv strong{text-align:right;overflow-wrap:anywhere}.motivo,.acao{margin:10px 0 0;padding:11px;border-radius:7px}.motivo{background:#fef3c7}.acao{background:#fff7ed;color:#7c2d12}footer{padding:18px 32px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0}@media(max-width:700px){.resumo,.detail-grid{grid-template-columns:1fr}.report-actions{align-items:stretch;flex-direction:column}}@media print{body{background:#fff}.page{margin:0;border:0}.export-button{display:none}.detail-row{display:table-row}.detail-panel{break-inside:avoid}}</style></head><body><main class="page"><header><h1>Laudo de divergências de CT-e</h1><p>${esc(transportadoras || "Transportador")}</p><p>Competência: ${esc(competencia || "não informada")} · Gerado em ${esc(new Date().toLocaleString("pt-BR"))}</p></header><div class="resumo"><div class="card"><small>CT-es incorretos</small><strong>${rows.length}</strong></div><div class="card"><small>Total cobrado</small><strong>${dinheiro(soma("valor_cte"))}</strong></div><div class="card"><small>Total cálculo AMD</small><strong>${dinheiro(soma("valor_calculado"))}</strong></div><div class="card"><small>Diferença total</small><strong class="erro">${dinheiro(totalDiferenca)}</strong></div></div><div class="intro"><p>Prezados, identificamos divergências nos CT-es abaixo. Solicitamos a conferência individual de cada documento e o retorno com a tratativa.</p>${observacao ? `<p><b>Observação:</b> ${esc(observacao)}</p>` : ""}</div><section class="lista"><h2>CT-es com divergência</h2><div class="report-actions"><div class="note">Clique em um CT-e para abrir ou fechar os detalhes do cálculo AMD.</div><button class="export-button" type="button" onclick="exportarExcel()">Exportar Excel</button></div><table id="tabela-ctes"><thead><tr><th>Fatura</th><th>CT-e</th><th>Transportadora</th><th>Rota</th><th>Peso</th><th>Cobrado</th><th>Cálculo AMD</th><th>Diferença</th><th>Status</th></tr></thead><tbody>${linhas}</tbody></table></section><footer>Documento gerado pela Central Fretes para conferência do transportador.</footer></main><script>function toggleDetail(id){var el=document.getElementById(id);if(el)el.classList.toggle('open')}function exportarExcel(){var tabela=document.getElementById('tabela-ctes');var copia=tabela.cloneNode(true);Array.from(copia.querySelectorAll('.detail-row')).forEach(function(row){row.remove()});var conteudo='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>'+copia.outerHTML+'</body></html>';var blob=new Blob(['\\ufeff',conteudo],{type:'application/vnd.ms-excel;charset=utf-8'});var url=URL.createObjectURL(blob);var link=document.createElement('a');link.href=url;link.download='laudo-ctes-${esc(competencia || new Date().toISOString().slice(0, 7))}.xls';document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url)},1000)}</script></body></html>`;
  const filtrosHtml = `<div class="filters"><label>Buscar<input id="filtro-busca" type="search" placeholder="CT-e, fatura, transportadora ou rota" oninput="aplicarFiltros()"></label><label>Situação<select id="filtro-status" onchange="aplicarFiltros()"><option value="">Todas</option><option value="DIVERGENTE">Somente divergentes</option><option value="COBRADO ACIMA">Cobrado acima</option><option value="COBRADO ABAIXO">Cobrado abaixo</option><option value="OK">OK</option></select></label><label>Fatura<select id="filtro-fatura" onchange="aplicarFiltros()"><option value="">Com e sem fatura</option><option value="COM">Somente com fatura</option><option value="SEM">Somente sem fatura</option></select></label><button type="button" class="clear-button" onclick="limparFiltros()">Limpar filtros</button><strong id="resultado-filtro"></strong></div>`;
  const cssFiltros = `.filters{display:grid;grid-template-columns:minmax(240px,2fr) minmax(170px,1fr) minmax(180px,1fr) auto auto;align-items:end;gap:10px;padding:12px;margin:0 0 12px;background:#f8fafc;border:1px solid #dbe3ef;border-radius:9px}.filters label{display:flex;flex-direction:column;gap:5px;color:#475569;font-size:11px;font-weight:700}.filters input,.filters select{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:9px;color:#0f172a}.clear-button{border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:9px 12px;cursor:pointer}.filters strong{padding:9px 0;white-space:nowrap}@media(max-width:850px){.filters{grid-template-columns:1fr 1fr}.filters label:first-child{grid-column:1/-1}}@media(max-width:520px){.filters{grid-template-columns:1fr}.filters label:first-child{grid-column:auto}}@media print{.filters{display:none}}`;
  const scriptsFiltros = `function normalizarFiltro(v){return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase()}function aplicarFiltros(){var busca=normalizarFiltro(document.getElementById('filtro-busca').value);var status=document.getElementById('filtro-status').value;var fatura=document.getElementById('filtro-fatura').value;var visiveis=0;document.querySelectorAll('#tabela-ctes tbody .cte-row').forEach(function(row){var cols=row.cells;var texto=normalizarFiltro(row.textContent);var statusLinha=String(cols[8]&&cols[8].textContent||'').trim();var faturaLinha=normalizarFiltro(cols[0]&&cols[0].textContent||'');var atendeStatus=!status||(status==='DIVERGENTE'?statusLinha!=='OK':statusLinha===status);var atendeFatura=!fatura||(fatura==='COM'?faturaLinha!=='SEM FATURA':faturaLinha==='SEM FATURA');var mostrar=(!busca||texto.includes(busca))&&atendeStatus&&atendeFatura;row.style.display=mostrar?'':'none';var detalhe=row.nextElementSibling;if(detalhe&&detalhe.classList.contains('detail-row')){detalhe.style.display='none';detalhe.classList.remove('open')}if(mostrar)visiveis++});document.getElementById('resultado-filtro').textContent=visiveis+' CT-e(s) exibido(s)'}function limparFiltros(){document.getElementById('filtro-busca').value='';document.getElementById('filtro-status').value='';document.getElementById('filtro-fatura').value='';aplicarFiltros()}function exportarExcel(){var tabela=document.getElementById('tabela-ctes');var copia=tabela.cloneNode(true);Array.from(copia.querySelectorAll('.detail-row,.cte-row[style*="display: none"]')).forEach(function(row){row.remove()});var conteudo='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>'+copia.outerHTML+'</body></html>';var blob=new Blob(['\\ufeff',conteudo],{type:'application/vnd.ms-excel;charset=utf-8'});var url=URL.createObjectURL(blob);var link=document.createElement('a');link.href=url;link.download='laudo-ctes-filtrado-${esc(competencia || new Date().toISOString().slice(0, 7))}.xls';document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url)},1000)}aplicarFiltros();`;
  const scriptExcelDetalhado = `function exportarExcel(){var tabela=document.getElementById('tabela-ctes');var nova=document.createElement('table');var cabecalho=tabela.tHead.cloneNode(true);var th=document.createElement('th');th.textContent='Detalhes do cálculo AMD';cabecalho.rows[0].appendChild(th);nova.appendChild(cabecalho);var corpo=document.createElement('tbody');Array.from(tabela.querySelectorAll('tbody .cte-row')).filter(function(row){return row.style.display!=='none'}).forEach(function(row){var copia=row.cloneNode(true);copia.removeAttribute('onclick');copia.removeAttribute('style');var td=document.createElement('td');var detalhe=row.nextElementSibling;td.textContent=detalhe&&detalhe.classList.contains('detail-row')?detalhe.innerText.replace(/\\s+/g,' ').trim():'';copia.appendChild(td);corpo.appendChild(copia)});nova.appendChild(corpo);var conteudo='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>td,th{border:1px solid #ccc;padding:6px;vertical-align:top}td:last-child{white-space:normal;min-width:500px}</style></head><body>'+nova.outerHTML+'</body></html>';var blob=new Blob(['\\ufeff',conteudo],{type:'application/vnd.ms-excel;charset=utf-8'});var url=URL.createObjectURL(blob);var link=document.createElement('a');link.href=url;link.download='laudo-ctes-detalhado-${esc(competencia || new Date().toISOString().slice(0, 7))}.xls';document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url)},1000)}`;
  const scriptDetalhesEmColunas = `function toggleDetail(id){var el=document.getElementById(id);if(!el)return;el.style.display='';el.classList.toggle('open')}function extrairDetalhesExcel(row){var detalhe=row.nextElementSibling;var mapa={};if(!detalhe||!detalhe.classList.contains('detail-row'))return mapa;detalhe.querySelectorAll('.detail-box').forEach(function(box){var titulo=String(box.querySelector('h3')&&box.querySelector('h3').textContent||'Detalhes').trim();box.querySelectorAll('.kv').forEach(function(kv){var label=String(kv.querySelector('span')&&kv.querySelector('span').textContent||'').trim();var valor=String(kv.querySelector('strong')&&kv.querySelector('strong').textContent||'').trim();if(label)mapa[titulo+' - '+label]=valor})});var motivo=detalhe.querySelector('.motivo');var acao=detalhe.querySelector('.acao');if(motivo)mapa['Ponto para verificação']=motivo.textContent.replace(/^Ponto para verificação:\\s*/i,'').trim();if(acao)mapa['Ação solicitada']=acao.textContent.replace(/^Ação solicitada:\\s*/i,'').trim();return mapa}function exportarExcel(){var tabela=document.getElementById('tabela-ctes');var linhas=Array.from(tabela.querySelectorAll('tbody .cte-row')).filter(function(row){return row.style.display!=='none'});var detalhes=linhas.map(extrairDetalhesExcel);var colunas=[];detalhes.forEach(function(mapa){Object.keys(mapa).forEach(function(chave){if(!colunas.includes(chave))colunas.push(chave)})});var nova=document.createElement('table');var cabecalho=tabela.tHead.cloneNode(true);colunas.forEach(function(nome){var th=document.createElement('th');th.textContent=nome;cabecalho.rows[0].appendChild(th)});nova.appendChild(cabecalho);var corpo=document.createElement('tbody');linhas.forEach(function(row,indice){var copia=row.cloneNode(true);copia.removeAttribute('onclick');copia.removeAttribute('style');colunas.forEach(function(nome){var td=document.createElement('td');td.textContent=detalhes[indice][nome]||'';copia.appendChild(td)});corpo.appendChild(copia)});nova.appendChild(corpo);var conteudo='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>td,th{border:1px solid #ccc;padding:6px;vertical-align:top;white-space:nowrap}</style></head><body>'+nova.outerHTML+'</body></html>';var blob=new Blob(['\\ufeff',conteudo],{type:'application/vnd.ms-excel;charset=utf-8'});var url=URL.createObjectURL(blob);var link=document.createElement('a');link.href=url;link.download='laudo-ctes-detalhado-${esc(competencia || new Date().toISOString().slice(0, 7))}.xls';document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url)},1000)}`;
  const scriptResumoDinamico = `function moedaNumero(texto){var valor=String(texto||'').replace(/[^0-9,.-]/g,'').replace(/\\./g,'').replace(',','.');return Number(valor)||0}function moedaBr(valor){return Number(valor||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}function atualizarResumoDinamico(){var linhas=Array.from(document.querySelectorAll('#tabela-ctes tbody .cte-row')).filter(function(row){return row.style.display!=='none'});var cobrado=0;var calculado=0;var diferenca=0;linhas.forEach(function(row){cobrado+=moedaNumero(row.cells[5]&&row.cells[5].textContent);calculado+=moedaNumero(row.cells[6]&&row.cells[6].textContent);diferenca+=moedaNumero(row.cells[7]&&row.cells[7].textContent)});document.getElementById('resumo-quantidade').textContent=linhas.length.toLocaleString('pt-BR');document.getElementById('resumo-cobrado').textContent=moedaBr(cobrado);document.getElementById('resumo-calculado').textContent=moedaBr(calculado);document.getElementById('resumo-diferenca').textContent=moedaBr(diferenca)}var aplicarFiltrosOriginal=aplicarFiltros;aplicarFiltros=function(){aplicarFiltrosOriginal();atualizarResumoDinamico()};atualizarResumoDinamico();`;
  const scriptsFiltrosComEmissao = scriptsFiltros.replace("cols[8]&&cols[8].textContent", "cols[9]&&cols[9].textContent");
  const scriptResumoComEmissao = scriptResumoDinamico
    .replaceAll("row.cells[5]", "row.cells[__COBRADO__]")
    .replaceAll("row.cells[6]", "row.cells[__CALCULADO__]")
    .replaceAll("row.cells[7]", "row.cells[__DIFERENCA__]")
    .replaceAll("__COBRADO__", "6")
    .replaceAll("__CALCULADO__", "7")
    .replaceAll("__DIFERENCA__", "8");
  const scriptResumoPublico = scriptResumoComEmissao.replace(
    "calculado+=moedaNumero(row.cells[7]&&row.cells[7].textContent);",
    `var calculadoLinha=moedaNumero(row.cells[7]&&row.cells[7].textContent);calculado+=${mostrarCobrancaAMenor ? "calculadoLinha" : "Math.min(calculadoLinha,moedaNumero(row.cells[6]&&row.cells[6].textContent))"};`,
  );
  // Fase 14: botão que leva a transportadora ao portal de resposta. O link é
  // servido pela função serverless (/api/portal/<token>), não pelo app — o
  // laudo é um arquivo estático e não deve tentar gravar resposta sozinho.
  const listaPortais = (portais || []).filter((p) => p && p.url);
  const blocoPortal = listaPortais.length
    ? `<div class="portal-box"><div><strong>Responder esta auditoria online</strong>
<p>Confira CT-e a CT-e e registre sua tratativa direto no sistema — não é preciso login.</p></div>
<div class="portal-links">${listaPortais.map((p) => (
        `<a class="portal-button" href="${esc(p.url)}" target="_blank" rel="noopener">Conferir e responder${listaPortais.length > 1 && p.transportadora ? ` — ${esc(p.transportadora)}` : ''}</a>`
      )).join('')}</div></div>`
    : '';
  const cssPortal = `.portal-box{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:0 32px 16px;padding:16px 18px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:10px}.portal-box p{margin:4px 0 0;color:#065f46;font-size:13px}.portal-links{display:flex;gap:8px;flex-wrap:wrap}.portal-button{display:inline-block;border-radius:8px;background:#0f6b3e;color:#fff;font-weight:700;padding:12px 18px;text-decoration:none;white-space:nowrap}.portal-button:hover{background:#0c5732}@media print{.portal-box{display:none}}`;

  return html
    .replace("</style>", `${cssPortal}</style>`)
    .replace('<section class="lista">', `${blocoPortal}<section class="lista">`)
    .replace('<th>CT-e</th><th>Transportadora</th>', '<th>CT-e</th><th>Emissão</th><th>Transportadora</th>')
    .replace('<small>CT-es incorretos</small><strong>', '<small>CT-es exibidos</small><strong id="resumo-quantidade">')
    .replace('<small>Total cobrado</small><strong>', '<small>Total cobrado</small><strong id="resumo-cobrado">')
    .replace('<small>Total cálculo AMD</small><strong>', '<small>Total cálculo AMD</small><strong id="resumo-calculado">')
    .replace('<small>Diferença total</small><strong class="erro">', '<small>Diferença total</small><strong id="resumo-diferenca" class="erro">')
    .replace("</style>", `${cssFiltros}</style>`)
    .replace('<table id="tabela-ctes">', `${filtrosHtml}<table id="tabela-ctes">`)
    .replace("</script>", `${scriptsFiltrosComEmissao}${scriptExcelDetalhado}${scriptDetalhesEmColunas}${scriptResumoPublico}</script>`);
}

/** Nome de arquivo por transportadora — gerando um laudo por transportadora,
 * sem o sufixo os downloads teriam o mesmo nome e um sobrescreveria o outro. */
export function nomeArquivoLaudoAuditoriaCtes(rows = [], competencia = "") {
  const transportadoras = [...new Set(rows.map((r) => r.transportadora).filter(Boolean))];
  const sufixo = transportadoras.length === 1
    ? `-${transportadoras[0].normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40)}`
    : "";
  return `laudo-ctes-incorretos${sufixo}-${competencia || new Date().toISOString().slice(0, 10)}.html`;
}

/** Gera o laudo e devolve {url, nome} sem disparar download. Usado quando há
 * mais de uma transportadora: o navegador bloqueia downloads múltiplos
 * automáticos, então cada arquivo vira um botão pro usuário clicar. */
export function prepararArquivoLaudoAuditoriaCtes(rows, opcoes = {}) {
  const blob = new Blob([gerarHtmlLaudoAuditoriaCtes(rows, opcoes)], {
    type: "text/html;charset=utf-8",
  });
  return {
    url: URL.createObjectURL(blob),
    nome: nomeArquivoLaudoAuditoriaCtes(rows, opcoes.competencia),
  };
}

export function baixarArquivoPreparado({ url, nome }) {
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function baixarHtmlLaudoAuditoriaCtes(rows, opcoes = {}) {
  const arquivo = prepararArquivoLaudoAuditoriaCtes(rows, opcoes);
  baixarArquivoPreparado(arquivo);
  // Revogar na hora cancela o download quando o clique não vem direto de um
  // gesto do usuário (ex.: geramos o laudo depois de um await no Supabase).
  setTimeout(() => URL.revokeObjectURL(arquivo.url), 1000);
}
