import * as XLSX from 'xlsx';
import { montarDadosAjusteRotaFaixa } from './ajusteRotaFaixaLaudo.js';

const CAMPOS_PRECO = new Set([
  'freteminimo', 'minimo', 'fretemin', 'taxaaplicada', 'valorfixo', 'valorfaixa',
  'fretepercentual', 'percentual', 'percentualfrete', 'valorexcedente',
  'excedente', 'rskg', 'valorkg', 'valorlotacao', 'advalorem', 'gris', 'pedagio',
  'tas', 'tda', 'tde', 'tdr', 'trt', 'outrastaxas', 'taxaextra',
]);

function chave(value = '') {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function numero(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').replace(/R\$/gi, '').replace(/%/g, '').trim();
  if (!raw) return 0;
  const normalizado = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const result = Number(normalizado.replace(/[^\d.-]/g, ''));
  return Number.isFinite(result) ? result : 0;
}

function dadosOriginais(item = {}) {
  if (item.dados_originais && typeof item.dados_originais === 'object') return { ...item.dados_originais };
  if (typeof item.dados_originais === 'string') {
    try { return { ...JSON.parse(item.dados_originais) }; } catch { /* segue com o modelo padrao */ }
  }
  return {};
}

function nomeRota(item = {}, dados = {}) {
  return String(dados.cotacaoFinal || dados.cotacaoBase || dados.cotacao_base || dados.cotacao
    || dados.rota || dados.nomeRota || String(item.faixa_peso || '').split('|')[0] || item.observacao || '').trim();
}

function faixaItem(item = {}, dados = {}) {
  return String(item.faixa_peso || dados.faixaPeso || dados.faixa_peso || dados.faixa || '').trim();
}

function reduzirValorOriginal(value, fator) {
  const novo = Math.max(0, numero(value) * fator);
  if (typeof value === 'string' && value.includes('%')) return `${novo.toFixed(4).replace('.', ',')}%`;
  return Number(novo.toFixed(4));
}

function linhaOriginalOuPadrao(item = {}) {
  const original = dadosOriginais(item);
  const chavesUteis = Object.keys(original).filter((key) => !['tipo_item', 'rodada'].includes(key));
  if (chavesUteis.length) return original;
  return {
    tipo_item: item.item_tipo || '', cidade_origem: item.cidade_origem || '', uf_origem: item.uf_origem || '',
    ibge_origem: item.ibge_origem || '', cidade_destino: item.cidade_destino || '', uf_destino: item.uf_destino || '',
    ibge_destino: item.ibge_destino || '', faixa_peso: item.faixa_peso || '', frete_minimo: item.frete_minimo || 0,
    taxa_aplicada: item.taxa_aplicada || 0, frete_percentual: item.frete_percentual || 0,
    excesso_kg: item.excesso_kg || 0, valor_excedente: item.valor_excedente || 0, prazo: item.prazo || '',
  };
}

export function planejarAjustesParaAderencia(resultado = {}, meta = 0, margemCompetitiva = 0) {
  const { linhas, totais } = montarDadosAjusteRotaFaixa(resultado);
  const ctesComTabela = Number(resultado.ctesComTabelaSelecionada || Math.max(0, totais.ctes - totais.ctesSemCalculo));
  const ganhosAtuais = Number(resultado.ctesGanhariaSelecionada ?? totais.ctesGanharia ?? 0);
  const metaValida = Math.min(100, Math.max(0, Number(meta) || 0));
  const margemValida = Math.min(50, Math.max(0, Number(margemCompetitiva) || 0));
  const ganhosNecessarios = Math.ceil((metaValida / 100) * ctesComTabela);
  const detalhes = (resultado.ctesAjusteRotaExcel || []).map((item) => {
    const tabela = Number(item.tabelaSimulacao || item.tabelaRpa || item.freteSelecionada || item.freteTabela || 0);
    const referencia = Number(item.freteCobrado || item.freteBaseComparativa || item.freteRealizado || 0);
    return {
      ...item, tabela, referencia,
      perdiaOriginalmente: tabela > referencia,
      valorAlvo: referencia * (1 - margemValida / 100),
      reducaoNecessaria: tabela > 0 && tabela > referencia * (1 - margemValida / 100)
        ? ((tabela - referencia * (1 - margemValida / 100)) / tabela) * 100 : 0,
    };
  }).filter((item) => item.tabela > 0 && item.referencia > 0);
  const perdasDetalhadas = detalhes.filter((item) => item.perdiaOriginalmente && item.reducaoNecessaria > 0)
    .sort((a, b) => a.reducaoNecessaria - b.reducaoNecessaria);
  const ganhosDentroMargem = detalhes.length ? detalhes.filter((item) => item.reducaoNecessaria === 0).length : ganhosAtuais;
  const adicionaisNecessarios = Math.max(0, ganhosNecessarios - ganhosAtuais);
  const selecionados = perdasDetalhadas.slice(0, adicionaisNecessarios);
  const limitePorGrupo = new Map();
  selecionados.forEach((item) => {
    const grupo = `${chave(item.rota)}|${chave(item.faixaPeso || item.faixa)}`;
    limitePorGrupo.set(grupo, Math.max(limitePorGrupo.get(grupo) || 0, item.reducaoNecessaria));
  });
  const linhaPorGrupo = new Map(linhas.map((linha) => [`${chave(linha.rota)}|${chave(linha.faixa)}`, linha]));
  const ajustes = Array.from(limitePorGrupo.entries()).map(([grupo, limite]) => {
    const linha = linhaPorGrupo.get(grupo) || {};
    const reduzirPctSugerido = Math.min(95, limite);
    const itensGrupo = detalhes.filter((item) => `${chave(item.rota)}|${chave(item.faixaPeso || item.faixa)}` === grupo);
    const ctesConvertidos = itensGrupo.filter((item) => item.perdiaOriginalmente && item.reducaoNecessaria > 0 && item.reducaoNecessaria <= reduzirPctSugerido).length;
    const ganhosProjetadosRota = Math.min(Number(linha.ctes || 0), Number(linha.ctesGanharia || 0) + ctesConvertidos);
    return { ...linha, reduzirPctSugerido, ganhosProjetadosRota, ctesConvertidos };
  }).sort((a, b) => b.ctesConvertidos - a.ctesConvertidos || a.reduzirPctSugerido - b.reduzirPctSugerido);
  const convertidosProjetados = ajustes.reduce((soma, item) => soma + Number(item.ctesConvertidos || 0), 0);
  const ganhosProjetados = Math.min(ctesComTabela, ganhosAtuais + convertidosProjetados);
  const fatorPorGrupo = new Map(ajustes.map((item) => [`${chave(item.rota)}|${chave(item.faixa)}`, 1 - item.reduzirPctSugerido / 100]));
  const faturamentoTabelaAtual = detalhes.reduce((soma, item) => soma + item.tabela, 0);
  const faturamentoTabelaProjetado = detalhes.reduce((soma, item) => {
    const grupo = `${chave(item.rota)}|${chave(item.faixaPeso || item.faixa)}`;
    return soma + item.tabela * (fatorPorGrupo.get(grupo) ?? 1);
  }, 0);
  const meses = Math.max(1, Number(resultado.meses || 1));
  const metricasFaturamento = detalhes.reduce((acc, item) => {
    const grupo = `${chave(item.rota)}|${chave(item.faixaPeso || item.faixa)}`;
    const fator = fatorPorGrupo.get(grupo) ?? 1;
    const tabelaProjetada = item.tabela * fator;
    const ganhaHoje = item.tabela <= item.referencia;
    const ganhaProjetado = ganhaHoje || (fator < 1 && tabelaProjetada <= item.valorAlvo);
    if (ganhaHoje) acc.atualNasGanhas += item.tabela;
    else acc.comConcorrentesHoje += item.referencia;
    if (ganhaProjetado) acc.projetadoNasGanhas += tabelaProjetada;
    if (!ganhaHoje && ganhaProjetado) acc.capturadoConcorrentes += tabelaProjetada;
    if (ganhaProjetado) acc.savingProjetado += Math.max(0, item.referencia - tabelaProjetada);
    return acc;
  }, { atualNasGanhas: 0, projetadoNasGanhas: 0, comConcorrentesHoje: 0, capturadoConcorrentes: 0, savingProjetado: 0 });
  return {
    ajustes, meta: metaValida, margemCompetitiva: margemValida, ctesComTabela, ganhosAtuais, ganhosDentroMargem, ganhosNecessarios,
    ganhosProjetados,
    aderenciaAtual: ctesComTabela ? (ganhosAtuais / ctesComTabela) * 100 : 0,
    aderenciaDentroMargem: ctesComTabela ? (ganhosDentroMargem / ctesComTabela) * 100 : 0,
    aderenciaProjetada: ctesComTabela ? (Math.min(ctesComTabela, ganhosProjetados) / ctesComTabela) * 100 : 0,
    atingivel: ganhosProjetados >= ganhosNecessarios,
    calculoPorCte: detalhes.length >= ctesComTabela * 0.95,
    faturamentoTabelaAtual,
    faturamentoTabelaProjetado,
    reducaoFaturamento: faturamentoTabelaAtual - faturamentoTabelaProjetado,
    faturamentoProjetadoMensal: faturamentoTabelaProjetado / meses,
    faturamentoAtualNasGanhas: metricasFaturamento.atualNasGanhas,
    faturamentoProjetadoNasGanhas: metricasFaturamento.projetadoNasGanhas,
    faturamentoConcorrentesHoje: metricasFaturamento.comConcorrentesHoje,
    faturamentoCapturadoConcorrentes: metricasFaturamento.capturadoConcorrentes,
    faturamentoProjetadoNasGanhasMensal: metricasFaturamento.projetadoNasGanhas / meses,
    savingProjetadoPeriodo: metricasFaturamento.savingProjetado,
    savingProjetadoMensal: metricasFaturamento.savingProjetado / meses,
    savingProjetadoAnual: (metricasFaturamento.savingProjetado / meses) * 12,
  };
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function pct(value) { return `${Number(value || 0).toFixed(2)}%`; }
function inteiro(value) { return Number(value || 0).toLocaleString('pt-BR'); }
function dinheiro(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

export function gerarHtmlLaudoProjecaoAderencia(resultado = {}, meta = 0, margemCompetitiva = 0) {
  const plano = planejarAjustesParaAderencia(resultado, meta, margemCompetitiva);
  const dados = montarDadosAjusteRotaFaixa(resultado);
  const ajustes = new Map(plano.ajustes.map((item) => [`${chave(item.rota)}|${chave(item.faixa)}`, item]));
  const linhas = dados.linhasAtendidas.map((linha) => {
    const ajuste = ajustes.get(`${chave(linha.rota)}|${chave(linha.faixa)}`);
    return { ...linha, ajuste, aderenciaProjetadaRota: ajuste && linha.ctes ? (ajuste.ganhosProjetadosRota / linha.ctes) * 100 : linha.aderenciaRota };
  });
  const linhasAjustar = linhas.filter((linha) => linha.ajuste);
  const foraDaMeta = linhas.filter((linha) => !linha.ajuste && linha.ctesPerderia > 0);
  const detalhesCtes = resultado.ctesAjusteRotaExcel || [];
  const status = plano.atingivel ? 'Meta projetada atingida' : 'Meta não atingível com os ajustes calculados';
  const montarLinhaComCtes = (linha) => {
    const fator = 1 - linha.ajuste.reduzirPctSugerido / 100;
    const ctes = detalhesCtes
      .filter((cte) => chave(cte.rota) === chave(linha.rota) && chave(cte.faixaPeso || cte.faixa) === chave(linha.faixa))
      .map((cte) => {
        const atual = Number(cte.tabelaSimulacao || cte.tabelaRpa || 0);
        const referencia = Number(cte.freteCobrado || 0);
        const alvoInterno = referencia * (1 - plano.margemCompetitiva / 100);
        const projetado = atual * fator;
        const ganhaHoje = atual <= referencia;
        const ganhaProjetado = projetado <= alvoInterno;
        return { ...cte, atual, referencia, projetado, ganhaHoje, ganhaProjetado, converte: !ganhaHoje && ganhaProjetado };
      })
      .sort((a, b) => Number(b.converte) - Number(a.converte) || Number(b.ganhaProjetado) - Number(a.ganhaProjetado) || (a.projetado - a.referencia) - (b.projetado - b.referencia));
    const convertidosCalculados = ctes.filter((cte) => cte.converte).length;
    const reconciliado = convertidosCalculados === Number(linha.ajuste.ctesConvertidos || 0);
    const detalhe = ctes.slice(0, 50).map((cte) => `<tr><td><strong>${escHtml(cte.cte || '-')}</strong></td><td>${escHtml(cte.destino || '-')}/${escHtml(cte.ufDestino || '')}</td><td class="num">${dinheiro(cte.atual)}</td><td class="num">${dinheiro(cte.projetado)}</td><td class="${cte.ganhaHoje ? 'ganha' : 'perde'}">${cte.ganhaHoje ? 'GANHA' : 'PERDE'}</td><td class="${cte.ganhaProjetado ? 'ganha' : 'perde'}">${cte.ganhaProjetado ? (cte.converte ? 'PASSA A GANHAR' : 'GANHA') : 'PERDE'}</td></tr>`).join('');
    const aviso = reconciliado
      ? `<div class="note"><strong>${inteiro(convertidosCalculados)} CT-e(s)</strong> mudam de perde para ganha nesta rota/faixa. Os casos convertidos aparecem primeiro.</div>`
      : `<div class="note alerta"><strong>Projeção não reconciliada:</strong> o detalhe encontrou ${inteiro(convertidosCalculados)} conversões, diferente das ${inteiro(linha.ajuste.ctesConvertidos)} previstas. Recalcule a simulação antes de usar este laudo.</div>`;
    return `<tr class="selected"><td><strong>${escHtml(linha.rota)}</strong><details><summary>Ver CT-es e mudança de resultado (${inteiro(convertidosCalculados)} convertem)</summary><div class="cte-wrap">${aviso}<table><thead><tr><th>CT-e</th><th>Destino</th><th class="num">Tabela atual</th><th class="num">Tabela sugerida</th><th>Hoje</th><th>Projetado</th></tr></thead><tbody>${detalhe}</tbody></table>${ctes.length > 50 ? `<div class="note">Mostrando 50 de ${inteiro(ctes.length)} CT-es, com os casos convertidos primeiro.</div>` : ''}</div></details></td><td>${escHtml(linha.faixa || '-')}</td><td class="num">${inteiro(linha.ctes)}</td><td class="num">${inteiro(linha.ctesGanharia)}</td><td class="num">${inteiro(linha.ctesPerderia)}</td><td class="num">${pct(linha.aderenciaRota)}</td><td class="num">${pct(linha.reduzirPct)}</td><td class="num"><strong>${pct(linha.ajuste.reduzirPctSugerido)}</strong></td><td class="num"><strong>${inteiro(linha.ajuste.ctesConvertidos)}</strong></td><td class="num"><strong>${pct(linha.aderenciaProjetadaRota)}</strong></td></tr>`;
  };
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Laudo de projeção de aderência</title><style>
body{font-family:Arial,sans-serif;margin:0;color:#071a44;background:#f4f7fb}header{background:#071a44;color:#fff;padding:28px 34px}main{padding:28px 34px}h1{margin:0 0 8px;font-size:25px}h2{margin-top:28px;font-size:18px}.muted{color:#cbd5e1;font-size:13px}.cards{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:12px;margin:18px 0 24px}.card{background:#fff;border:1px solid #d8e1ef;border-radius:12px;padding:14px}.card span{display:block;color:#5d6b89;font-size:12px;font-weight:700}.card strong{display:block;margin-top:7px;font-size:22px}.project{background:#eef2ff;border-color:#a5b4fc}.goal{background:#fff7ed;border-color:#fdba74}.ok{color:#087f3f}.warn{color:#c2410c}.note{background:#fff;border-left:4px solid #1d4ed8;padding:12px 14px;margin:18px 0;line-height:1.5}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d8e1ef}th,td{border-bottom:1px solid #d8e1ef;padding:10px 9px;text-align:left;font-size:12px;vertical-align:top}th{background:#eef3fb;font-size:11px;text-transform:uppercase}td.num,th.num{text-align:right;white-space:nowrap}.selected{background:#fff7ed}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:800}.badge.keep{background:#e2e8f0;color:#475569}details{margin:5px 0}summary{cursor:pointer;color:#1d4ed8;font-weight:800;padding:7px 0}.cte-wrap{padding:10px;background:#f8fafc;border:1px solid #dbe3ef;border-radius:8px}.ganha{color:#087f3f;font-weight:800}.perde{color:#c1121f;font-weight:800}@media print{body{background:#fff}header,main{padding:18px}.cards{grid-template-columns:repeat(3,1fr)}}
</style></head><body><header><h1>Laudo de projeção de aderência</h1><div>${escHtml(dados.transportadora)} - ${escHtml(dados.periodo)} - Canal ${escHtml(resultado.filtros?.canal || 'Todos')}</div><div class="muted">Mesmo recorte do laudo de ajuste por rota, agora com a contraproposta necessária para a meta informada.</div></header><main>
<section class="cards"><div class="card"><span>CT-es com tabela</span><strong>${inteiro(plano.ctesComTabela)}</strong></div><div class="card"><span>Aderência atual</span><strong>${pct(plano.aderenciaAtual)}</strong></div><div class="card goal"><span>Meta mínima solicitada</span><strong>${pct(plano.meta)}</strong></div><div class="card project"><span>Aderência projetada</span><strong>${pct(plano.aderenciaProjetada)}</strong></div><div class="card"><span>Rotas/faixas a ajustar</span><strong>${inteiro(plano.ajustes.length)}</strong></div><div class="card"><span>CT-es ganhos hoje</span><strong>${inteiro(plano.ganhosAtuais)}</strong></div><div class="card project"><span>CT-es ganhos projetados</span><strong>${inteiro(plano.ganhosProjetados)}</strong></div><div class="card"><span>CT-es adicionais projetados</span><strong>${inteiro(plano.ganhosProjetados-plano.ganhosAtuais)}</strong></div><div class="card"><span>Faturamento atual nas ganhas</span><strong>${dinheiro(plano.faturamentoAtualNasGanhas)}</strong></div><div class="card project"><span>Faturamento projetado nas ganhas</span><strong>${dinheiro(plano.faturamentoProjetadoNasGanhas)}</strong></div><div class="card"><span>Faturamento hoje com concorrentes</span><strong>${dinheiro(plano.faturamentoConcorrentesHoje)}</strong></div><div class="card"><span>Faturamento projetado nas ganhas/mês</span><strong>${dinheiro(plano.faturamentoProjetadoNasGanhasMensal)}</strong></div><div class="card"><span>Situação</span><strong class="${plano.atingivel?'ok':'warn'}" style="font-size:15px">${status}</strong></div></section>
<div class="note"><strong>Direcionamento da contraproposta:</strong> ajustar as ${inteiro(plano.ajustes.length)} rota(s)/faixa(s) abaixo conforme os valores sugeridos. Reimporte a tabela e rode novamente a simulação para validar mínimos, taxas e ICMS.</div>
<h2>Rotas/faixas incluídas nesta meta</h2><table><thead><tr><th>Rota</th><th>Faixa</th><th class="num">CT-es</th><th class="num">Ganha hoje</th><th class="num">Perde hoje</th><th class="num">Aderência atual</th><th class="num">Redução média das perdas</th><th class="num">Redução sugerida</th><th class="num">CT-es convertidos</th><th class="num">Aderência projetada</th></tr></thead><tbody>${linhasAjustar.map(montarLinhaComCtes).join('')}</tbody></table>
<div class="note"><strong>Fora desta meta:</strong> ${inteiro(foraDaMeta.length)} rota(s)/faixa(s ainda possuem perdas, mas não foram necessárias para alcançar a meta informada. Isso não significa “manter” ou que estejam aderentes; elas devem voltar à priorização se a meta for aumentada.</div>
</main></body></html>`;
}

export function gerarWorkbookTabelaSugerida({ resultado = {}, negociacao = {}, meta = 0, margemCompetitiva = 0 } = {}) {
  const plano = planejarAjustesParaAderencia(resultado, meta, margemCompetitiva);
  const itens = negociacao.tabelas_negociacao_itens || negociacao.itens || [];
  if (!itens.length) throw new Error('Nao encontrei as linhas originais da tabela selecionada.');
  const ajustes = new Map(plano.ajustes.map((item) => [`${chave(item.rota)}|${chave(item.faixa)}`, item]));
  const ajustesPorRota = new Map(plano.ajustes.map((item) => [chave(item.rota), item]));

  const comparacoes = [];
  const linhas = itens.map((item) => {
    const original = linhaOriginalOuPadrao(item);
    const rota = nomeRota(item, original);
    const faixa = faixaItem(item, original);
    const ajuste = ajustes.get(`${chave(rota)}|${chave(faixa)}`) || ajustesPorRota.get(chave(rota));
    if (!ajuste) return original;
    const fator = 1 - (ajuste.reduzirPctSugerido / 100);
    const alterada = { ...original };
    let alterou = false;
    Object.keys(alterada).forEach((campo) => {
      if (!CAMPOS_PRECO.has(chave(campo)) || numero(alterada[campo]) <= 0) return;
      const atual = numero(alterada[campo]);
      alterada[campo] = reduzirValorOriginal(alterada[campo], fator);
      comparacoes.push({ rota, faixa, destino: original.cidadeDestino || original.cidade_destino || original.destino || '', ibge: original.ibgeDestino || original.ibge_destino || '', campo, atual, sugerido: numero(alterada[campo]), reducao: ajuste.reduzirPctSugerido / 100 });
      alterou = true;
    });
    if (!alterou) {
      ['frete_minimo', 'taxa_aplicada', 'frete_percentual', 'valor_excedente'].forEach((campo) => {
        if (numero(item[campo]) > 0) alterada[campo] = reduzirValorOriginal(item[campo], fator);
      });
    }
    return alterada;
  });

  const wb = XLSX.utils.book_new();
  const resumo = [
    ['TABELA SUGERIDA PARA ADERENCIA MINIMA'],
    ['Meta informada', plano.meta / 100], ['Aderencia atual', plano.aderenciaAtual / 100],
    ['Aderencia projetada', plano.aderenciaProjetada / 100], ['Meta projetada atingida', plano.atingivel ? 'SIM' : 'NAO'],
    ['CT-es com tabela', plano.ctesComTabela], ['CT-es ganhos atuais', plano.ganhosAtuais],
    ['CT-es ganhos projetados', plano.ganhosProjetados], [],
    ['Faturamento atual nas ganhas', Number(plano.faturamentoAtualNasGanhas.toFixed(2))],
    ['Faturamento projetado nas ganhas', Number(plano.faturamentoProjetadoNasGanhas.toFixed(2))],
    ['Faturamento hoje com concorrentes', Number(plano.faturamentoConcorrentesHoje.toFixed(2))],
    ['Faturamento capturado dos concorrentes', Number(plano.faturamentoCapturadoConcorrentes.toFixed(2))],
    ['Faturamento projetado nas ganhas mensal', Number(plano.faturamentoProjetadoNasGanhasMensal.toFixed(2))], [],
    ['Observacao', 'Projecao baseada no laudo por rota/faixa. Reimporte e simule a tabela para validar o resultado exato.'], [],
    ['Rota', 'Faixa', 'CT-es perdidos abrangidos', 'Reducao sugerida'],
    ...plano.ajustes.map((a) => [a.rota, a.faixa, a.ctesPerderia, a.reduzirPctSugerido / 100]),
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  wsResumo['!cols'] = [{ wch: 34 }, { wch: 28 }, { wch: 24 }, { wch: 22 }];
  wsResumo['!freeze'] = { xSplit: 0, ySplit: 1 };
  ['B2', 'B3', 'B4'].forEach((ref) => { if (wsResumo[ref]) wsResumo[ref].z = '0.00%'; });
  for (let i = 1; i <= resumo.length; i += 1) { const ref = `D${i}`; if (wsResumo[ref]) wsResumo[ref].z = '0.00%'; }
  XLSX.utils.book_append_sheet(wb, wsResumo, '1. Resumo executivo');
  const wsAjustes = XLSX.utils.json_to_sheet(comparacoes.map((item) => ({
    Rota: item.rota, Faixa: item.faixa, Destino: item.destino, 'IBGE destino': item.ibge,
    'Componente alterado': item.campo, 'Valor atual': item.atual, 'Valor sugerido': item.sugerido,
    'Diferença': Number((item.sugerido - item.atual).toFixed(4)), 'Redução sugerida': item.reducao,
  })));
  wsAjustes['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 18 }];
  wsAjustes['!autofilter'] = { ref: wsAjustes['!ref'] || 'A1:I1' };
  wsAjustes['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsAjustes, '2. Ajustes sugeridos');
  const camposTecnicos = new Set(['id', 'rodada', 'criadoem', 'atualizadoem', 'tabelanegociacaoid']);
  const colunasImportacao = [...new Set(linhas.flatMap((linha) => Object.keys(linha)))]
    .filter((campo) => !camposTecnicos.has(chave(campo)))
    .filter((campo) => linhas.some((linha) => linha[campo] !== null && linha[campo] !== undefined && linha[campo] !== ''));
  const linhasImportacao = linhas.map((linha) => Object.fromEntries(colunasImportacao.map((campo) => [campo, linha[campo] ?? ''])));
  const wsTabela = XLSX.utils.json_to_sheet(linhasImportacao, { header: colunasImportacao });
  wsTabela['!autofilter'] = { ref: wsTabela['!ref'] || 'A1:A1' };
  wsTabela['!freeze'] = { xSplit: 2, ySplit: 1 };
  wsTabela['!cols'] = colunasImportacao.map((campo) => ({ wch: Math.min(28, Math.max(12, campo.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, wsTabela, '3. Tabela para importar');
  return { workbook: wb, plano };
}
