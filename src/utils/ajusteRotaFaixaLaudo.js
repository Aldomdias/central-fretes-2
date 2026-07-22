import * as XLSX from 'xlsx';

export function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}
export function formatNumberBR(value, digits = 0) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
export function nomeArquivoSeguro(value, fallback = 'arquivo') {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || fallback;
}
export function periodoLaudoRealizado(resultado = {}) {
  const inicio = resultado.filtros?.inicio || '';
  const fim = resultado.filtros?.fim || '';
  if (inicio || fim) return `${inicio || 'início'} a ${fim || 'fim'}`;
  return 'período selecionado';
}

export const MAX_ITENS_AMOSTRA_POR_ROTA = 50;

export function rotuloTabelaLaudoAjuste(nome = 'Tabela') {
  const base = String(nome || 'Tabela')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .split('—')[0]
    .trim();
  if (!base) return 'Tabela';
  return /^tabela\b/i.test(base) ? base : `Tabela ${base}`;
}

export function chaveRotaFaixaLaudo(rota = '', faixa = '') {
  return `${String(rota || 'Sem rota/cotacao').trim()}||${String(faixa || '').trim()}`;
}

// Detalhe de calculo de UM CT-e pra mostrar no laudo do transportador: so os
// dados de entrada/saida (peso, %base, taxas, ICMS, Tabela RPA), NUNCA o
// "valor bruto do motor" ou qualquer correcao/discrepancia — isso e auditoria
// interna e nao pode ir pro transportador.
export function detalheCalculoCteTransportador(item = {}) {
  if (!item.selecionadaDetalhes) {
    const valorNF = Number(item.valorNF || 0);
    const freteCobrado = Number(item.freteBaseComparativa || 0);
    return {
      percentualBase: 0,
      percentualCobrado: valorNF > 0 ? (freteCobrado / valorNF) * 100 : 0,
      percentualCalc: 0,
      gris: 0,
      tas: 0,
      ctrc: 0,
      pedagio: 0,
      icms: 0,
      tabelaRpa: 0,
      taxaAplicadaTexto: '-',
    };
  }
  const frete = item.selecionadaDetalhes?.frete || item.vencedorDetalhes?.frete || {};
  const taxas = item.selecionadaDetalhes?.taxas || item.vencedorDetalhes?.taxas || {};
  const valorNF = Number(item.valorNF || 0);
  const freteCobrado = Number(item.freteBaseComparativa || 0);
  const totalOriginal = Number(item.freteSelecionada || frete.total || 0);
  const percentualBase = [frete.percentualAplicado, frete.percentual, frete.percentualNF, frete.percentualNf, frete.percentual_nf]
    .map(Number).find((v) => Number.isFinite(v) && v > 0) || 0;
  const valorKgAplicado = Number(frete.valorKgAplicado || frete.rsKgAplicado || frete.rsKg || frete.valorPorKg || 0);
  const valorFixoAplicado = Number(frete.valorFixoAplicado || frete.valorFaixa || frete.valorBaseFaixa || 0);
  const taxaAplicadaTexto = percentualBase > 0
    ? `${formatNumberBR(percentualBase, 2)}% NF`
    : (valorKgAplicado > 0
      ? `${formatMoney(valorKgAplicado)}/kg`
      : (valorFixoAplicado > 0 ? `${formatMoney(valorFixoAplicado)} fixo/faixa` : '-'));

  let tabelaRpa = totalOriginal;
  let icms = Number(frete.icms || 0);
  if (totalOriginal > 0 && valorNF > 0) {
    const nfCalculo = Number(frete.valorNFInformado || 0);
    let totalNormalizado = totalOriginal;
    if (nfCalculo > 0) {
      const ratioNf = nfCalculo / valorNF;
      if (ratioNf >= 1.5 || ratioNf <= 0.67) totalNormalizado = totalOriginal / ratioNf;
    }
    const somaTaxas =
      Number(taxas.adValorem || 0) + Number(taxas.gris || 0) + Number(taxas.pedagio || 0) + Number(taxas.tas || 0) +
      Number(taxas.ctrc || 0) + Number(taxas.tda || 0) + Number(taxas.tde || 0) + Number(taxas.tdr || 0) +
      Number(taxas.trt || 0) + Number(taxas.suframa || 0) + Number(taxas.outras || 0) + Number(taxas.taxaExtra || 0);
    const valorPercentual = percentualBase > 0 ? valorNF * (percentualBase / 100) : 0;
    const subtotalRecomposto = valorPercentual + somaTaxas;
    const aliquota = Number(frete.aliquotaIcms || 0) / 100;
    const icmsRecomposto = aliquota > 0 && aliquota < 1 ? (subtotalRecomposto / (1 - aliquota)) - subtotalRecomposto : 0;
    const totalRecomposto = subtotalRecomposto + icmsRecomposto;
    const percentualCalculado = (totalNormalizado / valorNF) * 100;
    const deveRecompor = percentualBase > 0 && percentualCalculado > percentualBase * 3 && totalRecomposto > 0;
    tabelaRpa = deveRecompor ? totalRecomposto : totalNormalizado;
    if (deveRecompor) icms = icmsRecomposto;
  }

  return {
    percentualBase,
    percentualCobrado: valorNF > 0 ? (freteCobrado / valorNF) * 100 : 0,
    percentualCalc: valorNF > 0 ? (tabelaRpa / valorNF) * 100 : 0,
    gris: Number(taxas.gris || 0),
    tas: Number(taxas.tas || 0),
    ctrc: Number(taxas.ctrc || 0),
    pedagio: Number(taxas.pedagio || 0),
    icms,
    tabelaRpa,
    taxaAplicadaTexto,
  };
}

// Monta o resumo por rota/cotacao do laudo de ajuste (cards + tabela), a
// partir do agregado COMPLETO da simulacao (resultado.rotasCotacao) — "rota"
// aqui e a cotacao cadastrada na tabela (rotaNome), nao a rota geografica.
// Cobre todos os CT-es do periodo, nao so a amostra de auditoria usada em
// ctesDetalhes. Usado tanto pela exportacao HTML quanto pela Excel, pra nao
// duplicar a logica de agrupamento/aderencia em dois lugares. Motor canonico
// tambem reaproveitado pelo laudo devolutiva e pelo laudo de rodadas.
export function montarDadosAjusteRotaFaixa(resultado = {}) {
  const r = resultado;
  const nomeTabelaLaudo = String(
    r.filtros?.transportadoraTabelaUsada ||
    r.filtros?.transportadora ||
    r.negociacaoNome ||
    'Tabela'
  ).replace(/\s*\([^)]*\)\s*$/g, '').trim() || 'Tabela';
  const rotuloTabelaLaudo = rotuloTabelaLaudoAjuste(nomeTabelaLaudo);
  const nomeCotacaoAmostra = (item) => item.selecionadaDetalhes?.frete?.rotaNome || item.vencedorDetalhes?.frete?.rotaNome || item.rotaSelecionada || 'Sem rota/cotacao';
  const normalizarCteLaudoExcel = (item) => {
    const valorNF = Number(item.valorNF || 0);
    const freteCobrado = Number(item.freteCobrado || item.freteBaseComparativa || 0);
    const tabelaRpa = Number(item.tabelaSimulacao || item.tabelaRpa || 0);
    return {
      cte: item.cte,
      canal: item.canal,
      peso: Number(item.peso || item.pesoConsiderado || 0),
      valorNF,
      freteBaseComparativa: freteCobrado,
      statusSelecionada: item.statusSelecionada,
      percentualBase: Number(item.percentualBase || 0),
      percentualCobrado: valorNF > 0 ? (freteCobrado / valorNF) * 100 : Number(item.percentualCobrado || 0),
      percentualCalc: valorNF > 0 ? (tabelaRpa / valorNF) * 100 : Number(item.percentualCalc || 0),
      taxaAplicadaTexto: item.taxaAplicadaTexto || (Number(item.percentualAplicado || item.percentualBase || 0) > 0
        ? `${formatNumberBR(Number(item.percentualAplicado || item.percentualBase || 0), 2)}% NF`
        : (Number(item.valorKgAplicado || 0) > 0
          ? `${formatMoney(Number(item.valorKgAplicado || 0))}/kg`
          : (Number(item.valorFixoAplicado || 0) > 0 ? `${formatMoney(Number(item.valorFixoAplicado || 0))} fixo/faixa` : '-'))),
      gris: Number(item.gris || 0),
      tas: Number(item.tas || 0),
      ctrc: Number(item.ctrc || 0),
      pedagio: Number(item.pedagio || 0),
      icms: Number(item.icms || 0),
      tabelaRpa,
    };
  };
  const ctesCompletosPorRota = new Map();
  (r.ctesAjusteRotaExcel || []).forEach((item) => {
    const chave = chaveRotaFaixaLaudo(item.rota || 'Sem rota/cotacao', item.faixaPeso || '');
    if (!ctesCompletosPorRota.has(chave)) ctesCompletosPorRota.set(chave, []);
    ctesCompletosPorRota.get(chave).push(normalizarCteLaudoExcel(item));
  });
  // Agrupa a amostra de auditoria (ctesDetalhes) pela mesma cotacao usada no
  // agregado completo, pra poder abrir "quais CT-es sao esses" ao clicar na
  // rota — sem depender da amostra pra fechar os totais da linha.
  const amostraPorRota = new Map();
  (r.ctesDetalhes || []).forEach((item) => {
    const chave = nomeCotacaoAmostra(item);
    if (!amostraPorRota.has(chave)) amostraPorRota.set(chave, []);
    amostraPorRota.get(chave).push(item);
  });
  const linhas = (r.rotasCotacao || []).map((rota) => {
    const ctes = Number(rota.ctes || 0);
    let ctesSemCalculo = Number(rota.ctesSemCalculo || 0);
    let ctesComCalculo = Math.max(0, ctes - ctesSemCalculo);
    let ctesGanharia = Number(rota.ctesGanharia || 0);
    let ctesPerderia = Number(rota.ctesPerderia || 0);
    const valorNF = Number(rota.valorNF || 0);
    const freteRealizado = Number(rota.freteRealizado || 0);
    const faixaRota = rota.faixaPeso || rota.faixa || '';
    const itensRotaCompletos = ctesCompletosPorRota.get(chaveRotaFaixaLaudo(rota.nome, faixaRota)) || [];
    const itensRotaAmostra = itensRotaCompletos.length ? itensRotaCompletos : (Array.isArray(rota.itensAmostra) && rota.itensAmostra.length
      ? rota.itensAmostra
      : (amostraPorRota.get(rota.nome) || []));
    const itensRotaDetalhados = itensRotaCompletos.length ? itensRotaCompletos : itensRotaAmostra.map((item) => ({
      cte: item.cte,
      canal: item.canal,
      peso: Number(item.peso || 0),
      valorNF: Number(item.valorNF || 0),
      freteBaseComparativa: Number(item.freteBaseComparativa || 0),
      statusSelecionada: item.statusSelecionada,
      ...detalheCalculoCteTransportador(item),
    }));
    const detalheCompletoDaRota = itensRotaDetalhados.length === ctes && ctes > 0;
    const itensComCalculoDetalhado = itensRotaDetalhados.filter((item) => Number(item.tabelaRpa || 0) > 0 && Number(item.freteBaseComparativa || 0) > 0);
    const itensGanhariaDetalhado = itensComCalculoDetalhado.filter((item) => Number(item.tabelaRpa || 0) <= Number(item.freteBaseComparativa || 0));
    const itensPerderiaDetalhado = itensComCalculoDetalhado.filter((item) => Number(item.tabelaRpa || 0) > Number(item.freteBaseComparativa || 0));
    const freteRealizadoPerderiaDetalhado = itensPerderiaDetalhado
      .reduce((acc, item) => acc + Number(item.freteBaseComparativa || 0), 0);
    const freteTabela = Number(rota.freteTabela || rota.freteTabelaLaudo || 0);
    const freteTabelaGanharia = Number(rota.freteTabelaGanharia || rota.freteTabelaGanhariaLaudo || 0);
    const itensAmostra = itensRotaDetalhados.slice(0, MAX_ITENS_AMOSTRA_POR_ROTA);
    return {
      rota: rota.nome,
      faixa: faixaRota,
      ctes,
      ctesSemCalculo,
      ctesGanharia,
      ctesPerderia,
      valorNF,
      freteRealizado,
      freteTabela,
      freteTabelaGanharia,
      freteRealizadoPerderia: Number(rota.freteRealizadoPerderia || (detalheCompletoDaRota ? freteRealizadoPerderiaDetalhado : 0) || 0),
      pctRealizado: Number(rota.percentualFreteRealizado || 0),
      pctTabelaFinal: valorNF > 0 ? (freteTabela / valorNF) * 100 : Number(rota.percentualFreteSelecionada || 0),
      aderenciaRota: ctesComCalculo > 0 ? (ctesGanharia / ctesComCalculo) * 100 : 0,
      reduzirPct: Number(rota.reducaoMediaNecessariaLaudo || rota.reducaoMediaNecessaria || 0),
      diferenca: freteTabela - freteRealizado,
      peso: Number(rota.peso || 0),
      volumes: Number(rota.volumes || 0),
      volumesGanharia: Number(rota.volumesGanharia || 0),
      pesoGanharia: Number(rota.pesoGanharia || 0),
      itensAmostra,
      itensAmostraIncompleta: itensAmostra.length < ctes,
    };
  }).sort((a, b) => b.ctes - a.ctes);

  const totais = linhas.reduce((acc, item) => {
    acc.ctes += item.ctes;
    acc.ctesSemCalculo += item.ctesSemCalculo;
    acc.ctesGanharia += item.ctesGanharia;
    acc.ctesPerderia += item.ctesPerderia;
    acc.valorNF += item.valorNF;
    acc.freteRealizado += item.freteRealizado;
    acc.freteTabela += item.freteTabela;
    acc.freteTabelaGanharia += item.freteTabelaGanharia;
    acc.freteRealizadoPerderia += item.freteRealizadoPerderia;
    acc.peso += item.peso;
    acc.volumes += item.volumes;
    acc.volumesGanharia += item.volumesGanharia;
    acc.pesoGanharia += item.pesoGanharia;
    return acc;
  }, { ctes: 0, ctesSemCalculo: 0, ctesGanharia: 0, ctesPerderia: 0, valorNF: 0, freteRealizado: 0, freteTabela: 0, freteTabelaGanharia: 0, freteRealizadoPerderia: 0, peso: 0, volumes: 0, volumesGanharia: 0, pesoGanharia: 0 });

  const ctesResultado = Number(r.ctesAnalisados || 0);
  const ctesForaAgrupamento = Math.max(0, ctesResultado - totais.ctes);
  if (ctesForaAgrupamento > 0) {
    const ctesSemCalculoSaldo = Math.max(0, Number(r.ctesSemTabelaSelecionada || 0) - totais.ctesSemCalculo);
    const linhaSemRota = {
      rota: 'Sem rota/cotacao no resultado salvo',
      ctes: ctesForaAgrupamento,
      ctesSemCalculo: ctesSemCalculoSaldo,
      ctesGanharia: Math.max(0, Number(r.ctesGanhariaSelecionada || 0) - totais.ctesGanharia),
      ctesPerderia: Math.max(0, Number(r.ctesPerdidosSelecionada || 0) - totais.ctesPerderia),
      valorNF: Math.max(0, Number(r.valorNF || 0) - totais.valorNF),
      freteRealizado: Math.max(0, Number(r.freteRealizado || 0) - totais.freteRealizado),
      freteTabela: Math.max(0, Number(r.freteSelecionada || 0) - totais.freteTabela),
      freteTabelaGanharia: Math.max(0, Number(r.freteSelecionadaGanhadora || 0) - totais.freteTabelaGanharia),
      freteRealizadoPerderia: 0,
      pctRealizado: 0,
      pctTabelaFinal: 0,
      aderenciaRota: 0,
      reduzirPct: 0,
      diferenca: 0,
      peso: Math.max(0, Number(r.peso || 0) - totais.peso),
      volumes: Math.max(0, Number(r.volumes || 0) - totais.volumes),
      volumesGanharia: Math.max(0, Number(r.volumesGanhariaSelecionada || 0) - totais.volumesGanharia),
      pesoGanharia: Math.max(0, Number(r.pesoGanhariaSelecionada || 0) - totais.pesoGanharia),
      itensAmostra: [],
      itensAmostraIncompleta: true,
      avisoIncompleto: true,
    };
    linhaSemRota.pctRealizado = linhaSemRota.valorNF > 0 ? (linhaSemRota.freteRealizado / linhaSemRota.valorNF) * 100 : 0;
    linhaSemRota.pctTabelaFinal = linhaSemRota.valorNF > 0 ? (linhaSemRota.freteTabela / linhaSemRota.valorNF) * 100 : 0;
    const ctesComCalculoSemRota = Math.max(0, linhaSemRota.ctes - linhaSemRota.ctesSemCalculo);
    linhaSemRota.aderenciaRota = ctesComCalculoSemRota > 0 ? (linhaSemRota.ctesGanharia / ctesComCalculoSemRota) * 100 : 0;
    linhaSemRota.reduzirPct = linhaSemRota.pctTabelaFinal > linhaSemRota.pctRealizado && linhaSemRota.pctTabelaFinal > 0
      ? ((linhaSemRota.pctTabelaFinal - linhaSemRota.pctRealizado) / linhaSemRota.pctTabelaFinal) * 100
      : 0;
    linhaSemRota.diferenca = linhaSemRota.freteTabela - linhaSemRota.freteRealizado;
    linhas.push(linhaSemRota);
    totais.ctes += linhaSemRota.ctes;
    totais.ctesSemCalculo += linhaSemRota.ctesSemCalculo;
    totais.ctesGanharia += linhaSemRota.ctesGanharia;
    totais.ctesPerderia += linhaSemRota.ctesPerderia;
    totais.valorNF += linhaSemRota.valorNF;
    totais.freteRealizado += linhaSemRota.freteRealizado;
    totais.freteTabela += linhaSemRota.freteTabela;
    totais.freteTabelaGanharia += linhaSemRota.freteTabelaGanharia;
    totais.freteRealizadoPerderia += linhaSemRota.freteRealizadoPerderia;
    totais.peso += linhaSemRota.peso;
    totais.volumes += linhaSemRota.volumes;
    totais.volumesGanharia += linhaSemRota.volumesGanharia;
    totais.pesoGanharia += linhaSemRota.pesoGanharia;
  }
  totais.freteTotalAnalisado = Number(r.freteRealizado || totais.freteRealizado || 0);
  if (r.ctesAnalisados !== undefined) totais.ctes = Number(r.ctesAnalisados || 0);
  if (r.ctesComTabelaSelecionada !== undefined) totais.ctesSemCalculo = Math.max(0, Number(r.ctesAnalisados || 0) - Number(r.ctesComTabelaSelecionada || 0));
  else if (r.ctesSemTabelaSelecionada !== undefined) totais.ctesSemCalculo = Number(r.ctesSemTabelaSelecionada || 0);
  if (r.ctesGanhariaSelecionada !== undefined) totais.ctesGanharia = Number(r.ctesGanhariaSelecionada || 0);
  if (r.ctesPerdidosSelecionada !== undefined) totais.ctesPerderia = Number(r.ctesPerdidosSelecionada || 0);
  if (r.freteRealizadoComTabelaSelecionada !== undefined) totais.freteRealizado = Number(r.freteRealizadoComTabelaSelecionada || 0);
  else if (r.freteRealizado !== undefined) totais.freteRealizado = Number(r.freteRealizado || 0);
  if (r.freteSelecionada !== undefined) totais.freteTabela = Number(r.freteSelecionada || 0);
  if (r.valorNFComTabelaSelecionada !== undefined) totais.valorNF = Number(r.valorNFComTabelaSelecionada || 0);
  if (r.freteSelecionadaGanhadora !== undefined) totais.freteTabelaGanharia = Number(r.freteSelecionadaGanhadora || 0);
  if (r.freteRealizadoComTabelaSelecionada !== undefined || r.freteRealizadoGanhariaSelecionada !== undefined) {
    totais.freteRealizadoPerderia = Math.max(0, Number(r.freteRealizadoComTabelaSelecionada || 0) - Number(r.freteRealizadoGanhariaSelecionada || 0));
  }
  if (r.peso !== undefined) totais.peso = Number(r.peso || 0);
  if (r.volumes !== undefined) totais.volumes = Number(r.volumes || 0);
  if (r.volumesGanhariaSelecionada !== undefined) totais.volumesGanharia = Number(r.volumesGanhariaSelecionada || 0);
  if (r.pesoGanhariaSelecionada !== undefined) totais.pesoGanharia = Number(r.pesoGanhariaSelecionada || 0);
  const pctRealizadoTotal = r.percentualFreteRealizadoComTabela !== undefined
    ? Number(r.percentualFreteRealizadoComTabela || 0)
    : (totais.valorNF > 0 ? (totais.freteRealizado / totais.valorNF) * 100 : 0);
  const pctTabelaTotal = r.percentualFreteSelecionadaComTabela !== undefined
    ? Number(r.percentualFreteSelecionadaComTabela || 0)
    : (totais.valorNF > 0 ? (totais.freteTabela / totais.valorNF) * 100 : 0);
  const ctesComCalculoTotal = Number(r.ctesComTabelaSelecionada || Math.max(0, totais.ctes - totais.ctesSemCalculo));
  const linhasAtendidas = linhas.filter((linha) => {
    const ctesComResultadoTabela = Number(linha.ctesGanharia || 0) + Number(linha.ctesPerderia || 0);
    return ctesComResultadoTabela > 0 || Number(linha.freteTabela || 0) > 0;
  });
  // "Aderencia da tabela" = taxa de vitoria: dos CT-es que tinham calculo,
  // quantos a Tabela RPA ganharia do realizado. Mesma formula da "Aderencia
  // rota" de cada linha — "Sem calculo" ja aparece em card separado pra
  // mostrar a cobertura.
  const aderenciaTotal = r.aderenciaSelecionada !== undefined
    ? Number(r.aderenciaSelecionada || 0)
    : (ctesComCalculoTotal > 0 ? (totais.ctesGanharia / ctesComCalculoTotal) * 100 : 0);
  const reduzirTotal = r.reducaoMediaNecessaria !== undefined
    ? Number(r.reducaoMediaNecessaria || 0)
    : (pctTabelaTotal > pctRealizadoTotal && pctTabelaTotal > 0
    ? ((pctTabelaTotal - pctRealizadoTotal) / pctTabelaTotal) * 100
    : 0);
  const dias = Math.max(1, Number(r.dias || 0));
  const meses = Math.max(1, Number(r.meses || 0));
  const volumesAtendidos = Number(r.volumesComTabelaSelecionada || 0)
    || linhasAtendidas.reduce((acc, item) => acc + Number(item.volumes || 0), 0);
  const volumesAtendidosPorDia = volumesAtendidos / dias;
  // Volumes/dia só das rotas que a Tabela RPA ganharia — projecao de quanto
  // ela de fato carregaria por dia, nao o volume total do periodo analisado.
  const volumesGanhariaPorDia = totais.volumesGanharia / dias;
  const pedidosAtendidosTotal = Number(r.pedidosComTabelaSelecionada || 0);
  const savingPeriodo = Number(r.savingSelecionadaVsReal || 0)
    || Math.max(Number(r.freteRealizadoGanhariaSelecionada || 0) - Number(totais.freteTabelaGanharia || 0), 0);
  const savingMensal = Number(r.savingSelecionadaVsRealMes || 0) || (meses ? savingPeriodo / meses : savingPeriodo);
  const savingAnual = Number(r.savingSelecionadaVsRealAno || 0) || (savingMensal * 12);

  const transportadora = r.filtros?.transportadoraTabelaUsada || r.filtros?.transportadora || 'Transportadora';
  const periodo = periodoLaudoRealizado(r) || `${r.filtros?.inicio || ''} a ${r.filtros?.fim || ''}`;

  return {
    linhas, linhasAtendidas, totais, transportadora, periodo,
    nomeTabelaLaudo, rotuloTabelaLaudo,
    pctRealizadoTotal, pctTabelaTotal, aderenciaTotal, reduzirTotal,
    dias, meses, ctesComCalculoTotal, volumesAtendidosPorDia, volumesGanhariaPorDia, pedidosAtendidosTotal,
    savingPeriodo, savingMensal, savingAnual,
  };
}

export function prepararAnaliseRotaFaixaParaNegociacao(resultado = {}, { incluirHtml = true } = {}) {
  if (!resultado?.rotasCotacao?.length) return null;

  const dados = montarDadosAjusteRotaFaixa(resultado);
  const limitarAmostra = (itens = []) => itens.slice(0, MAX_ITENS_AMOSTRA_POR_ROTA).map((item) => ({
    cte: item.cte,
    canal: item.canal,
    destino: item.destino,
    peso: item.peso,
    valorNF: item.valorNF,
    freteBaseComparativa: item.freteBaseComparativa,
    tabelaRpa: item.tabelaRpa,
    percentualBase: item.percentualBase,
    percentualCobrado: item.percentualCobrado,
    percentualCalc: item.percentualCalc,
    taxaAplicadaTexto: item.taxaAplicadaTexto,
    gris: item.gris,
    tas: item.tas,
    ctrc: item.ctrc,
    pedagio: item.pedagio,
    icms: item.icms,
  }));

  return {
    tipo: 'analise_rota_faixa_transportador',
    geradoEm: new Date().toISOString(),
    transportadora: dados.transportadora,
    periodo: dados.periodo,
    nomeTabela: dados.nomeTabelaLaudo,
    rotuloTabela: dados.rotuloTabelaLaudo,
    totais: {
      ...dados.totais,
      ctesComCalculoTotal: dados.ctesComCalculoTotal,
      pctRealizadoTotal: dados.pctRealizadoTotal,
      pctTabelaTotal: dados.pctTabelaTotal,
      aderenciaTotal: dados.aderenciaTotal,
      reduzirTotal: dados.reduzirTotal,
      volumesAtendidosPorDia: dados.volumesAtendidosPorDia,
      volumesGanhariaPorDia: dados.volumesGanhariaPorDia,
      pedidosAtendidosTotal: dados.pedidosAtendidosTotal,
      savingPeriodo: dados.savingPeriodo,
      savingMensal: dados.savingMensal,
      savingAnual: dados.savingAnual,
    },
    linhas: dados.linhasAtendidas.map((linha) => ({
      ...linha,
      itensAmostra: limitarAmostra(linha.itensAmostra || []),
    })),
    laudoHtml: incluirHtml ? gerarHtmlAjusteRotaFaixa(resultado, { incluirSavingGerencial: true }) : undefined,
  };
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

// Gera o HTML do laudo de ajuste por rota a partir do resultado bruto da
// simulacao (mesmo formato usado pelo Simulador). Usado tambem pelo laudo
// devolutiva consolidado (varias origens) e pelo laudo de rodadas.
export function gerarHtmlAjusteRotaFaixa(resultado = {}, { incluirSavingGerencial = false, tituloLaudo = 'Laudo de ajuste por rota' } = {}) {
  const r = resultado;
  const esc = escHtml;
  const {
    linhasAtendidas, totais, transportadora, periodo,
    rotuloTabelaLaudo,
    pctRealizadoTotal, pctTabelaTotal, aderenciaTotal, reduzirTotal,
    ctesComCalculoTotal, volumesAtendidosPorDia, volumesGanhariaPorDia, pedidosAtendidosTotal,
    savingPeriodo, savingMensal, savingAnual,
  } = montarDadosAjusteRotaFaixa(r);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${esc(tituloLaudo)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; color: #071a44; background: #f4f7fb; }
    header { background: #071a44; color: #fff; padding: 28px 34px; }
    main { padding: 28px 34px; }
    h1 { margin: 0 0 8px; font-size: 25px; }
    h2 { margin-top: 28px; font-size: 18px; }
    .muted { color: #5d6b89; font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(6, minmax(135px, 1fr)); gap: 12px; margin: 18px 0 24px; }
    .card { background: #fff; border: 1px solid #d8e1ef; border-radius: 12px; padding: 14px; }
    .card span { display: block; color: #5d6b89; font-size: 12px; font-weight: 700; }
    .card strong { display: block; margin-top: 7px; font-size: 22px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8e1ef; }
    th, td { border-bottom: 1px solid #d8e1ef; padding: 10px 9px; text-align: left; font-size: 12px; vertical-align: top; }
    th { background: #eef3fb; font-size: 11px; text-transform: uppercase; letter-spacing: .02em; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .reduce { color: #c1121f; font-weight: 800; }
    .ok { color: #087f3f; font-weight: 800; }
    .note { background: #fff; border-left: 4px solid #1d4ed8; padding: 12px 14px; margin: 18px 0; }
    .alerta { color: #c1121f; font-weight: 800; }
    .muted-cell { color: #94a3b8; }
    .rpa-cell, th.rpa-col { background: #eef2ff; color: #3730a3; font-weight: 800; }
    .linha-expansivel { cursor: pointer; }
    .linha-expansivel:hover { background: #f7fbff; }
    .linha-detalhe { display: none; background: #fbfdff; }
    .linha-detalhe.aberta { display: table-row; }
    .mini-table { margin-top: 8px; font-size: 11px; }
    .mini-table th, .mini-table td { padding: 6px; font-size: 11px; }
    @media print { body { background: #fff; } header, main { padding: 18px; } .cards { grid-template-columns: repeat(3, 1fr); } }
  </style>
</head>
<body>
  <header>
    <h1>${esc(tituloLaudo)}</h1>
    <div>${esc(transportadora)} - ${esc(periodo)} - Canal ${esc(r.filtros?.canal || 'Todos')}</div>
    <div class="muted">Comparativo entre o frete cobrado no CT-e e a ${esc(rotuloTabelaLaudo)} simulada, agrupado por rota. Cobre 100% dos CT-es do periodo (nao e uma amostra).</div>
  </header>
  <main>
    <section class="cards">
      <div class="card"><span>CT-es com tabela</span><strong>${formatNumberBR(ctesComCalculoTotal, 0)}</strong></div>
      <div class="card"><span>Fora da tabela</span><strong>${formatNumberBR(totais.ctesSemCalculo, 0)}</strong></div>
      <div class="card"><span>Rotas atendidas</span><strong>${formatNumberBR(linhasAtendidas.length, 0)}</strong></div>
      <div class="card"><span>Ganharia</span><strong>${formatNumberBR(totais.ctesGanharia, 0)}</strong></div>
      <div class="card"><span>Perderia</span><strong>${formatNumberBR(totais.ctesPerderia, 0)}</strong></div>
      <div class="card"><span>Aderencia da tabela</span><strong>${formatPercent(aderenciaTotal)}</strong></div>
      <div class="card"><span>Faturamento atual</span><strong>${formatMoney(totais.freteRealizado)}</strong></div>
      <div class="card rpa-cell"><span>Faturamento ${esc(rotuloTabelaLaudo)}</span><strong>${formatMoney(totais.freteTabela)}</strong></div>
      <div class="card"><span>Faturamento ${esc(rotuloTabelaLaudo)} nas ganhas</span><strong>${formatMoney(totais.freteTabelaGanharia)}</strong></div>
      ${incluirSavingGerencial ? `
      <div class="card"><span>Saving no periodo</span><strong>${formatMoney(savingPeriodo)}</strong></div>
      <div class="card"><span>Saving mensal</span><strong>${formatMoney(savingMensal)}</strong></div>
      <div class="card"><span>Saving anual</span><strong>${formatMoney(savingAnual)}</strong></div>` : ''}
      <div class="card"><span>% realizado medio</span><strong>${formatPercent(pctRealizadoTotal)}</strong></div>
      <div class="card"><span>% ${esc(rotuloTabelaLaudo)}</span><strong>${formatPercent(pctTabelaTotal)}</strong></div>
      <div class="card"><span>Reducao media sugerida</span><strong>${formatPercent(reduzirTotal)}</strong></div>
      <div class="card"><span>Perdendo p/ outras transportadoras</span><strong>${formatMoney(totais.freteRealizadoPerderia)}</strong></div>
      <div class="card"><span>Volumes/dia (base atendida)</span><strong>${formatNumberBR(volumesAtendidosPorDia, 1)}</strong></div>
      <div class="card rpa-cell"><span>Volumes/dia (rotas ganhas)</span><strong>${formatNumberBR(volumesGanhariaPorDia, 1)}</strong></div>
      ${pedidosAtendidosTotal > 0 ? `<div class="card"><span>Pedidos (base atendida)</span><strong>${formatNumberBR(pedidosAtendidosTotal, 0)}</strong></div>` : ''}
    </section>
    <div class="note">
      <strong>Como ler os cards:</strong> Os valores financeiros e percentuais consideram apenas os CT-es em rotas/faixas atendidas pela ${esc(rotuloTabelaLaudo)}.
      "Fora da tabela" mostra o volume do recorte que ficou sem cobertura e nao entra no faturamento, aderencia, percentuais ou reducao sugerida.
      Aderencia da tabela = dos CT-es com calculo, % em que a ${esc(rotuloTabelaLaudo)} ganharia do frete realizado (mesma logica da Aderencia de cada rota).
      Faturamento atual = soma do frete cobrado apenas nos CT-es onde a ${esc(rotuloTabelaLaudo)} encontrou cobertura. Faturamento ${esc(rotuloTabelaLaudo)} = soma da tabela simulada nessa mesma base calculavel.
      Faturamento ${esc(rotuloTabelaLaudo)} nas ganhas = apenas o recorte em que a tabela ficaria competitiva contra o frete atual.
      ${incluirSavingGerencial ? 'Saving = economia nas rotas ganhas, projetada pelo periodo, por mes e em 12 meses.' : ''}
      % realizado medio e % ${esc(rotuloTabelaLaudo)} = frete cobrado / tabela simulada sobre o valor NF total, na mesma base.
      Reducao media sugerida = quanto a ${esc(rotuloTabelaLaudo)} precisaria cair, em media, nas rotas onde ela ficou mais cara que o realizado.
      Perdendo = frete realizado nas rotas em que ela perderia para outra transportadora.
      "Volumes/dia (base atendida)" e o volume das rotas/faixas atendidas dividido pelos dias; "Volumes/dia (rotas ganhas)" e so o volume dos CT-es onde a ${esc(rotuloTabelaLaudo)} ganharia — a projecao real de quanto ela carregaria por dia.
    </div>
    <h2>Resumo por rota (ordenado por quantidade de CT-es)</h2>
    <div class="note">Clique numa rota para ver os CT-es dela. A abertura mostra ate ${formatNumberBR(MAX_ITENS_AMOSTRA_POR_ROTA, 0)} CT-es por rota/cotacao para conferir o calculo; os totais da linha da rota (CT-es, Ganharia, Perderia etc.) sempre somam 100% do periodo, mesmo quando a lista expandida for uma amostra.</div>
    <table>
      <thead><tr><th>Rota</th><th>Faixa</th><th class="num">CT-es</th><th class="num">Sem calc.</th><th class="num">Ganharia</th><th class="num">Perderia</th><th class="num">Aderencia rota</th><th class="num">Valor NF</th><th class="num">Frete cobrado</th><th class="num rpa-col">${esc(rotuloTabelaLaudo)}</th><th class="num">% cobrado</th><th class="num rpa-col">% ${esc(rotuloTabelaLaudo)}</th><th class="num">Reduzir</th></tr></thead>
      <tbody>${linhasAtendidas.map((item, idx) => {
        const detalheId = `rota-${idx}`;
        const linhasCte = item.itensAmostra.map((cte) => `<tr><td><strong>${esc(cte.cte)}</strong></td><td>${esc(cte.canal || '-')}</td><td class="num">${formatNumberBR(cte.peso, 2)}</td><td class="num">${formatMoney(cte.valorNF)}</td><td class="num">${formatMoney(cte.freteBaseComparativa)}</td><td class="num rpa-cell">${cte.tabelaRpa > 0 ? formatMoney(cte.tabelaRpa) : '-'}</td><td class="num">${formatPercent(cte.percentualCobrado)}</td><td class="num rpa-cell">${formatPercent(cte.percentualCalc)}</td><td class="num">${formatPercent(cte.percentualBase)}</td><td>${esc(cte.taxaAplicadaTexto || '-')}</td><td class="num">${formatMoney(cte.gris)}</td><td class="num">${formatMoney(cte.tas)}</td><td class="num">${formatMoney(cte.ctrc)}</td><td class="num">${formatMoney(cte.pedagio)}</td><td class="num">${formatMoney(cte.icms)}</td><td>${esc(cte.statusSelecionada || '-')}</td></tr>`).join('');
        const avisoAmostra = item.itensAmostraIncompleta
          ? `<div class="note">Mostrando ${formatNumberBR(item.itensAmostra.length, 0)} de ${formatNumberBR(item.ctes, 0)} CT-e(s) desta rota (amostra de auditoria, limite de ${formatNumberBR(MAX_ITENS_AMOSTRA_POR_ROTA, 0)} por rota — nao e a lista completa).</div>`
          : '';
        const corpoDetalhe = item.avisoIncompleto
          ? '<div class="note">Esta parte veio de uma analise salva sem o agrupamento detalhado por rota/cotacao. Os valores entram nos cards e totais, mas nao ha CT-es detalhados para abrir. Para detalhar rota a rota, recalcule ou unifique parcelas salvas ja com o novo formato.</div>'
          : item.itensAmostra.length
          ? `${avisoAmostra}<table class="mini-table"><thead><tr><th>CT-e</th><th>Canal</th><th class="num">Peso</th><th class="num">Valor NF</th><th class="num">Frete cobrado</th><th class="num rpa-col">${esc(rotuloTabelaLaudo)}</th><th class="num">% cobrado</th><th class="num rpa-col">% ${esc(rotuloTabelaLaudo)}</th><th class="num">% base</th><th>Taxa aplicada</th><th class="num">GRIS</th><th class="num">TAS</th><th class="num">CTRC</th><th class="num">Pedagio</th><th class="num">ICMS</th><th>Status</th></tr></thead><tbody>${linhasCte}</tbody></table>`
          : '<div class="note">Nenhum CT-e desta rota está na amostra de auditoria disponível.</div>';
        return `<tr class="linha-expansivel" onclick="document.getElementById('${detalheId}').classList.toggle('aberta')"><td><strong>${esc(item.rota)}</strong></td><td>${esc(item.faixa || '-')}</td><td class="num">${formatNumberBR(item.ctes, 0)}</td><td class="num">${formatNumberBR(item.ctesSemCalculo, 0)}</td><td class="num">${formatNumberBR(item.ctesGanharia, 0)}</td><td class="num">${formatNumberBR(item.ctesPerderia, 0)}</td><td class="num">${formatPercent(item.aderenciaRota)}</td><td class="num">${formatMoney(item.valorNF)}</td><td class="num">${formatMoney(item.freteRealizado)}</td><td class="num rpa-cell">${formatMoney(item.freteTabela)}</td><td class="num">${formatPercent(item.pctRealizado)}</td><td class="num rpa-cell">${formatPercent(item.pctTabelaFinal)}</td><td class="num ${item.reduzirPct > 0 ? 'reduce' : 'ok'}">${item.reduzirPct > 0 ? formatPercent(item.reduzirPct) : 'OK'}</td></tr><tr id="${detalheId}" class="linha-detalhe"><td colspan="13">${corpoDetalhe}</td></tr>`;
      }).join('')}</tbody>
    </table>
  </main>
</body>
</html>`;
}

// Mesmo laudo de ajuste rota, em Excel: aba de resumo (cards), aba com o
// resumo por rota e aba com a amostra de ajustes do motor de calculo.
// Retorna o workbook (XLSX) para o chamador decidir nome do arquivo/gravacao.
export function gerarWorkbookAjusteRotaFaixa(resultado = {}, { incluirSavingGerencial = false } = {}) {
  const {
    linhasAtendidas, totais, transportadora, periodo,
    rotuloTabelaLaudo,
    pctRealizadoTotal, pctTabelaTotal, aderenciaTotal, reduzirTotal,
    ctesComCalculoTotal, volumesAtendidosPorDia, volumesGanhariaPorDia, pedidosAtendidosTotal,
    savingPeriodo, savingMensal, savingAnual,
  } = montarDadosAjusteRotaFaixa(resultado);

  const linhasResumo = [
    ['Laudo de ajuste por rota'],
    ['Transportadora', transportadora],
    ['Periodo', periodo],
    [],
    ['CT-es com tabela', ctesComCalculoTotal],
    ['Fora da tabela', totais.ctesSemCalculo],
    ['Rotas atendidas', linhasAtendidas.length],
    ['Ganharia', totais.ctesGanharia],
    ['Perderia', totais.ctesPerderia],
    ['Faturamento atual', Number(totais.freteRealizado.toFixed(2))],
    [`Faturamento ${rotuloTabelaLaudo}`, Number(totais.freteTabela.toFixed(2))],
    [`Faturamento ${rotuloTabelaLaudo} nas ganhas`, Number(totais.freteTabelaGanharia.toFixed(2))],
    ...(incluirSavingGerencial ? [
      ['Saving no periodo', Number(savingPeriodo.toFixed(2))],
      ['Saving mensal', Number(savingMensal.toFixed(2))],
      ['Saving anual', Number(savingAnual.toFixed(2))],
    ] : []),
    ['Aderencia da tabela (%)', Number(aderenciaTotal.toFixed(2))],
    ['% realizado medio', Number(pctRealizadoTotal.toFixed(2))],
    [`% ${rotuloTabelaLaudo}`, Number(pctTabelaTotal.toFixed(2))],
    ['Reducao media sugerida (%)', Number(reduzirTotal.toFixed(2))],
    ['Perdendo para outras transportadoras', Number(totais.freteRealizadoPerderia.toFixed(2))],
    ['Volumes/dia (base atendida)', Number(volumesAtendidosPorDia.toFixed(2))],
    ['Volumes/dia (rotas ganhas)', Number(volumesGanhariaPorDia.toFixed(2))],
    ...(pedidosAtendidosTotal > 0 ? [['Pedidos (base atendida)', pedidosAtendidosTotal]] : []),
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(linhasResumo);
  wsResumo['!cols'] = [{ wch: 36 }, { wch: 22 }];

  const headerRota = ['Rota', 'Faixa', 'CT-es', 'Sem calculo', 'Ganharia', 'Perderia', 'Aderencia rota (%)', 'Valor NF', 'Frete cobrado', rotuloTabelaLaudo, '% cobrado', `% ${rotuloTabelaLaudo}`, 'Reduzir (%)'];
  const linhasRota = linhasAtendidas.map((item) => [
    item.rota, item.faixa || '', item.ctes, item.ctesSemCalculo, item.ctesGanharia, item.ctesPerderia,
    Number(item.aderenciaRota.toFixed(2)), Number(item.valorNF.toFixed(2)), Number(item.freteRealizado.toFixed(2)), Number(item.freteTabela.toFixed(2)),
    Number(item.pctRealizado.toFixed(2)), Number(item.pctTabelaFinal.toFixed(2)), Number(item.reduzirPct.toFixed(2)),
  ]);
  const wsRota = XLSX.utils.aoa_to_sheet([headerRota, ...linhasRota]);
  wsRota['!cols'] = headerRota.map(() => ({ wch: 18 }));

  // CT-es de cada rota, com o detalhe do calculo (peso, %base, taxas, ICMS,
  // tabela simulada) — sem nenhuma informacao de correcao/discrepancia interna,
  // ja que este arquivo pode ir pro transportador.
  const chavesRotasAtendidas = new Set(linhasAtendidas.map((item) => chaveRotaFaixaLaudo(item.rota, item.faixa || item.faixaPeso || '')));
  const ctesExcelCompletos = Array.isArray(resultado.ctesAjusteRotaExcel) && resultado.ctesAjusteRotaExcel.length
    ? resultado.ctesAjusteRotaExcel.filter((cte) => chavesRotasAtendidas.has(chaveRotaFaixaLaudo(cte.rota, cte.faixaPeso || cte.faixa || '')))
    : linhasAtendidas.flatMap((item) => item.itensAmostra.map((cte) => ({
      rota: item.rota,
      cte: cte.cte,
      chaveCte: cte.chaveCte || '',
      origem: '',
      ufOrigem: '',
      destino: '',
      ufDestino: '',
      canal: cte.canal || '',
      peso: cte.peso,
      volumes: 0,
      valorNF: cte.valorNF,
      freteCobrado: cte.freteBaseComparativa,
      tabelaRpa: cte.tabelaRpa,
      percentualCobrado: cte.percentualCobrado,
      percentualCalc: cte.percentualCalc,
      percentualBase: cte.percentualBase,
      tipoCalculo: '',
      faixaPeso: '',
      prazo: 0,
      pesoConsiderado: cte.peso,
      percentualAplicado: cte.percentualBase,
      valorPercentual: 0,
      valorKgAplicado: 0,
      valorKgGarantia: 0,
      valorExcedente: 0,
      minimoRota: 0,
      freteMinimoCotacao: 0,
      freteMinimoGeneralidade: 0,
      minimoAplicavel: 0,
      componenteVencedor: '',
      valorBase: 0,
      subtotal: 0,
      taxaEmergencialPct: 0,
      valorEmergencial: 0,
      aliquotaIcms: 0,
      adValorem: 0,
      adValPct: 0,
      grisPct: 0,
      gris: cte.gris,
      tas: cte.tas,
      ctrc: cte.ctrc,
      pedagio: cte.pedagio,
      tda: 0,
      tde: 0,
      tdr: 0,
      trt: 0,
      suframa: 0,
      outras: 0,
      taxaExtra: 0,
      icms: cte.icms,
      statusSelecionada: cte.statusSelecionada,
    })));
  const headerCtes = ['Rota', 'CT-e', 'Chave CT-e', 'Origem', 'UF origem', 'Destino', 'UF destino', 'Canal', 'Tipo calculo', 'Faixa', 'Prazo', 'Peso NF', 'Peso considerado', 'Volumes', 'Valor NF', 'Frete cobrado', rotuloTabelaLaudo, `${rotuloTabelaLaudo} x cobrado`, '% cobrado', `% ${rotuloTabelaLaudo}`, '% base', 'Taxa aplicada', '% aplicado', 'Valor percentual', 'R$/kg aplicado', 'Valor fixo/faixa', 'Valor kg garantia', 'Valor excedente', 'Minimo rota', 'Minimo cotacao', 'Minimo geral', 'Minimo aplicavel', 'Componente vencedor', 'Valor base', 'Subtotal', 'Taxa emergencial %', 'Valor emergencial', 'Aliquota ICMS %', 'ICMS', 'Ad Valorem', 'Ad Valorem %', 'GRIS', 'GRIS %', 'Pedagio', 'TAS', 'CTRC', 'TDA', 'TDE', 'TDR', 'TRT', 'Suframa', 'Outras', 'Taxa extra', 'Status'];
  const linhasCtes = ctesExcelCompletos.map((cte) => [
    cte.rota || '', cte.cte || '', cte.chaveCte || '', cte.origem || '', cte.ufOrigem || '', cte.destino || '', cte.ufDestino || '', cte.canal || '', cte.tipoCalculo || '', cte.faixaPeso || '', Number(cte.prazo || 0),
    Number((cte.peso || 0).toFixed(3)), Number((cte.pesoConsiderado || cte.peso || 0).toFixed(3)), Number((cte.volumes || 0).toFixed(2)), Number((cte.valorNF || 0).toFixed(2)),
    Number((cte.freteCobrado || 0).toFixed(2)), Number((cte.tabelaRpa || 0).toFixed(2)), Number(((cte.tabelaRpa || 0) - (cte.freteCobrado || 0)).toFixed(2)),
    Number((cte.percentualCobrado || 0).toFixed(2)), Number((cte.percentualCalc || 0).toFixed(2)), Number((cte.percentualBase || 0).toFixed(2)), cte.taxaAplicadaTexto || '', Number((cte.percentualAplicado || 0).toFixed(2)),
    Number((cte.valorPercentual || 0).toFixed(2)), Number((cte.valorKgAplicado || 0).toFixed(2)), Number((cte.valorFixoAplicado || 0).toFixed(2)), Number((cte.valorKgGarantia || 0).toFixed(2)), Number((cte.valorExcedente || 0).toFixed(2)),
    Number((cte.minimoRota || 0).toFixed(2)), Number((cte.freteMinimoCotacao || 0).toFixed(2)), Number((cte.freteMinimoGeneralidade || 0).toFixed(2)), Number((cte.minimoAplicavel || 0).toFixed(2)),
    cte.componenteVencedor || '', Number((cte.valorBase || 0).toFixed(2)), Number((cte.subtotal || 0).toFixed(2)), Number((cte.taxaEmergencialPct || 0).toFixed(2)), Number((cte.valorEmergencial || 0).toFixed(2)), Number((cte.aliquotaIcms || 0).toFixed(2)), Number((cte.icms || 0).toFixed(2)),
    Number((cte.adValorem || 0).toFixed(2)), Number((cte.adValPct || 0).toFixed(2)), Number((cte.gris || 0).toFixed(2)), Number((cte.grisPct || 0).toFixed(2)), Number((cte.pedagio || 0).toFixed(2)), Number((cte.tas || 0).toFixed(2)), Number((cte.ctrc || 0).toFixed(2)),
    Number((cte.tda || 0).toFixed(2)), Number((cte.tde || 0).toFixed(2)), Number((cte.tdr || 0).toFixed(2)), Number((cte.trt || 0).toFixed(2)), Number((cte.suframa || 0).toFixed(2)), Number((cte.outras || 0).toFixed(2)), Number((cte.taxaExtra || 0).toFixed(2)),
    cte.statusSelecionada || '',
  ]);
  const wsCtes = XLSX.utils.aoa_to_sheet([headerCtes, ...linhasCtes]);
  wsCtes['!cols'] = headerCtes.map(() => ({ wch: 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
  XLSX.utils.book_append_sheet(wb, wsRota, 'Rota');
  XLSX.utils.book_append_sheet(wb, wsCtes, 'CT-es completos');
  return wb;
}
