import { classificarCteNaGrade } from './paretoReajuste.js';
import { carregarGradeFrete, normalizarGradeFrete } from './gradeFreteConfig.js';

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function numero(valor, casas = 0) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function percentual(valor) {
  return `${Number(valor || 0).toFixed(2)}%`;
}

function n(valor) {
  const num = Number(valor || 0);
  return Number.isFinite(num) ? num : 0;
}

function texto(valor) {
  return String(valor || '').trim();
}

function upper(valor) {
  return texto(valor).toUpperCase();
}

function padraoComercialLaudo(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Exibição com Title Case para nomes de cidades (chave continua em CAPS internamente)
function exibirCidade(valor) {
  if (!valor) return '';
  // separa "ITAJAI/SC" em parte cidade e UF
  const str = String(valor).trim();
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    // UF após "/" volta para CAPS: "/Sc" -> "/SC"
    .replace(/\/([a-zA-Z]{2})(\b|$)/g, (_, uf) => '/' + uf.toUpperCase());
}

function dataBR(valor) {
  if (!valor) return '-';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? String(valor) : d.toLocaleDateString('pt-BR');
}

function resumoTexto(linhas = []) {
  return linhas.filter(Boolean).join('\n');
}

function getResumo(tabelaOuResumo = {}) {
  if (tabelaOuResumo.resumo_simulacao && typeof tabelaOuResumo.resumo_simulacao === 'object' && !Array.isArray(tabelaOuResumo.resumo_simulacao)) {
    return tabelaOuResumo.resumo_simulacao;
  }
  return tabelaOuResumo || {};
}

function getHistorico(tabelaOuResumo = {}) {
  const resumo = getResumo(tabelaOuResumo);
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}

function getResumoRodada(rodada = {}) {
  if (rodada.resumo && typeof rodada.resumo === 'object' && !Array.isArray(rodada.resumo)) return rodada.resumo;
  if (rodada.resultado && typeof rodada.resultado === 'object' && !Array.isArray(rodada.resultado)) return rodada.resultado;
  return rodada || {};
}

function getIndicadoresRodada(rodada = {}) {
  const resumo = getResumoRodada(rodada);
  const ind = rodada.indicadores && typeof rodada.indicadores === 'object' && !Array.isArray(rodada.indicadores)
    ? rodada.indicadores
    : {};

  return {
    rodada: n(rodada.rodada || ind.rodada || resumo.rodada_atual || 1) || 1,
    id: rodada.id || rodada.criado_em || `${rodada.rodada || 'rodada'}-${Math.random()}`,
    criadoEm: rodada.criado_em || resumo.salvo_em || resumo.geradoEm || '',
    ctesAnalisados: n(ind.ctes_analisados || resumo.ctesAnalisados || resumo.ctes_analisados || rodada.base?.ctes_na_malha),
    ctesComTabela: n(ind.ctes_com_tabela || resumo.ctesComTabelaSelecionada || resumo.ctes_com_tabela),
    ctesGanhos: n(ind.ctes_capturados || ind.ctes_ganhos || resumo.ctesGanhariaSelecionada || resumo.ctesCapturadosDeOutras),
    ctesPerdidos: n(ind.ctes_perdidos || resumo.ctesPerdidosSelecionada),
    volumesGanhos: n(ind.volumes_capturados || resumo.volumesCapturados || ind.volumes_ganhos_mes || resumo.volumesDia),
    pedidosDia: n(ind.pedidos_ganhos_dia || ind.pedidos_dia || resumo.cargasDia),
    pedidosMes: n(ind.pedidos_ganhos_mes || ind.pedidos_mes || (ind.pedidos_dia ? ind.pedidos_dia * 22 : 0) || (resumo.cargasDia ? resumo.cargasDia * 22 : 0)),
    volumesDia: n(ind.volumes_ganhos_dia || ind.volumes_dia || resumo.volumesDia),
    volumesMes: n(ind.volumes_ganhos_mes || ind.volumes_mes || (ind.volumes_dia ? ind.volumes_dia * 22 : 0) || (resumo.volumesDia ? resumo.volumesDia * 22 : 0)),
    aderencia: n(ind.aderencia || resumo.aderenciaSelecionada),
    faturamentoMes: n(ind.faturamento_mes || resumo.faturamentoSelecionadaGanhadoraMes || resumo.faturamentoSelecionadaMes || resumo.freteSelecionada),
    faturamentoAno: n(ind.faturamento_ano || resumo.faturamentoSelecionadaGanhadoraAno || resumo.faturamentoSelecionadaAno),
    savingMes: n(ind.saving_mes || resumo.savingSelecionadaVsRealMes || resumo.savingSelecionadaVsReal),
    savingAno: n(ind.saving_ano || resumo.savingSelecionadaVsRealAno),
    percentualFreteReal: n(ind.percentual_frete_realizado || resumo.percentualFreteRealizado),
    percentualFreteTabela: n(ind.percentual_frete_simulado || resumo.percentualFreteTabelaGanharia || resumo.percentualFreteSelecionada),
    reducaoMedia: n(ind.reducao_media || resumo.reducaoMediaNecessaria),
    rotasComGanho: n(ind.rotas_com_ganho || resumo.qtdRotasComGanhoSelecionada),
    rotasGanhas: n(ind.rotas_ganhas || resumo.qtdRotasGanhasSelecionada),
    rotasParciais: n(ind.rotas_parciais || resumo.qtdRotasParciaisSelecionada),
    rotasSemCobertura: n(ind.rotas_sem_cobertura || resumo.ctesSemTabelaSelecionada),
  };
}

function ordenarSimulacoes(a, b) {
  const rodada = n(a.rodada) - n(b.rodada);
  if (rodada) return rodada;
  return new Date(a.criado_em || 0).getTime() - new Date(b.criado_em || 0).getTime();
}

export function obterSimulacoesRodadas(tabelaOuResumo = {}) {
  return getHistorico(tabelaOuResumo)
    .filter((item) => item && item.tipo_registro === 'SIMULACAO')
    .slice()
    .sort(ordenarSimulacoes);
}

export function consolidarUltimaSimulacaoPorRodada(simulacoes = []) {
  const mapa = new Map();
  simulacoes.forEach((sim) => {
    const rodada = n(sim.rodada || 1) || 1;
    const anterior = mapa.get(rodada);
    if (!anterior) {
      mapa.set(rodada, sim);
      return;
    }
    const atualTime = new Date(sim.criado_em || 0).getTime();
    const antTime = new Date(anterior.criado_em || 0).getTime();
    if (atualTime >= antTime) mapa.set(rodada, sim);
  });
  return Array.from(mapa.values()).sort(ordenarSimulacoes);
}

function chaveRota(item = {}) {
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem);
  const destino = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.ufDestino || item.uf_destino);
  const rota = texto(item.nomeRota || item.nomeRotaCotacao || item.cotacaoComercial || item.rotaCotacao || item.rota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome);
  const faixa = texto(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa);
  return [origem || 'Origem', destino || 'Destino', rota || faixa || 'Rota/Cotacao'].filter(Boolean).join(' > ');
}

function getUfDestino(item = {}) {
  return upper(item.ufDestino || item.uf_destino || item.uf || item.destinoUf || item.destino_uf || item.estadoDestino || item.estado_destino) || '-';
}

function gradeDoContexto(resumo = {}, opcoes = {}) {
  if (opcoes.grade) return normalizarGradeFrete(opcoes.grade);
  if (resumo.gradeFrete) return normalizarGradeFrete(resumo.gradeFrete);
  return carregarGradeFrete();
}

function opcoesFaixaDoResumo(resumo = {}, opcoesExtras = {}) {
  return {
    resumo,
    grade: gradeDoContexto(resumo, opcoesExtras),
    canalPadrao: opcoesExtras.canalPadrao || resumo.canal || resumo.filtros?.canal || '',
  };
}

function qtdCtesItem(item = {}) {
  return n(item.ctes || item.qtd || item.qtdCtes || item.qtdAnalisados || item.qtdGanhasSelecionada || item.qtdPerdidasSelecionada || 0);
}

function pesoConsideradoCte(item = {}) {
  const valores = [
    item.peso, item.pesoRealizado, item.peso_realizado, item.pesoCte, item.peso_cte,
    item.pesoCobrado, item.peso_cobrado, item.pesoCubado, item.peso_cubado,
    item.pesoTaxado, item.peso_taxado, item.pesoDeclarado, item.peso_declarado,
    item.pesoFinalCalculado, item.peso_final_calculado, item.pesoMedio, item.peso_medio,
  ].map((v) => n(v));
  return Math.max(...valores, 0);
}

function pesoUnitarioCte(item = {}) {
  const peso = pesoConsideradoCte(item);
  const qtd = qtdCtesItem(item);
  if (qtd > 1 && peso > 0) return peso / qtd;
  if (peso > 0) return peso;
  const pesoTotal = n(item.pesoTotal || item.peso_total);
  const divisor = qtd || 1;
  if (pesoTotal > 0) return pesoTotal / divisor;
  return 0;
}

function faixaExplicitaPeso(valor) {
  const raw = texto(valor);
  if (!raw || /^rota$/i.test(raw)) return '';
  if (/\|/.test(raw) && !/\d+\s*(?:a|ate|até|-)\s*\d+/i.test(raw)) return '';
  const lower = raw.toLowerCase();
  if (/\d/.test(raw) && (lower.includes('kg') || lower.includes('acima') || /\d+\s*(?:a|ate|até|-)\s*\d+/i.test(raw))) {
    return raw;
  }
  return '';
}

function classificarFaixaPeso(item = {}, opcoes = {}) {
  const peso = pesoUnitarioCte(item);
  if (peso <= 0) return 'Sem faixa';
  const canalPadrao = opcoes.canalPadrao || '';
  return classificarCteNaGrade(
    { ...item, peso, canal: item.canal || canalPadrao },
    opcoes.grade || gradeDoContexto(opcoes.resumo || {}, opcoes),
    canalPadrao,
  ).peso;
}

function itemTemIdentificadorOperacional(item = {}) {
  return Boolean(
    item.numeroCte || item.numeroCTe || item.cte || item.chaveCte || item.chave_cte || item.chave_cte_ref ||
    item.numeroNF || item.notaFiscal || item.nf || item.chaveNf || item.chave_nf || item.pedido || item.numeroPedido ||
    item.idCte || item.id_cte || item.idTracking || item.tracking_id
  );
}

function itemPareceLinhaAgregada(item = {}) {
  const qtd = qtdCtesItem(item) || n(item.ctesGanhos) + n(item.ctesPerdidos);
  if (qtd > 1 && !item.chaveCte && !item.cte && !item.numeroCte) return true;
  if ((item.rota || item.nomeRota || item.cotacao || item.cotacaoFinal) && qtd > 1 && !item.chaveCte && !item.cte) return true;
  return false;
}

function itemValidoParaFaixa(item = {}, opcoes = {}) {
  if (!item || typeof item !== 'object') return false;
  if (itemPareceLinhaAgregada(item)) return false;
  return itemTemIdentificadorOperacional(item) || pesoUnitarioCte(item) > 0 || Boolean(faixaExplicitaPeso(item.faixaPeso || item.faixa_peso));
}

function getFaixa(item = {}, opcoes = {}) {
  const viaPeso = classificarFaixaPeso(item, opcoes);
  if (viaPeso !== 'Sem faixa') return viaPeso;
  const explicita = faixaExplicitaPeso(item.faixaPeso || item.faixa_peso || item.faixa || item.pesoFaixa || item.faixa_peso_padrao);
  return explicita || 'Sem faixa';
}

function isGanha(item = {}) {
  // Se tem campos diretos de contagem, usa-os com prioridade (evita dupla contagem)
  if (item.qtdGanhasSelecionada != null) return n(item.qtdGanhasSelecionada) > 0;
  if (item.ctesGanhos != null && item.ctesPerdidos != null) return n(item.ctesGanhos) > 0 && n(item.ctesPerdidos) === 0;
  if (n(item.ctesGanhos) > 0) return true;
  if (n(item.ctesPerdidos) > 0) return false;
  return item.statusSelecionada === 'Ganharia' || item.ganhouRealizado === true || n(item.savingSelecionada) > 0;
}

function isPerdida(item = {}) {
  // Se tem campos diretos de contagem, usa-os com prioridade (evita dupla contagem)
  if (item.qtdPerdidasSelecionada != null) return n(item.qtdPerdidasSelecionada) > 0;
  if (item.ctesGanhos != null && item.ctesPerdidos != null) return n(item.ctesPerdidos) > 0 && n(item.ctesGanhos) === 0;
  if (n(item.ctesPerdidos) > 0) return true;
  if (n(item.ctesGanhos) > 0) return false;
  return item.statusSelecionada === 'Perderia' || item.perdeuRealizado === true || n(item.diferencaParaVencedor) > 0;
}

function valorPotencial(item = {}) {
  return n(item.faturamentoPotencial || item.freteRealizado || item.valorCte || item.valorCTe || item.valorNF || item.valor_nf || item.freteSelecionada || item.freteTabelaSelecionada);
}

function valorCapturado(item = {}) {
  return n(item.faturamentoCapturado || item.freteSelecionadaGanhadora || item.freteCapturadoRealizado || item.freteSelecionada || item.valorFreteSelecionada);
}

function reducaoItem(item = {}) {
  return n(item.reducaoMediaNecessaria || item.reducaoNecessaria || item.percentualReducaoNecessaria || item.diferencaPercentual || item.gapPercentual);
}

function percentualFreteSobreNf(frete, valorNf) {
  const nf = n(valorNf);
  const valorFrete = n(frete);
  return nf > 0 && valorFrete > 0 ? (valorFrete / nf) * 100 : 0;
}

function itemGanhoAjuste(item = {}) {
  if (item.statusSelecionada === 'Ganharia') return true;
  if (item.statusSelecionada === 'Perderia') return false;
  if (item.ganhouRealizado === true) return true;
  if (item.perdeuRealizado === true) return false;
  return isGanha(item) && !isPerdida(item);
}

function ajusteItemCte(item = {}) {
  const ganha = itemGanhoAjuste(item);
  const reducao = reducaoItem(item);
  const freteReal = n(item.freteRealizado || item.valorCte || item.valorCTe);
  const freteTabela = n(item.freteSelecionada || item.freteTabelaSelecionada);
  const valorNf = n(item.valorNF || item.valor_nf);

  if (!ganha) {
    if (reducao > 0) return reducao;
    if (freteTabela > 0 && n(item.diferencaParaVencedor) > 0) {
      return (n(item.diferencaParaVencedor) / freteTabela) * 100;
    }
    const referencias = [freteReal, n(item.freteVencedor)].filter((v) => v > 0);
    const menorRef = referencias.length ? Math.min(...referencias) : 0;
    if (freteTabela > 0 && menorRef > 0 && freteTabela > menorRef) {
      return ((freteTabela - menorRef) / freteTabela) * 100;
    }
    return 0;
  }

  const variacaoSalva = n(item.variacaoPctFreteSelecionada || item.variacao_pct_frete_selecionada);
  if (variacaoSalva) return Math.abs(variacaoSalva);

  const pctReal = n(item.percentualFreteRealizado || item.percentual_frete_realizado)
    || (valorNf > 0 && freteReal > 0 ? percentualFreteSobreNf(freteReal, valorNf) : 0);
  const pctTabela = n(item.percentualFreteSelecionada || item.percentual_frete_selecionada || item.percentualFreteSimulado || item.percentual_frete_simulado)
    || (valorNf > 0 && freteTabela > 0 ? percentualFreteSobreNf(freteTabela, valorNf) : 0);
  if (pctReal > 0 && pctTabela > 0) return Math.abs(pctReal - pctTabela);

  if (freteReal > 0 && freteTabela > 0) {
    return Math.abs(((freteTabela - freteReal) / freteReal) * 100);
  }
  return 0;
}

function acumularAjusteMedio(acc, item, peso = 1) {
  const qtd = Math.max(n(peso), 1);
  const ajuste = ajusteItemCte(item);
  if (!ajuste) return;
  acc.reducaoSoma += ajuste * qtd;
  acc.reducaoQtd += qtd;
}

/** No Pareto, redução média = só CT-es perdidos (potencial a recuperar). */
function acumularReducaoPerdidos(acc, item, qtdPerdida = 0) {
  const qtd = Math.max(n(qtdPerdida), 0);
  if (!qtd) return;
  const reducao = reducaoItem(item);
  let ajuste = reducao;
  if (!ajuste) {
    const freteSel = n(item.freteSelecionada);
    if (freteSel > 0 && n(item.diferencaParaVencedor) > 0) {
      ajuste = (n(item.diferencaParaVencedor) / freteSel) * 100;
    }
  }
  if (!ajuste) return;
  acc.reducaoSoma += ajuste * qtd;
  acc.reducaoQtd += qtd;
}

function finalizarLinhaPareto(item = {}) {
  const base = n(item.ctesGanhos) + n(item.ctesPerdidos) || n(item.ctes) || n(item.ctesAnalisados);
  return {
    ...item,
    aderencia: base ? (n(item.ctesGanhos) / base) * 100 : 0,
    ajusteMedio: item.reducaoQtd ? item.reducaoSoma / item.reducaoQtd : 0,
    prioridade: n(item.ctesPerdidos) || n(item.faturamentoNaoCapturado) ? 'ALTA' : 'BAIXA',
  };
}

// CORRIGIDO: extrai ganhos/perdidos sem dupla contagem.
// Se o item já traz ctesGanhos/ctesPerdidos como campos numéricos diretos (linha agregada),
// usa direto. Se é linha individual (CT-e único), usa isGanha/isPerdida.
function extrairContagemItem(item) {
  const qtdAnalisada = n(item.ctes || item.qtd || item.qtdCtes || item.qtdAnalisados || 1) || 1;
  const temCamposDiretos = item.ctesGanhos != null || item.ctesPerdidos != null || item.qtdGanhasSelecionada != null || item.qtdPerdidasSelecionada != null;

  let qtdGanha, qtdPerdida;
  if (temCamposDiretos) {
    qtdGanha = n(item.qtdGanhasSelecionada ?? item.ctesGanhos ?? 0);
    qtdPerdida = n(item.qtdPerdidasSelecionada ?? item.ctesPerdidos ?? 0);
  } else {
    qtdGanha = isGanha(item) ? qtdAnalisada : 0;
    qtdPerdida = isPerdida(item) ? qtdAnalisada : 0;
  }
  return { qtdAnalisada, qtdGanha, qtdPerdida };
}

function agregarRegistro(mapa, chave, item = {}, rodadaIndicadores = {}, opcoesFaixa = {}) {
  if (!mapa.has(chave)) {
    mapa.set(chave, {
      chave,
      origem: texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem),
      destino: texto(item.destino || item.cidadeDestino || item.cidade_destino || item.ufDestino || item.uf_destino),
      ufDestino: getUfDestino(item),
      rota: texto(item.nomeRota || item.nomeRotaCotacao || item.cotacaoComercial || item.rotaCotacao || item.rota || item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.nome) || chave,
      faixa: getFaixa(item, opcoesFaixa),
      ctesAnalisados: 0,
      ctesGanhos: 0,
      ctesPerdidos: 0,
      volumes: 0,
      faturamentoPotencial: 0,
      faturamentoCapturado: 0,
      faturamentoNaoCapturado: 0,
      freteRealizado: 0,
      freteRealizadoGanhos: 0,
      freteRealizadoPerdido: 0,
      reducaoSoma: 0,
      reducaoQtd: 0,
      aderencia: 0,
      prioridade: 'BAIXA',
    });
  }

  const acc = mapa.get(chave);
  const { qtdAnalisada, qtdGanha, qtdPerdida } = extrairContagemItem(item);
  const volumes = n(item.volumes || item.qtdVolumes || item.volumesCapturados || item.volumesGanhas);
  const potencial = valorPotencial(item);
  const capturado = qtdGanha > 0 ? valorCapturado(item) : 0;

  acc.ctesAnalisados += qtdAnalisada;
  acc.ctesGanhos += qtdGanha;
  acc.ctesPerdidos += qtdPerdida;
  acc.volumes += volumes;
  acc.faturamentoPotencial += potencial;
  acc.faturamentoCapturado += capturado;
  const freteReal = n(item.freteRealizado || item.valorCte || item.valorCTe);
  if (freteReal > 0) {
    acc.freteRealizado += freteReal;
    if (qtdPerdida > 0) acc.freteRealizadoPerdido += freteReal;
    if (qtdGanha > 0) acc.freteRealizadoGanhos += freteReal;
  }
  acumularAjusteMedio(acc, item, qtdAnalisada);

  if (!acc.ufDestino || acc.ufDestino === '-') acc.ufDestino = getUfDestino(item);
  if (!acc.faixa || acc.faixa === 'Sem faixa') acc.faixa = getFaixa(item, opcoesFaixa);
  if (!acc.origem) acc.origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || rodadaIndicadores.origem);
}

function freteRealizadoPerdidosAgrupado(item = {}) {
  const fretePerdido = n(item.freteRealizadoPerdido);
  if (fretePerdido > 0) return fretePerdido;
  const freteTotal = n(item.freteRealizado);
  const perdidos = n(item.ctesPerdidos);
  const ganhos = n(item.ctesGanhos);
  const total = ganhos + perdidos || n(item.ctesAnalisados);
  if (freteTotal > 0 && perdidos > 0) {
    const freteGanhos = n(item.freteRealizadoGanhos);
    if (freteGanhos > 0) return Math.max(freteTotal - freteGanhos, 0);
    if (ganhos === 0) return freteTotal;
    if (total > 0) return (freteTotal / total) * perdidos;
  }
  return Math.max(n(item.faturamentoPotencial) - n(item.freteRealizadoGanhos || item.faturamentoCapturado), 0);
}

function finalizarAgrupados(lista = []) {
  return lista.map((item) => {
    const faturamentoNaoCapturado = freteRealizadoPerdidosAgrupado(item);
    const base = n(item.ctesGanhos) + n(item.ctesPerdidos) || n(item.ctesAnalisados);
    const aderencia = base ? (n(item.ctesGanhos) / base) * 100 : 0;
    const ajuste = item.reducaoQtd ? item.reducaoSoma / item.reducaoQtd : 0;
    let prioridade = 'BAIXA';
    if (faturamentoNaoCapturado >= 50000 || item.ctesPerdidos >= 100 || ajuste >= 15) prioridade = 'ALTA';
    else if (faturamentoNaoCapturado >= 15000 || item.ctesPerdidos >= 30 || ajuste >= 8) prioridade = 'MÉDIA';
    let status = 'Boa competitividade';
    if (item.ctesPerdidos > 0 && item.ctesGanhos > 0) status = 'Melhorou, mas ainda perde';
    if (item.ctesPerdidos > item.ctesGanhos) status = 'Crítica';
    if (!item.ctesGanhos && item.ctesPerdidos) status = 'Sem competitividade';

    return {
      ...item,
      faturamentoNaoCapturado,
      aderencia,
      ajusteMedio: ajuste,
      prioridade,
      status,
    };
  });
}

function extrairCtesIndividuaisResumo(resumo = {}) {
  const candidatos = [resumo.ctesDetalhes, resumo.detalhes, resumo.linhasDetalhe];
  const fonte = candidatos.find((lista) => Array.isArray(lista) && lista.length);
  return fonte || [];
}

function extrairDetalhesResumo(resumo = {}) {
  const candidatos = [
    resumo.ctesDetalhes,
    resumo.detalhes,
    resumo.linhasDetalhe,
    resumo.rotas,
    resumo.rotasPerdidasDestaque,
    resumo.rotasGanhasDestaque,
  ];
  const fonte = candidatos.find((lista) => Array.isArray(lista) && lista.length);
  return fonte || [];
}

function extrairDetalhesOperacionais(resumo = {}) {
  const candidatos = [
    resumo.ctesDetalhes,
    resumo.detalhes,
    resumo.linhasDetalhe,
    resumo.rotas,
    resumo.rotasPerdidasDestaque,
    resumo.rotasGanhasDestaque,
  ];
  const fonte = candidatos.find((lista) => Array.isArray(lista) && lista.length);
  return fonte || [];
}

function extrairDetalhesFaixaB2C(resumo = {}, opcoesFaixa = {}) {
  return extrairCtesIndividuaisResumo(resumo)
    .filter((item) => itemValidoParaFaixa(item, opcoesFaixa))
    .filter((item) => getFaixa(item, opcoesFaixa) !== 'Sem faixa');
}

function agruparDetalhes(simulacao, agrupador, opcoes = {}) {
  const resumo = getResumoRodada(simulacao);
  const ind = getIndicadoresRodada(simulacao);
  const opcoesFaixa = opcoesFaixaDoResumo(resumo, opcoes);
  const detalhes = opcoes.somenteFaixaB2C
    ? extrairDetalhesFaixaB2C(resumo, opcoesFaixa)
    : extrairDetalhesOperacionais(resumo);
  const mapa = new Map();

  detalhes.forEach((item) => {
    const chave = agrupador(item, opcoesFaixa);
    if (!chave || chave === 'Sem faixa' || chave === '-') return;
    agregarRegistro(mapa, chave, item, ind, opcoesFaixa);
  });

  return finalizarAgrupados(Array.from(mapa.values()));
}

function somarCamposContagem(item = {}, tipo = 'ganho') {
  if (tipo === 'ganho') return n(item.ctesGanhos || item.ctes_ganhos || item.qtdGanhasSelecionada || item.qtd_ganhas || item.ganhas || item.ctesCompetitivos || item.competitivos || item.qtdCompetitiva);
  if (tipo === 'perdido') return n(item.ctesPerdidos || item.ctes_perdidos || item.qtdPerdidasSelecionada || item.qtd_perdidas || item.perdidas || item.ctesNaoCompetitivos || item.naoCompetitivos || item.qtdNaoCompetitiva);
  return n(item.ctes || item.qtd || item.qtdCtes || item.ctesAnalisados || item.qtdAnalisados || item.totalCtes || item.total);
}

function chaveCotacaoAnalitica(item = {}) {
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem);
  const ufDestino = getUfDestino(item);
  const cotacao = texto(item.cotacao || item.cotacaoFinal || item.faixaCotacao || item.regiao || item.rota || item.nomeRota || item.nome);
  return [origem || 'Origem', ufDestino || 'UF', cotacao || 'Cotação/Rota'].filter(Boolean).join(' > ');
}

function chaveDestinoAnalitico(item = {}) {
  const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || item.ufOrigem || item.uf_origem);
  const cidade = texto(item.destino || item.cidadeDestino || item.cidade_destino || item.cidade || item.municipioDestino || item.municipio_destino);
  const ufDestino = getUfDestino(item);
  return [origem || 'Origem', cidade || 'Destino', ufDestino].filter(Boolean).join(' > ');
}

function chaveFaixaB2CAnalitica(item = {}, opcoesFaixa = {}) {
  const faixa = getFaixa(item, opcoesFaixa);
  if (!faixa || faixa === 'Sem faixa') return 'Sem faixa';
  return chaveDestinoAnalitico(item) + ' | ' + faixa;
}

function agruparPorUf(simulacao) {
  const porDetalhe = agruparDetalhes(simulacao, getUfDestino);
  const temContagem = porDetalhe.some((item) => n(item.ctesGanhos) || n(item.ctesPerdidos) || n(item.ctesAnalisados));
  if (temContagem) return porDetalhe;

  const resumo = getResumoRodada(simulacao);
  const estados = Array.isArray(resumo.resumoPorEstado) ? resumo.resumoPorEstado : Array.isArray(resumo.estadosGanhadoresDestaque) ? resumo.estadosGanhadoresDestaque : [];
  if (!estados.length) return porDetalhe;
  return finalizarAgrupados(estados.map((item) => {
    const analisados = somarCamposContagem(item, 'total');
    const ganhos = somarCamposContagem(item, 'ganho');
    const perdidos = somarCamposContagem(item, 'perdido') || Math.max(analisados - ganhos, 0);
    return {
      chave: getUfDestino(item),
      rota: getUfDestino(item),
      ufDestino: getUfDestino(item),
      faixa: 'Todas',
      ctesAnalisados: analisados || ganhos + perdidos,
      ctesGanhos: ganhos,
      ctesPerdidos: perdidos,
      volumes: n(item.volumes || item.volumesCapturados || item.qtdVolumes),
      faturamentoPotencial: n(item.faturamentoPotencial || item.freteRealizado || item.valorNF || item.valorPotencial),
      faturamentoCapturado: n(item.faturamentoCapturado || item.freteSelecionadaGanhadora || item.freteCapturado),
      reducaoSoma: n(item.reducaoMediaNecessaria || item.ajusteMedio || item.reducaoMedia) * Math.max(perdidos || analisados || 1, 1),
      reducaoQtd: Math.max(perdidos || analisados || 1, 1),
    };
  }));
}

function agruparPorCotacao(simulacao) {
  return agruparDetalhes(simulacao, chaveCotacaoAnalitica);
}

function agruparPorDestino(simulacao) {
  return agruparDetalhes(simulacao, chaveDestinoAnalitico);
}

function agruparPorFaixaB2C(simulacao) {
  return agruparDetalhes(simulacao, chaveFaixaB2CAnalitica, { somenteFaixaB2C: true });
}

function agruparSomentePorFaixa(simulacao) {
  const resumo = getResumoRodada(simulacao);
  const opcoesFaixa = opcoesFaixaDoResumo(resumo);
  return agruparDetalhes(simulacao, (item, op) => getFaixa(item, op), { somenteFaixaB2C: true, ...opcoesFaixa });
}

function compararRotas(primeira, ultima) {
  const inicial = new Map(agruparDetalhes(primeira, chaveRota).map((item) => [item.chave, item]));
  const final = new Map(agruparDetalhes(ultima, chaveRota).map((item) => [item.chave, item]));
  const chaves = new Set([].concat(Array.from(inicial.keys()), Array.from(final.keys())));

  return Array.from(chaves).map((chave) => {
    const ini = inicial.get(chave) || {};
    const fim = final.get(chave) || {};
    return {
      ...fim,
      chave,
      rota: fim.rota || ini.rota || chave,
      origem: fim.origem || ini.origem || '',
      destino: fim.destino || ini.destino || '',
      ufDestino: fim.ufDestino || ini.ufDestino || '-',
      faixa: fim.faixa || ini.faixa || 'Todas',
      ctesGanhosInicial: n(ini.ctesGanhos),
      ctesGanhosFinal: n(fim.ctesGanhos),
      evolucaoCtes: n(fim.ctesGanhos) - n(ini.ctesGanhos),
      aderenciaInicial: n(ini.aderencia),
      aderenciaAtual: n(fim.aderencia),
    };
  });
}

function compararGenerico(primeira, ultima, agrupador) {
  const inicial = new Map(agrupador(primeira).map((item) => [item.chave, item]));
  const final = new Map(agrupador(ultima).map((item) => [item.chave, item]));
  const chaves = new Set([].concat(Array.from(inicial.keys()), Array.from(final.keys())));

  return Array.from(chaves).map((chave) => {
    const ini = inicial.get(chave) || {};
    const fim = final.get(chave) || {};
    return {
      ...fim,
      chave,
      rota: fim.rota || ini.rota || chave,
      ufDestino: fim.ufDestino || ini.ufDestino || chave,
      faixa: fim.faixa || ini.faixa || chave,
      ctesGanhosInicial: n(ini.ctesGanhos),
      ctesGanhosFinal: n(fim.ctesGanhos),
      evolucaoCtes: n(fim.ctesGanhos) - n(ini.ctesGanhos),
      aderenciaInicial: n(ini.aderencia),
      aderenciaAtual: n(fim.aderencia),
    };
  });
}

function pesoParetoItem(item = {}, metrica = 'volumes') {
  if (metrica === 'faturamentoEmRisco') {
    return n(item.faturamentoMensalEmRisco ?? item.faturamentoNaoCapturado);
  }
  if (metrica === 'ctes') return n(item.ctes || item.ctesAnalisados || item.qtd || 1) || 1;
  return n(item.volumes || item.ctes || item.ctesAnalisados || 1) || 1;
}

export function aplicarCortePareto80(lista = [], { metrica = 'volumes', fallback = 20 } = {}) {
  const ordenada = [...lista].sort((a, b) => pesoParetoItem(b, metrica) - pesoParetoItem(a, metrica));
  const total = ordenada.reduce((acc, item) => acc + pesoParetoItem(item, metrica), 0);
  if (!total) return [];
  let acumulado = 0;
  const enriquecida = ordenada.map((item) => {
    const peso = pesoParetoItem(item, metrica);
    const pct = total ? (peso / total) * 100 : 0;
    const antes = acumulado;
    acumulado += pct;
    return {
      ...item,
      pctVolume: metrica === 'volumes' ? pct : n(item.pctVolume),
      pctCtes: metrica === 'ctes' ? pct : n(item.pctCtes),
      pctPareto: pct,
      pctAcumulado: acumulado,
      pareto80: antes < 80,
    };
  });
  const pareto = enriquecida.filter((item) => item.pareto80);
  return pareto.length ? pareto : enriquecida.slice(0, fallback);
}

/** Pareto 80%; se o corte tiver menos que minRotas, usa as minRotas primeiras por ranking. */
export function aplicarCortePareto80ComMinimoRotas(lista = [], { metrica = 'volumes', minRotas = 20 } = {}) {
  const ordenada = [...lista].sort((a, b) => pesoParetoItem(b, metrica) - pesoParetoItem(a, metrica));
  const total = ordenada.reduce((acc, item) => acc + pesoParetoItem(item, metrica), 0);
  if (!total) return [];
  let acumulado = 0;
  const enriquecida = ordenada.map((item) => {
    const peso = pesoParetoItem(item, metrica);
    const pct = total ? (peso / total) * 100 : 0;
    const antes = acumulado;
    acumulado += pct;
    return {
      ...item,
      pctPareto: pct,
      pctAcumulado: acumulado,
      pareto80: antes < 80,
    };
  });
  const pareto = enriquecida.filter((item) => item.pareto80);
  if (pareto.length >= minRotas) return pareto;
  return ordenada.slice(0, Math.min(minRotas, ordenada.length));
}

function getMesorregiaoLaudo(item = {}) {
  return texto(item.mesorregiaoDestino || item.mesorregiao || item.mesoRegiaoDestino || item.mesoRegiao || item.meso_regiao || item.microrregiao || item.regiaoDestino || item.regiao || 'Mesorregião não identificada');
}

function agruparMesorregiaoFaixa(simulacao) {
  const resumo = getResumoRodada(simulacao);
  const opcoesFaixa = opcoesFaixaDoResumo(resumo);
  const detalhes = extrairCtesIndividuaisResumo(resumo).filter((item) => getFaixa(item, opcoesFaixa) !== 'Sem faixa');
  const mapa = new Map();
  detalhes.forEach((item) => {
    const origem = texto(item.origem || item.cidadeOrigem || item.cidade_origem || 'Origem');
    const ufDestino = getUfDestino(item);
    const mesorregiao = getMesorregiaoLaudo(item);
    const faixa = getFaixa(item, opcoesFaixa);
    const chave = [upper(origem), ufDestino, upper(mesorregiao), upper(faixa)].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, ufDestino, mesorregiao, rota: mesorregiao, faixa, ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0, prioridade: 'BAIXA' });
    const acc = mapa.get(chave);
    const { qtdAnalisada, qtdGanha, qtdPerdida } = extrairContagemItem(item);
    acc.ctesAnalisados += qtdAnalisada;
    acc.ctesGanhos += qtdGanha;
    acc.ctesPerdidos += qtdPerdida;
    acc.volumes += n(item.volumes || item.qtdVolumes || qtdAnalisada);
    acc.faturamentoPotencial += valorPotencial(item);
    acc.faturamentoCapturado += qtdGanha > 0 ? n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado) : 0;
    acc.faturamentoNaoCapturado += qtdPerdida > 0 ? n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado) : 0;
    acumularAjusteMedio(acc, item, qtdAnalisada);
  });
  return finalizarAgrupados(Array.from(mapa.values())).sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos)).slice(0, 30);
}


function origemLabelLaudo(item = {}) {
  const origem = padraoComercialLaudo(item.origem || item.cidadeOrigem || item.cidade_origem || 'ORIGEM');
  const ufOrigem = upper(item.ufOrigem || item.uf_origem || item.ufOrigemCte || item.estadoOrigem || '');
  return origem + (ufOrigem ? '/' + ufOrigem : '');
}

// CORRIGIDO: usa só última rodada (não compararGenerico que une 2 rodadas)
function agruparPorOrigemUf(simulacao) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const origem = origemLabelLaudo(item);
    const ufDestino = getUfDestino(item);
    const chave = [upper(origem), ufDestino].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, ufDestino, rota: origem + ' → ' + ufDestino,
      destino: ufDestino, faixa: 'Todas', ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    const acc = mapa.get(chave);
    const { qtdAnalisada, qtdGanha, qtdPerdida } = extrairContagemItem(item);
    acc.ctesAnalisados += qtdAnalisada;
    acc.ctesGanhos += qtdGanha;
    acc.ctesPerdidos += qtdPerdida;
    acc.volumes += n(item.volumes || item.qtdVolumes || qtdAnalisada);
    acc.faturamentoPotencial += valorPotencial(item);
    acc.faturamentoCapturado += qtdGanha > 0 ? n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado) : 0;
    acc.faturamentoNaoCapturado += qtdPerdida > 0 ? n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado) : 0;
    acumularAjusteMedio(acc, item, qtdAnalisada);
  });
  return finalizarAgrupados(Array.from(mapa.values())).sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos));
}

function montarParetoDestinoFaixa(simulacao) {
  const resumo = getResumoRodada(simulacao);
  const opcoesFaixa = opcoesFaixaDoResumo(resumo);
  const detalhes = extrairCtesIndividuaisResumo(resumo).filter((item) => getFaixa(item, opcoesFaixa) !== 'Sem faixa');
  const mapa = new Map();
  detalhes.forEach((item) => {
    const origem = origemLabelLaudo(item);
    const cidade = padraoComercialLaudo(item.destino || item.cidadeDestino || item.cidade_destino || 'DESTINO');
    const ufDestino = getUfDestino(item);
    const faixa = getFaixa(item, opcoesFaixa);
    const chave = [upper(origem), upper(cidade), ufDestino, upper(faixa)].join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, destino: cidade, ufDestino, faixa, rotaDestino: origem + ' → ' + cidade + (ufDestino && ufDestino !== '-' ? '/' + ufDestino : ''), ctes: 0, volumes: 0, ctesGanhos: 0, ctesPerdidos: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    const acc = mapa.get(chave);
    const { qtdAnalisada, qtdGanha, qtdPerdida } = extrairContagemItem(item);
    acc.ctes += qtdAnalisada;
    acc.volumes += n(item.volumes || item.qtdVolumes || qtdAnalisada);
    acc.ctesGanhos += qtdGanha;
    acc.ctesPerdidos += qtdPerdida;
    if (qtdGanha > 0) acc.faturamentoCapturado += n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado);
    if (qtdPerdida > 0) {
      acc.faturamentoNaoCapturado += n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado);
      acumularReducaoPerdidos(acc, item, qtdPerdida);
    }
  });
  const listaBase = Array.from(mapa.values()).map(finalizarLinhaPareto);
  return aplicarCortePareto80(listaBase, { metrica: 'volumes' });
}


function obterAnaliseFaixasB2CSalva(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const lista = Array.isArray(resumo.analiseFaixasB2C) ? resumo.analiseFaixasB2C : [];
  return lista.map((item) => ({
    ...item,
    chave: item.chave || [item.origem, item.destino, item.ufDestino, item.rota || item.cotacao, item.faixa].filter(Boolean).join(' > '),
    rota: item.rota || item.cotacao || [item.origem, item.destino, item.ufDestino].filter(Boolean).join(' > '),
    ufDestino: item.ufDestino || item.uf_destino || item.uf || '-',
    ctesAnalisados: n(item.ctesAnalisados || item.ctes || item.qtd || 0),
    ctesGanhos: n(item.ctesGanhos || item.ctesGanhas || item.ganhas || 0),
    ctesPerdidos: n(item.ctesPerdidos || item.ctesPerdidas || item.perdidas || 0),
    faturamentoPotencial: n(item.faturamentoPotencial || 0),
    faturamentoCapturado: n(item.faturamentoCapturado || 0),
    faturamentoNaoCapturado: n(item.faturamentoNaoCapturado || 0),
    aderencia: n(item.aderencia || 0),
    ajusteMedio: n(item.ajusteMedio || item.reducaoMedia || 0),
    prioridade: item.prioridade || 'BAIXA',
  }));
}


function agruparAnaliseSalvaPorCampo(lista = [], campo = 'rota') {
  const mapa = new Map();
  lista.forEach((item) => {
    const chave = campo === 'destino'
      ? [item.origem, item.destino || item.destinoExemplo, item.ufDestino].filter(Boolean).join(' > ')
      : [item.origem, item.ufDestino, item.rota || item.cotacao].filter(Boolean).join(' > ');
    if (!chave) return;
    if (!mapa.has(chave)) {
      mapa.set(chave, { chave, origem: item.origem || '', destino: campo === 'destino' ? (item.destino || item.destinoExemplo || '') : '', ufDestino: item.ufDestino || '-', rota: campo === 'destino' ? [item.origem, item.destino || item.destinoExemplo, item.ufDestino].filter(Boolean).join(' > ') : (item.rota || item.cotacao || chave), faixa: 'Todas as faixas', ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    }
    const acc = mapa.get(chave);
    acc.ctesAnalisados += n(item.ctesAnalisados);
    acc.ctesGanhos += n(item.ctesGanhos);
    acc.ctesPerdidos += n(item.ctesPerdidos);
    acc.volumes += n(item.volumes);
    acc.faturamentoPotencial += n(item.faturamentoPotencial);
    acc.faturamentoCapturado += n(item.faturamentoCapturado);
    acc.faturamentoNaoCapturado += n(item.faturamentoNaoCapturado);
    const peso = Math.max(n(item.ctesPerdidos), 1);
    acc.reducaoSoma += n(item.ajusteMedio) * peso;
    acc.reducaoQtd += peso;
  });
  return finalizarAgrupados(Array.from(mapa.values())).sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos));
}


function montarParetoCidadesVolume(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = extrairCtesIndividuaisResumo(resumo);
  const mapa = new Map();
  detalhes.forEach((item) => {
    const cidade = padraoComercialLaudo(item.destino || item.cidadeDestino || item.cidade_destino || item.municipioDestino || item.municipio_destino);
    const uf = getUfDestino(item);
    if (!cidade && (!uf || uf === '-')) return;
    const chave = [cidade || 'Destino', uf || '-'].join('|');
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        chave,
        cidade: cidade || 'Destino',
        ufDestino: uf || '-',
        ctes: 0,
        volumes: 0,
        ctesGanhos: 0,
        ctesPerdidos: 0,
        faturamentoCapturado: 0,
        faturamentoNaoCapturado: 0,
        reducaoSoma: 0,
        reducaoQtd: 0,
      });
    }
    const acc = mapa.get(chave);
    const { qtdAnalisada, qtdGanha, qtdPerdida } = extrairContagemItem(item);
    const vols = n(item.volumes || item.qtdVolumes || item.volumesTotal || item.volume) || qtdAnalisada;
    acc.ctes += qtdAnalisada;
    acc.volumes += vols;
    acc.ctesGanhos += qtdGanha;
    acc.ctesPerdidos += qtdPerdida;
    if (qtdGanha > 0) acc.faturamentoCapturado += n(item.freteSelecionada || item.faturamentoCapturado || item.freteRealizado);
    if (qtdPerdida > 0) {
      acc.faturamentoNaoCapturado += n(item.faturamentoNaoCapturado || item.diferencaParaVencedor || item.freteRealizado);
      acumularReducaoPerdidos(acc, item, qtdPerdida);
    }
  });
  const listaBase = Array.from(mapa.values()).map(finalizarLinhaPareto);
  return aplicarCortePareto80(listaBase, { metrica: 'volumes', fallback: 10 });
}


const MARGEM_OPERACIONAL_VEICULO_LAUDO = 0.9;

const VEICULOS_OPERACIONAIS_LAUDO = [
  { tipo: 'Fiorino / utilitário leve', cubagemMin: 3, cubagemRef: 4, pesoMin: 500, pesoRef: 700, uso: 'Coleta pequena, e-commerce, volumes leves' },
  { tipo: 'HR / Kia Bongo / VUC pequeno', cubagemMin: 8, cubagemRef: 12, pesoMin: 1000, pesoRef: 1500, uso: 'Coletas urbanas pequenas/médias' },
  { tipo: 'Van / Sprinter / Master', cubagemMin: 10, cubagemRef: 15, pesoMin: 1200, pesoRef: 1800, uso: 'Fracionado leve, coleta expressa' },
  { tipo: 'VUC / 3/4', cubagemMin: 18, cubagemRef: 25, pesoMin: 2000, pesoRef: 3500, uso: 'Coleta urbana, restrição de cidade, fracionado médio' },
  { tipo: 'Toco', cubagemMin: 35, cubagemRef: 45, pesoMin: 5000, pesoRef: 7000, uso: 'Coletas maiores e transferência curta' },
  { tipo: 'Truck', cubagemMin: 50, cubagemRef: 60, pesoMin: 10000, pesoRef: 14000, uso: 'Coletas grandes, fracionado pesado, filial/CD' },
  { tipo: 'Bitruck', cubagemMin: 60, cubagemRef: 70, pesoMin: 16000, pesoRef: 18000, uso: 'Alto peso com cubagem média' },
  { tipo: 'Carreta simples / sider / baú', cubagemMin: 90, cubagemRef: 100, pesoMin: 24000, pesoRef: 28000, uso: 'Transferência, grandes coletas, lotação' },
  { tipo: 'Carreta LS / Vanderleia', cubagemMin: 95, cubagemRef: 105, pesoMin: 28000, pesoRef: 32000, uso: 'Transferência pesada / lotação' },
  { tipo: 'Rodotrem / Bitrem', cubagemMin: 110, cubagemRef: 140, pesoMin: 38000, pesoRef: 45000, uso: 'Transferência de alto volume/peso' },
];

function diasPeriodoOperacionalLaudo(resumo = {}) {
  const ini = resumo.filtros?.inicio || resumo.inicio || resumo.dataInicio;
  const fim = resumo.filtros?.fim || resumo.fim || resumo.dataFim;
  const dIni = ini ? new Date(ini) : null;
  const dFim = fim ? new Date(fim) : null;
  if (dIni && dFim && !Number.isNaN(dIni.getTime()) && !Number.isNaN(dFim.getTime()) && dFim >= dIni) {
    return Math.max(1, Math.ceil((dFim.getTime() - dIni.getTime()) / 86400000) + 1);
  }
  return 22;
}

function cubagemOperacionalItemLaudo(item = {}) {
  const direta = n(item.cubagem || item.cubagemTotal || item.cubagem_total || item.cubagemAplicada || item.cubagemRealizada);
  if (direta > 0) return direta;
  const unit = n(item.cubagemUnitaria || item.cubagem_unitaria);
  const volumes = n(item.volumes || item.qtdVolumes || item.qtd_volumes) || 1;
  return unit > 0 ? unit * Math.max(volumes, 1) : 0;
}

function pesoOperacionalItemLaudo(item = {}) {
  return pesoUnitarioCte(item);
}

function calcularIndicadorVeiculoOperacionalLaudo({ cubagemDia = 0, pesoDia = 0, cubagemDisponivel = true } = {}) {
  const cubagem = Math.max(0, n(cubagemDia));
  const peso = Math.max(0, n(pesoDia));
  const primeiro = VEICULOS_OPERACIONAIS_LAUDO[0];
  if (!peso) {
    return { semDados: true, cubagemDia: cubagem, pesoDia: peso, cubagemDisponivel, veiculo: primeiro, ocupacaoOperacional: 0, qtdVeiculos: 1, fatorLimitante: 'peso', alerta: 'Sem peso suficiente para sugerir veículo.' };
  }
  // Se cubagem não disponível, seleciona veículo só pelo peso
  const atendeFisico = cubagemDisponivel
    ? (v) => cubagem <= v.cubagemRef && peso <= v.pesoRef
    : (v) => peso <= v.pesoRef;
  const atendeOperacional = cubagemDisponivel
    ? (v) => cubagem <= v.cubagemRef * MARGEM_OPERACIONAL_VEICULO_LAUDO && peso <= v.pesoRef * MARGEM_OPERACIONAL_VEICULO_LAUDO
    : (v) => peso <= v.pesoRef * MARGEM_OPERACIONAL_VEICULO_LAUDO;
  const veiculoMinimo = VEICULOS_OPERACIONAIS_LAUDO.find(atendeFisico) || VEICULOS_OPERACIONAIS_LAUDO[VEICULOS_OPERACIONAIS_LAUDO.length - 1];
  const veiculoComFolga = VEICULOS_OPERACIONAIS_LAUDO.find(atendeOperacional) || VEICULOS_OPERACIONAIS_LAUDO[VEICULOS_OPERACIONAIS_LAUDO.length - 1];
  const cargaAcimaMaior = !VEICULOS_OPERACIONAIS_LAUDO.some(atendeOperacional);
  const veiculo = cargaAcimaMaior ? VEICULOS_OPERACIONAIS_LAUDO[VEICULOS_OPERACIONAIS_LAUDO.length - 1] : veiculoComFolga;
  const ocupacaoFisica = veiculo.pesoRef ? peso / veiculo.pesoRef : 0;
  const qtdVeiculos = Math.max(1, Math.ceil(ocupacaoFisica));
  const ocupacaoCubagem = (cubagemDisponivel && cubagem && veiculo.cubagemRef) ? cubagem / (veiculo.cubagemRef * MARGEM_OPERACIONAL_VEICULO_LAUDO * qtdVeiculos) : 0;
  const ocupacaoPeso = veiculo.pesoRef ? peso / (veiculo.pesoRef * MARGEM_OPERACIONAL_VEICULO_LAUDO * qtdVeiculos) : 0;
  const ocupacaoOperacional = cubagemDisponivel ? Math.max(ocupacaoCubagem, ocupacaoPeso) : ocupacaoPeso;
  const fatorLimitante = (cubagemDisponivel && ocupacaoCubagem >= ocupacaoPeso) ? 'cubagem' : 'peso';
  const minimoNoLimite = veiculoMinimo.tipo !== veiculo.tipo;
  let alerta = cubagemDisponivel
    ? 'Capacidade adequada com folga operacional.'
    : 'Cubagem não informada nos dados; sugestão baseada somente no peso das cargas ganhas.';
  if (cargaAcimaMaior && qtdVeiculos > 1) alerta = `Demanda acima de 1 veículo; estimar ${qtdVeiculos} veículo(s)/dia.`;
  else if (minimoNoLimite) alerta = `${veiculoMinimo.tipo} comporta, mas fica acima da folga operacional; recomendado subir para ${veiculo.tipo}.`;
  else if (ocupacaoOperacional >= 0.9) alerta = 'Ocupação alta; acompanhar peso, cubagem e janela de coleta.';
  return { semDados: false, cubagemDia: cubagem, pesoDia: peso, cubagemDisponivel, veiculo, veiculoMinimo, ocupacaoOperacional, qtdVeiculos, fatorLimitante, minimoNoLimite, alerta, margemOperacional: MARGEM_OPERACIONAL_VEICULO_LAUDO };
}

// CORRIGIDO: cubagem zerada = dado ausente, não zero real.
// Tenta buscar cubagem dos detalhes; se não encontrar, sinaliza cubagemDisponivel=false
// e calcula o veículo só pelo peso (que sempre deve existir).
function calcularVeiculoOperacionalLaudo(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  const ganhas = detalhes.filter(isGanha);
  const dias = diasPeriodoOperacionalLaudo(resumo);

  const cubagemTotal = ganhas.reduce((acc, item) => acc + cubagemOperacionalItemLaudo(item), 0);
  const pesoTotal = ganhas.reduce((acc, item) => acc + pesoOperacionalItemLaudo(item), 0);

  // Fallback de peso pelo campo agregado do resumo quando detalhes não têm peso
  const pesoFallback = pesoTotal > 0 ? pesoTotal : n(resumo.peso || resumo.pesoTotal || resumo.peso_total || 0);

  // Cubagem: se vier zero dos detalhes, tenta campo agregado do resumo
  const cubagemFallback = cubagemTotal > 0
    ? cubagemTotal
    : n(resumo.cubagemTotal || resumo.cubagem_total || resumo.cubagemGanho || resumo.cubagem_ganha || 0);

  const cubagemDisponivel = cubagemFallback > 0;

  const indicador = calcularIndicadorVeiculoOperacionalLaudo({
    cubagemDia: cubagemDisponivel ? cubagemFallback / dias : 0,
    pesoDia: pesoFallback / dias,
    cubagemDisponivel,
  });
  return { ...indicador, cubagemTotal: cubagemFallback, pesoTotal: pesoFallback, diasBase: dias, ctesGanhos: ganhas.length };
}


function classificarRecomendacao(comparativo, rotasCriticas = []) {
  const atual = comparativo.atual || {};
  const evolucao = comparativo.evolucaoAderencia;
  if (atual.aderencia >= 70 && atual.savingMes > 0) return 'Recomendação: avançar com aprovação ou aprovação parcial, mantendo monitoramento das rotas críticas residuais.';
  if (atual.aderencia >= 40) return 'Recomendação: solicitar contraproposta direcionada, priorizando as rotas/cotações com maior faturamento não capturado antes da aprovação final.';
  if (evolucao >= 10) return 'Recomendação: a transportadora demonstrou evolução relevante, mas ainda precisa de nova rodada focada nas rotas críticas antes de implantação.';
  if (rotasCriticas.length) return 'Recomendação: não aprovar neste momento. Solicitar nova rodada com ajuste objetivo nas rotas e faixas listadas como alta prioridade.';
  return 'Recomendação: manter em análise e validar cobertura, pois os dados atuais ainda não indicam aderência suficiente para aprovação.';
}

function recomendacaoTransportador(rotasCriticas = [], rotasMelhoraram = []) {
  const foco = rotasCriticas.slice(0, 3).map((item) => item.rota || item.chave).filter(Boolean).join('; ');
  const melhora = rotasMelhoraram.length ? 'Reconhecemos evolução em parte das rotas avaliadas. ' : '';
  if (foco) {
    return `${melhora}Para a próxima rodada, recomendamos concentrar a revisão nos pontos de maior impacto: ${foco}. Não é necessário alterar toda a tabela; o ganho de competitividade deve vir de ajustes direcionados nas rotas, cotações e faixas de peso destacadas.`;
  }
  return `${melhora}A proposta apresenta boa evolução geral. Para avançarmos, recomendamos validar os pontos remanescentes e manter as condições competitivas nas rotas onde a tabela já performa bem.`;
}

// CORRIGIDO: usa somente cargas ganhas para calcular % frete/NF
function calcularMetricasNfRodada(simulacao = {}) {
  const resumo = getResumoRodada(simulacao);
  const detalhes = extrairDetalhesResumo(resumo);
  // Filtra apenas cargas ganhas
  const ganhas = detalhes.filter(isGanha);
  let valorNfTotal = 0;
  let freteRealizadoTotal = 0;
  let freteSelecionadaTotal = 0;
  ganhas.forEach((item) => {
    const nf = n(item.valorNF || item.valorNf || item.valor_nf || item.valorNota || item.nf);
    valorNfTotal += nf;
    freteRealizadoTotal += n(item.freteRealizado || item.valorCte || item.valorCTe);
    freteSelecionadaTotal += n(item.freteSelecionada || item.freteTabelaSelecionada || item.valorFreteSelecionada);
  });
  // Fallback nos campos agregados do resumo quando não há detalhes com NF
  const percentualFreteReal = valorNfTotal
    ? (freteRealizadoTotal / valorNfTotal) * 100
    : n(resumo.percentualFreteRealizado);
  const percentualFreteTabela = valorNfTotal
    ? (freteSelecionadaTotal / valorNfTotal) * 100
    : n(resumo.percentualFreteTabelaGanharia || resumo.percentualFreteSelecionada);
  const variacaoPp = percentualFreteTabela - percentualFreteReal;
  return {
    valorNfTotal,
    freteRealizadoTotal,
    freteSelecionadaTotal,
    percentualFreteReal,
    percentualFreteTabela,
    reducaoPpFreteNf: variacaoPp,
    // flag para o template saber se deve chamar "Redução" ou "Variação"
    fretePropostaAcima: variacaoPp > 0,
  };
}


function montarComparativo(evolucaoRodadas = []) {
  const inicial = evolucaoRodadas[0] || {};
  const atual = evolucaoRodadas[evolucaoRodadas.length - 1] || inicial;
  // Detecta mudança de base entre rodadas
  const ctesAnalisadosInicial = n(inicial.ctesAnalisados);
  const ctesAnalisadosAtual = n(atual.ctesAnalisados);
  const baseMudou = evolucaoRodadas.length >= 2 && ctesAnalisadosInicial > 0 && ctesAnalisadosAtual > 0
    && Math.abs(ctesAnalisadosAtual - ctesAnalisadosInicial) / ctesAnalisadosInicial > 0.1;
  return {
    inicial,
    atual,
    evolucaoAderencia: n(atual.aderencia) - n(inicial.aderencia),
    evolucaoSavingMes: n(atual.savingMes) - n(inicial.savingMes),
    evolucaoFaturamentoMes: n(atual.faturamentoMes) - n(inicial.faturamentoMes),
    evolucaoCtesGanhos: n(atual.ctesGanhos) - n(inicial.ctesGanhos),
    evolucaoVolumes: n(atual.volumesGanhos) - n(inicial.volumesGanhos),
    evolucaoReducaoMedia: n(atual.reducaoMedia) - n(inicial.reducaoMedia),
    baseMudou,
  };
}

function fraseEvolucao(comparativo, quantidadeRodadas = 0) {
  if (quantidadeRodadas < 2) {
    return `Esta é a primeira rodada salva da análise. A proposta apresenta aderência atual de ${percentual(comparativo.atual?.aderencia)}, com ${numero(comparativo.atual?.ctesGanhos)} CT-es competitivos, ${numero(comparativo.atual?.volumesGanhos)} volumes competitivos e faturamento potencial capturado de ${dinheiro(comparativo.atual?.faturamentoMes)} por mês.`;
  }
  const partes = [];
  if (comparativo.evolucaoAderencia >= 0) partes.push(`A aderência evoluiu ${percentual(comparativo.evolucaoAderencia)} p.p. entre a primeira e a última rodada.`);
  else partes.push(`A aderência caiu ${percentual(Math.abs(comparativo.evolucaoAderencia))} p.p. entre a primeira e a última rodada.`);
  if (comparativo.baseMudou) partes.push('A base de CT-es analisados mudou entre as rodadas; a comparação de aderência deve ser lida com cautela.');
  if (comparativo.evolucaoFaturamentoMes > 0) partes.push(`O faturamento potencial capturado aumentou ${dinheiro(comparativo.evolucaoFaturamentoMes)} por mês.`);
  if (comparativo.evolucaoCtesGanhos > 0) partes.push(`A proposta passou a capturar mais ${numero(comparativo.evolucaoCtesGanhos)} CT-es no recorte analisado.`);
  if (comparativo.evolucaoReducaoMedia < 0) partes.push('A redução média necessária caiu, indicando aproximação da proposta em relação às referências de mercado.');
  if (comparativo.evolucaoReducaoMedia > 0) partes.push('A redução média necessária aumentou nas rotas críticas, exigindo atenção antes da aprovação.');
  return partes.join(' ');
}

function montarRelatorioExecutivo({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, faixasCriticas, recomendacao }) {
  const t = tabela || {};
  return resumoTexto([
    `LAUDO GERAL DAS RODADAS - ${t.transportadora || 'Transportadora'}`,
    `Canal: ${t.canal || '-'}`,
    `Origem: ${t.origem || '-'}`,
    `Rodadas simuladas: ${evolucaoRodadas.length}`,
    '',
    'RESUMO EXECUTIVO',
    fraseEvolucao(comparativo, evolucaoRodadas.length),
    `Aderência: ${percentual(comparativo.inicial.aderencia)} para ${percentual(comparativo.atual.aderencia)}.`,
    `Saving mensal: ${dinheiro(comparativo.inicial.savingMes)} para ${dinheiro(comparativo.atual.savingMes)}.`,
    `Faturamento capturado/mês: ${dinheiro(comparativo.inicial.faturamentoMes)} para ${dinheiro(comparativo.atual.faturamentoMes)}.`,
    '',
    'VEÍCULO SUGERIDO NAS CARGAS GANHAS',
    ...(comparativo.atual?.veiculoOperacional && !comparativo.atual.veiculoOperacional.semDados ? [
      `- ${comparativo.atual.veiculoOperacional.veiculo.tipo}: ${percentual(comparativo.atual.veiculoOperacional.ocupacaoOperacional * 100)} ocupado, limitante ${comparativo.atual.veiculoOperacional.fatorLimitante}. ${comparativo.atual.veiculoOperacional.cubagemDisponivel ? `Cubagem/dia ${numero(comparativo.atual.veiculoOperacional.cubagemDia, 2)} m³ e ` : ''}Peso/dia ${numero(comparativo.atual.veiculoOperacional.pesoDia, 0)} kg.`
    ] : ['- Sem peso suficiente para sugerir veículo.']),
    '',
    'EVOLUÇÃO DAS RODADAS',
    ...evolucaoRodadas.map((r) => `- ${r.rodada}ª rodada (${dataBR(r.criadoEm)}): aderência ${percentual(r.aderencia)}, CT-es ganhos ${numero(r.ctesGanhos)}, volumes ${numero(r.volumesGanhos)}, faturamento ${dinheiro(r.faturamentoMes)}/mês, saving ${dinheiro(r.savingMes)}/mês.`),
    '',
    'ROTAS/COTAÇÕES CRÍTICAS',
    ...(rotasCriticas.length ? rotasCriticas.slice(0, 10).map((r) => `- ${r.rota}: ${numero(r.ctesPerdidos)} CT-es perdidos, ${dinheiro(r.faturamentoNaoCapturado)} não capturado, ajuste médio ${percentual(r.ajusteMedio)}, prioridade ${r.prioridade}.`) : ['- Não foram identificadas rotas críticas no recorte atual.']),
    '',
    'ROTAS QUE MELHORARAM',
    ...(rotasMelhoraram.length ? rotasMelhoraram.slice(0, 8).map((r) => `- ${r.rota}: evolução de ${numero(r.evolucaoCtes)} CT-es competitivos.`) : ['- Não houve evolução destacada por rota/cotação.']),
    '',
    'UFs PRIORITÁRIAS',
    ...(ufsCriticas.length ? ufsCriticas.slice(0, 8).map((u) => `- ${u.ufDestino || u.rota}: ${numero(u.ctesPerdidos)} CT-es perdidos, aderência ${percentual(u.aderencia)}, ajuste médio ${percentual(u.ajusteMedio)}.`) : ['- Sem leitura suficiente por UF.']),
    '',
    'FAIXAS DE PESO PRIORITÁRIAS',
    ...(faixasCriticas.length ? faixasCriticas.slice(0, 8).map((f) => `- ${f.faixa || f.rota}: ${numero(f.ctesPerdidos)} CT-es perdidos, ${dinheiro(f.faturamentoNaoCapturado)} não capturado, ajuste médio ${percentual(f.ajusteMedio)}.`) : ['- Sem leitura suficiente por faixa de peso.']),
    '',
    'RECOMENDAÇÃO',
    recomendacao,
  ]);
}

function montarRelatorioTransportador({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, destinoFaixaPareto = [], paretoCidades = [], recomendacao }) {
  const t = tabela || {};
  const poucaBase = evolucaoRodadas.length < 2;
  const linhas = [
    `DEVOLUTIVA GERAL DAS RODADAS - ${t.transportadora || 'Transportadora'}`,
    `Canal: ${t.canal || '-'}`,
    `Origem: ${t.origem || '-'}`,
    `Rodadas avaliadas: ${evolucaoRodadas.length}`,
    '',
    poucaBase ? 'DIAGNÓSTICO INICIAL' : 'RESUMO DA EVOLUÇÃO',
    poucaBase
      ? `Esta é a primeira rodada salva da análise. A proposta apresenta aderência atual de ${percentual(comparativo.atual.aderencia)}, com ${numero(comparativo.atual.ctesGanhos)} CT-es competitivos, ${numero(comparativo.atual.volumesGanhos)} volumes competitivos e faturamento potencial capturado de ${dinheiro(comparativo.atual.faturamentoMes)} por mês. As próximas seções mostram onde estão os maiores volumes e as oportunidades de ajuste.`
      : `A proposta saiu de ${percentual(comparativo.inicial.aderencia)} para ${percentual(comparativo.atual.aderencia)} de aderência no recorte analisado.`,
    `Hoje o frete representa ${percentual(comparativo.atual.percentualFreteReal)} das notas fiscais das cargas ganhas. Com a proposta, passaria para ${percentual(comparativo.atual.percentualFreteTabela)}. ${comparativo.atual.fretePropostaAcima ? 'Variação' : 'Redução'}: ${Math.abs(Number(comparativo.atual.reducaoPpFreteNf || 0)).toFixed(2)} p.p.`,
    '',
    'EVOLUÇÃO DAS RODADAS',
    ...evolucaoRodadas.map((r) => `- ${r.rodada}ª rodada (${dataBR(r.criadoEm)}): aderência ${percentual(r.aderencia)}, CT-es competitivos ${numero(r.ctesGanhos)}, volumes ${numero(r.volumesGanhos)}, faturamento ${dinheiro(r.faturamentoMes)}/mês.`),
  ];

  if (!poucaBase) {
    linhas.push('', 'ONDE A PROPOSTA MELHOROU');
    linhas.push(...(rotasMelhoraram.length ? rotasMelhoraram.slice(0, 8).map((r) => `- ${r.rota}: evolução de ${numero(r.evolucaoCtes)} CT-es competitivos.`) : ['- Ainda não há melhoria destacada por rota/cotação.']));
  }

  linhas.push(
    '',
    'VISÃO POR ESTADO/UF',
    ...(ufsCriticas.length ? ufsCriticas.slice(0, 8).map((u) => `- ${u.rota || u.ufDestino}: ${numero(u.ctesPerdidos)} CT-es a revisar, aderência atual ${percentual(u.aderencia)}.`) : ['- Sem leitura suficiente por UF.']),
    '',
    'PARETO 80% DAS CIDADES POR VOLUME TOTAL',
    ...(paretoCidades.length ? paretoCidades.slice(0, 8).map((p) => `- ${p.cidade || '-'} / ${p.ufDestino || '-'}: ${numero(p.volumes)} volumes, ${percentual(p.pctAcumulado)} acumulado.`) : ['- Sem leitura suficiente para Pareto de cidades.']),
    '',
    'PARETO 80% - DESTINO X FAIXA',
    ...(destinoFaixaPareto.length ? destinoFaixaPareto.slice(0, 10).map((p) => `- ${p.rotaDestino || p.rota || p.chave}: faixa ${p.faixa || '-'}, ${numero(p.volumes)} volumes, aderência ${percentual(p.aderencia)}.`) : ['- Sem leitura suficiente por destino e faixa.']),
    '',
    'DIRECIONAL FINAL',
    recomendacao
  );
  return resumoTexto(linhas);
}

export function montarLaudosRodadasNegociacao(tabela = {}) {
  const resumo = getResumo(tabela);
  const simulacoesTodas = obterSimulacoesRodadas(resumo);
  const simulacoes = consolidarUltimaSimulacaoPorRodada(simulacoesTodas);
  const evolucaoRodadas = simulacoes.map(getIndicadoresRodada);
  const comparativo = montarComparativo(evolucaoRodadas);
  const primeira = simulacoes[0] || null;
  const ultima = simulacoes[simulacoes.length - 1] || primeira;
  const cidadesParetoVolume = ultima ? montarParetoCidadesVolume(ultima) : [];
  const rotasComparadas = primeira && ultima ? compararRotas(primeira, ultima) : [];
  const rotasCriticas = rotasComparadas
    .map((r) => ({ ...r, faixa: 'Todas as faixas' }))
    .filter((r) => n(r.ctesPerdidos) > 0 || n(r.faturamentoNaoCapturado) > 0 || n(r.ajusteMedio) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos) || n(b.ajusteMedio) - n(a.ajusteMedio))
    .slice(0, 20);
  const rotasMelhoraram = rotasComparadas
    .filter((r) => n(r.evolucaoCtes) > 0)
    .sort((a, b) => n(b.evolucaoCtes) - n(a.evolucaoCtes))
    .slice(0, 12);

  // CORRIGIDO: ufsCriticas usa só a última rodada (não compararGenerico que soma 2 rodadas)
  const ufsCriticas = ultima
    ? agruparPorOrigemUf(ultima)
        .filter((u) => n(u.ctesPerdidos) > 0 || n(u.faturamentoNaoCapturado) > 0)
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 12)
    : [];

  const faixasCriticas = primeira && ultima ? compararGenerico(primeira, ultima, agruparSomentePorFaixa)
    .filter((f) => n(f.ctesPerdidos) > 0 || n(f.faturamentoNaoCapturado) > 0)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 12) : [];

  const paretoFinal = cidadesParetoVolume;

  const faixasDetalhadas = ultima ? agruparDetalhes(ultima, chaveRota)
    .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
    .slice(0, 30) : [];

  const mesorregiaoFaixas = ultima ? agruparMesorregiaoFaixa(ultima).filter((item) => {
    const meso = String(item.mesorregiao || item.rota || '').toLowerCase();
    return meso && !meso.includes('não identificada') && !meso.includes('nao identificada');
  }) : [];

  const destinoFaixaPareto = ultima ? montarParetoDestinoFaixa(ultima) : [];

  const metricasNfAtual = ultima ? calcularMetricasNfRodada(ultima) : {};
  const veiculoOperacional = ultima ? calcularVeiculoOperacionalLaudo(ultima) : null;
  comparativo.atual = {
    ...(comparativo.atual || {}),
    ...metricasNfAtual,
    veiculoOperacional,
    percentualFreteReal: metricasNfAtual.percentualFreteReal || comparativo.atual?.percentualFreteReal || 0,
    percentualFreteTabela: metricasNfAtual.percentualFreteTabela || comparativo.atual?.percentualFreteTabela || 0,
    fretePropostaAcima: metricasNfAtual.fretePropostaAcima || false,
  };

  const cotacoesCriticas = primeira && ultima
    ? compararGenerico(primeira, ultima, agruparPorCotacao)
        .filter((r) => n(r.ctesPerdidos) > 0 || n(r.faturamentoNaoCapturado) > 0)
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 12)
    : [];

  const destinosCriticos = primeira && ultima
    ? compararGenerico(primeira, ultima, agruparPorDestino)
        .filter((r) => n(r.ctesPerdidos) > 0 || n(r.faturamentoNaoCapturado) > 0)
        .sort((a, b) => n(b.faturamentoNaoCapturado) - n(a.faturamentoNaoCapturado) || n(b.ctesPerdidos) - n(a.ctesPerdidos))
        .slice(0, 12)
    : [];

  const recomendacaoExecutivo = classificarRecomendacao(comparativo, rotasCriticas);
  const recomendacaoTransp = recomendacaoTransportador(rotasCriticas, rotasMelhoraram);
  const geradoEm = new Date().toISOString();

  const base = {
    transportadora: tabela.transportadora || resumo.transportadora || 'Transportadora',
    canal: tabela.canal || resumo.canal || '',
    origem: tabela.origem || resumo.filtros?.origem || '',
    ufDestino: tabela.uf_destino || resumo.filtros?.ufDestino || '',
    periodo: resumo.filtros?.inicio || resumo.filtros?.fim ? `${resumo.filtros?.inicio || 'início'} a ${resumo.filtros?.fim || 'fim'}` : 'período analisado',
    geradoEm,
    quantidadeSimulacoes: simulacoes.length,
    quantidadeRegistrosSimulacao: simulacoesTodas.length,
    evolucaoRodadas,
    comparativo,
    rotasCriticas,
    rotasMelhoraram,
    ufsCriticas,
    cotacoesCriticas,
    destinosCriticos,
    faixasCriticas,
    mesorregiaoFaixas,
    destinoFaixaPareto,
    cidadesParetoVolume,
    veiculoOperacional,
    paretoCidades: paretoFinal,
    faixasDetalhadas,
  };

  const relatorioExecutivo = montarRelatorioExecutivo({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, faixasCriticas, recomendacao: recomendacaoExecutivo });
  const relatorioTransportador = montarRelatorioTransportador({ tabela, comparativo, evolucaoRodadas, rotasCriticas, rotasMelhoraram, ufsCriticas, destinoFaixaPareto, paretoCidades: paretoFinal, recomendacao: recomendacaoTransp });

  return {
    executivo: {
      ...base,
      tipo: 'executivo_rodadas',
      titulo: 'Laudo Geral das Rodadas — Análise Interna',
      assunto: `Laudo geral das rodadas - ${base.transportadora}`,
      corpoEmail: relatorioExecutivo,
      relatorio: relatorioExecutivo,
      relatorioTexto: relatorioExecutivo,
      laudoCompleto: `Assunto: Laudo geral das rodadas - ${base.transportadora}\n\n${relatorioExecutivo}`,
      indicadores: comparativo.atual || {},
      recomendacao: recomendacaoExecutivo,
    },
    transportador: {
      ...base,
      tipo: 'transportador_rodadas',
      titulo: 'Devolutiva Geral das Rodadas — Oportunidades de Ajuste',
      assunto: `Devolutiva de rodadas - ${base.transportadora}`,
      corpoEmail: relatorioTransportador,
      relatorio: relatorioTransportador,
      relatorioTexto: relatorioTransportador,
      laudoCompleto: `Assunto: Devolutiva de rodadas - ${base.transportadora}\n\n${relatorioTransportador}`,
      indicadores: comparativo.atual || {},
      ondeMelhorou: rotasMelhoraram,
      ondeAjustar: rotasCriticas,
      cotacoesPrioritarias: cotacoesCriticas,
      destinosPrioritarios: destinosCriticos,
      recomendacao: recomendacaoTransp,
    },
  };
}

export const formatadoresLaudoRodadas = { dinheiro, numero, percentual, dataBR, exibirCidade };
