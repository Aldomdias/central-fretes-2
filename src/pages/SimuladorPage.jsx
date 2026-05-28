
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  analisarCoberturaTabela,
  analisarOrigemPorGrade,
  analisarTransportadoraPorGrade,
  buildLookupTables,
  exportarLinhasCsv,
  getCidadeByIbge,
  getUfByIbge,
  simularPorTransportadora,
  simularSimples,
} from '../utils/calculoFrete';
import { carregarGradeFrete, salvarGradeFrete } from '../utils/gradeFreteConfig';
import { carregarGradeFreteCentralizada, salvarGradeFreteCentralizada, restaurarGradeFreteCentralizadaPadrao } from '../services/gradeFreteSupabaseService';
import { buscarBaseSimulacaoDb, buscarBaseSimulacaoPorRotasDb, carregarMunicipiosIbgeDb, carregarOpcoesSimuladorDb, resolverDestinoIbgeDb } from '../services/freteDatabaseService';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarVinculosTransportadoras, criarMapaVinculosTransportadoras } from '../services/vinculosTransportadorasService';
import {
  buscarTabelasNegociacaoParaSimulacao,
  salvarResultadoSimulacaoNegociacao,
} from '../services/tabelasNegociacaoService';
import {
  converterTabelasNegociacaoParaSimulador,
  labelTabelaNegociacaoSimulador,
} from '../utils/tabelasNegociacaoSimuladorAdapter';
import { LaudoNegociacaoTemplate } from '../components/laudos';
import { prepararLaudosNegociacao, salvarLaudosNegociacao } from '../services/laudosNegociacaoService';

const CANAL_VENDAS_MAP_SIM = {
  'B2C': 'B2C', 'B2B': 'ATACADO', 'MERCADO LIVRE': 'B2C', 'SHOPEE': 'B2C',
  'MAGAZINE LUIZA': 'B2C', 'AMAZON': 'B2C', 'VIA VAREJO': 'B2C', 'CARREFOUR': 'B2C',
  'LIVELO': 'B2C', 'CANTU PNEUS': 'B2C', 'PITSTOP': 'B2C', 'INTER': 'B2C',
  'ITAU SHOP': 'B2C', '99': 'B2C', 'COOPERA': 'B2C', 'BRADESCO SHOP': 'B2C', 'MUSTANG': 'B2C',
};
const MARCADORES_ATACADO_SIM = ['AT-AG', 'AT-TR', 'ECM-B2B', 'ECC-SALES', 'ECA-SALES'];
const TOMADORES_REALIZADO_PADRAO_SIM = ['CPX', 'ITR', 'GP PNEUS'];


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFetchNetworkError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('fetch failed') || msg.includes('timeout') || msg.includes('aborted');
}

async function executarQueryRealizadoComRetry(montarQuery, contexto = 'consulta realizado_local_ctes', tentativas = 3) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      return await montarQuery();
    } catch (error) {
      ultimoErro = error;
      if (!isFetchNetworkError(error) || tentativa >= tentativas) break;
      await sleep(600 * tentativa);
    }
  }

  const detalhe = ultimoErro?.message || String(ultimoErro || 'erro desconhecido');
  throw new Error(`${contexto}: ${detalhe}`);
}

function normalizarCanalSim(r) {
  const norm = (s) => String(s || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cv = norm(r.canal_vendas);
  if (cv && CANAL_VENDAS_MAP_SIM[cv]) return CANAL_VENDAS_MAP_SIM[cv];
  const marc = norm(r.marcadores);
  if (marc) {
    if (MARCADORES_ATACADO_SIM.some((t) => marc.includes(t))) return 'ATACADO';
    if (marc.length > 0) return 'B2C';
  }
  if (!String(r.documento_destinatario || '').trim()) return 'B2C';
  const cl = norm(r.canal);
  return cl || 'B2C';
}

function pickRealizadoField(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function onlyDigitsRealizado(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function aplicarFiltrosRealizadoQuery(query, filtros) {
  if (filtros.transportadora) query = query.ilike('transportadora', `%${filtros.transportadora}%`);
  // Origem/destino são filtrados depois em JavaScript com normalização sem acento.
  // Isso evita falha entre Itajaí/Itajai e outros casos de acentuação.
  // if (filtros.origem) query = query.ilike('cidade_origem', filtros.origem + '%');
  // if (filtros.destino) query = query.ilike('cidade_destino', filtros.destino + '%');
  if (filtros.ufOrigem) query = query.eq('uf_origem', filtros.ufOrigem);
  if (filtros.canal) {
    const canalNorm = String(filtros.canal || '').toUpperCase();
    if (canalNorm === 'ATACADO' || canalNorm === 'B2B') query = query.in('canal', ['ATACADO', 'B2B', 'Atacado', 'b2b']);
    else query = query.eq('canal', filtros.canal);
  }
  if (Array.isArray(filtros.ufDestino) && filtros.ufDestino.length) query = query.in('uf_destino', filtros.ufDestino);
  else if (filtros.ufDestino) query = query.eq('uf_destino', filtros.ufDestino);
  if (filtros.inicio) query = query.gte('data_emissao', filtros.inicio);
  if (filtros.fim) query = query.lte('data_emissao', filtros.fim);
  return query;
}

async function buscarRealizadoLocalCtes(filtros = {}, onProgresso = null) {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseClient();
  const totalMax = Math.min(Number(filtros.limit) || 100000, 200000);
  const PAGE_SIZE = 500; // menor para evitar Failed to fetch em bases grandes
  let allRows = [];
  let from = 0;

  while (allRows.length < totalMax) {
    const to = from + PAGE_SIZE - 1;
    let query = supabase
      .from('realizado_local_ctes')
      .select('*')
      .order('data_emissao', { ascending: false })
      .range(from, to);
    query = aplicarFiltrosRealizadoQuery(query, filtros);

    const resposta = await executarQueryRealizadoComRetry(async () => query, `Erro ao buscar realizado_local_ctes (${from + 1}-${to + 1})`);
    const { data, error } = resposta || {};
    if (error) throw new Error('Erro ao buscar realizado_local_ctes: ' + error.message);
    if (!data || data.length === 0) break;

    allRows = allRows.concat(data);
    if (onProgresso) onProgresso(allRows.length);
    if (data.length < PAGE_SIZE) break; // última página
    from += PAGE_SIZE;
  }

  const rows = allRows.slice(0, totalMax);
  let mapeados = rows.map(r => ({
    transportadora: pickRealizadoField(r, ['transportadora', 'nome_transportadora', 'transportador']) || '',
    tomador: pickRealizadoField(r, ['tomador_servico', 'tomadorServico', 'tomador', 'nome_tomador', 'razao_social_tomador']) || '',
    valorCte: Number(pickRealizadoField(r, ['valor_cte', 'valorCte', 'frete_realizado', 'freteRealizado', 'valor_frete'])) || 0,
    valorNF: Number(pickRealizadoField(r, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota', 'valor_mercadoria'])) || 0,
    cidadeDestino: pickRealizadoField(r, ['cidade_destino', 'cidadeDestino', 'destino', 'municipio_destino']) || '',
    ufDestino: String(pickRealizadoField(r, ['uf_destino', 'ufDestino', 'estado_destino']) || '').toUpperCase(),
    cidadeOrigem: pickRealizadoField(r, ['cidade_origem', 'cidadeOrigem', 'origem', 'municipio_origem']) || '',
    ufOrigem: String(pickRealizadoField(r, ['uf_origem', 'ufOrigem', 'estado_origem']) || '').toUpperCase(),
    canal: normalizarCanalSim(r),
    numeroCte: pickRealizadoField(r, ['numero_cte', 'numeroCte', 'cte', 'n_cte']) || '',
    chaveCte: pickRealizadoField(r, ['chave_cte', 'chaveCte', 'chave']) || '',
    chaveNfe: pickRealizadoField(r, ['chave_nfe', 'chaveNfe', 'chave_nf', 'chaveNf', 'chave_nota', 'chaveNota']) || '',
    notaFiscal: pickRealizadoField(r, ['nota_fiscal', 'notaFiscal', 'nf', 'numero_nf', 'numeroNf', 'nfe_numero']) || '',
    pesoDeclarado: Number(pickRealizadoField(r, ['peso_declarado', 'pesoDeclarado', 'peso', 'peso_real', 'pesoReal'])) || 0,
    qtdVolumes: Number(pickRealizadoField(r, ['qtd_volumes', 'qtdVolumes', 'volume', 'volumes', 'quantidade_volumes'])) || 0,
    cubagemUnitaria: Number(pickRealizadoField(r, ['cubagem_unitaria', 'cubagemUnitaria', 'cubagem'])) || 0,
    cubagemTotal: Number(pickRealizadoField(r, ['cubagem_total', 'cubagemTotal'])) || 0,
    pesoCubado: Number(pickRealizadoField(r, ['peso_cubado', 'pesoCubado'])) || 0,
    ibgeOrigem: onlyDigitsRealizado(pickRealizadoField(r, ['ibge_origem', 'ibgeOrigem', 'codigo_ibge_origem', 'codigoMunicipioOrigem', 'cod_mun_origem'])).slice(0, 7),
    ibgeDestino: onlyDigitsRealizado(pickRealizadoField(r, ['ibge_destino', 'ibgeDestino', 'codigo_ibge_destino', 'codigoMunicipioDestino', 'cod_mun_destino'])).slice(0, 7),
    competencia: pickRealizadoField(r, ['competencia', 'mes_competencia']) || '',
    dataEmissao: pickRealizadoField(r, ['data_emissao', 'dataEmissao', 'emissao']) || '',
    tipo_veiculo: pickRealizadoField(r, ['tipo_veiculo', 'tipoVeiculo', 'veiculo', 'tipo']) || '',
  }));

  const origemFiltro = String(filtros.origem || '').trim();
  if (origemFiltro) {
    const origemNorm = normalizarChaveSimulador(origemFiltro);
    mapeados = mapeados.filter((row) => normalizarChaveSimulador(row.cidadeOrigem || '').startsWith(origemNorm));
  }

  const destinoFiltro = String(filtros.destino || '').trim();
  if (destinoFiltro) {
    const destinoNorm = normalizarChaveSimulador(destinoFiltro);
    mapeados = mapeados.filter((row) => normalizarChaveSimulador(row.cidadeDestino || '').startsWith(destinoNorm));
  }

  return mapeados;
}


function criarChaveUnicaRealizadoSim(row = {}) {
  const chaveCte = normalizarChaveLongaTracking(row.chaveCte || row.chave_cte || row.chave || '');
  if (chaveCte) return `cte:${chaveCte}`;
  const numeroCte = apenasDigitosTracking(row.numeroCte || row.numero_cte || row.cte || '');
  const notaFiscal = apenasDigitosTracking(row.notaFiscal || row.nota_fiscal || row.nf || '');
  const data = String(row.dataEmissao || row.data_emissao || '').slice(0, 10);
  const origem = normalizarChaveSimulador(row.cidadeOrigem || row.cidade_origem || '');
  const destino = normalizarChaveSimulador(row.cidadeDestino || row.cidade_destino || '');
  if (numeroCte || notaFiscal) return `doc:${numeroCte}|${notaFiscal}|${data}|${origem}|${destino}`;
  return `row:${data}|${origem}|${destino}|${Number(row.valorCte || row.valor_cte || 0)}|${Number(row.valorNF || row.valor_nf || 0)}`;
}

function normalizarOrigensFiltroRealizadoSim(origens = []) {
  const lista = Array.isArray(origens)
    ? origens
    : String(origens || '').split(',');

  const vistos = new Set();
  const saida = [];
  lista.forEach((origem) => {
    const texto = String(origem || '').trim();
    const chave = normalizarChaveSimulador(texto);
    if (!texto || !chave || vistos.has(chave)) return;
    vistos.add(chave);
    saida.push(texto);
  });
  return saida;
}

async function buscarRealizadoLocalCtesExpandido(filtros = {}, onProgresso = null) {
  const origens = normalizarOrigensFiltroRealizadoSim(filtros.origens);
  const origemUnica = String(filtros.origem || '').trim();

  if (origemUnica || origens.length <= 1) {
    return buscarRealizadoLocalCtes({
      ...filtros,
      origem: origemUnica || origens[0] || '',
    }, onProgresso);
  }

  const totalMax = Math.min(Number(filtros.limit) || 100000, 200000);
  const todos = [];
  const vistos = new Set();

  for (const origem of origens) {
    const restante = totalMax - todos.length;
    if (restante <= 0) break;

    const parcial = await buscarRealizadoLocalCtes({
      ...filtros,
      origem,
      limit: restante,
    }, (qtd) => {
      if (onProgresso) onProgresso(todos.length + qtd);
    });

    (parcial || []).forEach((row) => {
      const chave = criarChaveUnicaRealizadoSim(row);
      if (vistos.has(chave)) return;
      vistos.add(chave);
      todos.push(row);
    });

    if (onProgresso) onProgresso(todos.length);
  }

  return todos.slice(0, totalMax);
}

function filtrarBasePorTransportadoraSimulador(base = [], nomeTransportadora = '') {
  const nome = String(nomeTransportadora || '').trim();
  const lista = Array.isArray(base) ? base : [];
  if (!nome) return lista;

  return lista.filter((item) => (
    normalizarTransportadoraSimulador(item?.nome) === normalizarTransportadoraSimulador(nome) ||
    transportadoraCompativelSimulador(item?.nome, nome)
  ));
}

function extrairOrigensBaseSimulador(bases = [], canal = '') {
  const vistos = new Set();
  const saida = [];
  (bases || []).flat().filter(Boolean).forEach((base) => {
    (base.origens || [])
      .filter((origem) => !canal || (origem.canal || 'ATACADO') === canal)
      .forEach((origem) => {
        const cidade = String(origem.cidade || '').trim();
        const chave = normalizarChaveSimulador(cidade);
        if (!cidade || !chave || vistos.has(chave)) return;
        vistos.add(chave);
        saida.push(cidade);
      });
  });
  return saida.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function extrairUfsDestinoBaseSimulador(bases = [], canal = '', origemFiltro = '') {
  const ufs = new Set();
  const origemNorm = normalizarChaveSimulador(origemFiltro);
  let encontrouOrigem = false;

  (bases || []).flat().filter(Boolean).forEach((base) => {
    (base.origens || [])
      .filter((origem) => !canal || (origem.canal || 'ATACADO') === canal)
      .filter((origem) => {
        if (!origemNorm) return true;
        const ok = normalizarChaveSimulador(origem.cidade) === origemNorm;
        if (ok) encontrouOrigem = true;
        return ok;
      })
      .forEach((origem) => {
        if (!origemNorm) encontrouOrigem = true;
        (origem.rotas || []).forEach((rota) => {
          const uf = String(rota.ufDestino || getUfByIbge(rota.ibgeDestino) || '').trim().toUpperCase();
          if (uf) ufs.add(uf);
        });
      });
  });

  if (origemNorm && !encontrouOrigem) return [];
  return [...ufs].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

const GRADE_STORAGE_KEY = 'amd-grade-peso-v2';
const GRADE_PADRAO = {
  B2C: [
    { peso: 1, valorNF: 150, cubagem: 0 },
    { peso: 5, valorNF: 250, cubagem: 0 },
    { peso: 10, valorNF: 400, cubagem: 0 },
    { peso: 20, valorNF: 800, cubagem: 0 },
    { peso: 50, valorNF: 1800, cubagem: 0 },
    { peso: 100, valorNF: 3000, cubagem: 0 },
    { peso: 150, valorNF: 4500, cubagem: 0 },
  ],
  ATACADO: [
    { peso: 50, valorNF: 2000, cubagem: 0 },
    { peso: 100, valorNF: 3000, cubagem: 0 },
    { peso: 150, valorNF: 5000, cubagem: 0 },
    { peso: 250, valorNF: 8000, cubagem: 0 },
    { peso: 500, valorNF: 12000, cubagem: 0 },
  ],
};

function canaisDaTransportadora(nome, opcoesOnline, transportadoras) {
  const online = opcoesOnline.canaisPorTransportadora?.[nome];
  if (online?.length) return online;

  const local = transportadoras.find((item) => item.nome === nome);
  return [...new Set((local?.origens || []).map((origem) => origem.canal || 'ATACADO').filter(Boolean))].sort();
}

function filtrarTransportadorasPorCanal(nomes = [], canal, opcoesOnline, transportadoras) {
  if (!canal) return nomes;
  return (nomes || []).filter((nome) => canaisDaTransportadora(nome, opcoesOnline, transportadoras).includes(canal));
}

function normalizeBuscaIbge(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function limparCidadeDigitada(texto) {
  return String(texto || '').replace(/\s*·\s*\d+$/i, '').replace(/\s*\/\s*[A-Z]{2}$/i, '').trim();
}

function montarLabelMunicipio(item) {
  if (!item) return '';
  return `${item.cidade || 'IBGE'}${item.uf ? `/${item.uf}` : ''} · ${item.ibge}`;
}

const UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}
function downloadCsv(nomeArquivo, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', nomeArquivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
function formatNumberBR(value, digits = 0) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
function nomeArquivoSeguro(value, fallback = 'arquivo') {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || fallback;
}
function periodoLaudoRealizado(resultado = {}) {
  const inicio = resultado.filtros?.inicio || '';
  const fim = resultado.filtros?.fim || '';
  if (inicio || fim) return `${inicio || 'início'} a ${fim || 'fim'}`;
  return 'período selecionado';
}
function simOuNaoTexto(value) {
  return Number(value || 0) > 0;
}
function gerarLaudosEmailRealizado(resultado = {}) {
  if (!resultado?.ctesAnalisados) return null;
  const transportadora = resultado.filtros?.transportadora || 'transportadora selecionada';
  const periodo = periodoLaudoRealizado(resultado);
  const dataGeracao = new Date().toLocaleDateString('pt-BR');
  const rotasGanhas = (resultado.rotasGanhasDestaque || [])
    .filter((item) => Number(item.qtdGanhasSelecionada || 0) > 0)
    .slice(0, 8);
  const rotasPerdidas = (resultado.rotasPerdidasDestaque || resultado.rotas || [])
    .filter((item) => Number(item.diferencaParaVencedor || 0) > 0 || Number(item.qtdPerdidasSelecionada || 0) > 0)
    .sort((a, b) => Number(b.diferencaParaVencedor || 0) - Number(a.diferencaParaVencedor || 0) || Number(b.qtdPerdidasSelecionada || 0) - Number(a.qtdPerdidasSelecionada || 0))
    .slice(0, 8);
  const estados = (resultado.resumoPorEstado || resultado.estadosGanhadoresDestaque || []).slice(0, 8);
  const perdasTransportadoras = (resultado.transportadorasPerdaDestaque || resultado.impactoTransportadoras || [])
    .filter((item) => Number(item.freteCedidoSelecionada || 0) > 0)
    .slice(0, 8);
  const cubagemOutliers = Number(resultado.filtros?.trackingCubagemOutliers || 0);
  const coberturaMensal = Number(resultado.faturamentoSelecionadaMes || 0);
  const faturamentoGanhoMensal = Number(resultado.faturamentoSelecionadaGanhadoraMes || 0);
  const faturamentoNaoCapturadoMensal = Math.max(coberturaMensal - faturamentoGanhoMensal, 0);

  const linhasRotas = (lista, externo = false) => lista.map((item, index) => {
    const partes = [
      `${index + 1}. ${item.rota || 'Rota não identificada'}`,
      `${formatNumberBR(item.qtdGanhasSelecionada || item.ctes || 0)} CT-es`,
    ];
    if (!externo && Number(item.freteSelecionadaGanhadora || 0) > 0) partes.push(`faturamento ganho ${formatMoney(item.freteSelecionadaGanhadora)}`);
    if (Number(item.reducaoMediaNecessaria || 0) > 0) partes.push(`redução média necessária ${formatPercent(item.reducaoMediaNecessaria)}`);
    if (item.principalVencedor && item.principalVencedor !== '-') partes.push(`referência: ${item.principalVencedor}`);
    return partes.join(' · ');
  });

  const assuntoDiretoria = `Análise de competitividade - ${transportadora} - Simulação de frete realizado`;
  const diretoriaPartes = [
    'Prezados,',
    '',
    `Segue análise de competitividade da transportadora ${transportadora}, considerando a base de CT-es realizados no ${periodo} e a comparação da tabela simulada contra as demais tabelas disponíveis no sistema.`,
    '',
    `A transportadora participou da simulação em ${formatNumberBR(resultado.ctesComTabelaSelecionada)} CT-es de ${formatNumberBR(resultado.ctesAnalisados)} analisados, apresentando ganho em ${formatNumberBR(resultado.ctesGanhariaSelecionada)} CT-es (${formatPercent(resultado.aderenciaSelecionada)}) e perda em ${formatNumberBR(resultado.ctesPerdidosSelecionada)} CT-es para concorrentes mais competitivos.`,
    '',
    'Resumo executivo',
    `- A cobertura/carteira cotada pela tabela representa ${formatMoney(coberturaMensal)} por mês, mas o faturamento efetivamente ganho é ${formatMoney(faturamentoGanhoMensal)} por mês.`,
    `- O volume não capturado ou perdido para outras tabelas representa aproximadamente ${formatMoney(faturamentoNaoCapturadoMensal)} por mês dentro do recorte comparado.`,
    `- O saving potencial nas rotas/CT-es ganhos é ${formatMoney(resultado.savingSelecionadaVsRealMes)} por mês e ${formatMoney(resultado.savingSelecionadaVsRealAno)} em 12 meses.`,
    `- A redução média necessária nas rotas perdidas é de ${formatPercent(resultado.reducaoMediaNecessaria)}.`,
    '',
    'Potencial financeiro',
    `- Faturamento ganho pela tabela: ${formatMoney(resultado.freteSelecionadaGanhadora)} no período.`,
    `- Saving no período nas rotas ganhas: ${formatMoney(resultado.savingSelecionadaVsReal)}.`,
    `- Referência de mercado: a melhor tabela disponível geraria ${formatMoney(resultado.savingVencedorVsReal)} de saving potencial no mesmo recorte.`,
    perdasTransportadoras.length ? `- Faturamento que migra de transportadoras atuais: ${formatMoney(resultado.freteCapturadoRealizado || 0)} em ${formatNumberBR(resultado.ctesCapturadosDeOutras || 0)} CT-es.` : '',
    '',
    'Principais rotas ganhas',
    ...(rotasGanhas.length ? linhasRotas(rotasGanhas, false).map((linha) => `- ${linha}`) : ['- Não disponível para os filtros atuais.']),
    '',
    'Principais rotas perdidas',
    ...(rotasPerdidas.length ? linhasRotas(rotasPerdidas, false).map((linha) => `- ${linha}`) : ['- Não foram identificadas rotas perdidas com diferença relevante.']),
    '',
    'Oportunidades de negociação',
    estados.length ? `- Estados com maior relevância na análise: ${estados.slice(0, 5).map((item) => `${item.uf} (${formatNumberBR(item.ctesGanhas || 0)} ganhos, aderência ${formatPercent(item.aderencia || 0)})`).join('; ')}.` : '',
    perdasTransportadoras.length ? `- Transportadoras com maior exposição de perda: ${perdasTransportadoras.slice(0, 4).map((item) => `${item.transportadora} (${formatMoney(item.freteCedidoSelecionada || 0)})`).join('; ')}.` : '',
    simOuNaoTexto(cubagemOutliers) ? `- Observação técnica: ${formatNumberBR(cubagemOutliers)} CT-e(s) apresentaram cubagem fora do padrão e foram tratados para evitar distorção, utilizando o peso real na análise.` : '',
    '',
    'Recomendação final',
    'Diante dos resultados, a recomendação é seguir com negociação direcionada nas rotas de maior perda, priorizando aquelas com maior volume e maior diferença percentual. Caso a transportadora ajuste os pontos críticos identificados, há potencial de aumento de competitividade e captura de saving no período analisado.',
  ].filter((linha) => linha !== '');

  const assuntoTransportadora = `Devolutiva de competitividade - ${transportadora} - Oportunidades de ajuste`;
  const transportadoraPartes = [
    'Prezados,',
    '',
    `Realizamos uma análise de competitividade da tabela da ${transportadora} considerando as rotas e CT-es movimentados no ${periodo}. O objetivo é compartilhar uma visão prática dos pontos em que a tabela apresenta boa aderência e também das oportunidades de ajuste para ampliar a competitividade da operação.`,
    '',
    'Visão geral da participação na simulação',
    `- Foram analisados ${formatNumberBR(resultado.ctesAnalisados)} CT-es, dos quais ${formatNumberBR(resultado.ctesComTabelaSelecionada)} possuíam cobertura da tabela simulada.`,
    `- A tabela ficou competitiva em ${formatNumberBR(resultado.ctesGanhariaSelecionada)} CT-es, com aderência de ${formatPercent(resultado.aderenciaSelecionada)} no recorte comparado.`,
    `- Foram identificados ${formatNumberBR(resultado.ctesPerdidosSelecionada)} CT-es com oportunidade de melhoria frente às referências mais competitivas da base analisada.`,
    '',
    'Rotas com boa competitividade',
    ...(rotasGanhas.length ? linhasRotas(rotasGanhas, true).map((linha) => `- ${linha}`) : ['- Não disponível para os filtros atuais.']),
    '',
    'Rotas com perda de competitividade',
    ...(rotasPerdidas.length ? linhasRotas(rotasPerdidas, true).map((linha) => `- ${linha}`) : ['- Não foram identificadas rotas críticas com os filtros atuais.']),
    '',
    'Pontos prioritários de revisão',
    `- Nas rotas em que a tabela não ficou em primeiro lugar, foi identificada uma necessidade média de redução de aproximadamente ${formatPercent(resultado.reducaoMediaNecessaria)} para que a transportadora se aproxime dos valores mais competitivos do mercado analisado.`,
    '- Recomendamos priorizar a revisão das rotas com maior volume de CT-es e maior diferença percentual.',
    simOuNaoTexto(cubagemOutliers) ? '- Alguns registros apresentaram inconsistência de cubagem e foram tratados para evitar distorções na análise.' : '',
    '',
    'Direcional comercial',
    'O ajuste direcionado das rotas críticas pode aumentar a competitividade da tabela e ampliar a participação da transportadora nas próximas movimentações.',
    '',
    'Próximos passos sugeridos',
    'Ficamos à disposição para avaliar uma contraproposta direcionada, principalmente nas rotas destacadas como críticas. O ajuste nesses pontos pode aumentar a competitividade da transportadora e ampliar sua participação nas próximas movimentações.',
  ].filter((linha) => linha !== '');

  return {
    diretoria: {
      tipo: 'diretoria',
      titulo: 'Laudo para Diretoria',
      assunto: assuntoDiretoria,
      corpo: diretoriaPartes.join('\n'),
      completo: `Assunto: ${assuntoDiretoria}\n\n${diretoriaPartes.join('\n')}`,
      rotasGanhas,
      rotasPerdidas,
      estados,
      perdasTransportadoras,
      kpis: [
        ['Aderência', formatPercent(resultado.aderenciaSelecionada)],
        ['Faturamento ganho/mês', formatMoney(faturamentoGanhoMensal)],
        ['Cobertura cotada/mês', formatMoney(coberturaMensal)],
        ['Saving/mês', formatMoney(resultado.savingSelecionadaVsRealMes)],
        ['Rotas com ganho', formatNumberBR(resultado.qtdRotasComGanhoSelecionada || 0)],
        ['Redução média', formatPercent(resultado.reducaoMediaNecessaria)],
      ],
      observacaoCubagem: simOuNaoTexto(cubagemOutliers) ? `${formatNumberBR(cubagemOutliers)} CT-e(s) com cubagem fora do padrão foram tratados para evitar distorção.` : '',
    },
    transportadora: {
      tipo: 'transportadora',
      titulo: 'Laudo Devolutivo para Transportadora',
      assunto: assuntoTransportadora,
      corpo: transportadoraPartes.join('\n'),
      completo: `Assunto: ${assuntoTransportadora}\n\n${transportadoraPartes.join('\n')}`,
      rotasGanhas,
      rotasPerdidas,
      estados,
      perdasTransportadoras: [],
      kpis: [
        ['Aderência', formatPercent(resultado.aderenciaSelecionada)],
        ['CT-es comparados', formatNumberBR(resultado.ctesComTabelaSelecionada)],
        ['CT-es competitivos', formatNumberBR(resultado.ctesGanhariaSelecionada)],
        ['CT-es a revisar', formatNumberBR(resultado.ctesPerdidosSelecionada)],
        ['Rotas com boa competitividade', formatNumberBR(resultado.qtdRotasComGanhoSelecionada || 0)],
        ['Redução média sugerida', formatPercent(resultado.reducaoMediaNecessaria)],
      ],
      observacaoCubagem: simOuNaoTexto(cubagemOutliers) ? 'Alguns registros apresentaram inconsistência de cubagem e foram tratados para evitar distorções na análise.' : '',
    },
    meta: { transportadora, periodo, dataGeracao },
  };
}
function buildDestinoLabel(item) {
  if (item.cidadeDestino) return `${item.cidadeDestino}${item.ufDestino ? `/${item.ufDestino}` : ''}`;
  return `IBGE ${item.ibgeDestino}`;
}
function getGradeInicial() {
  return carregarGradeFrete();
}
function getRankingBadge(ranking) {
  if (ranking === 1) return '🏆 1º lugar';
  if (ranking === 2) return '🥈 2º lugar';
  if (ranking === 3) return '🥉 3º lugar';
  return `#${ranking || '-'} lugar`;
}

function ResultadoCard({ item }) {
  const [aberto, setAberto] = useState(false);
  const destaque = item.ranking === 1
    ? { borderColor: '#92d6a5', boxShadow: '0 0 0 1px rgba(74, 222, 128, 0.20) inset' }
    : {};

  return (
    <div className="sim-resultado-card" style={destaque}>
      <div className="sim-resultado-topo compact-top">
        <div>
          <strong>{item.transportadora}</strong>
          <div className="sim-resultado-linha">Origem {item.origem} • Destino {buildDestinoLabel(item)}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{getRankingBadge(item.ranking)} • {item.prazo} dia(s)</span>
          <button className="sim-tab" type="button" onClick={() => setAberto((v) => !v)}>
            {aberto ? 'Fechar detalhes' : 'Ver detalhes'}
          </button>
        </div>
      </div>

      <div className="sim-resultado-grade">
        <div>
          <span>Frete final</span>
          <strong>{formatMoney(item.total)}</strong>
        </div>
        <div>
          <span>% sobre NF</span>
          <strong>{formatPercent(item.percentualSobreNF)}</strong>
        </div>
        <div>
          <span>{item.ranking === 1 ? 'Próxima se bloquear' : 'Perdeu para'}</span>
          <strong>{item.ranking === 1 ? (item.proximaSeBloquear || 'Sem substituta') : (item.perdeuPara || '-')}</strong>
        </div>
        <div>
          <span>Redução p/ líder</span>
          <strong>{formatPercent(item.reducaoNecessariaPct)}</strong>
        </div>
      </div>

      {aberto && (
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Formação do frete e prazo</strong>
                <p>Como o valor base foi encontrado.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              <div>Tipo de cálculo: <strong>{item.detalhes?.frete?.tipoCalculo}</strong></div>
              <div>Prazo: <strong>{item.detalhes?.prazo} dia(s)</strong></div>
              <div>Faixa aplicada: <strong>{item.detalhes?.frete?.faixaPeso}</strong></div>
              <div>Peso informado: <strong>{item.detalhes?.frete?.pesoInformado} kg</strong></div>
              <div>Peso da grade: <strong>{item.detalhes?.frete?.pesoGrade} kg</strong></div>
              <div>Cubagem da grade: <strong>{Number(item.detalhes?.frete?.cubagemGrade || 0).toFixed(6)} m³</strong></div>
              <div>Cubagem usada no cálculo: <strong>{Number(item.detalhes?.frete?.cubagemAplicada || 0).toFixed(6)} m³</strong></div>
              <div>Regra da cubagem: <strong>{item.detalhes?.frete?.origemCubagem === 'grade' ? 'somente grade' : 'sem cubagem na grade'}</strong></div>
              <div>Fator cubagem: <strong>{item.detalhes?.frete?.fatorCubagem} kg/m³</strong></div>
              <div>Peso cubado: <strong>{Number(item.detalhes?.frete?.pesoCubado || 0).toFixed(2)} kg</strong></div>
              <div>Peso considerado: <strong>{Number(item.detalhes?.frete?.pesoConsiderado || 0).toFixed(2)} kg</strong></div>
              <div>R$/kg: <strong>{Number(item.detalhes?.frete?.rsKgAplicado || 0).toFixed(4)}</strong></div>
              <div>% aplicado: <strong>{formatPercent(item.detalhes?.frete?.percentualAplicado)}</strong></div>
              <div>Valor fixo/faixa: <strong>{formatMoney(item.detalhes?.frete?.valorFixoAplicado)}</strong></div>
              <div>Valor NF utilizado: <strong>{formatMoney(item.detalhes?.frete?.valorNFInformado)}</strong> <span style={{ color: '#64748b' }}>({item.detalhes?.frete?.valorNFOrigem === 'manual' ? 'informado' : 'grade padrão'})</span></div>
              <div>Limite para excedente: <strong>{Number(item.detalhes?.frete?.pesoLimiteExcedente || 0).toFixed(0)} kg</strong></div>
              <div>Peso excedente: <strong>{Number(item.detalhes?.frete?.pesoExcedente || 0).toFixed(2)} kg</strong></div>
              <div>Valor do excedente: <strong>{formatMoney(item.detalhes?.frete?.valorExcedente)}</strong></div>
              <div>Mínimo da rota: <strong>{formatMoney(item.detalhes?.frete?.minimoRota)}</strong></div>
              <div>Valor base: <strong>{formatMoney(item.detalhes?.frete?.valorBase)}</strong></div>
              <div>Subtotal antes do ICMS: <strong>{formatMoney(item.detalhes?.frete?.subtotal)}</strong></div>
              <div>ICMS ({formatPercent(item.detalhes?.frete?.aliquotaIcms)}): <strong>{formatMoney(item.detalhes?.frete?.icms)}</strong> <span style={{ color: '#64748b' }}>({item.detalhes?.frete?.origemAliquotaIcms})</span></div>
            </div>
          </div>

          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Taxas adicionais vinculadas</strong>
                <p>Taxas gerais e específicas do destino.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              <div>Ad Valorem: <strong>{formatMoney(item.detalhes?.taxas?.adValorem)}</strong> ({formatPercent(item.detalhes?.taxas?.adValPct)} • mín. {formatMoney(item.detalhes?.taxas?.adValMin)})</div>
              <div>GRIS: <strong>{formatMoney(item.detalhes?.taxas?.gris)}</strong> ({formatPercent(item.detalhes?.taxas?.grisPct)} • mín. {formatMoney(item.detalhes?.taxas?.grisMin)})</div>
              <div>Pedágio: <strong>{formatMoney(item.detalhes?.taxas?.pedagio)}</strong></div>
              <div>TAS: <strong>{formatMoney(item.detalhes?.taxas?.tas)}</strong></div>
              <div>CTRC: <strong>{formatMoney(item.detalhes?.taxas?.ctrc)}</strong></div>
              <div>TDA/STDA: <strong>{formatMoney(item.detalhes?.taxas?.tda)}</strong></div>
              <div>TDE: <strong>{formatMoney(item.detalhes?.taxas?.tde)}</strong></div>
              <div>TDR: <strong>{formatMoney(item.detalhes?.taxas?.tdr)}</strong></div>
              <div>TRT: <strong>{formatMoney(item.detalhes?.taxas?.trt)}</strong></div>
              <div>Suframa: <strong>{formatMoney(item.detalhes?.taxas?.suframa)}</strong></div>
              <div>Outras: <strong>{formatMoney(item.detalhes?.taxas?.outras)}</strong></div>
              <div>Total de taxas: <strong>{formatMoney(item.detalhes?.taxas?.totalTaxas)}</strong></div>
              <div>Frete substituta: <strong>{item.freteSubstituta ? formatMoney(item.freteSubstituta) : '-'}</strong></div>
              <div>Frete final: <strong>{formatMoney(item.detalhes?.frete?.total)}</strong></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GraficoUf({ itens }) {
  if (!itens?.length) return null;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {itens.slice(0, 8).map((item) => {
        const largura = `${Math.max(Math.min(Number(item.aderencia || 0), 100), 0)}%`;
        return (
          <div key={item.uf}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <strong>{item.uf}</strong>
              <span>{item.aderencia !== undefined ? `${item.total} rotas • ${formatPercent(item.aderencia)}` : `${item.faltantes} faltantes`}</span>
            </div>
            <div style={{ background: '#e7eefb', borderRadius: 999, height: 10, overflow: 'hidden' }}>
              <div style={{ width: largura, height: '100%', background: '#071b49' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}


function numeroRealizado(value) {
  const numero = Number(value || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function pesoRealizado(row = {}) {
  const declarado = numeroRealizado(row.pesoDeclarado);
  return declarado > 0 ? declarado : numeroRealizado(row.peso);
}

function cubagemRealizado(row = {}) {
  // Regra do realizado:
  // cubagem só é confiável quando veio do Tracking.
  // O CT-e pode trazer cubagem divergente, então não usamos cubagem do CT-e como fallback.
  if (!row.trackingMatch) return 0;

  const total = numeroRealizado(row.cubagemTotal || row.cubagem_total);
  if (total > 0) return total;

  const unitaria = numeroRealizado(row.cubagemUnitaria || row.cubagem_unitaria);
  const volumes = numeroRealizado(row.qtdVolumes || row.volumes || row.volume);

  if (unitaria > 0 && volumes > 0) return unitaria * volumes;
  return 0;
}


function normalizarChaveTracking(value = '') {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function apenasDigitosTracking(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function normalizarChaveLongaTracking(value = '') {
  // Para CT-e/NF-e, a comparação precisa ser pela chave limpa, apenas dígitos.
  // Isso evita perder vínculo quando uma base traz máscara/espaços e a outra não.
  return apenasDigitosTracking(value);
}

function chunksTracking(lista = [], tamanho = 300) {
  const saida = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}

function numeroTracking(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function validarCubagemTracking({ cubagemTotal = 0, qtdVolumes = 0, peso = 0 }) {
  const cubagem = numeroTracking(cubagemTotal);
  const volumes = numeroTracking(qtdVolumes);
  const pesoRef = numeroTracking(peso);

  if (cubagem <= 0) {
    return { cubagemTotal: 0, cubagemOriginal: 0, outlier: false, limiteCubagem: 0 };
  }

  // Proteção contra cubagem claramente fora de escala no Tracking.
  // Ex.: 2.500 kg com 398 m³ faz o frete explodir e não representa a operação.
  // Quando estourar o limite, desconsideramos a cubagem e calculamos pelo peso real.
  const limitePorPeso = pesoRef > 0 ? Math.max(8, (pesoRef / 250) * 4) : 0;
  const limitePorVolume = volumes > 0 ? Math.max(5, volumes * 0.35) : 0;
  const limiteCubagem = Math.max(30, limitePorPeso, limitePorVolume);
  const outlier = cubagem > 20 && limiteCubagem > 0 && cubagem > limiteCubagem;

  return {
    cubagemTotal: outlier ? 0 : cubagem,
    cubagemOriginal: cubagem,
    outlier,
    limiteCubagem,
  };
}

function criarTrackingAgregado(item = {}, origem = 'raw') {
  const qtdVolumes = numeroTracking(item.qtd_volumes ?? item.volumes ?? item.volume ?? 0);
  const cubagemUnitaria = numeroTracking(item.cubagem_unitaria ?? 0);
  const cubagemTotalDireta = numeroTracking(item.cubagem_total ?? item.cubagem ?? 0);
  const cubagemTotal = cubagemTotalDireta > 0
    ? cubagemTotalDireta
    : cubagemUnitaria > 0 && qtdVolumes > 0
      ? cubagemUnitaria * qtdVolumes
      : 0;

  return {
    ...item,
    origem_vinculo_tracking: origem,
    linhas_tracking: Number(item.linhas_tracking || 1),
    qtd_volumes: qtdVolumes,
    cubagem_unitaria: cubagemUnitaria,
    cubagem_total: cubagemTotal,
    peso: numeroTracking(item.peso ?? item.peso_tracking ?? 0),
    peso_declarado: numeroTracking(item.peso_declarado ?? 0),
    peso_cubado: numeroTracking(item.peso_cubado ?? 0),
    valor_nf: numeroTracking(item.valor_nf ?? 0),
  };
}

function somarTrackingAgregado(atual, proximo) {
  if (!atual) return criarTrackingAgregado(proximo);
  const item = criarTrackingAgregado(proximo);
  return {
    ...atual,
    ...Object.fromEntries(
      Object.entries(atual).filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    ),
    linhas_tracking: numeroTracking(atual.linhas_tracking) + numeroTracking(item.linhas_tracking || 1),
    qtd_volumes: numeroTracking(atual.qtd_volumes) + numeroTracking(item.qtd_volumes),
    cubagem_unitaria: numeroTracking(atual.cubagem_unitaria) || numeroTracking(item.cubagem_unitaria),
    cubagem_total: numeroTracking(atual.cubagem_total) + numeroTracking(item.cubagem_total),
    peso: numeroTracking(atual.peso) + numeroTracking(item.peso),
    peso_declarado: numeroTracking(atual.peso_declarado) || numeroTracking(item.peso_declarado),
    peso_cubado: numeroTracking(atual.peso_cubado) || numeroTracking(item.peso_cubado),
    valor_nf: numeroTracking(atual.valor_nf) || numeroTracking(item.valor_nf),
    origem_vinculo_tracking: atual.origem_vinculo_tracking || item.origem_vinculo_tracking || 'raw',
  };
}

function adicionarTrackingNoMapa(mapa, chave, item) {
  if (!chave) return;
  const atual = mapa.get(chave);
  mapa.set(chave, somarTrackingAgregado(atual, item));
}

async function buscarTrackingParaRealizado(rows = []) {
  const vazio = { mapaChaveCte: new Map(), mapaChaveNfe: new Map(), mapaNota: new Map(), mapaNumeroCte: new Map(), total: 0, erro: '' };
  if (!isSupabaseConfigured() || !rows?.length) return vazio;

  const chavesCte = [...new Set(rows.map((r) => normalizarChaveLongaTracking(r.chaveCte)).filter((v) => v.length >= 20))];
  const chavesNfe = [...new Set(rows.map((r) => normalizarChaveLongaTracking(r.chaveNfe)).filter((v) => v.length >= 20))];
  const notas = [...new Set(rows.map((r) => apenasDigitosTracking(r.notaFiscal)).filter(Boolean))];

  // Número de CT-e fica como último recurso. Não deve ser usado quando a linha possui chave.
  const numerosCteFallback = [...new Set(
    rows
      .filter((r) => !normalizarChaveLongaTracking(r.chaveCte) && !normalizarChaveLongaTracking(r.chaveNfe) && !apenasDigitosTracking(r.notaFiscal))
      .map((r) => apenasDigitosTracking(r.numeroCte))
      .filter(Boolean)
  )];

  if (!chavesCte.length && !chavesNfe.length && !notas.length && !numerosCteFallback.length) return vazio;

  const supabase = getSupabaseClient();
  const mapaChaveCte = new Map();
  const mapaChaveNfe = new Map();
  const mapaNota = new Map();
  const mapaNumeroCte = new Map();
  let totalEncontrado = 0;
  let erroView = '';

  async function consultarViewAgregadaPorChaveCte() {
    if (!chavesCte.length) return false;
    let consultou = false;
    for (const parte of chunksTracking(chavesCte, 300)) {
      if (!parte.length) continue;
      const { data, error } = await supabase
        .from('vw_tracking_cte_agregado')
        .select('chave_cte_limpa,chave_cte,chave_nfe,cte_numero,nota_fiscal,canal,transportadora,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,peso,peso_declarado,peso_cubado,cubagem_unitaria,cubagem_total,valor_nf,qtd_volumes,linhas_tracking,data_transporte,data_entrega,previsao_transportadora')
        .in('chave_cte_limpa', parte);

      if (error) {
        erroView = error.message || String(error);
        return false;
      }

      consultou = true;
      (data || []).forEach((item) => {
        const chave = normalizarChaveLongaTracking(item.chave_cte_limpa || item.chave_cte);
        adicionarTrackingNoMapa(mapaChaveCte, chave, criarTrackingAgregado(item, 'VIEW_CHAVE_CTE'));
        totalEncontrado += Number(item.linhas_tracking || 1);
      });
    }
    return consultou;
  }

  async function consultarRawPorColuna(coluna, valores, tipo) {
    for (const parte of chunksTracking(valores, 300)) {
      if (!parte.length) continue;
      const { data, error } = await supabase
        .from('tracking_rows')
        .select('chave_nfe,chave_cte,cte_numero,nota_fiscal,canal,transportadora,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,peso,peso_declarado,peso_cubado,cubagem_unitaria,cubagem_total,valor_nf,qtd_volumes,data_transporte,data_entrega,previsao_transportadora')
        .in(coluna, parte);
      if (error) throw error;

      (data || []).forEach((item) => {
        totalEncontrado += 1;
        if (tipo === 'CHAVE_CTE') adicionarTrackingNoMapa(mapaChaveCte, normalizarChaveLongaTracking(item.chave_cte), criarTrackingAgregado(item, 'RAW_CHAVE_CTE'));
        if (tipo === 'CHAVE_NFE') adicionarTrackingNoMapa(mapaChaveNfe, normalizarChaveLongaTracking(item.chave_nfe), criarTrackingAgregado(item, 'RAW_CHAVE_NFE'));
        if (tipo === 'NOTA') adicionarTrackingNoMapa(mapaNota, apenasDigitosTracking(item.nota_fiscal), criarTrackingAgregado(item, 'RAW_NOTA_FISCAL'));
        if (tipo === 'NUMERO_CTE') adicionarTrackingNoMapa(mapaNumeroCte, apenasDigitosTracking(item.cte_numero), criarTrackingAgregado(item, 'RAW_NUMERO_CTE'));
      });
    }
  }

  try {
    const viewOk = await consultarViewAgregadaPorChaveCte();

    // Fallback: mantém compatibilidade se a view ainda não existir ou se alguma chave vier exatamente igual na tabela raw.
    // Mesmo quando a view existe, as demais buscas complementam NF/nota em casos sem chave CT-e.
    if (!viewOk && chavesCte.length) {
      await consultarRawPorColuna('chave_cte', chavesCte, 'CHAVE_CTE');
    }

    if (chavesNfe.length) await consultarRawPorColuna('chave_nfe', chavesNfe, 'CHAVE_NFE');
    if (notas.length) await consultarRawPorColuna('nota_fiscal', notas, 'NOTA');
    if (numerosCteFallback.length) await consultarRawPorColuna('cte_numero', numerosCteFallback, 'NUMERO_CTE');
  } catch (error) {
    console.warn('Tracking no Supabase indisponível para enriquecer realizado.', error?.message || error);
    return { ...vazio, erro: error?.message || String(error || '') };
  }

  return {
    mapaChaveCte,
    mapaChaveNfe,
    mapaNota,
    mapaNumeroCte,
    total: totalEncontrado,
    erro: '',
    aviso: erroView ? `View agregada indisponível, usado fallback raw: ${erroView}` : '',
  };
}

function obterTrackingDaLinha(row = {}, mapas) {
  if (!mapas) return null;
  const chaveCte = normalizarChaveLongaTracking(row.chaveCte);
  const chaveNfe = normalizarChaveLongaTracking(row.chaveNfe);
  const nota = apenasDigitosTracking(row.notaFiscal);
  const numeroCte = apenasDigitosTracking(row.numeroCte);

  const porChaveCte = chaveCte ? mapas.mapaChaveCte?.get(chaveCte) : null;
  if (porChaveCte) return porChaveCte;

  const porChaveNfe = chaveNfe ? mapas.mapaChaveNfe?.get(chaveNfe) : null;
  if (porChaveNfe) return porChaveNfe;

  const porNota = nota ? mapas.mapaNota?.get(nota) : null;
  if (porNota) return porNota;

  // Número CT-e é fallback de segurança somente quando não há chaves/NF na linha do realizado.
  // Isso evita falso vínculo quando o número aparece dentro de outra chave CT-e.
  if (!chaveCte && !chaveNfe && !nota && numeroCte) {
    return mapas.mapaNumeroCte?.get(numeroCte) || null;
  }

  return null;
}

function enriquecerRealizadoComTracking(rows = [], mapasTracking) {
  let vinculados = 0;
  let semTracking = 0;
  let volumesTracking = 0;
  let cubagemTracking = 0;
  let cubagemOutliers = 0;

  const linhas = (rows || []).map((row) => {
    const tracking = obterTrackingDaLinha(row, mapasTracking);

    // Regra do realizado:
    // cubagem e volumes devem vir obrigatoriamente do Tracking.
    // Se não houver vínculo, zera esses campos para não contaminar cálculo e capacidade.
    if (!tracking) {
      semTracking += 1;
      return {
        ...row,
        trackingMatch: false,
        trackingPendente: true,
        qtdVolumes: 0,
        cubagemUnitaria: 0,
        cubagemTotal: 0,
        pesoCubado: 0,
      };
    }

    vinculados += 1;

    const qtdVolumesTracking = numeroRealizado(tracking.qtd_volumes);
    const cubagemUnitariaTracking = numeroRealizado(tracking.cubagem_unitaria);
    const cubagemTotalDiretaTracking = numeroRealizado(tracking.cubagem_total);
    const cubagemTotalTracking = cubagemTotalDiretaTracking > 0
      ? cubagemTotalDiretaTracking
      : cubagemUnitariaTracking > 0 && qtdVolumesTracking > 0
        ? cubagemUnitariaTracking * qtdVolumesTracking
        : 0;

    const pesoRefTracking = numeroRealizado(tracking.peso) || numeroRealizado(tracking.peso_declarado) || numeroRealizado(row.pesoDeclarado);
    const cubagemValidada = validarCubagemTracking({
      cubagemTotal: cubagemTotalTracking,
      qtdVolumes: qtdVolumesTracking,
      peso: pesoRefTracking,
    });
    const pesoCubadoTracking = cubagemValidada.outlier ? 0 : numeroRealizado(tracking.peso_cubado);

    if (cubagemValidada.outlier) cubagemOutliers += 1;
    if (qtdVolumesTracking > 0) volumesTracking += qtdVolumesTracking;
    if (cubagemValidada.cubagemTotal > 0) cubagemTracking += cubagemValidada.cubagemTotal;

    return {
      ...row,
      trackingMatch: true,
      trackingPendente: false,
      trackingTransportadora: tracking.transportadora || '',
      trackingLinhas: Number(tracking.linhas_tracking || 1),
      trackingOrigemVinculo: tracking.origem_vinculo_tracking || '',

      chaveCte: row.chaveCte || tracking.chave_cte || '',
      chaveNfe: row.chaveNfe || tracking.chave_nfe || '',
      notaFiscal: row.notaFiscal || tracking.nota_fiscal || '',
      numeroCte: row.numeroCte || tracking.cte_numero || '',

      // Campos de capacidade e cubagem: sempre do Tracking.
      // Se a cubagem do Tracking vier fora de escala, ela é zerada para o cálculo usar peso real.
      qtdVolumes: qtdVolumesTracking,
      cubagemUnitaria: cubagemUnitariaTracking,
      cubagemTotal: cubagemValidada.cubagemTotal,
      cubagemTotalOriginalTracking: cubagemValidada.cubagemOriginal,
      cubagemOutlierTracking: cubagemValidada.outlier,
      limiteCubagemTracking: cubagemValidada.limiteCubagem,
      pesoCubado: pesoCubadoTracking,

      // Peso pode ser complementado pelo Tracking, mas mantém CT-e se o Tracking não trouxer peso.
      pesoDeclarado: numeroRealizado(tracking.peso_declarado) || numeroRealizado(tracking.peso) || row.pesoDeclarado,

      // Valor NF continua priorizando o CT-e por enquanto para não misturar regras nesta entrega.
      valorNF: numeroRealizado(row.valorNF) || numeroRealizado(tracking.valor_nf),

      canal: row.canal || tracking.canal || '',
      ibgeOrigem: row.ibgeOrigem || String(tracking.ibge_origem || '').replace(/\D/g, '').slice(0, 7),
      ibgeDestino: row.ibgeDestino || String(tracking.ibge_destino || '').replace(/\D/g, '').slice(0, 7),
      cidadeOrigem: row.cidadeOrigem || tracking.cidade_origem || '',
      ufOrigem: row.ufOrigem || String(tracking.uf_origem || '').toUpperCase(),
      cidadeDestino: row.cidadeDestino || tracking.cidade_destino || '',
      ufDestino: row.ufDestino || String(tracking.uf_destino || '').toUpperCase(),
    };
  });

  return {
    linhas,
    vinculados,
    semTracking,
    volumesTracking,
    cubagemTracking,
    cubagemOutliers,
    erroTracking: mapasTracking?.erro || '',
    avisoTracking: mapasTracking?.aviso || '',
  };
}


function normalizarTransportadoraSimulador(nome = '') {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isCpsLogSimulador(nome = '') {
  const texto = normalizarTransportadoraSimulador(nome);
  return texto.includes('CPS LOG') || texto.includes('CPSLOG');
}

function isEbazarSimulador(nome = '') {
  return normalizarTransportadoraSimulador(nome).includes('EBAZAR');
}

function isTomadorPermitidoRealizadoSim(row = {}) {
  const tomador = normalizarTransportadoraSimulador(row.tomador || row.tomadorServico || row.tomador_servico || row.nomeTomador || '');
  if (!tomador) return true;
  return TOMADORES_REALIZADO_PADRAO_SIM.some((permitido) => tomador.includes(normalizarTransportadoraSimulador(permitido)));
}

function registroTemCpsLogSimulador(row = {}) {
  const campos = [
    row.transportadora,
    row.transportadoraReal,
    row.transportadora_real,
    row.nomeTransportadora,
    row.nome_transportadora,
    row.transportador,
    row.tomador,
    row.tomadorServico,
    row.tomador_servico,
    row.nomeTomador,
    row.nome_tomador,
    row.raw?.transportadora,
    row.raw?.nome_transportadora,
    row.raw?.tomador,
    row.raw?.tomador_servico,
  ];

  return campos.some((campo) => isCpsLogSimulador(campo));
}

function filtrarCpsLogRealizadoSim(rows = [], incluirCpsLog = false) {
  const lista = Array.isArray(rows) ? rows : [];
  if (incluirCpsLog) return lista;
  return lista.filter((row) => !registroTemCpsLogSimulador(row));
}

function aplicarFiltrosPadraoRealizadoSim(rows = [], { incluirCpsLog = false } = {}) {
  return filtrarCpsLogRealizadoSim(
    (rows || []).filter((row) => {
      const transportadora = row.transportadora || '';
      const tomador = row.tomador || '';
      if (!isTomadorPermitidoRealizadoSim(row)) return false;
      if (isEbazarSimulador(transportadora) || isEbazarSimulador(tomador)) return false;
      return true;
    }),
    incluirCpsLog
  );
}

function transportadoraCompativelSimulador(nomeTabela = '', nomeFiltro = '') {
  const tabela = normalizarTransportadoraSimulador(nomeTabela);
  const filtro = normalizarTransportadoraSimulador(nomeFiltro);
  if (!tabela || !filtro) return false;
  if (tabela === filtro) return true;
  // Nomes vindos do CT-e e da tabela raramente são idênticos.
  // Ex.: CPS LOG x CPS LOG TRANSPORTES LTDA.
  // Para o simulador do realizado, aceita correspondência parcial segura.
  return (tabela.length >= 5 && filtro.includes(tabela)) || (filtro.length >= 5 && tabela.includes(filtro));
}

function criarMetricaRealizadoTransportadora(nome) {
  return {
    transportadora: nome || 'Sem transportadora',
    ctesConcorreu: 0,
    ctesGanharia: 0,
    ctesCarregou: 0,
    ctesCarregadosComTabela: 0,
    ctesCarregouGanhando: 0,
    ctesCarregouPerdendo: 0,
    freteRealizado: 0,
    freteTabelaPropria: 0,
    freteMelhorParaCargasCarregadas: 0,
    valorNF: 0,
    peso: 0,
    volumes: 0,
    exemplosCarregadas: [],
    exemplosGanharia: [],
  };
}

function obterMetricaRealizado(mapa, nome) {
  const nomeLimpo = String(nome || 'Sem transportadora').trim() || 'Sem transportadora';
  const chave = normalizarTransportadoraSimulador(nomeLimpo);
  if (!mapa.has(chave)) mapa.set(chave, criarMetricaRealizadoTransportadora(nomeLimpo));
  return mapa.get(chave);
}

function montarExemploSimulacaoOrigem({ row, transportadoraReal, valorCte, vencedor, resultado, itemTabela, tipo = 'carregada' }) {
  const freteMelhor = numeroRealizado(vencedor?.total);
  const freteTabela = numeroRealizado(itemTabela?.total);
  const economiaMelhor = valorCte - freteMelhor;
  return {
    tipo,
    cte: row.numeroCte || row.chaveCte || '',
    data: row.dataEmissao || '',
    origem: row.cidadeOrigem || '',
    ufOrigem: row.ufOrigem || '',
    destino: row.cidadeDestino || vencedor?.cidadeDestino || '',
    ufDestino: row.ufDestino || vencedor?.ufDestino || '',
    transportadoraReal,
    freteRealizado: valorCte,
    vencedor: vencedor?.transportadora || '',
    freteMelhor,
    transportadoraTabela: itemTabela?.transportadora || '',
    freteTabela,
    diferencaPotencial: economiaMelhor,
    savingPositivo: Math.max(economiaMelhor, 0),
    rankingTabela: itemTabela?.ranking || '',
    concorrentes: resultado.length,
    topConcorrentes: resultado.slice(0, 3).map((concorrente) => ({
      transportadora: concorrente.transportadora,
      frete: numeroRealizado(concorrente.total),
      ranking: concorrente.ranking,
    })),
  };
}

function resumirRealizadoPorOrigem(rows = [], baseOnline = [], filtros = {}, cidadePorIbge, gradeCanal = []) {
  const porTransportadoraMap = new Map();
  const simulacaoTransportadoraMap = new Map();
  const porDestinoMap = new Map();
  const simulacoes = [];
  let freteRealizado = 0;
  let freteRealizadoComTabela = 0;
  let freteGanhadorTotal = 0;
  let valorNF = 0;
  let peso = 0;
  let volumes = 0;
  let semTabela = 0;
  let savingPotencial = 0;
  let diferencaPotencialTotal = 0;
  let ganhoRealizado = 0;
  let ctesSimulados = 0;

  (rows || []).forEach((row) => {
    const transportadora = String(row.transportadora || 'Sem transportadora').trim() || 'Sem transportadora';
    const transportadoraKey = normalizarTransportadoraSimulador(transportadora);
    const valorCte = numeroRealizado(row.valorCte);
    const nf = numeroRealizado(row.valorNF);
    const pesoLinha = pesoRealizado(row);
    const cubagemLinha = cubagemRealizado(row);
    const vol = numeroRealizado(row.qtdVolumes);
    const destino = String(row.ibgeDestino || '').trim();
    freteRealizado += valorCte;
    valorNF += nf;
    peso += pesoLinha;
    volumes += vol;

    const t = porTransportadoraMap.get(transportadora) || { transportadora, ctes: 0, frete: 0, valorNF: 0, peso: 0, volumes: 0 };
    t.ctes += 1;
    t.frete += valorCte;
    t.valorNF += nf;
    t.peso += pesoLinha;
    t.volumes += vol;
    porTransportadoraMap.set(transportadora, t);

    const metricaReal = obterMetricaRealizado(simulacaoTransportadoraMap, transportadora);
    metricaReal.ctesCarregou += 1;
    metricaReal.freteRealizado += valorCte;
    metricaReal.valorNF += nf;
    metricaReal.peso += pesoLinha;
    metricaReal.volumes += vol;

    const chaveDestino = `${row.cidadeDestino || ''}/${row.ufDestino || ''}|${destino}`;
    const d = porDestinoMap.get(chaveDestino) || {
      destino: row.cidadeDestino || '',
      uf: row.ufDestino || '',
      ibge: destino,
      ctes: 0,
      transportadoras: new Set(),
      concorrentesTabela: new Set(),
      frete: 0,
    };
    d.ctes += 1;
    d.frete += valorCte;
    d.transportadoras.add(transportadora);
    porDestinoMap.set(chaveDestino, d);

    if (!destino) {
      semTabela += 1;
      return;
    }

    const resultado = simularSimples({
      transportadoras: baseOnline,
      origem: filtros.origem,
      canal: filtros.canal,
      peso: pesoLinha,
      valorNF: nf,
      cubagem: cubagemLinha,
      destinoCodigo: destino,
      cidadePorIbge,
      gradeCanal,
    }) || [];

    resultado.forEach((item) => {
      const nomeTabela = item.transportadora || 'Sem transportadora';
      const metrica = obterMetricaRealizado(simulacaoTransportadoraMap, nomeTabela);
      metrica.ctesConcorreu += 1;
      d.concorrentesTabela.add(nomeTabela);
      if (Number(item.ranking) === 1) {
        metrica.ctesGanharia += 1;
      }
    });

    const vencedor = resultado[0];
    if (!vencedor) {
      semTabela += 1;
      return;
    }

    ctesSimulados += 1;
    freteRealizadoComTabela += valorCte;
    freteGanhadorTotal += numeroRealizado(vencedor.total);

    const resultadoReal = resultado.find((item) => normalizarTransportadoraSimulador(item.transportadora) === transportadoraKey);
    if (resultadoReal) {
      metricaReal.ctesCarregadosComTabela += 1;
      metricaReal.freteTabelaPropria += numeroRealizado(resultadoReal.total);
    }

    metricaReal.freteMelhorParaCargasCarregadas += numeroRealizado(vencedor.total);

    const exemploCarregada = montarExemploSimulacaoOrigem({
      row,
      transportadoraReal: transportadora,
      valorCte,
      vencedor,
      resultado,
      itemTabela: resultadoReal,
      tipo: 'carregada',
    });
    metricaReal.exemplosCarregadas.push(exemploCarregada);

    const metricaVencedor = obterMetricaRealizado(simulacaoTransportadoraMap, vencedor.transportadora || 'Sem transportadora');
    metricaVencedor.exemplosGanharia.push(montarExemploSimulacaoOrigem({
      row,
      transportadoraReal: transportadora,
      valorCte,
      vencedor,
      resultado,
      itemTabela: vencedor,
      tipo: 'ganharia',
    }));

    const economia = valorCte - numeroRealizado(vencedor.total);
    diferencaPotencialTotal += economia;
    savingPotencial += Math.max(economia, 0);

    const realFoiGanhador = normalizarTransportadoraSimulador(vencedor.transportadora) === transportadoraKey;
    if (realFoiGanhador) {
      ganhoRealizado += 1;
      metricaReal.ctesCarregouGanhando += 1;
    } else {
      metricaReal.ctesCarregouPerdendo += 1;
    }

    simulacoes.push({
      cte: row.numeroCte || row.chaveCte || '',
      destino: row.cidadeDestino || vencedor.cidadeDestino || '',
      uf: row.ufDestino || vencedor.ufDestino || '',
      ibge: destino,
      transportadoraReal: transportadora,
      freteRealizado: valorCte,
      vencedor: vencedor.transportadora,
      freteVencedor: vencedor.total,
      saving: Math.max(economia, 0),
      diferenca: economia,
      realEraGanhador: realFoiGanhador,
      concorrentes: resultado.length,
      cubagemAplicada: numeroRealizado(vencedor?.detalhes?.frete?.cubagemAplicada),
      origemCubagem: vencedor?.detalhes?.frete?.origemCubagem || '',
      pesoCubado: numeroRealizado(vencedor?.detalhes?.frete?.pesoCubado),
      pesoConsiderado: numeroRealizado(vencedor?.detalhes?.frete?.pesoConsiderado),
    });
  });

  const porTransportadora = [...porTransportadoraMap.values()].map((item) => ({
    ...item,
    pctCtes: rows.length ? (item.ctes / rows.length) * 100 : 0,
    pctFrete: freteRealizado ? (item.frete / freteRealizado) * 100 : 0,
    percentualFrete: item.valorNF ? (item.frete / item.valorNF) * 100 : 0,
  })).sort((a, b) => b.ctes - a.ctes || b.frete - a.frete);

  const simulacaoPorTransportadora = [...simulacaoTransportadoraMap.values()].map((item) => {
    const diferencaPotencial = item.freteRealizado - item.freteMelhorParaCargasCarregadas;
    return {
      ...item,
      pctGanharia: item.ctesConcorreu ? (item.ctesGanharia / item.ctesConcorreu) * 100 : 0,
      pctCarregou: rows.length ? (item.ctesCarregou / rows.length) * 100 : 0,
      acertoOperacional: item.ctesCarregadosComTabela ? (item.ctesCarregouGanhando / item.ctesCarregadosComTabela) * 100 : 0,
      diferencaPotencial,
      economiaPotencial: Math.max(diferencaPotencial, 0),
      percentualEconomiaPotencial: item.freteRealizado ? (Math.max(diferencaPotencial, 0) / item.freteRealizado) * 100 : 0,
      exemplosCarregadas: [...(item.exemplosCarregadas || [])]
        .sort((a, b) => Math.abs(b.diferencaPotencial) - Math.abs(a.diferencaPotencial))
        .slice(0, 10),
      exemplosGanharia: [...(item.exemplosGanharia || [])]
        .sort((a, b) => Math.abs(b.diferencaPotencial) - Math.abs(a.diferencaPotencial))
        .slice(0, 10),
    };
  }).sort((a, b) => b.economiaPotencial - a.economiaPotencial || b.ctesCarregou - a.ctesCarregou || b.ctesGanharia - a.ctesGanharia);

  const porDestino = [...porDestinoMap.values()].map((item) => ({
    ...item,
    qtdTransportadoras: item.transportadoras.size,
    qtdConcorrentesTabela: item.concorrentesTabela.size,
    transportadoras: [...item.transportadoras].sort(),
    concorrentesTabela: [...item.concorrentesTabela].sort(),
    statusCobertura: item.concorrentesTabela.size === 0
      ? 'Sem cobertura'
      : item.concorrentesTabela.size === 1
        ? 'Baixa concorrência'
        : item.concorrentesTabela.size === 2
          ? 'Concorrência limitada'
          : 'Concorrência saudável',
  })).sort((a, b) => a.qtdConcorrentesTabela - b.qtdConcorrentesTabela || b.ctes - a.ctes || a.uf.localeCompare(b.uf));

  const destinosSemTabela = porDestino.filter((item) => item.qtdConcorrentesTabela === 0);
  const destinosUmaOpcao = porDestino.filter((item) => item.qtdConcorrentesTabela === 1);
  const destinosDuasOpcoes = porDestino.filter((item) => item.qtdConcorrentesTabela === 2);

  return {
    ctes: rows.length,
    ctesSimulados,
    freteRealizado,
    freteRealizadoComTabela,
    freteGanhadorTotal,
    diferencaPotencialTotal,
    valorNF,
    peso,
    volumes,
    percentualFreteRealizado: valorNF ? (freteRealizado / valorNF) * 100 : 0,
    savingPotencial,
    percentualSavingPotencial: freteRealizadoComTabela ? (savingPotencial / freteRealizadoComTabela) * 100 : 0,
    semTabela,
    ganhoRealizado,
    aderenciaRealizada: ctesSimulados ? (ganhoRealizado / ctesSimulados) * 100 : 0,
    destinosSemTabela: destinosSemTabela.length,
    destinosUmaOpcao: destinosUmaOpcao.length,
    destinosDuasOpcoes: destinosDuasOpcoes.length,
    porTransportadora,
    simulacaoPorTransportadora,
    porDestino,
    destinosCriticos: porDestino.filter((item) => item.qtdConcorrentesTabela <= 2).slice(0, 150),
    simulacoes: simulacoes.sort((a, b) => b.saving - a.saving).slice(0, 150),
  };
}

function normalizarChaveSimulador(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[/\-]\s*[A-Z]{2}\s*$/i, '')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function getTipoVeiculo(row) {
  return (
    row?.tipo_veiculo ||
    row?.tipoVeiculo ||
    row?.tipo ||
    row?.veiculo ||
    ''
  ).trim() || 'Não informado';
}

function periodoRealizadoDias(rows = [], inicio = '', fim = '') {
  const datas = rows
    .map((row) => String(row.dataEmissao || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  const dataInicio = inicio || datas[0];
  const dataFim = fim || datas[datas.length - 1];
  if (!dataInicio || !dataFim) return 1;
  const ini = new Date(`${dataInicio}T00:00:00`);
  const end = new Date(`${dataFim}T00:00:00`);
  const dias = Math.round((end - ini) / 86400000) + 1;
  return Math.max(Number.isFinite(dias) ? dias : 1, 1);
}

function periodoRealizadoMeses(rows = [], inicio = '', fim = '') {
  const datas = rows
    .map((row) => String(row.dataEmissao || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  const dataInicio = inicio || datas[0];
  const dataFim = fim || datas[datas.length - 1];
  if (!dataInicio || !dataFim) return 1;
  const ini = new Date(`${dataInicio}T00:00:00`);
  const end = new Date(`${dataFim}T00:00:00`);
  const meses = (end.getFullYear() - ini.getFullYear()) * 12 + (end.getMonth() - ini.getMonth()) + 1;
  return Math.max(Number.isFinite(meses) ? meses : 1, 1);
}

function resolverIbgeRealizadoPorCidade(row = {}, tipo = 'destino', municipioPorCidade) {
  const campoIbge = tipo === 'origem' ? 'ibgeOrigem' : 'ibgeDestino';
  const atual = String(row?.[campoIbge] || '').replace(/\D/g, '').slice(0, 7);
  if (atual) return atual;

  const cidade = tipo === 'origem' ? row.cidadeOrigem : row.cidadeDestino;
  const uf = tipo === 'origem' ? row.ufOrigem : row.ufDestino;
  const cidadeNorm = normalizeBuscaIbge(cidade || '');
  const cidadeUfNorm = normalizeBuscaIbge(`${cidade || ''}/${uf || ''}`);
  const municipio = municipioPorCidade?.get(cidadeUfNorm) || municipioPorCidade?.get(cidadeNorm);
  return municipio?.ibge || '';
}

function criarRouteKeysRealizado(rows = [], canalPadrao = '') {
  const keys = new Set();
  (rows || []).forEach((row) => {
    const origem = String(row.ibgeOrigem || '').replace(/\D/g, '').slice(0, 7);
    const destino = String(row.ibgeDestino || '').replace(/\D/g, '').slice(0, 7);
    if (!origem || !destino) return;
    keys.add(`${row.canal || canalPadrao || ''}|${origem}-${destino}`);
  });
  return [...keys];
}

function mesclarBasesTransportadorasSimulador(bases = []) {
  const mapa = new Map();

  (bases || []).flat().filter(Boolean).forEach((transportadora) => {
    const nome = String(transportadora?.nome || '').trim();
    if (!nome) return;
    const chave = normalizarTransportadoraSimulador(nome);
    const atual = mapa.get(chave) || {
      ...transportadora,
      nome,
      origens: [],
    };

    const origemKeys = new Set((atual.origens || []).map((origem) => {
      const ibge = String(origem?.rotas?.[0]?.ibgeOrigem || origem?.ibgeOrigem || '').replace(/\D/g, '').slice(0, 7);
      return [normalizarChaveSimulador(origem?.cidade), String(origem?.canal || '').toUpperCase(), ibge].join('|');
    }));

    (transportadora.origens || []).forEach((origem) => {
      const ibge = String(origem?.rotas?.[0]?.ibgeOrigem || origem?.ibgeOrigem || '').replace(/\D/g, '').slice(0, 7);
      const chaveOrigem = [normalizarChaveSimulador(origem?.cidade), String(origem?.canal || '').toUpperCase(), ibge].join('|');
      if (!origemKeys.has(chaveOrigem)) {
        atual.origens.push(origem);
        origemKeys.add(chaveOrigem);
      }
    });

    mapa.set(chave, atual);
  });

  return [...mapa.values()].filter((item) => (item.origens || []).length);
}

function valoresUnicosValidos(lista = []) {
  const vistos = new Set();
  const saida = [];
  (lista || []).forEach((item) => {
    const texto = String(item || '').trim();
    const chave = normalizarChaveSimulador(texto);
    if (!texto || !chave || vistos.has(chave)) return;
    vistos.add(chave);
    saida.push(texto);
  });
  return saida;
}

function simularLinhaRealizadoComFallback({ baseOnline = [], row = {}, canal = '', pesoLinha = 0, nf = 0, destino = '', cidadePorIbge, gradeCanal = [], filtros = {} }) {
  const origemLinha = String(row.cidadeOrigem || '').trim();
  const ufOrigem = String(row.ufOrigem || '').trim().toUpperCase();
  const canalLinha = canal || filtros.canal || row.canal || 'ATACADO';

  const origensTentativa = valoresUnicosValidos([
    origemLinha,
    origemLinha && ufOrigem ? `${origemLinha}/${ufOrigem}` : '',
    filtros.origem,
  ]);

  for (const origemTentativa of origensTentativa) {
    const resultado = simularSimples({
      transportadoras: baseOnline,
      origem: origemTentativa,
      canal: canalLinha,
      peso: pesoLinha,
      valorNF: nf,
      cubagem: cubagemRealizado(row),
      destinoCodigo: destino,
      cidadePorIbge,
      gradeCanal,
    }) || [];
    if (resultado.length) return { resultado, origemUsada: origemTentativa, fallback: false };
  }

  // Fallback controlado: quando o CT-e vem com origem escrita diferente da tabela
  // ou sem IBGE de origem, simula pelo destino e depois tenta manter apenas a mesma origem textual.
  const resultadoDestino = simularSimples({
    transportadoras: baseOnline,
    origem: '',
    canal: canalLinha,
    peso: pesoLinha,
    valorNF: nf,
    cubagem: cubagemRealizado(row),
    destinoCodigo: destino,
    cidadePorIbge,
    gradeCanal,
  }) || [];

  if (!resultadoDestino.length) return { resultado: [], origemUsada: origemLinha || filtros.origem || '', fallback: true };

  const origemNorm = normalizarChaveSimulador(origemLinha || filtros.origem || '');
  const resultadoMesmaOrigem = origemNorm
    ? resultadoDestino.filter((item) => normalizarChaveSimulador(item.origem) === origemNorm || normalizarChaveSimulador(item.origem).includes(origemNorm) || origemNorm.includes(normalizarChaveSimulador(item.origem)))
    : resultadoDestino;

  return {
    resultado: resultadoMesmaOrigem.length ? resultadoMesmaOrigem : resultadoDestino,
    origemUsada: origemLinha || filtros.origem || '',
    fallback: true,
  };
}

function criarResumoRotaRealizado(row, itemSelecionada, vencedor, resultado, economiaSelecionadaVsReal, reducaoNecessaria, diferencaVencedor) {
  return {
    origem: row.cidadeOrigem || '',
    ufOrigem: row.ufOrigem || '',
    destino: row.cidadeDestino || '',
    ufDestino: row.ufDestino || '',
    ibgeDestino: row.ibgeDestino || '',
    tipo: getTipoVeiculo(row),
    ctes: 0,
    volumes: 0,
    peso: 0,
    valorNF: 0,
    freteRealizado: 0,
    freteSelecionada: 0,
    freteVencedor: 0,
    savingSelecionada: 0,
    savingTabelaSelecionadaBruto: 0,
    savingVencedor: 0,
    diferencaParaVencedor: 0,
    reducaoNecessariaSoma: 0,
    qtdComSelecionada: 0,
    qtdPerdidasSelecionada: 0,
    qtdGanhasSelecionada: 0,
    freteSelecionadaGanhadora: 0,
    freteRealizadoGanharia: 0,
    valorNFGanharia: 0,
    savingGanhasSelecionada: 0,
    qtdSemTabelaSelecionada: 0,
    qtdSemTabelaGeral: 0,
    concorrentesSoma: 0,
    vencedores: new Map(),
    exemploVencedor: vencedor?.transportadora || '',
    exemploRankingSelecionada: itemSelecionada?.ranking || '',
    exemploReducao: reducaoNecessaria,
    exemploDiferenca: diferencaVencedor,
  };
}

function finalizarResumoRotaRealizado(item) {
  const vencedores = [...item.vencedores.entries()]
    .map(([transportadora, qtd]) => ({ transportadora, qtd }))
    .sort((a, b) => b.qtd - a.qtd);

  const mediaReducao = item.qtdPerdidasSelecionada
    ? item.reducaoNecessariaSoma / item.qtdPerdidasSelecionada
    : 0;

  return {
    ...item,
    rota: `${item.origem}${item.ufOrigem ? `/${item.ufOrigem}` : ''} → ${item.destino}${item.ufDestino ? `/${item.ufDestino}` : ''}`,
    percentualFreteRealizado: item.valorNF ? (item.freteRealizado / item.valorNF) * 100 : 0,
    ticketMedioRealizado: item.ctes ? item.freteRealizado / item.ctes : 0,
    ticketMedioSelecionada: item.qtdComSelecionada ? item.freteSelecionada / item.qtdComSelecionada : 0,
    ticketMedioVencedor: item.ctes ? item.freteVencedor / item.ctes : 0,
    ticketMedioSelecionadaGanhadora: item.qtdGanhasSelecionada ? item.freteSelecionadaGanhadora / item.qtdGanhasSelecionada : 0,
    percentualFreteSelecionada: item.valorNF ? (item.freteSelecionada / item.valorNF) * 100 : 0,
    percentualFreteVencedor: item.valorNF ? (item.freteVencedor / item.valorNF) * 100 : 0,
    percentualFreteTabelaGanhadora: item.valorNFGanharia ? (item.freteSelecionadaGanhadora / item.valorNFGanharia) * 100 : 0,
    percentualSavingGanhas: item.freteRealizadoGanharia ? (item.savingGanhasSelecionada / item.freteRealizadoGanharia) * 100 : 0,
    savingTabelaSelecionadaBruto: item.savingTabelaSelecionadaBruto || 0,
    reducaoMediaNecessaria: mediaReducao,
    concorrentesMedio: item.ctes ? item.concorrentesSoma / item.ctes : 0,
    principalVencedor: vencedores[0]?.transportadora || item.exemploVencedor || '-',
    oportunidade: Math.max(item.savingSelecionada, 0) + Math.max(item.diferencaParaVencedor, 0),
    statusRotaSelecionada: item.qtdGanhasSelecionada > 0 && item.qtdPerdidasSelecionada === 0
      ? 'Ganha'
      : item.qtdGanhasSelecionada > 0
        ? 'Parcial'
        : item.qtdComSelecionada > 0
          ? 'Perdida'
          : 'Sem tabela',
    vencedores,
  };
}


function calcularPareto80Volume(rotas = []) {
  const ordenadas = [...(rotas || [])]
    .map((item) => ({ ...item, volumePareto: numeroRealizado(item.volumes) || numeroRealizado(item.ctes) }))
    .filter((item) => item.volumePareto > 0)
    .sort((a, b) => b.volumePareto - a.volumePareto || b.ctes - a.ctes || b.freteRealizado - a.freteRealizado);

  const totalVolume = ordenadas.reduce((acc, item) => acc + item.volumePareto, 0);
  let acumulado = 0;
  const selecionadas = [];
  for (const item of ordenadas) {
    if (acumulado >= totalVolume * 0.8 && selecionadas.length) break;
    acumulado += item.volumePareto;
    selecionadas.push({
      ...item,
      pctVolume: totalVolume ? (item.volumePareto / totalVolume) * 100 : 0,
      pctAcumulado: totalVolume ? (acumulado / totalVolume) * 100 : 0,
    });
  }

  const total = selecionadas.reduce((acc, item) => {
    acc.ctes += numeroRealizado(item.ctes);
    acc.volumes += numeroRealizado(item.volumes);
    acc.peso += numeroRealizado(item.peso);
    acc.valorNF += numeroRealizado(item.valorNF);
    acc.freteRealizado += numeroRealizado(item.freteRealizado);
    acc.freteSelecionada += numeroRealizado(item.freteSelecionada);
    acc.freteVencedor += numeroRealizado(item.freteVencedor);
    acc.savingSelecionada += numeroRealizado(item.savingSelecionada);
    acc.savingTabelaSelecionadaBruto += numeroRealizado(item.savingTabelaSelecionadaBruto);
    acc.savingVencedor += numeroRealizado(item.savingVencedor);
    acc.diferencaParaVencedor += numeroRealizado(item.diferencaParaVencedor);
    acc.perdidas += numeroRealizado(item.qtdPerdidasSelecionada);
    acc.reducaoSoma += numeroRealizado(item.reducaoMediaNecessaria) * numeroRealizado(item.qtdPerdidasSelecionada);
    return acc;
  }, { ctes: 0, volumes: 0, peso: 0, valorNF: 0, freteRealizado: 0, freteSelecionada: 0, freteVencedor: 0, savingSelecionada: 0, savingTabelaSelecionadaBruto: 0, savingVencedor: 0, diferencaParaVencedor: 0, perdidas: 0, reducaoSoma: 0 });

  return {
    rotas: selecionadas,
    totalVolume,
    volumeCoberto: acumulado,
    pctCoberto: totalVolume ? (acumulado / totalVolume) * 100 : 0,
    qtdRotas: selecionadas.length,
    reducaoMediaNecessaria: total.perdidas ? total.reducaoSoma / total.perdidas : 0,
    ...total,
  };
}

function gerarLaudoTextoRealizado(resumo, transportadora) {
  if (!resumo) return [];
  const linhas = [];
  linhas.push(`A transportadora ${transportadora || 'selecionada'} participou da simulação em ${resumo.ctesComTabelaSelecionada} CT-es de ${resumo.ctesAnalisados} analisados.`);
  linhas.push(`Ela ganharia ${resumo.ctesGanhariaSelecionada} CT-es (${formatPercent(resumo.aderenciaSelecionada)}) e perderia ${resumo.ctesPerdidosSelecionada} CT-es para concorrentes mais baratos.`);
  if (resumo.qtdRotasComTabelaSelecionada) {
    linhas.push(`Em rotas com tabela, ela aparece em ${resumo.qtdRotasComTabelaSelecionada} rota(s): ${resumo.qtdRotasGanhasSelecionada} ganha(s), ${resumo.qtdRotasParciaisSelecionada} parcial(is), ${resumo.qtdRotasComGanhoSelecionada} com algum CT-e ganho e ${resumo.qtdRotasPerdidasSelecionada} perdida(s).`);
  }
  if (Array.isArray(resumo.rotasGanhasDestaque) && resumo.rotasGanhasDestaque.length) {
    const rotas = resumo.rotasGanhasDestaque.map((rota) => `${rota.rota} (${rota.qtdGanhasSelecionada} CT-es, ${formatMoney(rota.freteSelecionadaGanhadora || 0)})`).join('; ');
    linhas.push(`Principais rotas ganhas: ${rotas}.`);
  }
  linhas.push(`A projeção de faturamento nos CT-es ganhos pela tabela selecionada é ${formatMoney(resumo.faturamentoSelecionadaGanhadoraMes)} por mês e ${formatMoney(resumo.faturamentoSelecionadaGanhadoraAno)} em 12 meses.`);
  linhas.push(`O saving da tabela ganhadora contra o frete realizado é ${formatMoney(resumo.savingSelecionadaVsReal)} no período, considerando somente os CT-es em que a tabela selecionada ficaria em 1º lugar.`);
  linhas.push(`Como referência de mercado, o melhor preço entre todas as tabelas geraria ${formatMoney(resumo.savingVencedorVsReal)} de saving potencial no mesmo recorte.`);
  if (Array.isArray(resumo.estadosGanhadoresDestaque) && resumo.estadosGanhadoresDestaque.length) {
    const estados = resumo.estadosGanhadoresDestaque.map((item) => `${item.uf}: ${item.ctesGanhas} CT-es e ${formatMoney(item.freteSelecionadaGanhas)}`).join('; ');
    linhas.push(`Estados com maior volume ganho: ${estados}.`);
  }
  if (Array.isArray(resumo.transportadorasPerdaDestaque) && resumo.transportadorasPerdaDestaque.length) {
    const perdas = resumo.transportadorasPerdaDestaque.map((item) => `${item.transportadora}: ${formatMoney(item.freteCedidoSelecionada || 0)} em ${Number(item.ctesCedidosSelecionada || 0).toLocaleString('pt-BR')} CT-es`).join('; ');
    linhas.push(`Transportadoras atuais com maior perda de faturamento: ${perdas}.`);
  }
  linhas.push(`Nas rotas perdidas, a redução média necessária para virar ganhadora é de ${formatPercent(resumo.reducaoMediaNecessaria)}.`);
  if (Array.isArray(resumo.rotasPerdidasDestaque) && resumo.rotasPerdidasDestaque.length) {
    const rotas = resumo.rotasPerdidasDestaque.map((rota) => `${rota.rota} (reduzir ${formatPercent(rota.reducaoMediaNecessaria)}, diferença ${formatMoney(rota.diferencaParaVencedor || 0)})`).join('; ');
    linhas.push(`Rotas críticas para negociação: ${rotas}.`);
  }
  return linhas;
}


function calcularResumoGanhasNegociacao(resultado = {}) {
  const detalhes = Array.isArray(resultado.ctesDetalhes) ? resultado.ctesDetalhes : [];
  const comTabela = detalhes.filter((item) => Number(item.freteSelecionada || 0) > 0);
  const ganhas = comTabela.filter((item) => item.statusSelecionada === 'Ganharia');
  const dias = Math.max(1, Number(resultado.dias || 1));
  const meses = Math.max(1, Number(resultado.meses || 1));

  const soma = (lista, campo) => lista.reduce((acc, item) => acc + Number(item?.[campo] || 0), 0);
  const ctesGanhas = ganhas.length;
  const ctesComTabela = comTabela.length || Number(resultado.ctesComTabelaSelecionada || 0);
  const freteRealizadoGanhas = soma(ganhas, 'freteRealizado');
  const freteTabelaGanhas = soma(ganhas, 'freteSelecionada');
  const valorNFGanhas = soma(ganhas, 'valorNF');
  const volumesGanhas = soma(ganhas, 'volumes');
  const cubagemGanhas = soma(ganhas, 'cubagem');
  const pesoGanhas = soma(ganhas, 'peso');
  const savingGanhas = Math.max(0, freteRealizadoGanhas - freteTabelaGanhas);

  return {
    ctesComTabela,
    ctesGanhas,
    ctesPerdidas: Math.max(0, ctesComTabela - ctesGanhas),
    aderencia: ctesComTabela ? (ctesGanhas / ctesComTabela) * 100 : 0,
    freteRealizadoGanhas,
    freteTabelaGanhas,
    faturamentoMes: freteTabelaGanhas / meses,
    faturamentoAno: (freteTabelaGanhas / meses) * 12,
    savingGanhas,
    savingMes: savingGanhas / meses,
    savingAno: (savingGanhas / meses) * 12,
    valorNFGanhas,
    percentualRealizadoGanhas: valorNFGanhas ? (freteRealizadoGanhas / valorNFGanhas) * 100 : 0,
    percentualTabelaGanhas: valorNFGanhas ? (freteTabelaGanhas / valorNFGanhas) * 100 : 0,
    variacaoPercentual: freteRealizadoGanhas && valorNFGanhas
      ? (((freteTabelaGanhas / valorNFGanhas) / (freteRealizadoGanhas / valorNFGanhas)) - 1) * 100
      : 0,
    cargasDia: ctesGanhas / dias,
    cargasMes: ctesGanhas / meses,
    volumesGanhas,
    volumesDia: volumesGanhas / dias,
    volumesMes: volumesGanhas / meses,
    cubagemGanhas,
    cubagemDia: cubagemGanhas / dias,
    cubagemMes: cubagemGanhas / meses,
    pesoGanhas,
    pesoDia: pesoGanhas / dias,
    pesoMes: pesoGanhas / meses,
  };
}

function calcularResumoPorEstadoRealizado(detalhes = []) {
  const porUf = new Map();

  detalhes.forEach((item) => {
    const uf = String(item.ufDestino || 'N/A').trim().toUpperCase() || 'N/A';
    const atual = porUf.get(uf) || {
      uf,
      ctes: 0,
      ctesComTabela: 0,
      ctesGanhas: 0,
      ctesPerdidas: 0,
      ctesSemTabela: 0,
      freteRealizado: 0,
      freteSelecionada: 0,
      freteSelecionadaGanhas: 0,
      freteRealizadoGanhas: 0,
      freteVencedor: 0,
      savingGanhas: 0,
      diferencaParaVencedor: 0,
      valorNF: 0,
      volumes: 0,
      peso: 0,
      cubagem: 0,
      reducaoSoma: 0,
      reducaoQtd: 0,
    };

    const freteSelecionada = Number(item.freteSelecionada || 0);
    const freteRealizado = Number(item.freteRealizado || 0);
    const ganhou = item.statusSelecionada === 'Ganharia';
    const perdeu = item.statusSelecionada === 'Perderia';

    atual.ctes += 1;
    if (freteSelecionada > 0) atual.ctesComTabela += 1;
    if (ganhou) atual.ctesGanhas += 1;
    else if (perdeu) atual.ctesPerdidas += 1;
    else atual.ctesSemTabela += 1;

    atual.freteRealizado += freteRealizado;
    atual.freteSelecionada += freteSelecionada;
    atual.freteVencedor += Number(item.freteVencedor || 0);
    atual.valorNF += Number(item.valorNF || 0);
    atual.volumes += Number(item.volumes || 0);
    atual.peso += Number(item.peso || 0);
    atual.cubagem += Number(item.cubagem || 0);
    atual.diferencaParaVencedor += Number(item.diferencaParaVencedor || 0);

    if (ganhou) {
      atual.freteSelecionadaGanhas += freteSelecionada;
      atual.freteRealizadoGanhas += freteRealizado;
      atual.savingGanhas += Math.max(freteRealizado - freteSelecionada, 0);
    }

    if (perdeu && Number(item.reducaoNecessaria || 0) > 0) {
      atual.reducaoSoma += Number(item.reducaoNecessaria || 0);
      atual.reducaoQtd += 1;
    }

    porUf.set(uf, atual);
  });

  return [...porUf.values()]
    .map((item) => ({
      ...item,
      aderencia: item.ctesComTabela ? (item.ctesGanhas / item.ctesComTabela) * 100 : 0,
      percentualFreteRealizado: item.valorNF ? (item.freteRealizado / item.valorNF) * 100 : 0,
      percentualFreteTabela: item.valorNF ? (item.freteSelecionada / item.valorNF) * 100 : 0,
      reducaoMediaNecessaria: item.reducaoQtd ? item.reducaoSoma / item.reducaoQtd : 0,
    }))
    .sort((a, b) => b.freteSelecionadaGanhas - a.freteSelecionadaGanhas || b.ctesGanhas - a.ctesGanhas || a.uf.localeCompare(b.uf, 'pt-BR'));
}

const MARGEM_OPERACIONAL_VEICULO_SIM = 0.9;

const VEICULOS_OPERACIONAIS_SIM = [
  {
    tipo: 'Fiorino / utilitário leve',
    cubagemMin: 3,
    cubagemRef: 4,
    pesoMin: 500,
    pesoRef: 700,
    uso: 'Coleta pequena, e-commerce, volumes leves',
  },
  {
    tipo: 'HR / Kia Bongo / VUC pequeno',
    cubagemMin: 8,
    cubagemRef: 12,
    pesoMin: 1000,
    pesoRef: 1500,
    uso: 'Coletas urbanas pequenas/médias',
  },
  {
    tipo: 'Van / Sprinter / Master',
    cubagemMin: 10,
    cubagemRef: 15,
    pesoMin: 1200,
    pesoRef: 1800,
    uso: 'Fracionado leve, coleta expressa',
  },
  {
    tipo: 'VUC / 3/4',
    cubagemMin: 18,
    cubagemRef: 25,
    pesoMin: 2000,
    pesoRef: 3500,
    uso: 'Coleta urbana, restrição de cidade, fracionado médio',
  },
  {
    tipo: 'Toco',
    cubagemMin: 35,
    cubagemRef: 45,
    pesoMin: 5000,
    pesoRef: 7000,
    uso: 'Coletas maiores e transferência curta',
  },
  {
    tipo: 'Truck',
    cubagemMin: 50,
    cubagemRef: 60,
    pesoMin: 10000,
    pesoRef: 14000,
    uso: 'Coletas grandes, fracionado pesado, filial/CD',
  },
  {
    tipo: 'Bitruck',
    cubagemMin: 60,
    cubagemRef: 70,
    pesoMin: 16000,
    pesoRef: 18000,
    uso: 'Alto peso com cubagem média',
  },
  {
    tipo: 'Carreta simples / sider / baú',
    cubagemMin: 90,
    cubagemRef: 100,
    pesoMin: 24000,
    pesoRef: 28000,
    uso: 'Transferência, grandes coletas, lotação',
  },
  {
    tipo: 'Carreta LS / Vanderleia',
    cubagemMin: 95,
    cubagemRef: 105,
    pesoMin: 28000,
    pesoRef: 32000,
    uso: 'Transferência pesada / lotação',
  },
  {
    tipo: 'Rodotrem / Bitrem',
    cubagemMin: 110,
    cubagemRef: 140,
    pesoMin: 38000,
    pesoRef: 45000,
    uso: 'Transferência de alto volume/peso',
  },
];

function formatNumeroOperacionalSim(value, casas = 1) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function calcularIndicadorVeiculoOperacionalSim({ cubagemDia = 0, pesoDia = 0 } = {}) {
  const cubagem = Math.max(0, numeroRealizado(cubagemDia));
  const peso = Math.max(0, numeroRealizado(pesoDia));

  if (!cubagem && !peso) {
    return {
      semDados: true,
      cubagemDia: cubagem,
      pesoDia: peso,
      veiculo: VEICULOS_OPERACIONAIS_SIM[0],
      veiculoMinimo: VEICULOS_OPERACIONAIS_SIM[0],
      ocupacaoOperacional: 0,
      ocupacaoFisica: 0,
      qtdVeiculos: 1,
      fatorLimitante: 'cubagem',
      alerta: 'Sem cubagem/peso suficiente para sugerir veículo.',
    };
  }

  const atendeCapacidadeFisica = (veiculo) => cubagem <= veiculo.cubagemRef && peso <= veiculo.pesoRef;
  const atendeCapacidadeOperacional = (veiculo) => (
    cubagem <= veiculo.cubagemRef * MARGEM_OPERACIONAL_VEICULO_SIM
    && peso <= veiculo.pesoRef * MARGEM_OPERACIONAL_VEICULO_SIM
  );

  const veiculoMinimo = VEICULOS_OPERACIONAIS_SIM.find(atendeCapacidadeFisica) || VEICULOS_OPERACIONAIS_SIM[VEICULOS_OPERACIONAIS_SIM.length - 1];
  const veiculoComFolga = VEICULOS_OPERACIONAIS_SIM.find(atendeCapacidadeOperacional) || VEICULOS_OPERACIONAIS_SIM[VEICULOS_OPERACIONAIS_SIM.length - 1];
  const cargaAcimaMaiorVeiculo = !VEICULOS_OPERACIONAIS_SIM.some(atendeCapacidadeOperacional);
  const veiculo = cargaAcimaMaiorVeiculo ? VEICULOS_OPERACIONAIS_SIM[VEICULOS_OPERACIONAIS_SIM.length - 1] : veiculoComFolga;

  const ocupacaoCubagemFisica = veiculo.cubagemRef ? cubagem / veiculo.cubagemRef : 0;
  const ocupacaoPesoFisica = veiculo.pesoRef ? peso / veiculo.pesoRef : 0;
  const ocupacaoFisica = Math.max(ocupacaoCubagemFisica, ocupacaoPesoFisica);
  const qtdVeiculos = Math.max(1, Math.ceil(ocupacaoFisica));
  const capacidadeCubagemOperacional = veiculo.cubagemRef * MARGEM_OPERACIONAL_VEICULO_SIM * qtdVeiculos;
  const capacidadePesoOperacional = veiculo.pesoRef * MARGEM_OPERACIONAL_VEICULO_SIM * qtdVeiculos;
  const ocupacaoCubagemOperacional = capacidadeCubagemOperacional ? cubagem / capacidadeCubagemOperacional : 0;
  const ocupacaoPesoOperacional = capacidadePesoOperacional ? peso / capacidadePesoOperacional : 0;
  const ocupacaoOperacional = Math.max(ocupacaoCubagemOperacional, ocupacaoPesoOperacional);
  const fatorLimitante = ocupacaoCubagemOperacional >= ocupacaoPesoOperacional ? 'cubagem' : 'peso';
  const minimoNoLimite = veiculoMinimo.tipo !== veiculo.tipo;

  let alerta = 'Capacidade adequada com folga operacional.';
  if (cargaAcimaMaiorVeiculo && qtdVeiculos > 1) {
    alerta = `Demanda acima de 1 veículo; estimar ${qtdVeiculos} veículo(s)/dia.`;
  } else if (minimoNoLimite) {
    alerta = `${veiculoMinimo.tipo} comporta, mas fica acima da folga operacional; recomendado subir para ${veiculo.tipo}.`;
  } else if (ocupacaoOperacional >= 0.9) {
    alerta = 'Ocupação alta; acompanhar peso, cubagem e janela de coleta.';
  }

  return {
    semDados: false,
    cubagemDia: cubagem,
    pesoDia: peso,
    veiculo,
    veiculoMinimo,
    veiculoComFolga: veiculo,
    ocupacaoOperacional,
    ocupacaoFisica,
    ocupacaoCubagemOperacional,
    ocupacaoPesoOperacional,
    qtdVeiculos,
    fatorLimitante,
    minimoNoLimite,
    alerta,
    margemOperacional: MARGEM_OPERACIONAL_VEICULO_SIM,
  };
}


function getTipoIlustracaoVeiculoSim(tipo = '') {
  const nome = String(tipo || '').toLowerCase();
  if (nome.includes('fiorino') || nome.includes('utilitário')) return 'fiorino';
  if (nome.includes('bongo') || nome.includes('hr') || nome.includes('vuc pequeno')) return 'vucPequeno';
  if (nome.includes('van') || nome.includes('sprinter') || nome.includes('master')) return 'van';
  if (nome.includes('vuc') || nome.includes('3/4')) return 'vuc';
  if (nome.includes('toco')) return 'toco';
  if (nome.includes('bitruck')) return 'bitruck';
  if (nome.includes('truck')) return 'truck';
  if (nome.includes('rodotrem') || nome.includes('bitrem')) return 'rodotrem';
  if (nome.includes('ls') || nome.includes('vanderleia')) return 'carretaLs';
  if (nome.includes('carreta')) return 'carreta';
  return 'truck';
}

function VeiculoOcupacaoIlustracaoSim({ tipo = '', ocupacaoPercentual = 0 }) {
  const ilustracao = getTipoIlustracaoVeiculoSim(tipo);
  const fill = Math.max(0, Math.min(100, ocupacaoPercentual));
  const fillColor = fill >= 90 ? '#fb923c' : fill >= 70 ? '#34d399' : '#60a5fa';
  const stroke = '#bfdbfe';
  const baseFill = '#eff6ff';
  const cabFill = '#e0f2fe';
  const glassFill = '#f8fafc';
  const wheelFill = '#0f172a';
  const wheelInner = '#f8fafc';

  const renderWheel = (cx, cy = 68, r = 9) => (
    <g key={`wheel-${cx}-${cy}-${r}`}>
      <circle cx={cx} cy={cy} r={r} fill={wheelFill} />
      <circle cx={cx} cy={cy} r={Math.max(3, r * 0.44)} fill={wheelInner} />
    </g>
  );

  const renderCargo = (x, y, width, height, rx = 6) => {
    const fillWidth = Math.max(0, Math.min(width - 4, (width - 4) * (fill / 100)));
    return (
      <>
        <rect x={x} y={y} width={width} height={height} rx={rx} fill={baseFill} stroke={stroke} strokeWidth="2" />
        <rect x={x + 2} y={y + 2} width={fillWidth} height={Math.max(0, height - 4)} rx={Math.max(4, rx - 2)} fill={fillColor} opacity="0.9" />
      </>
    );
  };

  const desenhos = {
    fiorino: (
      <>
        <path d="M18 53c0-10 8-18 18-18h84c15 0 24 6 30 14l13 1c5 0 9 4 9 9v6H18v-12Z" fill={baseFill} stroke={stroke} strokeWidth="2" />
        <rect x="30" y="39" width="92" height="22" rx="8" fill={baseFill} stroke={stroke} strokeWidth="2" />
        <rect x="32" y="41" width={Math.max(0, 88 * (fill / 100))} height="18" rx="6" fill={fillColor} opacity="0.9" />
        <path d="M120 39h18c10 0 16 6 21 14h-39V39Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M132 42h10c6 0 10 4 13 9h-23V42Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        {renderWheel(52, 66, 8)}
        {renderWheel(136, 66, 8)}
        <line x1="22" y1="64" x2="168" y2="64" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    vucPequeno: (
      <>
        {renderCargo(18, 28, 92, 34, 8)}
        <path d="M110 38h22l18 16v8h-40V38Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M123 41h8l11 10h-19V41Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        {renderWheel(40)}
        {renderWheel(116)}
        <line x1="18" y1="66" x2="150" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    van: (
      <>
        <path d="M20 54c0-12 9-22 21-22h86c13 0 22 5 31 15h16v18H20V54Z" fill={baseFill} stroke={stroke} strokeWidth="2" />
        <rect x="34" y="36" width="96" height="24" rx="8" fill="none" stroke={stroke} strokeWidth="2" />
        <rect x="36" y="38" width={Math.max(0, 92 * (fill / 100))} height="20" rx="6" fill={fillColor} opacity="0.9" />
        <path d="M128 37h14c8 0 14 4 19 10h-33V37Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M139 40h8c5 0 9 3 12 7h-20V40Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        {renderWheel(56, 67, 8)}
        {renderWheel(138, 67, 8)}
        <line x1="22" y1="65" x2="174" y2="65" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    vuc: (
      <>
        {renderCargo(14, 24, 108, 38, 8)}
        <path d="M122 35h24l18 19v8h-42V35Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M136 39h8l11 11h-19V39Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        {renderWheel(38)}
        {renderWheel(132)}
        <line x1="14" y1="66" x2="164" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    toco: (
      <>
        {renderCargo(10, 24, 124, 38, 8)}
        <path d="M134 35h25l18 19v8h-43V35Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M149 39h8l11 11h-19V39Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        {renderWheel(36)}
        {renderWheel(96)}
        {renderWheel(144)}
        <line x1="12" y1="66" x2="176" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    truck: (
      <>
        {renderCargo(8, 23, 138, 39, 8)}
        <path d="M146 34h26l19 20v8h-45V34Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M162 38h8l12 12h-20V38Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        {renderWheel(34)}
        {renderWheel(96)}
        {renderWheel(144)}
        {renderWheel(176)}
        <line x1="10" y1="66" x2="190" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    bitruck: (
      <>
        {renderCargo(6, 23, 148, 39, 8)}
        <path d="M154 34h24l18 20v8h-42V34Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M168 38h7l11 12h-18V38Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        {renderWheel(30)}
        {renderWheel(84)}
        {renderWheel(122)}
        {renderWheel(156)}
        {renderWheel(181)}
        <line x1="8" y1="66" x2="196" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    carreta: (
      <>
        {renderCargo(8, 24, 152, 38, 8)}
        <path d="M160 35h22l16 19v8h-38V35Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M172 39h7l10 11h-17V39Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        {renderWheel(36)}
        {renderWheel(98)}
        {renderWheel(132)}
        {renderWheel(162)}
        {renderWheel(184)}
        <line x1="10" y1="66" x2="198" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    carretaLs: (
      <>
        {renderCargo(4, 24, 164, 38, 8)}
        <path d="M168 35h20l16 19v8h-36V35Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M179 39h6l10 11h-16V39Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        {renderWheel(32)}
        {renderWheel(90)}
        {renderWheel(122)}
        {renderWheel(152)}
        {renderWheel(176)}
        <line x1="8" y1="66" x2="202" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    rodotrem: (
      <>
        {renderCargo(4, 24, 86, 38, 8)}
        {renderCargo(100, 24, 78, 38, 8)}
        <path d="M178 35h20l16 19v8h-36V35Z" fill={cabFill} stroke={stroke} strokeWidth="2" />
        <path d="M189 39h6l10 11h-16V39Z" fill={glassFill} stroke={stroke} strokeWidth="1.5" />
        <circle cx="94" cy="56" r="3" fill="#94a3b8" />
        {renderWheel(28)}
        {renderWheel(66)}
        {renderWheel(112)}
        {renderWheel(146)}
        {renderWheel(182)}
        {renderWheel(201)}
        <line x1="6" y1="66" x2="214" y2="66" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 220 88" role="img" aria-label={`Ocupação estimada do veículo ${tipo || 'selecionado'}`} style={{ width: '100%', maxWidth: 190 }}>
      {desenhos[ilustracao] || desenhos.truck}
    </svg>
  );
}

function VeiculoOcupacaoCard({ cubagemDia = 0, pesoDia = 0, titulo = 'Veículo sugerido' }) {
  const indicador = calcularIndicadorVeiculoOperacionalSim({ cubagemDia, pesoDia });
  const ocupacaoPercentual = indicador.ocupacaoOperacional * 100;
  const faixaCubagem = `${formatNumeroOperacionalSim(indicador.veiculo.cubagemMin, 0)} a ${formatNumeroOperacionalSim(indicador.veiculo.cubagemRef, 0)} m³`;
  const faixaPeso = `${formatNumeroOperacionalSim(indicador.veiculo.pesoMin, 0)} a ${formatNumeroOperacionalSim(indicador.veiculo.pesoRef, 0)} kg`;
  const badgeBg = indicador.semDados ? '#f8fafc' : indicador.ocupacaoOperacional >= 0.9 ? '#fff7ed' : indicador.ocupacaoOperacional >= 0.7 ? '#ecfdf5' : '#eff6ff';
  const badgeColor = indicador.semDados ? '#64748b' : indicador.ocupacaoOperacional >= 0.9 ? '#c2410c' : indicador.ocupacaoOperacional >= 0.7 ? '#047857' : '#1d4ed8';

  return (
    <div className="summary-card" style={{ gridColumn: 'span 2', minWidth: 260, alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <span>{titulo}</span>
          <strong style={{ fontSize: '1rem', lineHeight: 1.15 }}>{indicador.veiculo.tipo}</strong>
        </div>
        <div style={{ padding: '4px 8px', borderRadius: 999, background: badgeBg, color: badgeColor, fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
          {formatPercent(ocupacaoPercentual)} ocupado
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: 12, alignItems: 'center' }}>
        <VeiculoOcupacaoIlustracaoSim tipo={indicador.veiculo.tipo} ocupacaoPercentual={ocupacaoPercentual} />

        <small style={{ display: 'grid', gap: 4 }}>
          <span>Cubagem/dia: <strong>{formatNumeroOperacionalSim(indicador.cubagemDia, 2)} m³</strong></span>
          <span>Peso/dia: <strong>{formatNumeroOperacionalSim(indicador.pesoDia, 0)} kg</strong></span>
          <span>Referência: <strong>{faixaCubagem} • {faixaPeso}</strong></span>
          {indicador.qtdVeiculos > 1 && <span>Necessidade: <strong>{indicador.qtdVeiculos} veículo(s)/dia</strong></span>}
          <span>Limitante: <strong>{indicador.fatorLimitante === 'peso' ? 'peso' : 'cubagem'}</strong></span>
        </small>
      </div>

      <small style={{ color: badgeColor }}>
        {indicador.alerta}
        {indicador.minimoNoLimite ? ` Menor veículo físico: ${indicador.veiculoMinimo.tipo}.` : ''}
      </small>
      <small>Uso comum: {indicador.veiculo.uso}</small>
    </div>
  );
}

function simularRealizadoComTabela({ rows = [], baseOnline = [], transportadoraSelecionada = '', filtros = {}, cidadePorIbge, gradePorCanal = {}, municipioPorCidade }) {
  const nomeSelecionadoNorm = normalizarTransportadoraSimulador(transportadoraSelecionada);
  const rotasMap = new Map();
  const transportadorasMap = new Map();
  const ctesDetalhes = [];
  const dias = periodoRealizadoDias(rows, filtros.inicio, filtros.fim);
  const meses = periodoRealizadoMeses(rows, filtros.inicio, filtros.fim);

  let ctesAnalisados = 0;
  let ctesSimulados = 0;
  let ctesComTabelaSelecionada = 0;
  let ctesGanhariaSelecionada = 0;
  let ctesPerdidosSelecionada = 0;
  let ctesSemTabelaSelecionada = 0;
  let ctesSemTabelaGeral = 0;
  let freteRealizado = 0;
  let freteRealizadoComTabelaSelecionada = 0;
  let freteSelecionada = 0;
  let freteVencedor = 0;
  let valorNF = 0;
  let valorNFComTabelaSelecionada = 0;
  let peso = 0;
  let volumes = 0;
  let cubagemTotal = 0;
  let linhasComTracking = 0;
  let savingSelecionadaVsReal = 0;
  let savingTabelaSelecionadaVsRealBruto = 0;
  let savingVencedorVsReal = 0;
  let freteRealizadoGanhariaSelecionada = 0;
  let freteSelecionadaGanhadora = 0;
  let valorNFGanhariaSelecionada = 0;
  let diferencaSelecionadaVsVencedor = 0;
  let reducaoNecessariaSoma = 0;
  let ctesCapturadosDeOutras = 0;
  let freteCapturadoRealizado = 0;
  let freteCapturadoTabela = 0;
  let valorNFCapturado = 0;
  let pesoCapturado = 0;
  let volumesCapturados = 0;
  const diagnostico = {
    linhasSemIbgeDestino: 0,
    linhasSemResultado: 0,
    canaisUsados: new Map(),
    origensUsadas: new Map(),
    destinosSemResultado: new Map(),
  };

  (rows || []).forEach((row) => {
    ctesAnalisados += 1;
    const valorCte = numeroRealizado(row.valorCte);
    const nf = numeroRealizado(row.valorNF);
    const pesoLinha = pesoRealizado(row);
    const vol = numeroRealizado(row.qtdVolumes);
    const cubagemLinha = cubagemRealizado(row);
    if (row.trackingMatch) linhasComTracking += 1;
    cubagemTotal += cubagemLinha;
    const origem = row.cidadeOrigem || filtros.origem || '';
    const canal = filtros.canal || row.canal || 'ATACADO';
    const canalDiag = String(canal || 'SEM CANAL').toUpperCase();
    diagnostico.canaisUsados.set(canalDiag, (diagnostico.canaisUsados.get(canalDiag) || 0) + 1);
    const origemDiag = String(origem || 'SEM ORIGEM').trim();
    diagnostico.origensUsadas.set(origemDiag, (diagnostico.origensUsadas.get(origemDiag) || 0) + 1);
    let destino = String(row.ibgeDestino || '').trim();

    if (!destino && municipioPorCidade) {
      const cidadeNorm = normalizeBuscaIbge(row.cidadeDestino || '');
      const cidadeUfNorm = normalizeBuscaIbge(`${row.cidadeDestino || ''}/${row.ufDestino || ''}`);
      const municipio = municipioPorCidade.get(cidadeUfNorm) || municipioPorCidade.get(cidadeNorm);
      destino = municipio?.ibge || '';
    }

    freteRealizado += valorCte;
    valorNF += nf;
    peso += pesoLinha;
    volumes += vol;

    const chaveTransportadoraReal = normalizarChaveSimulador(row.transportadora || 'Sem transportadora');
    if (!transportadorasMap.has(chaveTransportadoraReal)) {
      transportadorasMap.set(chaveTransportadoraReal, {
        transportadora: row.transportadora || 'Sem transportadora',
        ctes: 0,
        frete: 0,
        valorNF: 0,
        peso: 0,
        volumes: 0,
        ctesCedidosSelecionada: 0,
        freteCedidoSelecionada: 0,
        freteTabelaCapturadoSelecionada: 0,
        valorNFCedidoSelecionada: 0,
        pesoCedidoSelecionada: 0,
        volumesCedidosSelecionada: 0,
      });
    }
    const metricaReal = transportadorasMap.get(chaveTransportadoraReal);
    metricaReal.ctes += 1;
    metricaReal.frete += valorCte;
    metricaReal.valorNF += nf;
    metricaReal.peso += pesoLinha;
    metricaReal.volumes += vol;

    if (!destino) {
      diagnostico.linhasSemIbgeDestino += 1;
      ctesSemTabelaGeral += 1;
      return;
    }

    const gradeCanal = gradePorCanal[canal] || gradePorCanal.ATACADO || [];
    const { resultado, origemUsada, fallback } = simularLinhaRealizadoComFallback({
      baseOnline,
      row,
      canal,
      pesoLinha,
      nf,
      destino,
      cidadePorIbge,
      gradeCanal,
      filtros,
    });

    const vencedor = resultado[0] || null;
    if (!vencedor) {
      diagnostico.linhasSemResultado += 1;
      const destinoLabelDiag = `${row.cidadeDestino || ''}/${row.ufDestino || ''} ${destino}`.trim();
      diagnostico.destinosSemResultado.set(destinoLabelDiag, (diagnostico.destinosSemResultado.get(destinoLabelDiag) || 0) + 1);
      ctesSemTabelaGeral += 1;
      return;
    }

    ctesSimulados += 1;
    const itemSelecionada = resultado.find((item) => transportadoraCompativelSimulador(item.transportadora, transportadoraSelecionada) || normalizarTransportadoraSimulador(item.transportadora) === nomeSelecionadoNorm) || null;
    const freteVenc = numeroRealizado(vencedor.total);
    freteVencedor += freteVenc;
    savingVencedorVsReal += Math.max(valorCte - freteVenc, 0);

    let freteSel = 0;
    let economiaSelecionadaVsReal = 0;
    let economiaTabelaSelecionadaVsRealBruto = 0;
    let diferencaVencedor = 0;
    let reducaoNecessaria = 0;
    let statusSelecionada = 'Sem tabela';

    if (itemSelecionada) {
      ctesComTabelaSelecionada += 1;
      freteSel = numeroRealizado(itemSelecionada.total);
      freteSelecionada += freteSel;
      freteRealizadoComTabelaSelecionada += valorCte;
      valorNFComTabelaSelecionada += nf;
      economiaTabelaSelecionadaVsRealBruto = Math.max(valorCte - freteSel, 0);
      savingTabelaSelecionadaVsRealBruto += economiaTabelaSelecionadaVsRealBruto;

      const temConcorrenteTabela = resultado.length > 1;
      const ganhaVsRealizado = freteSel > 0 && valorCte > 0 && freteSel < valorCte;
      const ganhaVsConcorrencia = Number(itemSelecionada.ranking) === 1;

      // Regra corrigida de vencedor:
      // a tabela só "ganha" se for mais barata que o realizado.
      // Se estiver acima do realizado, mesmo sendo 1ª entre as tabelas carregadas,
      // ela deve entrar como perda/acima do realizado.
      const ganhaTudoOuRealizado = ganhaVsRealizado && (!temConcorrenteTabela || ganhaVsConcorrencia);

      if (ganhaTudoOuRealizado) {
        ctesGanhariaSelecionada += 1;
        statusSelecionada = 'Ganharia';
        economiaSelecionadaVsReal = economiaTabelaSelecionadaVsRealBruto;
        savingSelecionadaVsReal += economiaSelecionadaVsReal;
        freteRealizadoGanhariaSelecionada += valorCte;
        freteSelecionadaGanhadora += freteSel;
        valorNFGanhariaSelecionada += nf;
      } else {
        ctesPerdidosSelecionada += 1;
        statusSelecionada = 'Perderia';

        const referenciasPerda = [
          valorCte > 0 ? valorCte : null,
          temConcorrenteTabela && freteVenc > 0 ? freteVenc : null,
        ].filter((valor) => Number(valor) > 0);
        const referenciaPerda = referenciasPerda.length ? Math.min(...referenciasPerda) : freteVenc;

        diferencaVencedor = Math.max(freteSel - referenciaPerda, 0);
        diferencaSelecionadaVsVencedor += diferencaVencedor;
        reducaoNecessaria = freteSel ? (diferencaVencedor / freteSel) * 100 : 0;
        reducaoNecessariaSoma += reducaoNecessaria;
      }
    } else {
      ctesSemTabelaSelecionada += 1;
    }

    const selecionadaJaCarregava = transportadoraCompativelSimulador(row.transportadora || '', transportadoraSelecionada)
      || normalizarTransportadoraSimulador(row.transportadora || '') === nomeSelecionadoNorm;
    const capturouDaTransportadoraAtual = statusSelecionada === 'Ganharia'
      && itemSelecionada
      && freteSel > 0
      && !selecionadaJaCarregava;

    if (capturouDaTransportadoraAtual) {
      metricaReal.ctesCedidosSelecionada += 1;
      metricaReal.freteCedidoSelecionada += valorCte;
      metricaReal.freteTabelaCapturadoSelecionada += freteSel;
      metricaReal.valorNFCedidoSelecionada += nf;
      metricaReal.pesoCedidoSelecionada += pesoLinha;
      metricaReal.volumesCedidosSelecionada += vol;
      ctesCapturadosDeOutras += 1;
      freteCapturadoRealizado += valorCte;
      freteCapturadoTabela += freteSel;
      valorNFCapturado += nf;
      pesoCapturado += pesoLinha;
      volumesCapturados += vol;
    }

    const origemResumo = origemUsada || origem;
    const chaveRota = [origemResumo, row.ufOrigem, row.cidadeDestino, row.ufDestino, getTipoVeiculo(row)].map(normalizarChaveSimulador).join('|');
    const rota = rotasMap.get(chaveRota) || criarResumoRotaRealizado(row, itemSelecionada, vencedor, resultado, economiaSelecionadaVsReal, reducaoNecessaria, diferencaVencedor);
    rota.ctes += 1;
    rota.volumes += vol;
    rota.peso += pesoLinha;
    rota.valorNF += nf;
    rota.freteRealizado += valorCte;
    rota.freteSelecionada += freteSel;
    rota.freteVencedor += freteVenc;
    rota.savingSelecionada += economiaSelecionadaVsReal;
    rota.savingTabelaSelecionadaBruto += economiaTabelaSelecionadaVsRealBruto;
    rota.savingVencedor += Math.max(valorCte - freteVenc, 0);
    rota.diferencaParaVencedor += diferencaVencedor;
    rota.concorrentesSoma += resultado.length;

    if (itemSelecionada) {
      rota.qtdComSelecionada += 1;
      if (statusSelecionada === 'Ganharia') {
        rota.qtdGanhasSelecionada += 1;
        rota.freteSelecionadaGanhadora += freteSel;
        rota.freteRealizadoGanharia += valorCte;
        rota.valorNFGanharia += nf;
        rota.savingGanhasSelecionada += economiaSelecionadaVsReal;
      } else {
        rota.qtdPerdidasSelecionada += 1;
      }
    } else {
      rota.qtdSemTabelaSelecionada += 1;
    }

    if (!resultado.length) rota.qtdSemTabelaGeral += 1;
    if (reducaoNecessaria) rota.reducaoNecessariaSoma += reducaoNecessaria;
    const vencedorNome = vencedor?.transportadora || 'Sem vencedor';
    rota.vencedores.set(vencedorNome, (rota.vencedores.get(vencedorNome) || 0) + 1);
    rotasMap.set(chaveRota, rota);

    ctesDetalhes.push({
      cte: row.numeroCte || row.chaveCte || '',
      data: row.dataEmissao || '',
      origem: origemResumo,
      ufOrigem: row.ufOrigem || '',
      destino: row.cidadeDestino || vencedor?.cidadeDestino || '',
      ufDestino: row.ufDestino || vencedor?.ufDestino || '',
      canal,
      rotaSelecionada: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.rotaNome || '',
      rotaCotacao: itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.rotaNome || '',
      rotaVencedora: vencedor?.detalhes?.frete?.rotaCotacao || vencedor?.detalhes?.frete?.cotacaoComercial || vencedor?.rotaNome || '',
      faixaCotacaoSelecionada: itemSelecionada?.detalhes?.frete?.faixaPeso || '',
      transportadoraReal: row.transportadora || '',
      freteRealizado: valorCte,
      freteSelecionada: freteSel,
      vencedor: vencedor?.transportadora || '',
      freteVencedor: freteVenc,
      volumes: vol,
      peso: pesoLinha,
      cubagem: cubagemLinha,
      cubagemOriginalTracking: numeroRealizado(row.cubagemTotalOriginalTracking),
      cubagemOutlierTracking: Boolean(row.cubagemOutlierTracking),
      limiteCubagemTracking: numeroRealizado(row.limiteCubagemTracking),
      valorNF: nf,
      percentualFreteRealizado: nf ? (valorCte / nf) * 100 : 0,
      percentualFreteSelecionada: nf && freteSel ? (freteSel / nf) * 100 : 0,
      percentualFreteVencedor: nf && freteVenc ? (freteVenc / nf) * 100 : 0,
      variacaoPctFreteSelecionada: nf && valorCte && freteSel ? (((freteSel / nf) / (valorCte / nf)) - 1) * 100 : 0,
      savingTabelaSelecionadaBruto: economiaTabelaSelecionadaVsRealBruto,
      savingVencedor: Math.max(valorCte - freteVenc, 0),
      trackingMatch: Boolean(row.trackingMatch),
      chaveNfe: row.chaveNfe || '',
      statusSelecionada,
      rankingSelecionada: itemSelecionada?.ranking || '',
      reducaoNecessaria,
      savingSelecionada: economiaSelecionadaVsReal,
      diferencaParaVencedor: diferencaVencedor,
      concorrentes: resultado.length,
      origemUsada,
      fallbackOrigem: fallback,
      // Detalhes completos do cálculo para auditoria
      vencedorDetalhes: vencedor?.detalhes || null,
      selecionadaDetalhes: itemSelecionada?.detalhes || null,
      ganhouRealizado: freteSel > 0 && valorCte > 0 && freteSel < valorCte,
      nomeRota: itemSelecionada?.detalhes?.frete?.nomeCotacao || itemSelecionada?.detalhes?.frete?.rotaCotacao || itemSelecionada?.detalhes?.frete?.cotacaoComercial || itemSelecionada?.rotaNome || '',
      faixaPeso: itemSelecionada?.detalhes?.frete?.faixaPeso || '',
      todosResultados: resultado.slice(0, 8).map((r) => ({
        transportadora: r.transportadora,
        total: r.total,
        ranking: r.ranking,
        origem: r.origem,
        rotaNome: r.detalhes?.frete?.rotaCotacao || r.detalhes?.frete?.cotacaoComercial || r.rotaNome || '',
        detalhes: r.detalhes || null,
      })),
    });
  });

  const rotas = [...rotasMap.values()]
    .map(finalizarResumoRotaRealizado)
    .sort((a, b) => b.oportunidade - a.oportunidade || b.ctes - a.ctes || b.freteRealizado - a.freteRealizado);

  const freteProjetadoCenario = Math.max(freteRealizado - freteCapturadoRealizado + freteCapturadoTabela, 0);
  const porTransportadoraReal = [...transportadorasMap.values()]
    .map((item) => {
      const ctesCedidosSelecionada = numeroRealizado(item.ctesCedidosSelecionada);
      const freteCedidoSelecionada = numeroRealizado(item.freteCedidoSelecionada);
      const freteTabelaCapturadoSelecionada = numeroRealizado(item.freteTabelaCapturadoSelecionada);
      const novoFaturamentoProjetado = Math.max(numeroRealizado(item.frete) - freteCedidoSelecionada, 0);
      return {
        ...item,
        ctesCedidosSelecionada,
        freteCedidoSelecionada,
        freteTabelaCapturadoSelecionada,
        valorNFCedidoSelecionada: numeroRealizado(item.valorNFCedidoSelecionada),
        pesoCedidoSelecionada: numeroRealizado(item.pesoCedidoSelecionada),
        volumesCedidosSelecionada: numeroRealizado(item.volumesCedidosSelecionada),
        novoFaturamentoProjetado,
        reducaoFaturamentoPct: item.frete ? (freteCedidoSelecionada / item.frete) * 100 : 0,
        reducaoCtesPct: item.ctes ? (ctesCedidosSelecionada / item.ctes) * 100 : 0,
        pctCtes: ctesAnalisados ? (item.ctes / ctesAnalisados) * 100 : 0,
        pctFrete: freteRealizado ? (item.frete / freteRealizado) * 100 : 0,
        pctFreteProjetado: freteProjetadoCenario ? (novoFaturamentoProjetado / freteProjetadoCenario) * 100 : 0,
        percentualFrete: item.valorNF ? (item.frete / item.valorNF) * 100 : 0,
      };
    })
    .sort((a, b) => b.frete - a.frete || b.ctes - a.ctes);

  const impactoTransportadoras = [...porTransportadoraReal]
    .sort((a, b) => b.freteCedidoSelecionada - a.freteCedidoSelecionada || b.ctesCedidosSelecionada - a.ctesCedidosSelecionada || b.frete - a.frete);

  const reducaoMediaNecessaria = ctesPerdidosSelecionada ? reducaoNecessariaSoma / ctesPerdidosSelecionada : 0;
  const aderenciaSelecionada = ctesComTabelaSelecionada ? (ctesGanhariaSelecionada / ctesComTabelaSelecionada) * 100 : 0;
  const faturamentoSelecionadaMes = meses ? freteSelecionada / meses : freteSelecionada;
  const faturamentoSelecionadaAno = faturamentoSelecionadaMes * 12;
  const faturamentoSelecionadaGanhadoraMes = meses ? freteSelecionadaGanhadora / meses : freteSelecionadaGanhadora;
  const faturamentoSelecionadaGanhadoraAno = faturamentoSelecionadaGanhadoraMes * 12;
  const savingSelecionadaVsRealMes = meses ? savingSelecionadaVsReal / meses : savingSelecionadaVsReal;
  const savingSelecionadaVsRealAno = savingSelecionadaVsRealMes * 12;
  const pareto80Volume = calcularPareto80Volume(rotas);
  const rotasComTabelaSelecionada = rotas.filter((rota) => Number(rota.qtdComSelecionada || 0) > 0);
  const rotasGanhasSelecionada = rotasComTabelaSelecionada.filter((rota) => Number(rota.qtdGanhasSelecionada || 0) > 0 && Number(rota.qtdPerdidasSelecionada || 0) === 0);
  const rotasComGanhoSelecionada = rotasComTabelaSelecionada.filter((rota) => Number(rota.qtdGanhasSelecionada || 0) > 0);
  const rotasParciaisSelecionada = rotasComTabelaSelecionada.filter((rota) => Number(rota.qtdGanhasSelecionada || 0) > 0 && Number(rota.qtdPerdidasSelecionada || 0) > 0);
  const rotasPerdidasSelecionada = rotasComTabelaSelecionada.filter((rota) => Number(rota.qtdGanhasSelecionada || 0) === 0 && Number(rota.qtdPerdidasSelecionada || 0) > 0);
  const rotasGanhasDestaque = [...rotasComGanhoSelecionada]
    .sort((a, b) => Number(b.freteSelecionadaGanhadora || 0) - Number(a.freteSelecionadaGanhadora || 0) || Number(b.qtdGanhasSelecionada || 0) - Number(a.qtdGanhasSelecionada || 0))
    .slice(0, 8);
  const rotasPerdidasDestaque = [...rotasPerdidasSelecionada, ...rotasParciaisSelecionada]
    .filter((rota) => Number(rota.diferencaParaVencedor || 0) > 0)
    .sort((a, b) => Number(b.diferencaParaVencedor || 0) - Number(a.diferencaParaVencedor || 0) || Number(b.qtdPerdidasSelecionada || 0) - Number(a.qtdPerdidasSelecionada || 0))
    .slice(0, 8);
  const resumoPorEstado = calcularResumoPorEstadoRealizado(ctesDetalhes);
  const estadosGanhadoresDestaque = resumoPorEstado
    .filter((item) => Number(item.ctesGanhas || 0) > 0)
    .slice(0, 6);
  const estadosPerdidosDestaque = [...resumoPorEstado]
    .filter((item) => Number(item.ctesPerdidas || 0) > 0)
    .sort((a, b) => Number(b.diferencaParaVencedor || 0) - Number(a.diferencaParaVencedor || 0) || Number(b.ctesPerdidas || 0) - Number(a.ctesPerdidas || 0))
    .slice(0, 6);
  const transportadorasPerdaDestaque = impactoTransportadoras
    .filter((item) => Number(item.freteCedidoSelecionada || 0) > 0)
    .slice(0, 6);
  const freteRealizadoMes = meses ? freteRealizado / meses : freteRealizado;
  const freteRealizadoAno = freteRealizadoMes * 12;

  const resumo = {
    ctesAnalisados,
    ctesSimulados,
    ctesComTabelaSelecionada,
    ctesGanhariaSelecionada,
    ctesPerdidosSelecionada,
    ctesSemTabelaSelecionada,
    ctesSemTabelaGeral,
    freteRealizado,
    freteRealizadoComTabelaSelecionada,
    freteSelecionada,
    freteVencedor,
    valorNF,
    valorNFComTabelaSelecionada,
    peso,
    volumes,
    cubagemTotal,
    linhasComTracking,
    dias,
    meses,
    cargasDia: ctesAnalisados / dias,
    volumesDia: volumes / dias,
    freteRealizadoMes,
    freteRealizadoAno,
    freteProjetadoCenario,
    ctesCapturadosDeOutras,
    freteCapturadoRealizado,
    freteCapturadoTabela,
    valorNFCapturado,
    pesoCapturado,
    volumesCapturados,
    savingCapturado: Math.max(freteCapturadoRealizado - freteCapturadoTabela, 0),
    reducaoFaturamentoTotalPct: freteRealizado ? (freteCapturadoRealizado / freteRealizado) * 100 : 0,
    faturamentoSelecionadaMes,
    faturamentoSelecionadaAno,
    faturamentoSelecionadaGanhadoraMes,
    faturamentoSelecionadaGanhadoraAno,
    savingSelecionadaVsReal,
    savingSelecionadaVsRealMes,
    savingSelecionadaVsRealAno,
    savingTabelaSelecionadaVsRealBruto,
    savingVencedorVsReal,
    freteRealizadoGanhariaSelecionada,
    freteSelecionadaGanhadora,
    valorNFGanhariaSelecionada,
    diferencaSelecionadaVsVencedor,
    reducaoMediaNecessaria,
    aderenciaSelecionada,
    percentualFreteRealizado: valorNF ? (freteRealizado / valorNF) * 100 : 0,
    percentualFreteRealizadoComTabela: valorNFComTabelaSelecionada ? (freteRealizadoComTabelaSelecionada / valorNFComTabelaSelecionada) * 100 : 0,
    percentualFreteSelecionadaComTabela: valorNFComTabelaSelecionada ? (freteSelecionada / valorNFComTabelaSelecionada) * 100 : 0,
    variacaoPercentualFreteComTabela: freteRealizadoComTabelaSelecionada && valorNFComTabelaSelecionada ? (((freteSelecionada / valorNFComTabelaSelecionada) / (freteRealizadoComTabelaSelecionada / valorNFComTabelaSelecionada)) - 1) * 100 : 0,
    percentualFreteRealizadoGanharia: valorNFGanhariaSelecionada ? (freteRealizadoGanhariaSelecionada / valorNFGanhariaSelecionada) * 100 : 0,
    percentualFreteTabelaGanharia: valorNFGanhariaSelecionada ? (freteSelecionadaGanhadora / valorNFGanhariaSelecionada) * 100 : 0,
    variacaoPercentualFreteGanharia: freteRealizadoGanhariaSelecionada && valorNFGanhariaSelecionada ? (((freteSelecionadaGanhadora / valorNFGanhariaSelecionada) / (freteRealizadoGanhariaSelecionada / valorNFGanhariaSelecionada)) - 1) * 100 : 0,
    percentualSavingSelecionada: freteRealizadoGanhariaSelecionada ? (savingSelecionadaVsReal / freteRealizadoGanhariaSelecionada) * 100 : 0,
    percentualSavingSelecionadaBruto: freteRealizadoComTabelaSelecionada ? (savingTabelaSelecionadaVsRealBruto / freteRealizadoComTabelaSelecionada) * 100 : 0,
    percentualSavingVencedor: freteRealizado ? (savingVencedorVsReal / freteRealizado) * 100 : 0,
    rotas,
    qtdRotasComTabelaSelecionada: rotasComTabelaSelecionada.length,
    qtdRotasGanhasSelecionada: rotasGanhasSelecionada.length,
    qtdRotasComGanhoSelecionada: rotasComGanhoSelecionada.length,
    qtdRotasParciaisSelecionada: rotasParciaisSelecionada.length,
    qtdRotasPerdidasSelecionada: rotasPerdidasSelecionada.length,
    rotasGanhasDestaque,
    rotasPerdidasDestaque,
    resumoPorEstado,
    estadosGanhadoresDestaque,
    estadosPerdidosDestaque,
    transportadorasPerdaDestaque,
    porTransportadoraReal,
    impactoTransportadoras,
    pareto80Volume,
    ctesDetalhes: ctesDetalhes.sort((a, b) => b.savingSelecionada - a.savingSelecionada || b.diferencaParaVencedor - a.diferencaParaVencedor),
    diagnostico: {
      linhasSemIbgeDestino: diagnostico.linhasSemIbgeDestino,
      linhasSemResultado: diagnostico.linhasSemResultado,
      canaisUsados: [...diagnostico.canaisUsados.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      origensUsadas: [...diagnostico.origensUsadas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      destinosSemResultado: [...diagnostico.destinosSemResultado.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    },
  };

  return {
    ...resumo,
    laudo: gerarLaudoTextoRealizado(resumo, transportadoraSelecionada),
  };
}

function statusCombinadoCte(item) {
  const temTabela = Number(item?.freteSelecionada || 0) > 0 && item?.statusSelecionada !== 'Sem tabela';
  if (!temTabela) return { label: 'Sem tabela', bg: '#f1f5f9', color: '#64748b', icon: '—' };

  const ganhaRealizado = item.ganhouRealizado === true || (Number(item.freteSelecionada || 0) > 0 && Number(item.freteRealizado || 0) > 0 && Number(item.freteSelecionada || 0) < Number(item.freteRealizado || 0));
  const ganhaTabelas = item.statusSelecionada === 'Ganharia';
  const temConcorrencia = Number(item.concorrentes || 0) > 1;

  if (!temConcorrencia) {
    if (ganhaRealizado) return { label: 'Vencedor', bg: '#dcfce7', color: '#15803d', icon: '✅' };
    return { label: 'Acima do realizado', bg: '#fee2e2', color: '#dc2626', icon: '❌' };
  }

  // Regra corrigida:
  // "Ganharia" só pode ser usado quando a tabela também é mais barata que o realizado.
  // Quando a tabela fica em 1º entre as tabelas, mas está acima do frete realizado,
  // o status correto é "Acima do realizado", não "Ganha concorrência".
  if (ganhaRealizado && ganhaTabelas) return { label: 'Ganha tudo', bg: '#dcfce7', color: '#15803d', icon: '✅' };
  if (ganhaRealizado && !ganhaTabelas) return { label: 'Ganha realizado', bg: '#fef3c7', color: '#b45309', icon: '💰' };
  if (!ganhaRealizado && ganhaTabelas && temConcorrencia) return { label: 'Acima do realizado', bg: '#dbeafe', color: '#1d4ed8', icon: '⚠️' };
  if (!ganhaRealizado) return { label: 'Acima do realizado', bg: '#fee2e2', color: '#dc2626', icon: '❌' };

  return { label: 'Perde para concorrente', bg: '#fff7f0', color: '#c2410c', icon: '⚠️' };
}

export default function SimuladorPage({ transportadoras = [] }) {
  const [aba, setAba] = useState('simples');
  const [grade, setGrade] = useState(getGradeInicial());
  const [gradeFonte, setGradeFonte] = useState('local');
  const [gradeStatus, setGradeStatus] = useState('Grade carregada do navegador.');
  const [salvandoGrade, setSalvandoGrade] = useState(false);
  const [opcoesOnline, setOpcoesOnline] = useState({
    transportadoras: [],
    origens: [],
    canais: [],
    origensPorTransportadora: {},
    canaisPorTransportadora: {},
    origensPorCanal: {},
    municipiosIbge: [],
    fonte: '',
    atualizadoEm: '',
  });
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);
  const [negociacoesSimulador, setNegociacoesSimulador] = useState([]);
  const [carregandoNegociacoesSimulador, setCarregandoNegociacoesSimulador] = useState(false);
  const [erroNegociacoesSimulador, setErroNegociacoesSimulador] = useState('');
  const [negociacoesAtualizadasEm, setNegociacoesAtualizadasEm] = useState('');
  const [incluirNegociacoesRealizado, setIncluirNegociacoesRealizado] = useState(false);
  const [compararConcorrentesRealizado, setCompararConcorrentesRealizado] = useState(false);
  const [incluirCpsLogRealizado, setIncluirCpsLogRealizado] = useState(false);
  const [baseRealizadoTracking, setBaseRealizadoTracking] = useState('com_tracking'); // 'com_tracking' | 'todos'
  const [baseOficialRealizadoSelecionada, setBaseOficialRealizadoSelecionada] = useState([]);
  const [carregandoBaseOficialRealizado, setCarregandoBaseOficialRealizado] = useState(false);
  const [opcoesAvancadasRealizadoAberto, setOpcoesAvancadasRealizadoAberto] = useState(false);
  const [salvandoResultadoNegociacao, setSalvandoResultadoNegociacao] = useState(false);
  const [erroOpcoes, setErroOpcoes] = useState('');
  const [municipiosIbge, setMunicipiosIbge] = useState([]);

  const lookup = useMemo(() => buildLookupTables(transportadoras), [transportadoras]);
  const { cidadePorIbge, destinosDisponiveis } = lookup;

  const municipiosDisponiveis = useMemo(() => {
    const fonte = municipiosIbge.length ? municipiosIbge : opcoesOnline.municipiosIbge || [];
    const porIbge = new Map();
    (fonte || []).forEach((item) => {
      if (item?.ibge && item?.cidade) porIbge.set(String(item.ibge), item);
    });
    return [...porIbge.values()].sort((a, b) => `${a.cidade}/${a.uf}`.localeCompare(`${b.cidade}/${b.uf}`, 'pt-BR'));
  }, [municipiosIbge, opcoesOnline.municipiosIbge]);

  const cidadePorIbgeCompleto = useMemo(() => {
    const mapa = new Map(cidadePorIbge || []);
    municipiosDisponiveis.forEach((item) => {
      if (item.ibge && item.cidade) mapa.set(String(item.ibge), item.uf ? `${item.cidade}/${item.uf}` : item.cidade);
    });
    return mapa;
  }, [cidadePorIbge, municipiosDisponiveis]);

  const municipioPorIbge = useMemo(() => {
    const mapa = new Map();
    municipiosDisponiveis.forEach((item) => mapa.set(String(item.ibge), item));
    return mapa;
  }, [municipiosDisponiveis]);

  const municipioPorCidade = useMemo(() => {
    const mapa = new Map();
    municipiosDisponiveis.forEach((item) => {
      const cidade = normalizeBuscaIbge(item.cidade);
      const cidadeUf = normalizeBuscaIbge(`${item.cidade}/${item.uf}`);
      if (cidade && !mapa.has(cidade)) mapa.set(cidade, item);
      if (cidadeUf && !mapa.has(cidadeUf)) mapa.set(cidadeUf, item);
    });
    return mapa;
  }, [municipiosDisponiveis]);

  const canaisLocal = useMemo(() => [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.canal)).filter(Boolean))], [transportadoras]);
  const origensLocal = useMemo(() => [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.cidade)).filter(Boolean))].sort(), [transportadoras]);
  const canais = useMemo(() => (opcoesOnline.canais?.length ? opcoesOnline.canais : canaisLocal.length ? canaisLocal : ['ATACADO']), [opcoesOnline.canais, canaisLocal]);
  const todasOrigens = useMemo(() => (opcoesOnline.origens?.length ? opcoesOnline.origens : origensLocal), [opcoesOnline.origens, origensLocal]);

  const todosDestinosComCidade = useMemo(() => {
    const porIbge = new Map();

    destinosDisponiveis.forEach((ibge) => {
      porIbge.set(String(ibge), {
        ibge: String(ibge),
        cidade: getCidadeByIbge(ibge, cidadePorIbgeCompleto),
        uf: getUfByIbge(ibge),
      });
    });

    municipiosDisponiveis.forEach((item) => {
      if (!porIbge.has(String(item.ibge))) porIbge.set(String(item.ibge), item);
    });

    return [...porIbge.values()].sort((a, b) => `${a.cidade}/${a.uf}`.localeCompare(`${b.cidade}/${b.uf}`, 'pt-BR'));
  }, [destinosDisponiveis, cidadePorIbgeCompleto, municipiosDisponiveis]);

  const [origemSimples, setOrigemSimples] = useState('');
  const [destinoCodigo, setDestinoCodigo] = useState('');
  const [canalSimples, setCanalSimples] = useState(canais[0] || 'ATACADO');
  const [pesoSimples, setPesoSimples] = useState('');
  const [nfSimples, setNfSimples] = useState('');
  const [resultadoSimples, setResultadoSimples] = useState([]);
  const destinoIdentificado = useMemo(() => {
    const texto = String(destinoCodigo || '').trim();
    if (!texto) return '';

    const ibgeDigitado = texto.match(/(\d{7})\D*$/)?.[1];
    let municipio = ibgeDigitado
      ? todosDestinosComCidade.find((item) => String(item.ibge) === ibgeDigitado)
      : null;

    if (!municipio) {
      const busca = normalizeBuscaIbge(limparCidadeDigitada(texto));
      municipio = todosDestinosComCidade.find((item) => {
        const cidade = normalizeBuscaIbge(item.cidade);
        const cidadeUf = normalizeBuscaIbge(`${item.cidade || ''}/${item.uf || ''}`);
        return busca && (cidade === busca || cidadeUf === busca);
      });
    }

    return municipio ? montarLabelMunicipio(municipio) : '';
  }, [destinoCodigo, todosDestinosComCidade]);

  const [transportadora, setTransportadora] = useState('');
  const [canalTransportadora, setCanalTransportadora] = useState(canais[0] || 'ATACADO');
  const [origemTransportadora, setOrigemTransportadora] = useState('');
  const [destinoTransportadora, setDestinoTransportadora] = useState('');
  const [pesoTransportadora, setPesoTransportadora] = useState('');
  const [nfTransportadora, setNfTransportadora] = useState('');
  const [modoLista, setModoLista] = useState(false);
  const [listaCodigos, setListaCodigos] = useState('');
  const [resultadoTransportadora, setResultadoTransportadora] = useState([]);

  const [transportadoraAnalise, setTransportadoraAnalise] = useState('');
  const [canalAnalise, setCanalAnalise] = useState(canais[0] || 'ATACADO');
  const [origemAnalise, setOrigemAnalise] = useState('');
  const [ufAnalise, setUfAnalise] = useState('');
  const [resultadoAnalise, setResultadoAnalise] = useState(null);

  const [canalCobertura, setCanalCobertura] = useState(canais[0] || 'ATACADO');
  const [origemCobertura, setOrigemCobertura] = useState('');
  const [transportadoraCobertura, setTransportadoraCobertura] = useState('');
  const [ufCobertura, setUfCobertura] = useState('');
  const [resultadoCobertura, setResultadoCobertura] = useState(null);

  const [canalOrigem, setCanalOrigem] = useState(canais[0] || 'ATACADO');
  const [origemOrigem, setOrigemOrigem] = useState('');
  const [buscarOrigemOrigem, setBuscarOrigemOrigem] = useState('');
  const [ufDestinoOrigem, setUfDestinoOrigem] = useState('');
  const [inicioOrigem, setInicioOrigem] = useState('');
  const [fimOrigem, setFimOrigem] = useState('');
  const [usarRealizadoOrigem, setUsarRealizadoOrigem] = useState(true);
  const [resultadoOrigem, setResultadoOrigem] = useState(null);
  const [detalheOrigemAberto, setDetalheOrigemAberto] = useState('');

  const [transportadoraRealizado, setTransportadoraRealizado] = useState('');
  const [canalRealizado, setCanalRealizado] = useState(canais[0] || 'ATACADO');
  const [modoRealizado, setModoRealizado] = useState('malha');
  const [origemRealizado, setOrigemRealizado] = useState('');
  const [destinoRealizado, setDestinoRealizado] = useState('');
  const [ufOrigemRealizado, setUfOrigemRealizado] = useState('');
  const [ufDestinoRealizado, setUfDestinoRealizado] = useState('');
  const [ufsDestinoRealizado, setUfsDestinoRealizado] = useState([]);
  const [ufDestinoRealizadoAberto, setUfDestinoRealizadoAberto] = useState(false);
  const [inicioRealizado, setInicioRealizado] = useState('');
  const [fimRealizado, setFimRealizado] = useState('');
  const [limiteRealizado, setLimiteRealizado] = useState(200000);
  const [resultadoRealizado, setResultadoRealizado] = useState(null);
  const [baseRealizadoPesquisada, setBaseRealizadoPesquisada] = useState(null);
  const [resumoPesquisaRealizado, setResumoPesquisaRealizado] = useState(null);
  const [pesquisandoRealizado, setPesquisandoRealizado] = useState(false);
  const [filtrosPesquisaRealizado, setFiltrosPesquisaRealizado] = useState('');
  const [filtroDetalhe, setFiltroDetalhe] = useState('');
  const [paginaDetalhe, setPaginaDetalhe] = useState(0);
  const DETALHE_POR_PAGINA = 50;
  const [linhasExpandidas, setLinhasExpandidas] = useState(new Set());
  const [abaDetalheRealizado, setAbaDetalheRealizado] = useState('ctes'); // 'ctes' | 'uf'
  const [abaLaudoRealizado, setAbaLaudoRealizado] = useState('diretoria');
  const [feedbackCopiaLaudo, setFeedbackCopiaLaudo] = useState('');
  const [laudoVisualAberto, setLaudoVisualAberto] = useState(null);
  const [salvandoLaudosVisuais, setSalvandoLaudosVisuais] = useState(false);
  const [secoesFechadas, setSecoesFechadas] = useState(new Set(['laudo', 'transp-realizado', 'rotas-perda-box']));
  const toggleSecao = (id) => setSecoesFechadas((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const secaoAberta = (id) => !secoesFechadas.has(id);
  const laudosEmailRealizado = useMemo(() => gerarLaudosEmailRealizado(resultadoRealizado), [resultadoRealizado]);
  const laudoEmailAtual = laudosEmailRealizado?.[abaLaudoRealizado] || null;

  useEffect(() => {
    setBaseRealizadoPesquisada(null);
    setResumoPesquisaRealizado(null);
    setFiltrosPesquisaRealizado('');
  }, [
    transportadoraRealizado,
    canalRealizado,
    modoRealizado,
    origemRealizado,
    destinoRealizado,
    ufOrigemRealizado,
    ufDestinoRealizado,
    ufsDestinoRealizado,
    inicioRealizado,
    fimRealizado,
    limiteRealizado,
    baseRealizadoTracking,
    incluirCpsLogRealizado,
    incluirNegociacoesRealizado,
  ]);


  const [carregandoSimulacao, setCarregandoSimulacao] = useState(false);
  const [erroSimulacao, setErroSimulacao] = useState('');
  const timerProcessamentoRef = useRef(null);
  const hideProcessamentoRef = useRef(null);
  const [processamentoUi, setProcessamentoUi] = useState({
    ativo: false,
    titulo: '',
    mensagem: '',
    percentual: 0,
  });

  const limparTimersProcessamento = () => {
    if (timerProcessamentoRef.current) {
      clearInterval(timerProcessamentoRef.current);
      timerProcessamentoRef.current = null;
    }
    if (hideProcessamentoRef.current) {
      clearTimeout(hideProcessamentoRef.current);
      hideProcessamentoRef.current = null;
    }
  };

  const iniciarProcessamentoUi = (titulo, mensagem, percentualInicial = 8) => {
    limparTimersProcessamento();
    setProcessamentoUi({
      ativo: true,
      titulo,
      mensagem,
      percentual: percentualInicial,
    });

    timerProcessamentoRef.current = setInterval(() => {
      setProcessamentoUi((prev) => {
        if (!prev.ativo) return prev;
        const incremento = prev.percentual < 45 ? 6 : prev.percentual < 75 ? 3 : 1;
        return {
          ...prev,
          percentual: Math.min(prev.percentual + incremento, 92),
        };
      });
    }, 400);
  };

  const atualizarProcessamentoUi = (mensagem, percentual = null) => {
    setProcessamentoUi((prev) => ({
      ...prev,
      ativo: true,
      mensagem: mensagem || prev.mensagem,
      percentual: percentual === null ? prev.percentual : percentual,
    }));
  };

  const finalizarProcessamentoUi = (tituloFinal = 'Processamento concluído', mensagemFinal = 'Resultado carregado.', percentualFinal = 100) => {
    limparTimersProcessamento();
    setProcessamentoUi((prev) => ({
      ...prev,
      ativo: true,
      titulo: tituloFinal,
      mensagem: mensagemFinal,
      percentual: percentualFinal,
    }));

    hideProcessamentoRef.current = setTimeout(() => {
      setProcessamentoUi({
        ativo: false,
        titulo: '',
        mensagem: '',
        percentual: 0,
      });
      hideProcessamentoRef.current = null;
    }, 900);
  };

  const limparProcessamentoUi = () => {
    limparTimersProcessamento();
    setProcessamentoUi({
      ativo: false,
      titulo: '',
      mensagem: '',
      percentual: 0,
    });
  };

  const origensPorCanalSimples = useMemo(() => {
    const online = opcoesOnline.origensPorCanal?.[canalSimples];
    if (online?.length) return online;

    const locais = transportadoras.flatMap((item) =>
      (item.origens || [])
        .filter((origem) => !canalSimples || (origem.canal || 'ATACADO') === canalSimples)
        .map((origem) => origem.cidade)
        .filter(Boolean)
    );

    return [...new Set(locais.length ? locais : todasOrigens)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [opcoesOnline.origensPorCanal, canalSimples, transportadoras, todasOrigens]);
  const atualizarOpcoesSimulador = async () => {
    setCarregandoOpcoes(true);
    setErroOpcoes('');
    try {
      const opcoes = await carregarOpcoesSimuladorDb();
      setOpcoesOnline(opcoes || {});
      if (opcoes?.municipiosIbge?.length) {
        setMunicipiosIbge(opcoes.municipiosIbge);
      } else {
        const municipios = await carregarMunicipiosIbgeDb();
        setMunicipiosIbge(municipios || []);
      }
      return opcoes;
    } catch (error) {
      setErroOpcoes(error.message || 'Erro ao carregar opções do simulador no Supabase.');
      return null;
    } finally {
      setCarregandoOpcoes(false);
    }
  };


  const carregarNegociacoesSimulador = async (opcoes = {}) => {
    if (!opcoes.forcar && negociacoesSimulador.length) return negociacoesSimulador;
    setCarregandoNegociacoesSimulador(true);
    setErroNegociacoesSimulador('');

    try {
      const dados = await buscarTabelasNegociacaoParaSimulacao({ tipoTabela: 'FRACIONADO' });
      setNegociacoesSimulador(dados || []);
      setNegociacoesAtualizadasEm(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      return dados || [];
    } catch (error) {
      setErroNegociacoesSimulador(error.message || 'Erro ao carregar tabelas em negociação para simulação.');
      setNegociacoesSimulador([]);
      setNegociacoesAtualizadasEm('');
      return [];
    } finally {
      setCarregandoNegociacoesSimulador(false);
    }
  };

  useEffect(() => {
    atualizarOpcoesSimulador();
  }, []);

  // Carrega as negociações automaticamente ao entrar no Simulador Realizado.
  // Assim o usuário não precisa expandir opções só para atualizar a lista.
  useEffect(() => {
    if (aba === 'realizado' && !negociacoesSimulador.length && !carregandoNegociacoesSimulador) {
      carregarNegociacoesSimulador();
    }
  }, [aba, negociacoesSimulador.length, carregandoNegociacoesSimulador]);

  useEffect(() => {
    let ativo = true;
    async function carregarGradeCentral() {
      const resultado = await carregarGradeFreteCentralizada();
      if (!ativo) return;
      setGrade(resultado.grade);
      setGradeFonte(resultado.fonte || 'local');
      setGradeStatus(resultado.mensagem || 'Grade carregada.');
    }
    carregarGradeCentral();
    return () => { ativo = false; };
  }, []);


  const executarComTimeout = (promise, ms = 120000) => Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Tempo limite atingido ao buscar a base. Tente filtrar por origem para reduzir a análise.')), ms);
    }),
  ]);

  const carregarBaseOnline = async (filtros) => {
    setCarregandoSimulacao(true);
    setErroSimulacao('');
    try {
      const base = await executarComTimeout(buscarBaseSimulacaoDb(filtros), 120000);
      if (Array.isArray(base) && base.length) return base;

      // Fallback para evitar cenário zero por divergência de canal/origem digitada
      // Ex.: origem digitada sem acento ou canal salvo como B2B em vez de ATACADO.
      if (filtros?.origem || filtros?.canal) {
        const fallbackSemCanal = await executarComTimeout(buscarBaseSimulacaoDb({ ...filtros, canal: '' }), 120000);
        if (Array.isArray(fallbackSemCanal) && fallbackSemCanal.length) return fallbackSemCanal;
      }

      return [];
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao buscar base online do Supabase.');
      return [];
    } finally {
      setCarregandoSimulacao(false);
    }
  };


  const carregarBaseOnlinePorUfDestino = async (filtros = {}) => {
    const ufs = Array.isArray(filtros.ufDestino)
      ? filtros.ufDestino.map((uf) => String(uf || '').trim().toUpperCase()).filter(Boolean)
      : String(filtros.ufDestino || '').split(',').map((uf) => uf.trim().toUpperCase()).filter(Boolean);

    if (ufs.length <= 1) {
      return carregarBaseOnline({ ...filtros, ufDestino: ufs[0] || '' });
    }

    const bases = [];
    for (const uf of ufs) {
      const baseUf = await carregarBaseOnline({ ...filtros, ufDestino: uf });
      if (Array.isArray(baseUf) && baseUf.length) bases.push(baseUf);
    }

    return mesclarBasesTransportadorasSimulador(bases);
  };

  const carregarMapaVinculosSimulador = async () => {
    try {
      const vinculos = await carregarVinculosTransportadoras();
      return criarMapaVinculosTransportadoras(vinculos);
    } catch (err) {
      try {
        const locais = JSON.parse(localStorage.getItem('vinculos-transportadoras') || '[]');
        return criarMapaVinculosTransportadoras(Array.isArray(locais) ? locais : []);
      } catch {
        return new Map();
      }
    }
  };

  useEffect(() => () => {
    limparTimersProcessamento();
  }, []);

  useEffect(() => {
    if (!canalSimples && canais[0]) setCanalSimples(canais[0]);
    if (!canalTransportadora && canais[0]) setCanalTransportadora(canais[0]);
    if (!canalAnalise && canais[0]) setCanalAnalise(canais[0]);
    if (!canalCobertura && canais[0]) setCanalCobertura(canais[0]);
    if (!canalOrigem && canais[0]) setCanalOrigem(canais[0]);
    if (!canalRealizado && canais[0]) setCanalRealizado(canais[0]);
  }, [canalSimples, canalTransportadora, canalAnalise, canalCobertura, canalOrigem, canalRealizado, canais]);

  const todasTransportadorasDisponiveis = useMemo(() => (
    opcoesOnline.transportadoras?.length ? opcoesOnline.transportadoras : transportadoras.map((item) => item.nome).sort()
  ), [opcoesOnline.transportadoras, transportadoras]);

  const transportadorasDisponiveis = todasTransportadorasDisponiveis;

  const transportadorasPorCanalTransportadora = useMemo(
    () => filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalTransportadora, opcoesOnline, transportadoras),
    [todasTransportadorasDisponiveis, canalTransportadora, opcoesOnline, transportadoras]
  );

  const transportadorasPorCanalAnalise = useMemo(
    () => filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalAnalise, opcoesOnline, transportadoras),
    [todasTransportadorasDisponiveis, canalAnalise, opcoesOnline, transportadoras]
  );

  const transportadorasPorCanalCobertura = useMemo(
    () => filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalCobertura, opcoesOnline, transportadoras),
    [todasTransportadorasDisponiveis, canalCobertura, opcoesOnline, transportadoras]
  );

  const origensTransportadora = useMemo(() => {
    const online = opcoesOnline.origensPorCanal?.[canalTransportadora];
    if (online?.length) return online;
    return extrairOrigensBaseSimulador(transportadoras, canalTransportadora);
  }, [opcoesOnline.origensPorCanal, canalTransportadora, transportadoras]);

  const identificarDestinoLocal = (valor) => {
    const texto = String(valor || '').trim();
    if (!texto) return null;

    const ibge = texto.match(/(\d{7})\D*$/)?.[1];
    if (ibge) {
      return todosDestinosComCidade.find((item) => String(item.ibge) === ibge) || { ibge, cidade: getCidadeByIbge(ibge, cidadePorIbgeCompleto), uf: getUfByIbge(ibge) };
    }

    const busca = normalizeBuscaIbge(limparCidadeDigitada(texto));
    if (!busca) return null;

    return todosDestinosComCidade.find((item) => {
      const cidade = normalizeBuscaIbge(item.cidade);
      const cidadeUf = normalizeBuscaIbge(`${item.cidade || ''}/${item.uf || ''}`);
      return cidade === busca || cidadeUf === busca;
    }) || null;
  };

  const destinoTransportadoraIdentificado = useMemo(() => {
    const municipio = identificarDestinoLocal(destinoTransportadora);
    return municipio ? montarLabelMunicipio(municipio) : '';
  }, [destinoTransportadora, todosDestinosComCidade, cidadePorIbgeCompleto]);

  const resolverDestinoDigitado = async (valor) => {
    const local = identificarDestinoLocal(valor);
    if (local?.ibge) return String(local.ibge);

    const remoto = await resolverDestinoIbgeDb(valor);
    if (remoto?.ibge) return String(remoto.ibge);

    const digitos = String(valor || '').replace(/\D/g, '');
    if (digitos.length === 7) return digitos;
    return '';
  };

  const baseSimuladorComFallback = async (filtros = {}) => {
    const online = await carregarBaseOnlinePorUfDestino(filtros);
    return Array.isArray(online) && online.length ? online : transportadoras;
  };

  const onSimularSimples = async () => {
    setErroSimulacao('');
    if (!origemSimples || !destinoCodigo || !pesoSimples) {
      setErroSimulacao('Informe origem, destino e peso para simular.');
      return;
    }

    setCarregandoSimulacao(true);
    try {
      const ibgeDestino = await resolverDestinoDigitado(destinoCodigo);
      if (!ibgeDestino) throw new Error('Destino nÃ£o identificado. Informe cidade/UF, IBGE ou CEP.');

      const base = await baseSimuladorComFallback({ origem: origemSimples, canal: canalSimples });
      const gradeCanal = grade?.[canalSimples] || grade?.ATACADO || [];
      const resultado = simularSimples({
        transportadoras: base,
        origem: origemSimples,
        canal: canalSimples,
        peso: pesoSimples,
        valorNF: nfSimples,
        destinoCodigo: ibgeDestino,
        cidadePorIbge: cidadePorIbgeCompleto,
        gradeCanal,
      });
      setResultadoSimples(resultado || []);
    } catch (error) {
      setResultadoSimples([]);
      setErroSimulacao(error.message || 'Erro ao simular frete simples.');
    } finally {
      setCarregandoSimulacao(false);
    }
  };

  const onSimularTransportadora = async () => {
    setErroSimulacao('');
    if (!transportadora || !pesoTransportadora) {
      setErroSimulacao('Informe transportadora e peso para simular.');
      return;
    }

    setCarregandoSimulacao(true);
    try {
      const entradas = modoLista
        ? String(listaCodigos || '').split(/\r?\n|,|;/).map((item) => item.trim()).filter(Boolean)
        : [destinoTransportadora].filter((item) => String(item || '').trim());

      const destinoCodigos = [];
      for (const entrada of entradas) {
        const ibge = await resolverDestinoDigitado(entrada);
        if (ibge) destinoCodigos.push(ibge);
      }

      if (entradas.length && !destinoCodigos.length) throw new Error('Nenhum destino da lista foi identificado.');

      const base = await baseSimuladorComFallback({ nomeTransportadora: transportadora, canal: canalTransportadora, origem: origemTransportadora });
      const gradeCanal = grade?.[canalTransportadora] || grade?.ATACADO || [];
      const resultado = simularPorTransportadora({
        transportadoras: base,
        nomeTransportadora: transportadora,
        canal: canalTransportadora,
        origem: origemTransportadora,
        destinoCodigos,
        peso: pesoTransportadora,
        valorNF: nfTransportadora,
        cidadePorIbge: cidadePorIbgeCompleto,
        gradeCanal,
      });
      setResultadoTransportadora(resultado || []);
    } catch (error) {
      setResultadoTransportadora([]);
      setErroSimulacao(error.message || 'Erro ao simular transportadora.');
    } finally {
      setCarregandoSimulacao(false);
    }
  };

  const onSimularGrade = async () => {
    setErroSimulacao('');
    if (!transportadoraAnalise) {
      setErroSimulacao('Informe a transportadora para gerar a anÃ¡lise.');
      return;
    }

    setCarregandoSimulacao(true);
    iniciarProcessamentoUi('Gerando relatÃ³rio', 'Buscando tabela e calculando aderÃªncia...', 12);
    try {
      const base = await baseSimuladorComFallback({
        nomeTransportadora: transportadoraAnalise,
        canal: canalAnalise,
        origem: origemAnalise,
        ufDestino: ufAnalise,
      });
      atualizarProcessamentoUi('Calculando cenÃ¡rios da grade...', 55);
      const resultado = analisarTransportadoraPorGrade({
        transportadoras: base,
        nomeTransportadora: transportadoraAnalise,
        canal: canalAnalise,
        origem: origemAnalise,
        ufDestino: ufAnalise,
        grade: grade?.[canalAnalise] || grade?.ATACADO || [],
        cidadePorIbge: cidadePorIbgeCompleto,
      });
      setResultadoAnalise(resultado);
      finalizarProcessamentoUi('RelatÃ³rio pronto', 'AnÃ¡lise carregada.', 100);
    } catch (error) {
      limparProcessamentoUi();
      setResultadoAnalise(null);
      setErroSimulacao(error.message || 'Erro ao gerar anÃ¡lise de transportadora.');
    } finally {
      setCarregandoSimulacao(false);
    }
  };

  const onAnalisarCobertura = async () => {
    setErroSimulacao('');
    setCarregandoSimulacao(true);
    iniciarProcessamentoUi('Analisando cobertura', 'Conferindo destinos com e sem tabela...', 15);
    try {
      const base = await baseSimuladorComFallback({
        canal: canalCobertura,
        origem: origemCobertura,
        nomeTransportadora: transportadoraCobertura,
        ufDestino: ufCobertura,
      });
      const resultado = analisarCoberturaTabela({
        transportadoras: base,
        canal: canalCobertura,
        origem: origemCobertura,
        transportadora: transportadoraCobertura,
        ufDestino: ufCobertura,
        cidadePorIbge: cidadePorIbgeCompleto,
      });
      setResultadoCobertura(resultado);
      finalizarProcessamentoUi('Cobertura analisada', 'Resultado carregado.', 100);
    } catch (error) {
      limparProcessamentoUi();
      setResultadoCobertura(null);
      setErroSimulacao(error.message || 'Erro ao analisar cobertura.');
    } finally {
      setCarregandoSimulacao(false);
    }
  };

  const exportarSimulacaoTransportadora = () => {
    if (!resultadoTransportadora.length) return;
    const linhas = [
      ['Transportadora', 'Origem', 'Destino', 'IBGE', 'Ranking', 'Total', 'Prazo'],
      ...resultadoTransportadora.map((item) => [item.transportadora, item.origem, buildDestinoLabel(item), item.ibgeDestino, item.ranking, item.total, item.prazo]),
    ];
    const { nomeArquivo, csv } = exportarLinhasCsv('simulacao-transportadora.csv', linhas);
    downloadCsv(nomeArquivo, csv);
  };

  const exportarAnalise = () => {
    if (!resultadoAnalise?.detalhes?.length) return;
    const linhas = [
      ['Transportadora', 'Origem', 'Destino', 'IBGE', 'UF', 'Ranking', 'Total', 'Prazo'],
      ...resultadoAnalise.detalhes.map((item) => [item.transportadora, item.origem, buildDestinoLabel(item), item.ibgeDestino, item.ufDestino, item.ranking, item.total, item.prazo]),
    ];
    const { nomeArquivo, csv } = exportarLinhasCsv('analise-transportadora.csv', linhas);
    downloadCsv(nomeArquivo, csv);
  };

  const exportarCobertura = () => {
    if (!resultadoCobertura?.faltantes?.length) return;
    const linhas = [
      ['Origem', 'Cidade', 'UF', 'IBGE'],
      ...resultadoCobertura.faltantes.map((item) => [item.origem, item.cidade, item.uf, item.ibge]),
    ];
    const { nomeArquivo, csv } = exportarLinhasCsv('cobertura-faltantes.csv', linhas);
    downloadCsv(nomeArquivo, csv);
  };

  const transportadorasNegociacaoRealizado = useMemo(
    () => converterTabelasNegociacaoParaSimulador(negociacoesSimulador, { canal: canalRealizado }),
    [negociacoesSimulador, canalRealizado]
  );

  const nomesNegociacaoRealizado = useMemo(
    () => transportadorasNegociacaoRealizado.map((item) => item.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [transportadorasNegociacaoRealizado]
  );

  const ehTabelaNegociacaoRealizadoSelecionada = useMemo(
    () => nomesNegociacaoRealizado.includes(transportadoraRealizado),
    [nomesNegociacaoRealizado, transportadoraRealizado]
  );

  const basesMalhaRealizadoSelecionada = useMemo(() => {
    if (!transportadoraRealizado) return [];

    const bases = [];

    const negociacao = transportadorasNegociacaoRealizado.find((item) => item.nome === transportadoraRealizado);
    if (negociacao) bases.push(negociacao);

    const local = transportadoras.find((item) => (
      normalizarTransportadoraSimulador(item.nome) === normalizarTransportadoraSimulador(transportadoraRealizado) ||
      transportadoraCompativelSimulador(item.nome, transportadoraRealizado)
    ));
    if (local) bases.push(local);

    const oficiaisCarregadas = filtrarBasePorTransportadoraSimulador(baseOficialRealizadoSelecionada, transportadoraRealizado);
    if (oficiaisCarregadas.length) bases.push(...oficiaisCarregadas);

    return mesclarBasesTransportadorasSimulador(bases);
  }, [transportadoraRealizado, transportadorasNegociacaoRealizado, transportadoras, baseOficialRealizadoSelecionada]);

  const origensMalhaRealizadoDisponiveis = useMemo(
    () => extrairOrigensBaseSimulador(basesMalhaRealizadoSelecionada, canalRealizado),
    [basesMalhaRealizadoSelecionada, canalRealizado]
  );

  const ufsDestinoDaMalhaRealizado = useMemo(
    () => extrairUfsDestinoBaseSimulador(basesMalhaRealizadoSelecionada, canalRealizado, origemRealizado),
    [basesMalhaRealizadoSelecionada, canalRealizado, origemRealizado]
  );

  useEffect(() => {
    let ativo = true;

    async function carregarMalhaOficialRealizadoSelecionada() {
      setBaseOficialRealizadoSelecionada([]);

      if (!transportadoraRealizado || ehTabelaNegociacaoRealizadoSelecionada) {
        setCarregandoBaseOficialRealizado(false);
        return;
      }

      setCarregandoBaseOficialRealizado(true);
      try {
        const base = await executarComTimeout(buscarBaseSimulacaoDb({
          nomeTransportadora: transportadoraRealizado,
          canal: canalRealizado,
        }), 120000);

        if (!ativo) return;
        setBaseOficialRealizadoSelecionada(filtrarBasePorTransportadoraSimulador(base || [], transportadoraRealizado));
      } catch (error) {
        if (ativo) {
          console.warn('Não foi possível carregar a malha oficial da transportadora selecionada.', error?.message || error);
          setBaseOficialRealizadoSelecionada([]);
        }
      } finally {
        if (ativo) setCarregandoBaseOficialRealizado(false);
      }
    }

    carregarMalhaOficialRealizadoSelecionada();
    return () => { ativo = false; };
  }, [transportadoraRealizado, canalRealizado, ehTabelaNegociacaoRealizadoSelecionada]);

  const transportadorasPorCanalRealizado = useMemo(() => {
    const oficiaisDoCanal = filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalRealizado, opcoesOnline, transportadoras);

    // No Simulador do Realizado a transportadora selecionada pode ser:
    // 1) tabela oficial já cadastrada; ou
    // 2) tabela em negociação.
    // Por isso não podemos esconder uma tabela oficial só porque o canal/origem ainda não
    // foi reconhecido nas opções online. A simulação depois busca a tabela no Supabase e
    // aplica os filtros informados.
    return [...new Set([...(oficiaisDoCanal || []), ...(todasTransportadorasDisponiveis || []), ...nomesNegociacaoRealizado])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [todasTransportadorasDisponiveis, canalRealizado, opcoesOnline, transportadoras, nomesNegociacaoRealizado]);

  const negociacaoSelecionadaRealizado = useMemo(
    () => negociacoesSimulador.find((tabela) => labelTabelaNegociacaoSimulador(tabela) === transportadoraRealizado) || null,
    [negociacoesSimulador, transportadoraRealizado]
  );

  const salvarResultadoNegociacaoRealizado = async () => {
    if (!negociacaoSelecionadaRealizado?.id || !resultadoRealizado) return;

    setSalvandoResultadoNegociacao(true);
    setErroSimulacao('');

    try {
      const contextoLaudos = {
        transportadora: resultadoRealizado.filtros?.transportadora,
        canal: resultadoRealizado.filtros?.canal,
        origem: resultadoRealizado.filtros?.origem,
      };
      await salvarResultadoSimulacaoNegociacao(negociacaoSelecionadaRealizado.id, {
        ...resultadoRealizado,
        gradeFaixasLaudo: grade?.[canalRealizado] || grade?.ATACADO || [],
        laudosEmail: laudosEmailRealizado,
        laudos: prepararLaudosNegociacao(resultadoRealizado, contextoLaudos),
      });
      alert('Resultado projetado salvo na negociação.');
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao salvar resultado na negociação.');
    } finally {
      setSalvandoResultadoNegociacao(false);
    }
  };

  const recalcularRealizadoComMesmaBase = async () => {
    if (!baseRealizadoPesquisada?.rowsFiltrados?.length) {
      setErroSimulacao('Faça uma simulação primeiro para guardar a base de CT-es pesquisada.');
      return;
    }
    if (!transportadoraRealizado) {
      setErroSimulacao('Selecione a transportadora/tabela para recalcular.');
      return;
    }

    setFiltroDetalhe('');
    setPaginaDetalhe(0);
    setLinhasExpandidas(new Set());
    iniciarProcessamentoUi('Recalculando com mesma base', 'Recarregando somente a tabela/negociação selecionada...', 18);

    try {
      const dadosNegociacoes = await carregarNegociacoesSimulador({ forcar: true });
      const negociacoesConvertidas = converterTabelasNegociacaoParaSimulador(dadosNegociacoes || [], { canal: canalRealizado });
      const ehNegociacao = negociacoesConvertidas.some((item) => normalizarTransportadoraSimulador(item.nome) === normalizarTransportadoraSimulador(transportadoraRealizado));
      let baseSelecionada = [];

      if (ehNegociacao) {
        baseSelecionada = negociacoesConvertidas.filter((item) =>
          normalizarTransportadoraSimulador(item.nome) === normalizarTransportadoraSimulador(transportadoraRealizado) ||
          transportadoraCompativelSimulador(item.nome, transportadoraRealizado)
        );
      } else {
        const mapaVinculos = await carregarMapaVinculosSimulador();
        const nomeTabela = mapaVinculos.get(normalizarChaveSimulador(transportadoraRealizado)) || mapaVinculos.get(String(transportadoraRealizado || '').toUpperCase()) || transportadoraRealizado;
        const baseOficial = await carregarBaseOnlinePorUfDestino({
          nomeTransportadora: nomeTabela,
          canal: canalRealizado,
          origem: origemRealizado || '',
          ufDestino: ufsDestinoFiltroRealizado,
        });
        baseSelecionada = filtrarBasePorTransportadoraSimulador(baseOficial, nomeTabela);
      }

      if (!baseSelecionada.length) {
        setErroSimulacao('Não encontrei tabela atualizada para recalcular. Clique em Simular realizado para refazer o fluxo completo.');
        finalizarProcessamentoUi('Tabela não encontrada', 'Não foi possível recalcular com a tabela atualizada.', 100);
        return;
      }

      const basesParaMesclar = [baseSelecionada].filter((base) => Array.isArray(base) ? base.length : Boolean(base));
      if (compararConcorrentesRealizado && incluirNegociacoesRealizado && negociacoesConvertidas.length) basesParaMesclar.push(negociacoesConvertidas);
      const baseParaSimulacao = mesclarBasesTransportadorasSimulador(basesParaMesclar);
      const lookupOnline = buildLookupTables(baseParaSimulacao);
      const mapaCidades = new Map(cidadePorIbgeCompleto);
      (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));

      atualizarProcessamentoUi('Simulando novamente CT-e a CT-e com a mesma base pesquisada...', 72);
      const resultado = simularRealizadoComTabela({
        rows: baseRealizadoPesquisada.rowsFiltrados,
        baseOnline: baseParaSimulacao,
        transportadoraSelecionada: transportadoraRealizado,
        filtros: {
          ...(baseRealizadoPesquisada.filtros || {}),
          transportadora: transportadoraRealizado,
          transportadoraTabelaUsada: transportadoraRealizado,
          recalculoMesmaBase: true,
          recalculadoEm: new Date().toISOString(),
        },
        cidadePorIbge: mapaCidades,
        gradePorCanal: grade,
        municipioPorCidade,
      });

      setResultadoRealizado({
        ...resultado,
        filtros: {
          ...(baseRealizadoPesquisada.filtros || {}),
          transportadora: transportadoraRealizado,
          transportadoraTabelaUsada: transportadoraRealizado,
          canal: canalRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoFiltroRealizado.length ? ufsDestinoFiltroRealizado : (baseRealizadoPesquisada.filtros?.ufDestino || []),
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          recalculoMesmaBase: true,
          recalculadoEm: new Date().toISOString(),
          ctesNaMalha: baseRealizadoPesquisada.rowsFiltrados.length,
          ctesBaseSimulada: baseRealizadoPesquisada.rowsFiltrados.length,
          tabelasBaseSelecionada: baseSelecionada.length,
          fonteTabela: 'recalculo_mesma_base',
        },
      });
      finalizarProcessamentoUi('Recalculo concluído', 'A mesma base de CT-es foi recalculada com a tabela atualizada.', 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao recalcular com a mesma base.');
      finalizarProcessamentoUi('Erro no recalculo', 'Não foi possível recalcular com a base pesquisada.', 100);
    }
  };

  const onPesquisarRealizado = async () => {
    if (!transportadoraRealizado) {
      setErroSimulacao('Selecione a transportadora/tabela antes de pesquisar os CT-es.');
      return;
    }

    setPesquisandoRealizado(true);
    setCarregandoSimulacao(true);
    setResultadoRealizado(null);
    setBaseRealizadoPesquisada(null);
    setResumoPesquisaRealizado(null);
    setFiltroDetalhe('');
    setPaginaDetalhe(0);
    setLinhasExpandidas(new Set());
    iniciarProcessamentoUi('Pesquisar CT-es', 'Localizando tabela/malha selecionada...', 8);

    try {
      atualizarProcessamentoUi('Carregando vínculos de transportadoras...', 12);
      const mapaVinculos = await carregarMapaVinculosSimulador();
      const ehNegociacaoSelecionada = nomesNegociacaoRealizado.includes(transportadoraRealizado);
      const nomeTabelaSelecionada = ehNegociacaoSelecionada
        ? transportadoraRealizado
        : mapaVinculos.get(normalizarChaveSimulador(transportadoraRealizado))
          || mapaVinculos.get(String(transportadoraRealizado || '').toUpperCase())
          || transportadoraRealizado;

      atualizarProcessamentoUi('Buscando malha/tabela selecionada...', 18);
      let baseSelecionada = [];

      if (ehNegociacaoSelecionada) {
        baseSelecionada = transportadorasNegociacaoRealizado.filter((item) =>
          normalizarTransportadoraSimulador(item.nome) === normalizarTransportadoraSimulador(nomeTabelaSelecionada)
          || transportadoraCompativelSimulador(item.nome, nomeTabelaSelecionada)
        );
      } else {
        const baseJaCarregada = basesMalhaRealizadoSelecionada.length
          ? filtrarBasePorTransportadoraSimulador(basesMalhaRealizadoSelecionada, transportadoraRealizado)
          : [];

        const precisaBuscarMalha = !baseJaCarregada.length || origemRealizado || ufsDestinoFiltroRealizado.length;
        if (precisaBuscarMalha) {
          const baseOficial = await carregarBaseOnlinePorUfDestino({
            nomeTransportadora: nomeTabelaSelecionada,
            canal: canalRealizado,
            origem: origemRealizado || '',
            ufDestino: ufsDestinoFiltroRealizado,
          });
          baseSelecionada = filtrarBasePorTransportadoraSimulador(baseOficial, nomeTabelaSelecionada);
        }

        if (!baseSelecionada.length && baseJaCarregada.length) baseSelecionada = baseJaCarregada;
      }

      if (!baseSelecionada.length) {
        setErroSimulacao('Tabela/malha não localizada para a transportadora selecionada. Revise canal, transportadora e cadastro da tabela antes de simular.');
        finalizarProcessamentoUi('Tabela não localizada', 'Não foi possível carregar a malha para esta seleção.', 100);
        return;
      }

      const origensTabelaSelecionada = extrairOrigensBaseSimulador(baseSelecionada, canalRealizado);
      const ufsDestinoTabelaSelecionada = extrairUfsDestinoBaseSimulador(baseSelecionada, canalRealizado, origemRealizado);
      const origensFiltroEfetivo = origemRealizado ? [] : origensTabelaSelecionada;
      const ufsDestinoEfetivasRealizado = ufsDestinoFiltroRealizado.length
        ? ufsDestinoFiltroRealizado
        : ufsDestinoTabelaSelecionada;

      atualizarProcessamentoUi('Tabela localizada. Buscando CT-es realizados — página 1...', 26);
      const rowsBrutos = await buscarRealizadoLocalCtesExpandido({
        canal: canalRealizado,
        origem: origemRealizado,
        origens: origensFiltroEfetivo,
        destino: destinoRealizado,
        ufOrigem: ufOrigemRealizado,
        ufDestino: ufsDestinoEfetivasRealizado,
        inicio: inicioRealizado,
        fim: fimRealizado,
        limit: limiteRealizado,
      }, (qtd) => {
        atualizarProcessamentoUi(`Buscando CT-es realizados... ${qtd.toLocaleString('pt-BR')} carregados`, Math.min(42, 26 + Math.floor(qtd / 500)));
      });

      if (!rowsBrutos.length) {
        setErroSimulacao('Nenhum CT-e encontrado para os filtros informados. Revise canal, período, origem, destino e UF.');
        finalizarProcessamentoUi('Nenhum CT-e encontrado', 'A tabela foi localizada, mas a busca de CT-es retornou zero.', 100);
        return;
      }

      const rowsBrutosFiltrados = aplicarFiltrosPadraoRealizadoSim(rowsBrutos, {
        incluirCpsLog: incluirCpsLogRealizado,
      });

      atualizarProcessamentoUi('Resolvendo IBGE e aplicando vínculos...', 48);
      const rowsComIbgeBaseAntesCps = rowsBrutosFiltrados.map((row) => {
        const ibgeDestino = resolverIbgeRealizadoPorCidade(row, 'destino', municipioPorCidade);
        const ibgeOrigem = resolverIbgeRealizadoPorCidade(row, 'origem', municipioPorCidade);
        const nomeOriginal = String(row.transportadora || '').trim();
        const nomeVinculado = mapaVinculos.get(normalizarChaveSimulador(nomeOriginal)) || mapaVinculos.get(nomeOriginal.toUpperCase()) || nomeOriginal;
        return { ...row, ibgeOrigem, ibgeDestino, transportadora: nomeVinculado };
      });

      const rowsComIbgeBase = filtrarCpsLogRealizadoSim(rowsComIbgeBaseAntesCps, incluirCpsLogRealizado);

      atualizarProcessamentoUi('Cruzando CT-es com Tracking...', 62);
      const mapasTracking = await buscarTrackingParaRealizado(rowsComIbgeBase);
      const trackingEnriquecido = enriquecerRealizadoComTracking(rowsComIbgeBase, mapasTracking);
      const linhasEnriquecidasFiltradas = filtrarCpsLogRealizadoSim(trackingEnriquecido.linhas || [], incluirCpsLogRealizado);
      const rowsComTracking = linhasEnriquecidasFiltradas.filter((row) => row.trackingMatch);
      const rowsComIbge = baseRealizadoTracking === 'com_tracking'
        ? rowsComTracking
        : linhasEnriquecidasFiltradas;

      if (baseRealizadoTracking === 'com_tracking' && !rowsComIbge.length) {
        setErroSimulacao('Nenhum CT-e encontrou vínculo com Tracking. A tabela foi localizada e os CT-es foram buscados, mas a base final ficou zerada no Tracking.');
        finalizarProcessamentoUi('Sem CT-es com Tracking', 'Revise carga de Tracking ou altere temporariamente para Todos os CT-es.', 100);
        return;
      }

      const payloadPesquisa = {
        mapaVinculos,
        ehNegociacaoSelecionada,
        nomeTabelaSelecionada,
        baseSelecionada,
        origensTabelaSelecionada,
        ufsDestinoTabelaSelecionada,
        origensFiltroEfetivo,
        ufsDestinoEfetivasRealizado,
        rowsBrutos,
        rowsComIbgeBaseAntesCps,
        rowsComIbgeBase,
        mapasTracking,
        trackingEnriquecido,
        linhasEnriquecidasFiltradas,
        rowsComTracking,
        rows: rowsComIbge,
        filtros: {
          canal: canalRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          baseRealizadoTracking,
          incluirCpsLogRealizado,
        },
      };

      setBaseRealizadoPesquisada(payloadPesquisa);
      setResumoPesquisaRealizado(montarResumoPesquisaRealizado(payloadPesquisa));
      setFiltrosPesquisaRealizado(JSON.stringify(payloadPesquisa.filtros));
      setErroSimulacao('');
      finalizarProcessamentoUi('Pesquisa concluída', 'Base de CT-es localizada e pronta para simular/calcular.', 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao pesquisar CT-es do realizado.');
      finalizarProcessamentoUi('Erro na pesquisa de CT-es', 'Não foi possível montar a base para simulação.', 100);
    } finally {
      setPesquisandoRealizado(false);
      setCarregandoSimulacao(false);
    }
  };

  const onSimularRealizado = async () => {
    if (!transportadoraRealizado) {
      setErroSimulacao('Selecione a transportadora/tabela que será simulada no realizado.');
      return;
    }

    setCarregandoSimulacao(true);
    setFiltroDetalhe('');
    setPaginaDetalhe(0);
    setLinhasExpandidas(new Set());
    iniciarProcessamentoUi('Simular / Calcular', 'Calculando sobre a base de CT-es já pesquisada...', 8);

    try {
      if (!baseRealizadoPesquisada?.rows?.length) {
        setErroSimulacao('Pesquise os CT-es antes de simular. Primeiro valide a base encontrada e depois clique em Simular / Calcular.');
        finalizarProcessamentoUi('Pesquisa obrigatória', 'A simulação foi bloqueada porque não existe base de CT-es pesquisada.', 100);
        return;
      }

      atualizarProcessamentoUi('Usando base de CT-es já pesquisada...', 18);
      const pesquisa = baseRealizadoPesquisada;
      const mapaVinculos = pesquisa.mapaVinculos || new Map();
      const ehNegociacaoSelecionada = pesquisa.ehNegociacaoSelecionada;
      const nomeTabelaSelecionada = pesquisa.nomeTabelaSelecionada || transportadoraRealizado;
      const baseSelecionada = pesquisa.baseSelecionada || [];
      const origensTabelaSelecionada = pesquisa.origensTabelaSelecionada || [];
      const ufsDestinoTabelaSelecionada = pesquisa.ufsDestinoTabelaSelecionada || [];
      const origensFiltroEfetivo = pesquisa.origensFiltroEfetivo || [];
      const ufsDestinoEfetivasRealizado = pesquisa.ufsDestinoEfetivasRealizado || [];
      const rowsBrutos = pesquisa.rowsBrutos || [];
      const rowsComIbgeBaseAntesCps = pesquisa.rowsComIbgeBaseAntesCps || [];
      const rowsComIbgeBase = pesquisa.rowsComIbgeBase || [];
      const mapasTracking = pesquisa.mapasTracking || { total: 0 };
      const trackingEnriquecido = pesquisa.trackingEnriquecido || { linhas: [], vinculados: 0, semTracking: 0 };
      const linhasEnriquecidasFiltradas = pesquisa.linhasEnriquecidasFiltradas || [];
      const rowsComTracking = pesquisa.rowsComTracking || linhasEnriquecidasFiltradas.filter((row) => row.trackingMatch);
      const rowsComIbge = pesquisa.rows || [];

      if (!rowsComIbge.length) {
        setErroSimulacao('A base pesquisada está vazia. Pesquise os CT-es novamente antes de simular.');
        finalizarProcessamentoUi('Base pesquisada vazia', 'Não há CT-es disponíveis para cálculo.', 100);
        return;
      }

      atualizarProcessamentoUi('Aplicando malha da transportadora/tabela selecionada...', 46);

      const origensMalha = new Set(
        baseSelecionada
          .flatMap((t) => (t.origens || []).map((o) => normalizarChaveSimulador(o.cidade)))
          .filter(Boolean)
      );

      // Diagnóstico de normalização da malha
      const origemMalhaNaoReconhecida = new Set();
      const aplicarFiltroOrigemMalha = modoRealizado === 'malha' && !origemRealizado && origensMalha.size;
      const rowsFiltrados = aplicarFiltroOrigemMalha
        ? rowsComIbge.filter((row) => {
            const origemNorm = normalizarChaveSimulador(row.cidadeOrigem);
            const ok = origensMalha.has(origemNorm);
            if (!ok && row.cidadeOrigem) origemMalhaNaoReconhecida.add(row.cidadeOrigem);
            return ok;
          })
        : rowsComIbge;

      setBaseRealizadoPesquisada({
        criadoEm: new Date().toISOString(),
        rowsFiltrados,
        filtros: {
          canal: canalRealizado,
          modo: modoRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          ufDestinoSelecionado: ufsDestinoFiltroRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          ctesNaMalha: rowsFiltrados.length,
          ctesBaseSimulada: rowsComIbge.length,
          baseRealizadoTracking,
          incluirCpsLog: incluirCpsLogRealizado,
        },
      });

      setBaseRealizadoPesquisada({
        criadoEm: new Date().toISOString(),
        rowsFiltrados,
        filtros: {
          canal: canalRealizado,
          modo: modoRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          ufDestinoSelecionado: ufsDestinoFiltroRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          ctesNaMalha: rowsFiltrados.length,
          ctesBaseSimulada: rowsComIbge.length,
          baseRealizadoTracking,
          incluirCpsLog: incluirCpsLogRealizado,
        },
      });

      setBaseRealizadoPesquisada({
        criadoEm: new Date().toISOString(),
        rowsFiltrados,
        filtros: {
          canal: canalRealizado,
          modo: modoRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          ufDestinoSelecionado: ufsDestinoFiltroRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          ctesNaMalha: rowsFiltrados.length,
          ctesBaseSimulada: rowsComIbge.length,
          baseRealizadoTracking,
          incluirCpsLog: incluirCpsLogRealizado,
        },
      });

      setBaseRealizadoPesquisada({
        criadoEm: new Date().toISOString(),
        rowsFiltrados,
        filtros: {
          canal: canalRealizado,
          modo: modoRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          ufDestinoSelecionado: ufsDestinoFiltroRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          ctesNaMalha: rowsFiltrados.length,
          ctesBaseSimulada: rowsComIbge.length,
          baseRealizadoTracking,
          incluirCpsLog: incluirCpsLogRealizado,
        },
      });

      setBaseRealizadoPesquisada({
        criadoEm: new Date().toISOString(),
        rowsFiltrados,
        filtros: {
          canal: canalRealizado,
          modo: modoRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          ufDestinoSelecionado: ufsDestinoFiltroRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          ctesNaMalha: rowsFiltrados.length,
          ctesBaseSimulada: rowsComIbge.length,
          baseRealizadoTracking,
          incluirCpsLog: incluirCpsLogRealizado,
        },
      });

      const routeKeysRealizado = criarRouteKeysRealizado(rowsFiltrados, canalRealizado);
      const deveCompararConcorrentes = Boolean(compararConcorrentesRealizado);
      const basesParaMesclar = [baseSelecionada].filter((base) => Array.isArray(base) ? base.length : Boolean(base));

      // Só adiciona negociações como concorrentes quando os dois flags estiverem marcados.
      // Com "Comparar com tabelas oficiais/concorrentes" desmarcado, a simulação fica leve:
      // tabela selecionada x CT-es realizados.
      if (deveCompararConcorrentes && incluirNegociacoesRealizado && transportadorasNegociacaoRealizado.length) {
        basesParaMesclar.push(transportadorasNegociacaoRealizado);
      }
      let baseRotas = [];

      if (deveCompararConcorrentes && routeKeysRealizado.length) {
        atualizarProcessamentoUi(`Buscando concorrentes por ${routeKeysRealizado.length.toLocaleString('pt-BR')} rota(s) reais...`, 58);
        baseRotas = await buscarBaseSimulacaoPorRotasDb({
          routeKeys: routeKeysRealizado.slice(0, 5000),
          canal: canalRealizado,
        });
        if (Array.isArray(baseRotas) && baseRotas.length) basesParaMesclar.push(baseRotas);
      }

      // Fallback principal: usa o mesmo caminho que já funcionou na Análise por Origem.
      // Isso evita zerar quando o CT-e não possui IBGE de origem ou quando a busca por rota exata não acha concorrentes.
      const origensParaBuscar = valoresUnicosValidos([
        origemRealizado,
        ...rowsFiltrados.map((row) => row.cidadeOrigem),
        ...baseSelecionada.flatMap((t) => (t.origens || []).map((o) => o.cidade)),
      ]).slice(0, 20);

      let basesOrigemCarregadas = 0;
      if (deveCompararConcorrentes) {
        for (let idx = 0; idx < origensParaBuscar.length; idx += 1) {
          const origemBusca = origensParaBuscar[idx];
          atualizarProcessamentoUi(`Buscando tabelas concorrentes da origem ${origemBusca}...`, Math.min(72, 60 + idx));
          const baseOrigem = await carregarBaseOnlinePorUfDestino({
            canal: canalRealizado,
            origem: origemBusca,
            ufDestino: ufsDestinoEfetivasRealizado,
          });
          if (Array.isArray(baseOrigem) && baseOrigem.length) {
            basesOrigemCarregadas += baseOrigem.length;
            basesParaMesclar.push(baseOrigem);
          }
        }
      } else {
        atualizarProcessamentoUi('Simulando somente a negociação selecionada contra o realizado...', 72);
      }

      let baseParaSimulacao = mesclarBasesTransportadorasSimulador(basesParaMesclar);

      if (!baseParaSimulacao.length) {
        setErroSimulacao('Não encontrei nenhuma tabela compatível para simular. Confira se as tabelas estão no Supabase e se a origem/canal existem no cadastro.');
        setResultadoRealizado(simularRealizadoComTabela({
          rows: rowsFiltrados,
          baseOnline: [],
          transportadoraSelecionada: nomeTabelaSelecionada,
          filtros: {
            canal: canalRealizado,
            origem: origemRealizado,
            destino: destinoRealizado,
            ufOrigem: ufOrigemRealizado,
            ufDestino: ufsDestinoEfetivasRealizado,
            inicio: inicioRealizado,
            fim: fimRealizado,
            modo: modoRealizado,
          },
          cidadePorIbge: cidadePorIbgeCompleto,
          gradePorCanal: grade,
          municipioPorCidade,
        }));
        finalizarProcessamentoUi('Sem tabelas para simular', 'O realizado foi carregado, mas não há tabela concorrente disponível.', 100);
        return;
      }

      const lookupOnline = buildLookupTables(baseParaSimulacao);
      const mapaCidades = new Map(cidadePorIbgeCompleto);
      (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));

      atualizarProcessamentoUi(deveCompararConcorrentes ? 'Simulando CT-e a CT-e contra a tabela selecionada e concorrentes...' : 'Simulando CT-e a CT-e contra a tabela selecionada e o realizado...', 82);
      const resultado = simularRealizadoComTabela({
        rows: rowsFiltrados,
        baseOnline: baseParaSimulacao,
        transportadoraSelecionada: nomeTabelaSelecionada,
        filtros: {
          canal: canalRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          ufDestinoSelecionado: ufsDestinoFiltroRealizado,
          ufDestinoPadraoTabela: ufsDestinoFiltroRealizado.length ? [] : ufsDestinoEfetivasRealizado,
          origensPadraoTabela: origemRealizado ? [] : origensFiltroEfetivo,
          inicio: inicioRealizado,
          fim: fimRealizado,
          modo: modoRealizado,
        },
        cidadePorIbge: mapaCidades,
        gradePorCanal: grade,
        municipioPorCidade,
      });

      setResultadoRealizado({
        ...resultado,
        filtros: {
          transportadora: transportadoraRealizado,
          transportadoraTabelaUsada: nomeTabelaSelecionada,
          canal: canalRealizado,
          modo: modoRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          ufDestinoSelecionado: ufsDestinoFiltroRealizado,
          ufDestinoPadraoTabela: ufsDestinoFiltroRealizado.length ? [] : ufsDestinoEfetivasRealizado,
          origensPadraoTabela: origemRealizado ? [] : origensFiltroEfetivo,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          ctesBrutos: rowsBrutos.length,
          ctesAposFiltroPadrao: rowsComIbgeBase.length,
          ctesRemovidosFiltroPadrao: Math.max(0, rowsBrutos.length - rowsComIbgeBase.length),
          ctesRemovidosCpsAposVinculo: Math.max(0, rowsComIbgeBaseAntesCps.length - rowsComIbgeBase.length),
          incluirCpsLog: incluirCpsLogRealizado,
          baseRealizadoTracking,
          ctesComTracking: trackingEnriquecido.vinculados,
          ctesSemTracking: trackingEnriquecido.semTracking,
          ctesBaseSimulada: rowsComIbge.length,
          ctesNaMalha: rowsFiltrados.length,
          origemMalhaNaoReconhecida: [...origemMalhaNaoReconhecida].slice(0, 20),
          trackingVinculados: trackingEnriquecido.vinculados,
          trackingSemVinculo: trackingEnriquecido.semTracking,
          trackingCubagemOutliers: trackingEnriquecido.cubagemOutliers,
          trackingTotalEncontrado: mapasTracking.total,
          trackingErro: trackingEnriquecido.erroTracking,
          volumesTracking: trackingEnriquecido.volumesTracking,
          cubagemTracking: trackingEnriquecido.cubagemTracking,
          rotasReaisComIbge: routeKeysRealizado.length,
          tabelasCarregadas: baseParaSimulacao.length,
          tabelasBaseSelecionada: baseSelecionada.length,
          tabelasBaseRotas: Array.isArray(baseRotas) ? baseRotas.length : 0,
          tabelasBaseOrigem: basesOrigemCarregadas,
          origensBuscadas: origensParaBuscar.join(', '),
          fonteTabela: 'selecionada_rotas_origens',
        },
      });

      finalizarProcessamentoUi('Simulação do realizado concluída', 'Dossiê gerado com projeção, saving e rotas prioritárias.', 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao simular realizado.');
      finalizarProcessamentoUi('Erro na simulação do realizado', 'Não foi possível gerar o dossiê.', 100);
    } finally {
      setCarregandoSimulacao(false);
    }
  };

  const exportarSimuladorRealizado = () => {
    if (!resultadoRealizado?.rotas?.length) return;
    const linhas = [
      ['Resumo', 'Valor'],
      ['Transportadora simulada', resultadoRealizado.filtros?.transportadora || ''],
      ['CT-es analisados', resultadoRealizado.ctesAnalisados],
      ['CT-es simulados', resultadoRealizado.ctesSimulados],
      ['CT-es com tabela selecionada', resultadoRealizado.ctesComTabelaSelecionada],
      ['CT-es que ganharia', resultadoRealizado.ctesGanhariaSelecionada],
      ['CT-es perdidos', resultadoRealizado.ctesPerdidosSelecionada],
      ['Aderência %', resultadoRealizado.aderenciaSelecionada.toFixed(2)],
      ['Frete realizado', resultadoRealizado.freteRealizado.toFixed(2)],
      ['Faturamento tabela selecionada', resultadoRealizado.freteSelecionada.toFixed(2)],
      ['Faturamento mensal projetado', resultadoRealizado.faturamentoSelecionadaMes.toFixed(2)],
      ['Faturamento 12 meses projetado', resultadoRealizado.faturamentoSelecionadaAno.toFixed(2)],
      ['Saving ganhadora vs realizado', resultadoRealizado.savingSelecionadaVsReal.toFixed(2)],
      ['Saving tabela amplo', Number(resultadoRealizado.savingTabelaSelecionadaVsRealBruto || 0).toFixed(2)],
      ['Saving mercado', Number(resultadoRealizado.savingVencedorVsReal || 0).toFixed(2)],
      ['Saving 12 meses ganhadora', resultadoRealizado.savingSelecionadaVsRealAno.toFixed(2)],
      ['Tracking vinculados', Number(resultadoRealizado.linhasComTracking || 0).toFixed(0)],
      [],
      ['Rotas', 'Origem', 'Destino', 'Tipo', 'CT-es', 'Volumes', 'Peso', 'Valor NF', 'Frete realizado', 'Frete tabela selecionada', 'Frete vencedor', 'Saving selecionada', 'Diferença para vencedor', 'Redução média necessária %', 'Principal vencedor', 'Concorrentes médio'],
      ...resultadoRealizado.rotas.map((item) => [
        'Rota', item.origem, item.destino, item.tipo, item.ctes, item.volumes, item.peso.toFixed(2), item.valorNF.toFixed(2), item.freteRealizado.toFixed(2), item.freteSelecionada.toFixed(2), item.freteVencedor.toFixed(2), item.savingSelecionada.toFixed(2), item.diferencaParaVencedor.toFixed(2), item.reducaoMediaNecessaria.toFixed(2), item.principalVencedor, item.concorrentesMedio.toFixed(2),
      ]),
    ];

    const nomeBase = (resultadoRealizado.filtros?.transportadora || 'realizado').toLowerCase().replace(/[^a-z0-9]+/gi, '-');
    const { nomeArquivo, csv } = exportarLinhasCsv(`simulador-realizado-${nomeBase}.csv`, linhas);
    downloadCsv(nomeArquivo, csv);
  };

  // ── Relatório Fornecedor: Tabela Selecionada × Realizado (SEM concorrentes) ──
  const exportarRelatorioFornecedorVsRealizado = () => {
    if (!resultadoRealizado?.ctesAnalisados) return;
    const r = resultadoRealizado;
    const transp = r.filtros?.transportadora || 'Transportadora';
    const periodo = `${r.filtros?.inicio || ''} a ${r.filtros?.fim || ''}`;

    // Métricas globais tabela vs realizado
    const cteComTabela = (r.ctesDetalhes || []).filter((i) => i.freteSelecionada > 0);
    const totalRealizado = cteComTabela.reduce((acc, i) => acc + (i.freteRealizado || 0), 0);
    const totalTabela = cteComTabela.reduce((acc, i) => acc + (i.freteSelecionada || 0), 0);
    const totalDiferenca = totalRealizado - totalTabela;
    const qtdMaisBarata = cteComTabela.filter((i) => i.ganhouRealizado).length;
    const qtdMaisCara = cteComTabela.filter((i) => !i.ganhouRealizado).length;

    // Rotas: agrupa por rota usando ctesDetalhes
    const rotaMap = new Map();
    cteComTabela.forEach((item) => {
      const chave = `${item.origem}/${item.ufOrigem} → ${item.destino}/${item.ufDestino}`;
      const d = rotaMap.get(chave) || { rota: chave, ctes: 0, realizado: 0, tabela: 0, maisBarata: 0, maisCara: 0, volumesTotais: 0, pesoTotal: 0 };
      d.ctes += 1;
      d.realizado += item.freteRealizado || 0;
      d.tabela += item.freteSelecionada || 0;
      d.volumesTotais += item.volumes || 0;
      d.pesoTotal += item.peso || 0;
      if (item.ganhouRealizado) d.maisBarata += 1; else d.maisCara += 1;
      rotaMap.set(chave, d);
    });
    const rotasFornecedor = [...rotaMap.values()]
      .map((d) => ({ ...d, diferenca: d.realizado - d.tabela, pctDiferenca: d.realizado > 0 ? ((d.realizado - d.tabela) / d.realizado) * 100 : 0 }))
      .sort((a, b) => b.tabela - a.tabela);

    const linhas = [
      ['ANÁLISE DE TABELA DE FRETE — COMPARATIVO COM REALIZADO'],
      ['Empresa:', 'Central Fretes'],
      ['Transportadora:', transp],
      ['Tabela usada:', r.filtros?.transportadoraTabelaUsada || transp],
      ['Canal:', r.filtros?.canal || ''],
      ['Período:', periodo],
      ['Data do relatório:', new Date().toLocaleDateString('pt-BR')],
      [],
      ['VISÃO GERAL'],
      ['CT-es com tabela para comparação', cteComTabela.length],
      ['CT-es em que a tabela é mais competitiva que o praticado', qtdMaisBarata],
      ['CT-es em que a tabela é menos competitiva que o praticado', qtdMaisCara],
      ['Percentual de rotas competitivas (%)', cteComTabela.length ? ((qtdMaisBarata / cteComTabela.length) * 100).toFixed(2) : 0],
      [],
      ['VALORES TOTAIS'],
      ['Frete total praticado no período (realizado)', totalRealizado.toFixed(2)],
      ['Frete total pela tabela simulada', totalTabela.toFixed(2)],
      ['Diferença total (positivo = tabela mais barata)', totalDiferenca.toFixed(2)],
      ['Diferença % sobre realizado', totalRealizado > 0 ? ((totalDiferenca / totalRealizado) * 100).toFixed(2) + '%' : ''],
      ['Faturamento mensal projetado (tabela)', r.meses ? (totalTabela / r.meses).toFixed(2) : totalTabela.toFixed(2)],
      ['Faturamento 12 meses projetado (tabela)', r.meses ? ((totalTabela / r.meses) * 12).toFixed(2) : ''],
      [],
      ['RESUMO POR ROTA'],
      ['Rota', 'CT-es', 'Volumes', 'Peso (kg)', 'Frete realizado', 'Frete tabela', 'Diferença', 'Diferença %', 'CT-es tabela mais competitiva', 'CT-es tabela menos competitiva'],
      ...rotasFornecedor.map((d) => [
        d.rota, d.ctes,
        Number(d.volumesTotais).toLocaleString('pt-BR'),
        d.pesoTotal.toFixed(2),
        d.realizado.toFixed(2),
        d.tabela.toFixed(2),
        d.diferenca.toFixed(2),
        d.pctDiferenca.toFixed(2) + '%',
        d.maisBarata,
        d.maisCara,
      ]),
      [],
      ['DETALHE CT-E A CT-E'],
      ['CT-e', 'Data', 'Origem', 'Destino', 'Transp. atual', 'Peso (kg)', 'Cubagem (m³)', 'Valor NF', 'Volumes', 'Frete realizado', '% NF realizado', 'Frete tabela', '% NF tabela', 'Diferença', 'Diferença %', 'Resultado'],
      ...cteComTabela.map((item) => {
        const diferenca = (item.freteRealizado || 0) - (item.freteSelecionada || 0);
        const pctDif = item.freteRealizado > 0 ? (diferenca / item.freteRealizado) * 100 : 0;
        return [
          item.cte || '',
          item.data ? String(item.data).slice(0, 10) : '',
          `${item.origemUsada || item.origem}/${item.ufOrigem}`,
          `${item.destino}/${item.ufDestino}`,
          item.transportadoraReal || '',
          (item.peso || 0).toFixed(2),
          (item.cubagem || 0).toFixed(4),
          (item.valorNF || 0).toFixed(2),
          Number(item.volumes || 0).toLocaleString('pt-BR'),
          (item.freteRealizado || 0).toFixed(2),
          item.percentualFreteRealizado ? item.percentualFreteRealizado.toFixed(2) + '%' : '',
          (item.freteSelecionada || 0).toFixed(2),
          item.percentualFreteSelecionada ? item.percentualFreteSelecionada.toFixed(2) + '%' : '',
          diferenca.toFixed(2),
          pctDif.toFixed(2) + '%',
          item.ganhouRealizado ? 'Tabela mais competitiva' : 'Tabela menos competitiva',
        ];
      }),
    ];

    const nomeBase = transp.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
    const { nomeArquivo, csv } = exportarLinhasCsv(`fornecedor-vs-realizado-${nomeBase}.csv`, linhas);
    downloadCsv(nomeArquivo, csv);
  };

  const copiarTextoLaudo = async (texto, label) => {
    if (!texto) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = texto;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setFeedbackCopiaLaudo(`${label} copiado.`);
      window.setTimeout(() => setFeedbackCopiaLaudo(''), 2500);
    } catch {
      setFeedbackCopiaLaudo('Não foi possível copiar automaticamente.');
      window.setTimeout(() => setFeedbackCopiaLaudo(''), 3000);
    }
  };

  const imprimirLaudoVisualIsolado = () => {
    const laudo = document.querySelector('.modal-overlay .laudo-page');
    if (!laudo) {
      window.print();
      return;
    }

    const estilos = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((node) => node.outerHTML)
      .join('\n');
    const janela = window.open('', '_blank', 'width=1000,height=900');
    if (!janela) {
      window.print();
      return;
    }

    janela.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Laudo de competitividade</title>
          ${estilos}
          <style>
            body { margin: 0; background: #fff; }
            .laudo-page { box-shadow: none !important; border-radius: 0 !important; max-width: none !important; width: 100% !important; }
          </style>
        </head>
        <body>${laudo.outerHTML}</body>
      </html>`);
    janela.document.close();
    janela.focus();
    setTimeout(() => {
      janela.print();
      janela.close();
    }, 250);
  };

  const clonarLaudoComEstiloInline = (origem) => {
    const clone = origem.cloneNode(true);
    const copiarEstilos = (noOriginal, noClone) => {
      if (!noOriginal || !noClone || noOriginal.nodeType !== 1 || noClone.nodeType !== 1) return;
      const estilos = window.getComputedStyle(noOriginal);
      let css = '';
      for (let i = 0; i < estilos.length; i += 1) {
        const prop = estilos[i];
        css += `${prop}:${estilos.getPropertyValue(prop)};`;
      }
      noClone.setAttribute('style', `${noClone.getAttribute('style') || ''};${css}`);
      Array.from(noOriginal.children || []).forEach((filho, index) => {
        copiarEstilos(filho, noClone.children[index]);
      });
    };

    copiarEstilos(origem, clone);
    clone.setAttribute('contenteditable', 'true');
    clone.setAttribute('spellcheck', 'true');
    clone.style.outline = 'none';
    return clone;
  };

  const baixarLaudoVisualHtml = () => {
    const laudo = document.querySelector('.modal-overlay .laudo-page');
    if (!laudo) return;

    const clone = clonarLaudoComEstiloInline(laudo);
    const tipo = laudoVisualAberto === 'transportador' ? 'transportador' : 'diretoria';
    const transportadora = resultadoRealizado?.filtros?.transportadora || 'transportadora';
    const nomeArquivo = `laudo-${tipo}-${nomeArquivoSeguro(transportadora)}.html`;
    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Laudo ${tipo} - ${transportadora}</title>
  <style>
    body { margin: 0; background: #f4f6fa; color: #0f172a; font-family: Arial, sans-serif; }
    .laudo-export-shell { padding: 24px; }
    .laudo-page { box-shadow: 0 0 30px rgba(15, 23, 42, 0.12) !important; }
    .laudo-page[contenteditable="true"]:focus { outline: 3px solid #93c5fd; outline-offset: 4px; }
    @media print {
      body { background: #fff; }
      .laudo-export-shell { padding: 0; }
      .laudo-page { box-shadow: none !important; border-radius: 0 !important; max-width: none !important; width: 100% !important; }
    }
  </style>
</head>
<body>
  <main class="laudo-export-shell">
    ${clone.outerHTML}
  </main>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const exportarLaudoEmailRealizado = (tipo = abaLaudoRealizado) => {
    const pacote = laudosEmailRealizado?.[tipo];
    if (!resultadoRealizado?.ctesAnalisados || !pacote) return;
    const meta = laudosEmailRealizado.meta || {};
    const interno = tipo === 'diretoria';
    const linhasResumo = [
      ['Central Fretes / Simulador de Fretes'],
      [pacote.titulo],
      ['Transportadora', meta.transportadora || resultadoRealizado.filtros?.transportadora || ''],
      ['Período analisado', meta.periodo || periodoLaudoRealizado(resultadoRealizado)],
      ['Data de geração', meta.dataGeracao || new Date().toLocaleDateString('pt-BR')],
      [],
      ['Assunto sugerido'],
      [pacote.assunto],
      [],
      ['Corpo do e-mail'],
      ...pacote.corpo.split('\n').map((linha) => [linha]),
      [],
      ['Principais indicadores'],
      ['Indicador', 'Valor'],
      ...(pacote.kpis || []),
      [],
      ['Principais rotas ganhas'],
      ['Rota', 'CT-es ganhos', 'Faturamento ganho', interno ? 'Saving' : 'Observação', 'Aderência rota'],
      ...(pacote.rotasGanhas || []).map((item) => [
        item.rota || '',
        Number(item.qtdGanhasSelecionada || 0),
        interno ? Number(item.freteSelecionadaGanhadora || 0) : '',
        interno ? Number(item.savingGanhasSelecionada || item.savingSelecionada || 0) : 'Boa competitividade no recorte analisado',
        `${Number(item.qtdComSelecionada || 0) ? ((Number(item.qtdGanhasSelecionada || 0) / Number(item.qtdComSelecionada || 1)) * 100).toFixed(2) : '0.00'}%`,
      ]),
      [],
      ['Principais rotas perdidas'],
      ['Rota', 'CT-es perdidos', interno ? 'Diferença para vencedor' : 'Direcional', 'Redução média necessária', 'Principal referência'],
      ...(pacote.rotasPerdidas || []).map((item) => [
        item.rota || '',
        Number(item.qtdPerdidasSelecionada || item.ctes || 0),
        interno ? Number(item.diferencaParaVencedor || 0) : 'Revisar competitividade comercial',
        `${Number(item.reducaoMediaNecessaria || 0).toFixed(2)}%`,
        item.principalVencedor || '-',
      ]),
      [],
      ['Resumo por estado'],
      ['UF', 'CT-es ganhos', 'CT-es perdidos', 'Aderência', interno ? 'Faturamento ganho' : 'Direcional'],
      ...(pacote.estados || []).map((item) => [
        item.uf || '',
        Number(item.ctesGanhas || 0),
        Number(item.ctesPerdidas || 0),
        `${Number(item.aderencia || 0).toFixed(2)}%`,
        interno ? Number(item.freteSelecionadaGanhas || 0) : 'Priorizar rotas com maior volume e menor aderência',
      ]),
      [],
      ['Observações'],
      [pacote.observacaoCubagem || 'Não disponível'],
      [],
      ['Rodapé'],
      ['Análise gerada pelo sistema Central Fretes / Simulador de Fretes.'],
    ];

    if (interno && (pacote.perdasTransportadoras || []).length) {
      linhasResumo.push(
        [],
        ['Transportadoras atuais com maior perda projetada'],
        ['Transportadora', 'CT-es cedidos', 'Faturamento cedido', 'Redução de faturamento'],
        ...(pacote.perdasTransportadoras || []).map((item) => [
          item.transportadora || '',
          Number(item.ctesCedidosSelecionada || 0),
          Number(item.freteCedidoSelecionada || 0),
          `${Number(item.reducaoFaturamentoPct || 0).toFixed(2)}%`,
        ])
      );
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(linhasResumo);
    ws['!cols'] = [{ wch: 38 }, { wch: 28 }, { wch: 24 }, { wch: 24 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, interno ? 'Diretoria' : 'Transportadora');
    const nomeBase = nomeArquivoSeguro(meta.transportadora || resultadoRealizado.filtros?.transportadora || 'transportadora');
    XLSX.writeFile(wb, `${interno ? 'laudo-diretoria' : 'laudo-transportadora'}-${nomeBase}.xlsx`);
  };

  const exportarRelatorioTransportadora = () => {
    if (laudosEmailRealizado?.transportadora) {
      exportarLaudoEmailRealizado('transportadora');
      return;
    }
    if (!resultadoRealizado?.ctesAnalisados) return;
    const r = resultadoRealizado;
    const transp = r.filtros?.transportadora || 'Transportadora';
    const linhas = [
      ['DEVOLUTIVA DE ANÁLISE DE TABELA DE FRETE'],
      ['Preparado por:', 'Central Fretes'],
      ['Transportadora analisada:', transp],
      ['Tabela usada na simulação:', r.filtros?.transportadoraTabelaUsada || transp],
      ['Canal:', r.filtros?.canal || ''],
      ['Período analisado:', `${r.filtros?.inicio || 'início'} a ${r.filtros?.fim || 'fim'}`],
      ['Data do relatório:', new Date().toLocaleDateString('pt-BR')],
      [],
      ['RESUMO EXECUTIVO'],
      ['CT-es analisados', r.ctesAnalisados],
      ['CT-es com sua tabela coberta', r.ctesComTabelaSelecionada],
      ['CT-es que você ganharia (melhor preço)', r.ctesGanhariaSelecionada],
      ['CT-es que você perderia para concorrentes', r.ctesPerdidosSelecionada],
      ['Aderência da tabela (%)', r.aderenciaSelecionada?.toFixed(2)],
      ['Período base (meses)', r.meses],
      [],
      ['PROJEÇÃO DE FATURAMENTO'],
      ['Faturamento projetado mensal (tabela)', r.faturamentoSelecionadaMes?.toFixed(2)],
      ['Faturamento projetado 12 meses (tabela)', r.faturamentoSelecionadaAno?.toFixed(2)],
      ['Faturamento nas rotas ganhas (período)', r.freteSelecionadaGanhadora?.toFixed(2)],
      ['Faturamento nas rotas perdidas (período)', (r.freteSelecionada - r.freteSelecionadaGanhadora)?.toFixed(2)],
      ['Redução média necessária para virar ganhadora (%)', r.reducaoMediaNecessaria?.toFixed(2)],
      [],
      ['ROTAS ONDE VOCÊ GANHA (oportunidade de crescimento)'],
      ['Rota', 'CT-es', 'Volumes', 'Faturamento tabela (período)', '% sobre NF', 'Faturamento mensal projetado'],
      ...(r.rotas || [])
        .filter((item) => item.savingSelecionada > 0 || item.qtdGanhasSelecionada > 0)
        .sort((a, b) => b.freteSelecionada - a.freteSelecionada)
        .map((item) => [
          item.rota, item.ctes, Number(item.volumes || 0).toLocaleString('pt-BR'),
          item.freteSelecionada?.toFixed(2),
          item.percentualFreteSelecionada?.toFixed(2) + '%',
          r.meses ? (item.freteSelecionada / r.meses)?.toFixed(2) : '',
        ]),
      [],
      ['ROTAS ONDE VOCÊ PERDE (oportunidade de ajuste)'],
      ['Rota', 'CT-es', 'Volumes', 'Faturamento tabela', 'Faturamento vencedor', 'Redução necessária (%)', 'Principal concorrente vencedor'],
      ...(r.rotas || [])
        .filter((item) => item.diferencaParaVencedor > 0)
        .sort((a, b) => b.diferencaParaVencedor - a.diferencaParaVencedor)
        .map((item) => [
          item.rota, item.ctes, Number(item.volumes || 0).toLocaleString('pt-BR'),
          item.freteSelecionada?.toFixed(2),
          item.freteVencedor?.toFixed(2),
          item.reducaoMediaNecessaria?.toFixed(2) + '%',
          item.principalVencedor || '-',
        ]),
      [],
      ['PARETO 80% — ROTAS PRIORITÁRIAS'],
      ['Rota', 'CT-es', 'Volumes', '% do volume total', '% acumulado', 'Faturamento tabela', 'Redução necessária (%)', 'Principal vencedor'],
      ...(r.pareto80Volume?.rotas || []).map((item) => [
        item.rota, item.ctes, Number(item.volumes || item.ctes || 0).toLocaleString('pt-BR'),
        item.pctVolume?.toFixed(2) + '%', item.pctAcumulado?.toFixed(2) + '%',
        item.freteSelecionada?.toFixed(2),
        item.reducaoMediaNecessaria?.toFixed(2) + '%',
        item.principalVencedor || '-',
      ]),
    ];
    const nomeBase = transp.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
    const { nomeArquivo, csv } = exportarLinhasCsv(`devolutiva-transportadora-${nomeBase}.csv`, linhas);
    downloadCsv(nomeArquivo, csv);
  };

  // ── Relatório para Diretoria (COM saving, linguagem estratégica) ──────────────
  const exportarRelatorioDiretoria = () => {
    if (laudosEmailRealizado?.diretoria) {
      exportarLaudoEmailRealizado('diretoria');
      return;
    }
    if (!resultadoRealizado?.ctesAnalisados) return;
    const r = resultadoRealizado;
    const transp = r.filtros?.transportadora || 'Transportadora';
    const linhas = [
      ['ANÁLISE DE OPORTUNIDADE DE FRETE — USO INTERNO'],
      ['Transportadora analisada:', transp],
      ['Canal:', r.filtros?.canal || ''],
      ['Período:', `${r.filtros?.inicio || ''} a ${r.filtros?.fim || ''}`],
      ['Data:', new Date().toLocaleDateString('pt-BR')],
      [],
      ['VISÃO GERAL'],
      ['CT-es analisados', r.ctesAnalisados],
      ['Frete realizado total (período)', r.freteRealizado?.toFixed(2)],
      ['Frete realizado mensal', r.freteRealizadoMes?.toFixed(2)],
      ['% frete sobre NF', r.percentualFreteRealizado?.toFixed(2) + '%'],
      [],
      ['RESULTADO DA SIMULAÇÃO'],
      ['CT-es com tabela selecionada', r.ctesComTabelaSelecionada],
      ['CT-es que ganharia (melhor preço)', r.ctesGanhariaSelecionada],
      ['CT-es que perderia para concorrentes', r.ctesPerdidosSelecionada],
      ['Aderência (%)', r.aderenciaSelecionada?.toFixed(2) + '%'],
      [],
      ['IMPACTO FINANCEIRO'],
      ['Saving se ficarmos só nas rotas ganhas (período)', r.savingSelecionadaVsReal?.toFixed(2)],
      ['Saving mensal projetado (rotas ganhas)', r.savingSelecionadaVsRealMes?.toFixed(2)],
      ['Saving 12 meses projetado (rotas ganhas)', r.savingSelecionadaVsRealAno?.toFixed(2)],
      ['Saving tabela geral (todos CT-es com tabela)', r.savingTabelaSelecionadaVsRealBruto?.toFixed(2)],
      ['Saving mercado (melhor tabela disponível)', r.savingVencedorVsReal?.toFixed(2)],
      ['Perda para concorrentes (diferença)', r.diferencaSelecionadaVsVencedor?.toFixed(2)],
      ['Redução média necessária para virar ganhador (%)', r.reducaoMediaNecessaria?.toFixed(2) + '%'],
      [],
      ['PARETO 80% — PRIORIZAÇÃO DE NEGOCIAÇÃO'],
      ['Rota', 'CT-es', 'Volumes', '% vol.', '% acum.', 'Frete realizado', 'Frete tabela', 'Frete vencedor', 'Saving ganhadora', 'Saving mercado', 'Redução necessária (%)', 'Principal vencedor'],
      ...(r.pareto80Volume?.rotas || []).map((item) => [
        item.rota, item.ctes, Number(item.volumes || item.ctes || 0).toLocaleString('pt-BR'),
        item.pctVolume?.toFixed(2) + '%', item.pctAcumulado?.toFixed(2) + '%',
        item.freteRealizado?.toFixed(2), item.freteSelecionada?.toFixed(2),
        item.freteVencedor?.toFixed(2), item.savingSelecionada?.toFixed(2),
        item.savingVencedor?.toFixed(2), item.reducaoMediaNecessaria?.toFixed(2) + '%',
        item.principalVencedor || '-',
      ]),
      [],
      ['TODAS AS ROTAS — DETALHE COMPLETO'],
      ['Rota', 'Tipo', 'CT-es', 'Volumes', 'Frete realizado', 'Frete tabela', 'Frete vencedor', '% NF real', '% NF tabela', '% NF vencedor', 'Saving ganhadora', 'Saving tabela amplo', 'Saving mercado', 'Dif. vencedor', 'Redução média (%)', 'Principal vencedor', 'Concorrentes médio'],
      ...(r.rotas || []).map((item) => [
        item.rota, item.tipo, item.ctes, Number(item.volumes || 0).toLocaleString('pt-BR'),
        item.freteRealizado?.toFixed(2), item.freteSelecionada?.toFixed(2),
        item.freteVencedor?.toFixed(2),
        item.percentualFreteRealizado?.toFixed(2) + '%',
        item.percentualFreteSelecionada?.toFixed(2) + '%',
        item.percentualFreteVencedor?.toFixed(2) + '%',
        item.savingSelecionada?.toFixed(2), (item.savingTabelaSelecionadaBruto || 0)?.toFixed(2),
        item.savingVencedor?.toFixed(2), item.diferencaParaVencedor?.toFixed(2),
        item.reducaoMediaNecessaria?.toFixed(2) + '%', item.principalVencedor || '-',
        item.concorrentesMedio?.toFixed(2),
      ]),
      [],
      ['CT-E A CT-E — AMOSTRA COMPLETA'],
      ['CT-e', 'Data', 'Canal', 'Origem', 'Destino', 'Transp. real', 'Peso', 'Cubagem', 'Valor NF', 'Volumes', 'Frete realizado', '% NF real', 'Frete tabela', '% NF tabela', 'Vencedor', 'Frete vencedor', 'Status', 'Ranking', 'Redução (%)', 'Saving ganhadora', 'Saving mercado', 'Concorrentes', 'Fallback origem'],
      ...(r.ctesDetalhes || []).map((item) => [
        item.cte, item.data?.slice(0, 10) || '', item.canal,
        `${item.origemUsada || item.origem}/${item.ufOrigem}`,
        `${item.destino}/${item.ufDestino}`,
        item.transportadoraReal, item.peso?.toFixed(2), item.cubagem?.toFixed(4),
        item.valorNF?.toFixed(2), Number(item.volumes || 0).toLocaleString('pt-BR'),
        item.freteRealizado?.toFixed(2), item.percentualFreteRealizado?.toFixed(2) + '%',
        item.freteSelecionada ? item.freteSelecionada?.toFixed(2) : '',
        item.freteSelecionada ? item.percentualFreteSelecionada?.toFixed(2) + '%' : '',
        item.vencedor, item.freteVencedor?.toFixed(2),
        item.statusSelecionada, item.rankingSelecionada || '',
        item.reducaoNecessaria > 0 ? item.reducaoNecessaria?.toFixed(2) + '%' : '',
        item.savingSelecionada?.toFixed(2), item.savingVencedor?.toFixed(2),
        item.concorrentes, item.fallbackOrigem ? 'Sim' : 'Não',
      ]),
    ];
    const nomeBase = transp.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
    const { nomeArquivo, csv } = exportarLinhasCsv(`relatorio-diretoria-${nomeBase}.csv`, linhas);
    downloadCsv(nomeArquivo, csv);
  };

  const atualizarGradePadrao = async () => {
    setSalvandoGrade(true);
    setGradeStatus('Restaurando grade padrão...');
    try {
      const resultado = await restaurarGradeFreteCentralizadaPadrao();
      setGrade(resultado.grade);
      setGradeFonte(resultado.fonte || 'local');
      setGradeStatus(resultado.mensagem || 'Grade padrão restaurada.');
    } catch (error) {
      const gradeLocal = salvarGradeFrete(grade);
      setGrade(gradeLocal);
      setGradeFonte('local');
      setGradeStatus(`Não foi possível salvar no Supabase. Grade mantida localmente. ${error.message || ''}`);
    } finally {
      setSalvandoGrade(false);
    }
  };

  const salvarGradeAtual = async () => {
    setSalvandoGrade(true);
    setGradeStatus('Salvando grade no Supabase...');
    try {
      const resultado = await salvarGradeFreteCentralizada(grade);
      setGrade(resultado.grade);
      setGradeFonte(resultado.fonte || 'local');
      setGradeStatus(resultado.mensagem || 'Grade salva.');
    } catch (error) {
      const gradeLocal = salvarGradeFrete(grade);
      setGrade(gradeLocal);
      setGradeFonte('local');
      setGradeStatus(`Erro ao salvar no Supabase. Grade salva apenas localmente. ${error.message || ''}`);
    } finally {
      setSalvandoGrade(false);
    }
  };

  const onAnalisarOrigem = async () => {
    if (!origemOrigem) {
      setErroSimulacao('Informe a origem para gerar a análise por origem.');
      return;
    }

    iniciarProcessamentoUi('Análise por origem', `Buscando tabelas e volumetria de ${origemOrigem}...`, 8);

    try {
      atualizarProcessamentoUi('Buscando tabelas do simulador no Supabase...', 28);
      const baseOnline = await carregarBaseOnline({
        canal: canalOrigem,
        origem: origemOrigem,
        ufDestino: ufDestinoOrigem,
      });

      const lookupOnline = buildLookupTables(baseOnline);
      const mapaCidades = new Map(cidadePorIbgeCompleto);
      (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));

      atualizarProcessamentoUi('Calculando ranking, cobertura e rotas críticas...', 62);
      const resultadoTabela = analisarOrigemPorGrade({
        transportadoras: baseOnline,
        canal: canalOrigem,
        origem: origemOrigem,
        ufDestino: ufDestinoOrigem,
        grade: grade[canalOrigem] || grade.ATACADO || [],
        cidadePorIbge: mapaCidades,
      });

      let realizado = null;
      if (usarRealizadoOrigem) {
        atualizarProcessamentoUi('Lendo volumetria do Realizado Local...', 78);
        const rowsBrutos = await buscarRealizadoLocalCtes({
          canal: canalOrigem,
          origem: origemOrigem,
          ufDestino: ufDestinoOrigem,
          inicio: inicioOrigem,
          fim: fimOrigem,
          limit: 5000,
        });
        // Carrega vínculos de transportadoras do Supabase com fallback local
        const mapaVinculos = await carregarMapaVinculosSimulador();

        // Resolve ibgeDestino e aplica vínculos de nome de transportadora
        const rowsComIbge = rowsBrutos.map((row) => {
          // Resolve IBGE
          let ibgeDestino = row.ibgeDestino || '';
          if (!ibgeDestino) {
            const cidadeNorm = normalizeBuscaIbge(row.cidadeDestino || '');
            const cidadeUfNorm = normalizeBuscaIbge((row.cidadeDestino || '') + '/' + (row.ufDestino || ''));
            const municipio = municipioPorCidade.get(cidadeUfNorm) || municipioPorCidade.get(cidadeNorm);
            ibgeDestino = municipio?.ibge || '';
          }
          // Aplica vínculo de transportadora
          const nomeOriginal = String(row.transportadora || '').trim();
          const nomeVinculado = mapaVinculos.get(normalizarChaveSimulador(nomeOriginal)) || mapaVinculos.get(nomeOriginal.toUpperCase()) || nomeOriginal;
          return { ...row, ibgeDestino, transportadora: nomeVinculado };
        });

        realizado = {
          totalCompativel: rowsComIbge.length,
          limit: 5000,
          ...resumirRealizadoPorOrigem(rowsComIbge, baseOnline, { canal: canalOrigem, origem: origemOrigem }, mapaCidades, grade[canalOrigem] || grade.ATACADO || []),
        };
      }

      setDetalheOrigemAberto('');
      setResultadoOrigem({
        tabela: resultadoTabela,
        realizado,
        filtros: {
          canal: canalOrigem,
          origem: origemOrigem,
          ufDestino: ufDestinoOrigem,
          inicio: inicioOrigem,
          fim: fimOrigem,
        },
      });
      finalizarProcessamentoUi('Análise concluída', 'Laudo da origem gerado com ranking, volumetria e rotas críticas.', 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao gerar análise por origem.');
      finalizarProcessamentoUi('Erro na análise', 'Não foi possível gerar o laudo da origem.', 100);
    }
  };

  const exportarAnaliseOrigem = () => {
    if (!resultadoOrigem?.tabela) return;
    const linhas = [
      ['Tipo', 'Transportadora', 'Participações', 'Vitórias', '% Aderência', 'Frete médio', 'Prazo médio', 'Diferença média líder'],
      ...(resultadoOrigem.tabela.porTransportadora || []).map((item) => [
        'Tabela', item.transportadora, item.participacoes, item.vitorias, item.aderencia.toFixed(2), item.freteMedio.toFixed(2), item.prazoMedio.toFixed(2), item.diferencaMediaLider.toFixed(2),
      ]),
      [],
      ['Realizado', 'Transportadora', 'CT-es', '% CT-es', 'Frete realizado', '% Frete', 'Valor NF', '% Frete/NF'],
      ...((resultadoOrigem.realizado?.porTransportadora || []).map((item) => [
        'Realizado', item.transportadora, item.ctes, item.pctCtes.toFixed(2), item.frete.toFixed(2), item.pctFrete.toFixed(2), item.valorNF.toFixed(2), item.percentualFrete.toFixed(2),
      ])),
      [],
      ['Simulação sobre realizado', 'Transportadora', 'CT-es concorreu', 'CT-es ganharia', '% ganharia', 'CT-es carregou', '% carregou', 'Acerto operacional', 'Frete realizado', 'Frete melhor nas cargas', 'Diferença potencial'],
      ...((resultadoOrigem.realizado?.simulacaoPorTransportadora || []).map((item) => [
        'Simulação sobre realizado', item.transportadora, item.ctesConcorreu, item.ctesGanharia, item.pctGanharia.toFixed(2), item.ctesCarregou, item.pctCarregou.toFixed(2), item.acertoOperacional.toFixed(2), item.freteRealizado.toFixed(2), item.freteMelhorParaCargasCarregadas.toFixed(2), item.diferencaPotencial.toFixed(2),
      ])),
    ];
    const { nomeArquivo, csv } = exportarLinhasCsv(`analise-origem-${origemOrigem.toLowerCase().replace(/\s+/g, '-')}.csv`, linhas);
    downloadCsv(nomeArquivo, csv);
  };

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">AMD Log • Plataforma de Fretes</div>
        <h1>Simulador de fretes</h1>
        <p>Simulação com base nas tabelas reais importadas por transportadora, origem, rota, cotação e taxas especiais.</p>
      </div>

      <div className="sim-tabs">
        {[
          ['simples', 'Simulação simples'],
          ['transportadora', 'Simulação por transportadora'],
          ['analise', 'Análise de transportadora'],
          ['origem', 'Análise por origem'],
          ['realizado', 'Simulador do realizado'],
          ['cobertura', 'Cobertura de tabela'],
        ].map(([id, label]) => (
          <button key={id} className={`sim-tab ${aba === id ? 'active' : ''}`} onClick={() => setAba(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="sim-alert info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>
          Base do simulador: <strong>{carregandoOpcoes ? 'carregando opções' : (opcoesOnline.fonte === 'supabase' ? 'Supabase online' : 'sem conexão/fallback local')}</strong>
          {opcoesOnline.transportadoras?.length ? ` · ${opcoesOnline.transportadoras.length} transportadoras` : ''}
          {opcoesOnline.origens?.length ? ` · ${opcoesOnline.origens.length} origens` : ''}{municipiosDisponiveis.length ? ` · ${municipiosDisponiveis.length} municípios IBGE` : ''}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="sim-tab" type="button" onClick={atualizarOpcoesSimulador} disabled={carregandoOpcoes}>
            {carregandoOpcoes ? 'Atualizando opções...' : 'Atualizar opções'}
          </button>
          <button className="sim-tab" type="button" onClick={salvarGradeAtual} disabled={salvandoGrade}>
            {salvandoGrade ? 'Salvando grade...' : 'Salvar grade atual'}
          </button>
          <button className="sim-tab" type="button" onClick={atualizarGradePadrao} disabled={salvandoGrade}>
            Restaurar grade padrão
          </button>
        </div>
      </div>
      {erroOpcoes ? <div className="sim-alert error">{erroOpcoes}</div> : null}


      <div className="sim-alert info" style={{ display: 'grid', gap: 8 }}>
        <strong>Grade em uso no simulador <small style={{ fontWeight: 600, color: '#64748b' }}>({gradeFonte === 'supabase' ? 'Supabase' : 'local'})</small></strong>
        <small style={{ color: gradeFonte === 'supabase' ? '#047857' : '#92400e' }}>{gradeStatus}</small>
        <span>
          ATACADO: {(grade.ATACADO || []).map((item) => `${item.peso}kg`).join(' · ') || '-'}
        </span>
        <span>
          B2C: {(grade.B2C || []).map((item) => `${item.peso}kg`).join(' · ') || '-'}
        </span>
      </div>

      {carregandoSimulacao ? (
        <div className="sim-alert info">Consultando o Supabase para esta simulação...</div>
      ) : null}
      {processamentoUi.ativo ? (
        <div className="sim-alert info" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 22, lineHeight: 1 }}>⏳</div>
            <div style={{ flex: 1 }}>
              <strong>{processamentoUi.titulo}</strong>
              <div style={{ fontSize: 13, opacity: 0.9 }}>{processamentoUi.mensagem}</div>
            </div>
            <strong>{processamentoUi.percentual}%</strong>
          </div>
          <div style={{ background: '#e7eefb', borderRadius: 999, height: 12, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(6, Math.min(processamentoUi.percentual, 100))}%`,
                height: '100%',
                borderRadius: 999,
                background: 'linear-gradient(90deg, #04C7A4, #9153F0)',
                transition: 'width 0.35s ease',
              }}
            />
          </div>
          <small>
            Essa análise pode levar mais tempo quando houver muitas rotas, destinos e concorrentes no canal selecionado.
          </small>
        </div>
      ) : null}
      {erroSimulacao ? (
        <div className="sim-alert error">{erroSimulacao}</div>
      ) : null}

      {aba === 'simples' && (
        <section className="sim-card">
          <h2>Simulação simples</h2>
          <div className="sim-form-grid sim-grid-5">
            <label>Origem
              <input list="origens-simples-lista" value={origemSimples} onChange={(e) => setOrigemSimples(e.target.value)} placeholder="Clique ou digite a origem" />
              <datalist id="origens-simples-lista">
                {origensPorCanalSimples.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
            <label>Destino (CEP ou IBGE)
              <input list="destinos-lista" value={destinoCodigo} onChange={(e) => setDestinoCodigo(e.target.value)} placeholder="Digite cidade, IBGE ou CEP" />
              <datalist id="destinos-lista">
                {todosDestinosComCidade.map((item) => (
                  <option key={item.ibge} value={item.cidade && item.uf ? `${item.cidade}/${item.uf} · ${item.ibge}` : item.ibge}>
                    {item.ibge}
                  </option>
                ))}
              </datalist>
              {destinoIdentificado && <small style={{ color: '#64748b' }}>Destino identificado: {destinoIdentificado}</small>}
            </label>
            <label>Canal
              <select value={canalSimples} onChange={(e) => { setCanalSimples(e.target.value); setOrigemSimples(''); }}>{canais.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Peso
              <input value={pesoSimples} onChange={(e) => setPesoSimples(e.target.value)} placeholder="Ex: 150" />
            </label>
            <label>Valor NF (opcional)
              <input value={nfSimples} onChange={(e) => setNfSimples(e.target.value)} placeholder="Se vazio, usa a grade" />
              <small style={{ color: '#64748b' }}>Se não informar, o simulador usa o Valor NF da grade.</small>
            </label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onSimularSimples} disabled={carregandoSimulacao}>{carregandoSimulacao ? "Simulando..." : "Simular"}</button></div>
          <div className="sim-resultados">{resultadoSimples.map((item, idx) => <ResultadoCard key={`${item.transportadora}-${idx}`} item={item} />)}</div>
        </section>
      )}

      {aba === 'transportadora' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Simulação por transportadora</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button className="sim-tab" type="button" onClick={exportarSimulacaoTransportadora}>Exportar relatório</button></div>
          </div>
          <div className="sim-form-grid sim-grid-6">
            <label>Transportadora
              <input
                list="transportadoras-canal-lista"
                value={transportadora}
                onChange={(e) => {
                  const nome = e.target.value;
                  setTransportadora(nome);
                  setOrigemTransportadora('');
                  const primeiroCanal = opcoesOnline.canaisPorTransportadora?.[nome]?.[0] || canalTransportadora || canais[0] || 'ATACADO';
                  if (opcoesOnline.canaisPorTransportadora?.[nome]?.length && !opcoesOnline.canaisPorTransportadora[nome].includes(canalTransportadora)) {
                    setCanalTransportadora(primeiroCanal);
                  }
                }}
                placeholder="Digite a transportadora"
              />
              <datalist id="transportadoras-canal-lista">
                {transportadorasPorCanalTransportadora.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
            <label>Canal
              <select value={canalTransportadora} onChange={(e) => { setCanalTransportadora(e.target.value); setOrigemTransportadora(''); }}>{canais.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Origem (opcional)
              <input list="origens-transportadora-lista" value={origemTransportadora} onChange={(e) => setOrigemTransportadora(e.target.value)} placeholder="Todas ou digite a origem" />
              <datalist id="origens-transportadora-lista">
                {origensTransportadora.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
            <label>Destino opcional (cidade, CEP ou IBGE)
              <input disabled={modoLista} list="destinos-lista-transportadora" value={destinoTransportadora} onChange={(e) => setDestinoTransportadora(e.target.value)} placeholder="Digite cidade, IBGE ou CEP" />
              <datalist id="destinos-lista-transportadora">
                {todosDestinosComCidade.map((item) => (
                  <option key={item.ibge} value={item.cidade && item.uf ? `${item.cidade}/${item.uf} · ${item.ibge}` : item.ibge}>
                    {item.ibge}
                  </option>
                ))}
              </datalist>
              {destinoTransportadoraIdentificado && <small style={{ color: '#64748b' }}>Destino identificado: {destinoTransportadoraIdentificado}</small>}
            </label>
            <label>Peso
              <input value={pesoTransportadora} onChange={(e) => setPesoTransportadora(e.target.value)} placeholder="Ex: 150" />
            </label>
            <label>Valor NF (opcional)
              <input value={nfTransportadora} onChange={(e) => setNfTransportadora(e.target.value)} placeholder="Se vazio, usa a grade" />
            </label>
          </div>
          <div className="sim-inline-tools">
            <label className="sim-flag">
              <input type="checkbox" checked={modoLista} onChange={(e) => setModoLista(e.target.checked)} />
              Simulação em massa por lista de CEP/IBGE
            </label>
            {modoLista && (
              <div className="sim-lista-box" style={{ marginTop: 12 }}>
                <label>Lista de cidades, CEPs ou IBGEs
                  <textarea value={listaCodigos} onChange={(e) => setListaCodigos(e.target.value)} placeholder={"São Paulo/SP\n3506003\n88300000"} />
                </label>
              </div>
            )}
          </div>
          <div className="sim-actions"><button className="primary" onClick={onSimularTransportadora} disabled={carregandoSimulacao}>{carregandoSimulacao ? "Simulando..." : "Simular transportadora"}</button></div>
          <div className="sim-resultados">{resultadoTransportadora.map((item, idx) => <ResultadoCard key={`${item.transportadora}-${item.ibgeDestino}-${idx}`} item={item} />)}</div>
        </section>
      )}

      {aba === 'analise' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Análise de transportadora</h2>
            <button className="sim-tab" type="button" onClick={exportarAnalise}>Exportar relatório</button>
          </div>
          <div className="sim-form-grid sim-grid-5">
            <label>Transportadora
              <input list="transportadoras-analise-lista" value={transportadoraAnalise} onChange={(e) => { setTransportadoraAnalise(e.target.value); setOrigemAnalise(''); }} placeholder="Digite a transportadora" />
              <datalist id="transportadoras-analise-lista">
                {transportadorasPorCanalAnalise.map((item) => <option key={item} value={item} />)}
              </datalist>
              {!transportadorasPorCanalAnalise.length ? <small>Nenhuma transportadora cadastrada neste canal.</small> : null}
            </label>
            <label>Canal
              <select value={canalAnalise} onChange={(e) => { setCanalAnalise(e.target.value); setOrigemAnalise(''); }}>{canais.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label>Origem
              <input list="origens-analise-lista" value={origemAnalise} onChange={(e) => setOrigemAnalise(e.target.value)} placeholder="Obrigatório para B2C grande" />
              <datalist id="origens-analise-lista">
                {origensAnaliseDisponiveis.map((item) => <option key={item} value={item} />)}
              </datalist>
              <small style={{ color: '#64748b' }}>Quebre por origem: Itajaí, Itupeva, Campo Grande...</small>
            </label>
            <label>UF destino
              <select value={ufAnalise} onChange={(e) => setUfAnalise(e.target.value)}>
                {UF_OPTIONS.map((item) => <option key={item} value={item}>{item || 'Todas'}</option>)}
              </select>
            </label>
            <div className="sim-actions" style={{ alignItems: 'flex-end' }}><button className="primary" onClick={onSimularGrade} disabled={carregandoSimulacao || processamentoUi.ativo}>{carregandoSimulacao || processamentoUi.ativo ? "Processando..." : "Gerar relatório"}</button></div>
          </div>
          {resultadoAnalise && (
            <div className="sim-cobertura-box">
              <div className="sim-alert info">
                Filtros aplicados: <strong>{transportadoraAnalise}</strong> · Canal: <strong>{canalAnalise}</strong> · Origem: <strong>{origemAnalise}</strong>{ufAnalise ? ` · UF destino: ${ufAnalise}` : ''}
              </div>
              <div className="sim-analise-resumo">
                <div><span>Rotas avaliadas</span><strong>{resultadoAnalise.rotasAvaliadas}</strong></div>
                <div><span>Vitórias</span><strong>{resultadoAnalise.vitorias}</strong></div>
                <div><span>Aderência</span><strong>{formatPercent(resultadoAnalise.aderencia)}</strong></div>
                <div><span>Saving potencial</span><strong>{formatMoney(resultadoAnalise.saving)}</strong></div>
                <div><span>Prazo médio</span><strong>{resultadoAnalise.prazoMedio.toFixed(1)} dia(s)</strong></div>
                <div><span>Frete médio</span><strong>{formatMoney(resultadoAnalise.freteMedio)}</strong></div>
              </div>
              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div className="sim-parametros-box"><div className="sim-parametros-header"><div><strong>Desempenho por UF</strong><p>Onde a transportadora fica mais competitiva.</p></div></div><div style={{ marginTop: 12 }}><GraficoUf itens={resultadoAnalise.porUf} /></div></div>
                <div className="sim-parametros-box"><div className="sim-parametros-header"><div><strong>Leitura do relatório</strong><p>Base para devolutiva, reunião ou negociação.</p></div></div><div style={{ display: 'grid', gap: 8, marginTop: 12 }}><div>Total de linhas geradas: <strong>{resultadoAnalise.detalhes.length}</strong></div><div>Vitórias na grade: <strong>{resultadoAnalise.vitorias}</strong></div><div>Rotas fora do 1º lugar: <strong>{resultadoAnalise.rotasAvaliadas - resultadoAnalise.vitorias}</strong></div><div>Melhor uso: <strong>comparar aderência, prazo e necessidade de redução.</strong></div></div></div>
              </div>
              <div className="sim-resultados">{resultadoAnalise.detalhes.slice(0, 30).map((item, idx) => <ResultadoCard key={`${item.transportadora}-${idx}`} item={item} />)}</div>
            </div>
          )}
        </section>
      )}


      {aba === 'origem' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Análise por origem</h2>
            <button className="sim-tab" type="button" onClick={exportarAnaliseOrigem} disabled={!resultadoOrigem?.tabela}>Exportar laudo</button>
          </div>

          <div className="sim-form-grid sim-grid-6">
            <label>Canal
              <select value={canalOrigem} onChange={(e) => { setCanalOrigem(e.target.value); setOrigemOrigem(''); }}>
                {canais.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Origem
              <input
                value={origemOrigem}
                onChange={(e) => setOrigemOrigem(e.target.value)}
                placeholder="Digite a origem"
                list="origens-origem-lista"
              />
              <datalist id="origens-origem-lista">
                {origensOrigemDisponiveis.map((item) => <option key={item} value={item} />)}
              </datalist>
              {origemOrigem && <small style={{ color: '#64748b' }}>Busca por: {origemOrigem}</small>}
            </label>
            <label>UF destino
              <select value={ufDestinoOrigem} onChange={(e) => setUfDestinoOrigem(e.target.value)}>
                {UF_OPTIONS.map((item) => <option key={item} value={item}>{item || 'Todas'}</option>)}
              </select>
            </label>
            <label>Início realizado
              <input type="date" value={inicioOrigem} onChange={(e) => setInicioOrigem(e.target.value)} />
            </label>
            <label>Fim realizado
              <input type="date" value={fimOrigem} onChange={(e) => setFimOrigem(e.target.value)} />
            </label>
            <label className="sim-flag" style={{ justifyContent: 'end' }}>
              <input type="checkbox" checked={usarRealizadoOrigem} onChange={(e) => setUsarRealizadoOrigem(e.target.checked)} />
              Usar CT-e Online (Supabase)
            </label>
          </div>

          <div className="sim-actions"><button className="primary" onClick={onAnalisarOrigem} disabled={carregandoSimulacao || processamentoUi.ativo}>{carregandoSimulacao || processamentoUi.ativo ? 'Processando...' : 'Gerar laudo da origem'}</button></div>

          {resultadoOrigem?.tabela && (
            <div className="sim-cobertura-box">
              <div className="sim-alert info">
                Origem: <strong>{resultadoOrigem.filtros.origem}</strong> · Canal: <strong>{resultadoOrigem.filtros.canal}</strong>{resultadoOrigem.filtros.ufDestino ? ` · UF destino: ${resultadoOrigem.filtros.ufDestino}` : ''}
              </div>

              <div className="sim-analise-resumo">
                <div><span>Cenários tabela</span><strong>{resultadoOrigem.tabela.cenariosAvaliados}</strong></div>
                <div><span>Destinos cobertos</span><strong>{resultadoOrigem.tabela.destinosCobertos}</strong></div>
                <div><span>Rotas com 1 transp.</span><strong>{resultadoOrigem.tabela.rotasComUmaTransportadora}</strong></div>
                <div><span>Saving vs 2º menor</span><strong>{formatMoney(resultadoOrigem.tabela.savingVsSegundo)}</strong></div>
                <div><span>Frete médio ganhador</span><strong>{formatMoney(resultadoOrigem.tabela.freteMedioVencedor)}</strong></div>
                <div><span>Realizado local</span><strong>{resultadoOrigem.realizado ? `${resultadoOrigem.realizado.ctes} CT-es` : 'Não usado'}</strong></div>
              </div>

              {resultadoOrigem.realizado && (
                <div className="sim-analise-resumo">
                  <div><span>Frete realizado</span><strong>{formatMoney(resultadoOrigem.realizado.freteRealizado)}</strong></div>
                  <div><span>Frete se fosse ganhador</span><strong>{formatMoney(resultadoOrigem.realizado.freteGanhadorTotal)}</strong></div>
                  <div><span>Diferença potencial</span><strong>{formatMoney(resultadoOrigem.realizado.diferencaPotencialTotal)}</strong></div>
                  <div><span>% economia potencial</span><strong>{formatPercent(resultadoOrigem.realizado.percentualSavingPotencial)}</strong></div>
                  <div><span>Acerto operacional</span><strong>{formatPercent(resultadoOrigem.realizado.aderenciaRealizada)}</strong></div>
                  <div><span>Sem tabela no realizado</span><strong>{resultadoOrigem.realizado.semTabela}</strong></div>
                  <div><span>Destinos sem cobertura</span><strong>{resultadoOrigem.realizado.destinosSemTabela}</strong></div>
                  <div><span>Destinos com 1 opção</span><strong>{resultadoOrigem.realizado.destinosUmaOpcao}</strong></div>
                </div>
              )}

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Potencial por grade</strong><p>Quem ganha mais rotas/faixas simuladas da origem. Esta visão não representa volume real carregado.</p></div></div>
                  <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                    <table className="sim-analise-tabela">
                      <thead><tr><th>Transportadora</th><th>Rotas/faixas ganhas</th><th>Aderência</th><th>Frete médio</th><th>Prazo</th></tr></thead>
                      <tbody>
                        {(resultadoOrigem.tabela.porTransportadora || []).slice(0, 20).map((item) => (
                          <tr key={item.transportadora}>
                            <td><strong>{item.transportadora}</strong></td>
                            <td>{item.vitorias}</td>
                            <td>{formatPercent(item.aderencia)}</td>
                            <td>{formatMoney(item.freteMedio)}</td>
                            <td>{item.prazoMedio.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Quem carrega no realizado</strong><p>Participação real da origem, vindo da base local.</p></div></div>
                  <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                    <table className="sim-analise-tabela">
                      <thead><tr><th>Transportadora</th><th>CT-es</th><th>% CT-es</th><th>Frete</th><th>% Frete</th></tr></thead>
                      <tbody>
                        {((resultadoOrigem.realizado?.porTransportadora || []).slice(0, 20)).map((item) => (
                          <tr key={item.transportadora}>
                            <td><strong>{item.transportadora}</strong></td>
                            <td>{item.ctes}</td>
                            <td>{formatPercent(item.pctCtes)}</td>
                            <td>{formatMoney(item.frete)}</td>
                            <td>{formatPercent(item.pctFrete)}</td>
                          </tr>
                        ))}
                        {!resultadoOrigem.realizado && <tr><td colSpan="5">Ative “Usar CT-e Online (Supabase)” para ver a volumetria carregada.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {resultadoOrigem.realizado && (
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header">
                    <div>
                      <strong>Simulação sobre realizado local</strong>
                      <p>Usa peso e valor NF do realizado, mas volumes e cubagem vêm obrigatoriamente do Tracking. CT-es sem vínculo com Tracking ficam com volume/cubagem zerados para não contaminar capacidade e cálculo.</p>
                    </div>
                  </div>
                  <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                    <table className="sim-analise-tabela">
                      <thead>
                        <tr>
                          <th>Transportadora</th>
                          <th>CT-es concorreu</th>
                          <th>CT-es ganharia</th>
                          <th>% ganharia</th>
                          <th>CT-es carregou</th>
                          <th>% carregou</th>
                          <th>Acerto operacional</th>
                          <th>Frete realizado</th>
                          <th>Frete melhor</th>
                          <th>Dif. potencial</th>
                          <th>Detalhes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((resultadoOrigem.realizado?.simulacaoPorTransportadora || []).slice(0, 30)).map((item) => {
                          const aberto = detalheOrigemAberto === item.transportadora;
                          const exemplos = aberto
                            ? ((item.exemplosCarregadas || []).length ? item.exemplosCarregadas : item.exemplosGanharia || [])
                            : [];
                          return (
                            <React.Fragment key={item.transportadora}>
                              <tr>
                                <td><strong>{item.transportadora}</strong></td>
                                <td>{item.ctesConcorreu}</td>
                                <td>{item.ctesGanharia}</td>
                                <td>{formatPercent(item.pctGanharia)}</td>
                                <td>{item.ctesCarregou}</td>
                                <td>{formatPercent(item.pctCarregou)}</td>
                                <td>{formatPercent(item.acertoOperacional)}</td>
                                <td>{formatMoney(item.freteRealizado)}</td>
                                <td>{formatMoney(item.freteMelhorParaCargasCarregadas)}</td>
                                <td>{formatMoney(item.diferencaPotencial)}</td>
                                <td>
                                  <button
                                    className="sim-tab"
                                    type="button"
                                    onClick={() => setDetalheOrigemAberto(aberto ? '' : item.transportadora)}
                                    disabled={!(item.exemplosCarregadas?.length || item.exemplosGanharia?.length)}
                                  >
                                    {aberto ? 'Fechar' : 'Ver 10 casos'}
                                  </button>
                                </td>
                              </tr>
                              {aberto && (
                                <tr>
                                  <td colSpan="11" style={{ background: '#f8fafc' }}>
                                    <div style={{ display: 'grid', gap: 10 }}>
                                      <div style={{ fontSize: 13 }}>
                                        <strong>Como ler a Dif. potencial:</strong> soma do frete realizado nos CT-es carregados pela transportadora menos o melhor frete simulado para esses mesmos CT-es. Se ficar positivo, existia saving potencial; se ficar negativo, o realizado estava abaixo da melhor tabela encontrada.
                                      </div>
                                      <div className="sim-analise-tabela-wrap">
                                        <table className="sim-analise-tabela">
                                          <thead>
                                            <tr>
                                              <th>CT-e</th>
                                              <th>Destino</th>
                                              <th>Real</th>
                                              <th>Frete realizado</th>
                                              <th>Melhor tabela</th>
                                              <th>Frete melhor</th>
                                              <th>Diferença</th>
                                              <th>Tabela da transp.</th>
                                              <th>Concorrentes</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {exemplos.slice(0, 10).map((exemplo, idx) => (
                                              <tr key={`${exemplo.cte}-${idx}`}>
                                                <td>{exemplo.cte || '-'}</td>
                                                <td>{exemplo.destino}/{exemplo.ufDestino}</td>
                                                <td>{exemplo.transportadoraReal}</td>
                                                <td>{formatMoney(exemplo.freteRealizado)}</td>
                                                <td>{exemplo.vencedor || '-'}</td>
                                                <td>{formatMoney(exemplo.freteMelhor)}</td>
                                                <td className={exemplo.diferencaPotencial > 0 ? 'positivo' : exemplo.diferencaPotencial < 0 ? 'negativo' : ''}>{formatMoney(exemplo.diferencaPotencial)}</td>
                                                <td>{exemplo.freteTabela ? formatMoney(exemplo.freteTabela) : '-'}</td>
                                                <td>{exemplo.concorrentes}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Buracos e rotas sensíveis</strong><p>Sem cobertura = 0 transportadoras com tabela. Baixa concorrência = 1 transportadora. Concorrência limitada = 2 transportadoras.</p></div></div>
                  <div className="sim-cobertura-lista">
                    {((resultadoOrigem.realizado?.destinosCriticos || resultadoOrigem.tabela.rotasCriticas || []).slice(0, 60)).map((item, idx) => (
                      <div key={`${item.ibgeDestino || item.ibge}-${idx}`}>
                        {(item.origem || resultadoOrigem.filtros.origem)} → {item.cidadeDestino || item.destino || `IBGE ${item.ibgeDestino || item.ibge}`}/{item.ufDestino || item.uf} · {item.statusCobertura || 'Baixa concorrência'} · {(item.concorrentesTabela || item.transportadoras || []).join(', ') || 'Sem tabela'}
                      </div>
                    ))}
                    {resultadoOrigem.realizado && !resultadoOrigem.realizado.destinosCriticos?.length && <div>Nenhum destino crítico no realizado filtrado.</div>}
                    {!resultadoOrigem.realizado && !resultadoOrigem.tabela.rotasCriticas?.length && <div>Nenhuma rota com apenas uma transportadora encontrada nos filtros.</div>}
                  </div>
                </div>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Maiores oportunidades no realizado</strong><p>CT-es onde a tabela simulada indica menor preço que o frete realizado. A simulação considera cubagem real ou cubagem da faixa da grade.</p></div></div>
                  <div className="sim-cobertura-lista">
                    {(resultadoOrigem.realizado?.simulacoes || []).slice(0, 60).map((item, idx) => (
                      <div key={`${item.cte}-${idx}`}>{item.destino}/{item.uf} · Real: {item.transportadoraReal} {formatMoney(item.freteRealizado)} · Melhor: {item.vencedor} {formatMoney(item.freteVencedor)} · Dif.: {formatMoney(item.saving)}</div>
                    ))}
                    {resultadoOrigem.realizado && !resultadoOrigem.realizado.simulacoes?.length && <div>Não houve oportunidade simulada com a base realizada filtrada.</div>}
                    {!resultadoOrigem.realizado && <div>Ative a base realizada para listar oportunidades por CT-e.</div>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {aba === 'realizado' && (
        <div className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <div>
              <h2 style={{ margin: 0 }}>Simulador do realizado</h2>
              <p>
                Simule uma tabela sobre os CT-es realizados para medir projeção de faturamento, saving, rotas perdidas e redução necessária por rota.
              </p>
            </div>
            <button className="sim-tab" type="button" onClick={exportarSimuladorRealizado} disabled={!resultadoRealizado?.rotas?.length}>
              Exportar laudo
            </button>
            <button className="sim-tab" type="button"
              onClick={exportarRelatorioTransportadora}
              disabled={!resultadoRealizado?.ctesAnalisados}
              title="Relatório sem saving — para enviar à transportadora"
              style={{ background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' }}>
              📄 Relatório Transportadora
            </button>
            <button className="sim-tab" type="button"
              onClick={exportarRelatorioFornecedorVsRealizado}
              disabled={!resultadoRealizado?.ctesDetalhes?.length}
              title="Comparativo tabela × realizado — sem concorrentes, foco no que foi pago vs tabela"
              style={{ background: '#f3e8ff', color: '#7c3aed', border: '1px solid #c4b5fd' }}>
              📋 Fornecedor × Realizado
            </button>
            <button className="sim-tab" type="button"
              onClick={exportarRelatorioDiretoria}
              disabled={!resultadoRealizado?.ctesAnalisados}
              title="Relatório completo com saving — uso interno/diretoria"
              style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>
              📊 Relatório Diretoria
            </button>
            <button className="sim-tab" type="button" onClick={() => setLaudoVisualAberto('executivo')} disabled={!resultadoRealizado?.ctesAnalisados}>
              Ver Laudo Diretoria
            </button>
            <button className="sim-tab" type="button" onClick={() => setLaudoVisualAberto('transportador')} disabled={!resultadoRealizado?.ctesAnalisados}>
              Ver Laudo Transportador
            </button>
            <button className="sim-tab" type="button" onClick={salvarLaudosVisuaisNegociacao} disabled={!negociacaoSelecionadaRealizado?.id || salvandoLaudosVisuais}>
              {salvandoLaudosVisuais ? 'Salvando laudos...' : 'Salvar laudos na negociação'}
            </button>
            <button className="sim-tab" type="button"
              onClick={salvarResultadoNegociacaoRealizado}
              disabled={!resultadoRealizado?.ctesAnalisados || !negociacaoSelecionadaRealizado || salvandoResultadoNegociacao}
              title="Salva saving, aderência, faturamento e volumetria na tabela em negociação"
              style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d' }}>
              {salvandoResultadoNegociacao ? 'Salvando...' : '💾 Salvar resultado na negociação'}
            </button>
          </div>

          <div className="sim-form-grid sim-grid-5">
            <label>
              Transportadora / tabela
              <select value={transportadoraRealizado} onChange={(event) => setTransportadoraRealizado(event.target.value)}>
                <option value="">Selecione</option>
                {transportadorasPorCanalRealizado.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
              </select>
              {carregandoBaseOficialRealizado && (
                <small style={{ color: '#64748b' }}>Carregando origens e UFs atendidas pela tabela...</small>
              )}
            </label>
            <label>
              Canal
              <select value={canalRealizado} onChange={(event) => setCanalRealizado(event.target.value)}>
                {canais.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
              </select>
            </label>
            <label>
              Modo
              <select value={modoRealizado} onChange={(event) => setModoRealizado(event.target.value)}>
                <option value="malha">Usar malha da transportadora</option>
                <option value="filtros">Usar apenas filtros informados</option>
              </select>
            </label>
            <label>
              Emissão início
              <input type="date" value={inicioRealizado} onChange={(event) => setInicioRealizado(event.target.value)} />
            </label>
            <label>
              Emissão fim
              <input type="date" value={fimRealizado} onChange={(event) => setFimRealizado(event.target.value)} />
            </label>
          </div>

          <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
            <label>
              Origem
              <input list="origens-realizado-list" value={origemRealizado} onChange={(event) => setOrigemRealizado(event.target.value)} placeholder="Opcional" />
              <datalist id="origens-realizado-list">
                {origensRealizadoDisponiveis.map((origem) => <option key={origem} value={origem} />)}
              </datalist>
            </label>
            <label>
              Destino
              <input value={destinoRealizado} onChange={(event) => setDestinoRealizado(event.target.value)} placeholder="Cidade opcional" />
            </label>
            <label>
              UF origem
              <select value={ufOrigemRealizado} onChange={(event) => setUfOrigemRealizado(event.target.value)}>
                {UF_OPTIONS.map((uf) => <option key={uf || 'todas'} value={uf}>{uf || 'Todas'}</option>)}
              </select>
            </label>
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'grid', gap: 6 }}>
                UF destino
                <button
                  type="button"
                  className="sim-tab"
                  onClick={() => setUfDestinoRealizadoAberto((aberto) => !aberto)}
                  style={{
                    width: '100%',
                    minHeight: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    textAlign: 'left',
                    padding: '0.55rem 0.75rem',
                    background: '#fff',
                  }}
                >
                  <span>{ufDestinoRealizadoLabel}</span>
                  <span>{ufDestinoRealizadoAberto ? '▲' : '▼'}</span>
                </button>
              </label>

              {ufDestinoRealizadoAberto && (
                <div
                  style={{
                    position: 'absolute',
                    zIndex: 60,
                    top: 'calc(100% + 4px)',
                    left: 0,
                    right: 0,
                    maxHeight: 300,
                    overflow: 'auto',
                    background: '#fff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 10,
                    boxShadow: '0 14px 34px rgba(15, 23, 42, 0.18)',
                    padding: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleUfDestinoRealizado('')}
                    style={{
                      width: '100%',
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      background: !ufsDestinoFiltroRealizado.length ? '#dbeafe' : '#f8fafc',
                      color: '#0f172a',
                      padding: '7px 9px',
                      textAlign: 'left',
                      fontWeight: 700,
                      cursor: 'pointer',
                      marginBottom: 8,
                    }}
                  >
                    {!ufsDestinoFiltroRealizado.length ? '☑' : '☐'} Todas
                  </button>

                  <div style={{ display: 'grid', gap: 6 }}>
                    {(ufsDestinoRealizadoDisponiveis || []).filter(Boolean).map((uf) => {
                      const marcado = ufsDestinoFiltroRealizado.includes(uf);
                      return (
                        <button
                          key={uf}
                          type="button"
                          onClick={() => toggleUfDestinoRealizado(uf)}
                          style={{
                            width: '100%',
                            border: '1px solid #e2e8f0',
                            borderRadius: 8,
                            background: marcado ? '#e0f2fe' : '#fff',
                            color: '#0f172a',
                            padding: '7px 9px',
                            textAlign: 'left',
                            fontWeight: marcado ? 700 : 500,
                            cursor: 'pointer',
                          }}
                        >
                          {marcado ? '☑' : '☐'} {uf}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10, borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
                    <button
                      type="button"
                      className="sim-tab"
                      onClick={() => toggleUfDestinoRealizado('')}
                    >
                      Limpar UFs
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setUfDestinoRealizadoAberto(false)}
                      style={{ padding: '0.45rem 0.9rem' }}
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              )}
            </div>
            <label>
              Limite CT-es
              <select value={limiteRealizado} onChange={(event) => setLimiteRealizado(Number(event.target.value))}>
                <option value={3000}>3.000</option>
                <option value={5000}>5.000</option>
                <option value={10000}>10.000</option>
                <option value={20000}>20.000</option>
                <option value={50000}>50.000</option>
                <option value={100000}>100.000</option>
                <option value={200000}>200.000 / mês completo</option>
              </select>
            </label>
          </div>

          <div className="sim-alert info" style={{ marginTop: 14, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <strong>Base da simulação: {baseRealizadoTracking === 'com_tracking' ? 'somente CT-es com Tracking' : 'todos os CT-es'}</strong>
                <div style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 3 }}>
                  CPS LOG excluído por padrão • Concorrentes {compararConcorrentesRealizado ? 'ativos' : 'desativados'} • Negociações {incluirNegociacoesRealizado ? 'ativas' : 'desativadas'} • {carregandoNegociacoesSimulador ? 'atualizando negociações...' : negociacoesAtualizadasEm ? `negociações atualizadas às ${negociacoesAtualizadasEm}` : 'negociações aguardando atualização'}
                </div>
              </div>
              <button
                className="sim-tab"
                type="button"
                onClick={() => setOpcoesAvancadasRealizadoAberto((valor) => !valor)}
              >
                {opcoesAvancadasRealizadoAberto ? 'Recolher opções' : 'Expandir opções'}
              </button>
            </div>

            {opcoesAvancadasRealizadoAberto && (
              <div style={{ display: 'grid', gap: 10, paddingTop: 10, borderTop: '1px solid #cbd5e1' }}>
                <label className="sim-flag">
                  <input
                    type="checkbox"
                    checked={incluirNegociacoesRealizado}
                    onChange={(event) => {
                      const marcado = event.target.checked;
                      setIncluirNegociacoesRealizado(marcado);
                      if (marcado && !negociacoesSimulador.length && !carregandoNegociacoesSimulador) {
                        carregarNegociacoesSimulador();
                      }
                    }}
                  />
                  Incluir tabelas em negociação marcadas como “Simulação = Sim”
                </label>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', color: '#475569' }}>
                  <span>
                    Negociações disponíveis no canal atual: <strong>{nomesNegociacaoRealizado.length}</strong>
                    {carregandoNegociacoesSimulador
                      ? ' · atualizando automaticamente...'
                      : negociacoesAtualizadasEm
                        ? ` · atualizado às ${negociacoesAtualizadasEm}`
                        : ' · aguardando atualização automática'}
                  </span>
                </div>

                <div style={{ display: 'grid', gap: 6 }}>
                  <strong>Base da simulação</strong>
                  <label className="sim-flag">
                    <input
                      type="radio"
                      name="base-realizado-tracking"
                      checked={baseRealizadoTracking === 'com_tracking'}
                      onChange={() => setBaseRealizadoTracking('com_tracking')}
                    />
                    Somente CT-es com Tracking vinculado
                  </label>
                  <label className="sim-flag">
                    <input
                      type="radio"
                      name="base-realizado-tracking"
                      checked={baseRealizadoTracking === 'todos'}
                      onChange={() => setBaseRealizadoTracking('todos')}
                    />
                    Todos os CT-es encontrados
                  </label>
                  <small style={{ color: '#64748b' }}>
                    Recomendado: usar somente CT-es com Tracking para garantir NF, volume e cubagem reais na simulação.
                  </small>
                </div>

                <label className="sim-flag">
                  <input
                    type="checkbox"
                    checked={incluirCpsLogRealizado}
                    onChange={(event) => setIncluirCpsLogRealizado(event.target.checked)}
                  />
                  Incluir CPS LOG nesta análise
                </label>

                <label className="sim-flag">
                  <input
                    type="checkbox"
                    checked={compararConcorrentesRealizado}
                    onChange={(event) => setCompararConcorrentesRealizado(event.target.checked)}
                  />
                  Comparar com tabelas oficiais/concorrentes
                </label>

                <small style={{ color: '#64748b' }}>
                  Padrão recomendado: simular somente CT-es com Tracking vinculado, mantendo NF, volumes e cubagem rastreáveis. Em qualquer modo, o sistema mantém tomadores CPX, ITR e GP PNEUS, exclui EBAZAR e exclui CPS LOG por padrão. Marque CPS LOG somente quando quiser analisar esse operador.
                </small>
              </div>
            )}

            {erroNegociacoesSimulador ? <span style={{ color: '#dc2626' }}>{erroNegociacoesSimulador}</span> : null}
          </div>

          <div className="sim-actions" style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="primary" type="button" onClick={onPesquisarRealizado} disabled={carregandoSimulacao || pesquisandoRealizado || !transportadoraRealizado}>
              {pesquisandoRealizado ? 'Pesquisando CT-es...' : 'Pesquisar CT-es'}
            </button>
            <button className="primary" type="button" onClick={onSimularRealizado} disabled={carregandoSimulacao || !baseRealizadoPesquisada?.rows?.length}>
              {carregandoSimulacao && !pesquisandoRealizado ? 'Calculando...' : 'Simular / Calcular'}
            </button>
            <button className="sim-tab" type="button" onClick={() => { setResultadoRealizado(null); setBaseRealizadoPesquisada(null); setResumoPesquisaRealizado(null); }}>
              Limpar resultado/base
            </button>
          </div>


          {resumoPesquisaRealizado && (
            <div className="sim-alert info" style={{ marginTop: 14, display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong>Base pesquisada pronta para simular</strong>
                  <div style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 3 }}>
                    Tabela localizada: <strong>{resumoPesquisaRealizado.tabela}</strong> • Canal {resumoPesquisaRealizado.canal} • {resumoPesquisaRealizado.modoBase === 'com_tracking' ? 'Somente CT-es com Tracking' : 'Todos os CT-es'}
                  </div>
                </div>
                <div style={{ fontWeight: 800, color: '#15803d' }}>✅ Pesquisa concluída</div>
              </div>

              <div className="sim-analise-resumo">
                <div><span>CT-es buscados</span><strong>{resumoPesquisaRealizado.ctesBrutos}</strong></div>
                <div><span>Base para simular</span><strong>{resumoPesquisaRealizado.ctesBase}</strong></div>
                <div><span>Com Tracking</span><strong>{resumoPesquisaRealizado.ctesComTracking}</strong></div>
                <div><span>Sem Tracking</span><strong>{resumoPesquisaRealizado.ctesSemTracking}</strong></div>
                <div><span>% vínculo Tracking</span><strong>{formatPercent(resumoPesquisaRealizado.percentualTracking)}</strong></div>
                <div><span>Valor CT-e</span><strong>{Number(resumoPesquisaRealizado.valorCte || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
                <div><span>Valor NF</span><strong>{Number(resumoPesquisaRealizado.valorNF || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
                <div><span>Peso</span><strong>{Number(resumoPesquisaRealizado.peso || 0).toLocaleString('pt-BR')}</strong></div>
                <div><span>Cubagem</span><strong>{Number(resumoPesquisaRealizado.cubagem || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</strong></div>
                <div><span>Volumes</span><strong>{Number(resumoPesquisaRealizado.volumes || 0).toLocaleString('pt-BR')}</strong></div>
                <div><span>Vol./CT-e</span><strong>{Number(resumoPesquisaRealizado.volumeMedioPorCte || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong></div>
                <div><span>Frete/volume</span><strong>{Number(resumoPesquisaRealizado.fretePorVolume || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
                <div><span>Origens</span><strong>{resumoPesquisaRealizado.origens}</strong></div>
                <div><span>UFs destino</span><strong>{resumoPesquisaRealizado.ufsDestino}</strong></div>
              </div>


              {resumoPesquisaRealizado.alertaVolumes && (
                <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 10, padding: '10px 12px', fontWeight: 700 }}>
                  ⚠️ {resumoPesquisaRealizado.alertaVolumes}
                </div>
              )}

              {(resumoPesquisaRealizado.preview || []).length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="sim-table" style={{ minWidth: 980 }}>
                    <thead>
                      <tr>
                        <th>CT-e</th>
                        <th>NF</th>
                        <th>Transportadora realizada</th>
                        <th>Origem</th>
                        <th>Destino</th>
                        <th>UF</th>
                        <th>Valor CT-e</th>
                        <th>Valor NF</th>
                        <th>Tracking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumoPesquisaRealizado.preview.map((row, idx) => (
                        <tr key={idx}>
                          <td>{row.cte}</td>
                          <td>{row.nf}</td>
                          <td>{row.transportadora}</td>
                          <td>{row.origem}</td>
                          <td>{row.destino}</td>
                          <td>{row.ufDestino}</td>
                          <td>{Number(row.valorCte || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                          <td>{Number(row.valorNF || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                          <td style={{ fontWeight: 700, color: row.tracking === 'Com Tracking' ? '#15803d' : '#b45309' }}>{row.tracking}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="sim-alert info" style={{ marginTop: 14 }}>
            <strong>Regra:</strong> por padrão, o sistema simula somente CT-es vinculados ao Tracking, garantindo NF, volumes e cubagem rastreáveis. CPS LOG fica excluído por padrão em qualquer modo e só entra quando a opção "Incluir CPS LOG nesta análise" estiver marcada. No modo “Todos os CT-es”, a simulação considera também CT-es sem Tracking. Tabelas oficiais cadastradas e tabelas em negociação ficam disponíveis separadamente na seleção. Concorrentes só são buscados quando a opção "Comparar com tabelas oficiais/concorrentes" estiver marcada.
          </div>

          {resultadoRealizado && (
            <div style={{ marginTop: 18, display: 'grid', gap: 16 }}>
              <div className="sim-analise-resumo">
                <div><span>Buscados do banco</span><strong>{resultadoRealizado.filtros?.ctesBrutos ?? resultadoRealizado.ctesAnalisados}</strong></div>
                <div><span>{resultadoRealizado.filtros?.modo === 'malha' ? 'Na malha (filtro)' : 'Após filtros'}</span><strong>{resultadoRealizado.filtros?.ctesNaMalha ?? resultadoRealizado.ctesAnalisados}</strong></div>
                <div><span>CT-es analisados</span><strong>{resultadoRealizado.ctesAnalisados}</strong></div>
                <div><span>Com Tracking</span><strong>{resultadoRealizado.filtros?.ctesComTracking ?? resultadoRealizado.linhasComTracking ?? 0}</strong></div>
                <div><span>Sem Tracking</span><strong>{resultadoRealizado.filtros?.ctesSemTracking ?? 0}</strong></div>
                <div><span>Base simulada</span><strong>{resultadoRealizado.filtros?.ctesBaseSimulada ?? resultadoRealizado.ctesAnalisados}</strong></div>
                <div><span>CT-es simulados</span><strong>{resultadoRealizado.ctesSimulados}</strong><small style={{fontSize:'0.7em',color:'#64748b'}}>{compararConcorrentesRealizado ? 'com tabela concorrente' : 'vs realizado'}</small></div>
                <div><span>Sem tabela geral</span><strong style={{color: resultadoRealizado.ctesSemTabelaGeral > 0 ? '#b45309' : undefined}}>{resultadoRealizado.ctesSemTabelaGeral}</strong></div>
                <div><span>Com tabela selecionada</span><strong>{resultadoRealizado.ctesComTabelaSelecionada}</strong></div>
                <div><span>Sem tabela selecionada</span><strong>{resultadoRealizado.ctesSemTabelaSelecionada}</strong></div>
                <div><span>Aderência da tabela</span><strong>{formatPercent(resultadoRealizado.aderenciaSelecionada)}</strong></div>
                <div><span>Ganharia</span><strong style={{color:'#15803d'}}>{resultadoRealizado.ctesGanhariaSelecionada}</strong></div>
                <div><span>Perderia</span><strong style={{color:'#dc2626'}}>{resultadoRealizado.ctesPerdidosSelecionada}</strong></div>
              </div>

              {/* 4 estados */}
              {(resultadoRealizado.ctesDetalhes || []).length > 0 && (() => {
                const detalhesStatus = resultadoRealizado.ctesDetalhes || [];
                if (!compararConcorrentesRealizado) {
                  const vencedor = detalhesStatus.filter((i) => Number(i.freteSelecionada || 0) > 0 && i.ganhouRealizado).length;
                  const perdedor = detalhesStatus.filter((i) => Number(i.freteSelecionada || 0) > 0 && !i.ganhouRealizado).length;
                  const total = vencedor + perdedor;
                  const aderencia = total ? (vencedor / total) * 100 : 0;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 8 }}>
                      <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#15803d' }}>{vencedor}</div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#15803d' }}>✅ Vencedor vs realizado</div>
                        <div style={{ fontSize: '0.72rem', color: '#166534' }}>Tabela menor que o frete realizado</div>
                      </div>
                      <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#dc2626' }}>{perdedor}</div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#dc2626' }}>❌ Perdedor / acima do realizado</div>
                        <div style={{ fontSize: '0.72rem', color: '#b91c1c' }}>Aderência: {formatPercent(aderencia)} sobre {total.toLocaleString('pt-BR')} CT-e(s) comparados</div>
                      </div>
                    </div>
                  );
                }
                const ganhaTabGanhaReal = (resultadoRealizado.ctesDetalhes || []).filter((i) => i.statusSelecionada === 'Ganharia' && i.ganhouRealizado).length;
                const ganhaTabPerdeReal = (resultadoRealizado.ctesDetalhes || []).filter((i) => i.statusSelecionada === 'Ganharia' && !i.ganhouRealizado && i.freteSelecionada > 0).length;
                const perdeTabGanhaReal = (resultadoRealizado.ctesDetalhes || []).filter((i) => i.statusSelecionada === 'Perderia' && i.ganhouRealizado).length;
                const perdeTabPerdeReal = (resultadoRealizado.ctesDetalhes || []).filter((i) => i.statusSelecionada === 'Perderia' && !i.ganhouRealizado && i.freteSelecionada > 0).length;
                const totalComTabela = ganhaTabGanhaReal + ganhaTabPerdeReal + perdeTabGanhaReal + perdeTabPerdeReal;
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#15803d' }}>{ganhaTabGanhaReal}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#15803d' }}>✅ Ganha tudo</div>
                      <div style={{ fontSize: '0.7rem', color: '#166534' }}>1º + mais barato que realizado</div>
                    </div>
                    <div style={{ background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1d4ed8' }}>{ganhaTabPerdeReal}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1d4ed8' }}>⚠️ Acima do realizado</div>
                      <div style={{ fontSize: '0.7rem', color: '#1e40af' }}>Tabela acima do frete realizado</div>
                    </div>
                    <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#b45309' }}>{perdeTabGanhaReal}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#b45309' }}>💰 Ganha realizado</div>
                      <div style={{ fontSize: '0.7rem', color: '#92400e' }}>Mais barato que real, perde concorrência</div>
                    </div>
                    <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#dc2626' }}>{perdeTabPerdeReal}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626' }}>❌ Perde tudo</div>
                      <div style={{ fontSize: '0.7rem', color: '#b91c1c' }}>Mais caro que real + perde concorrência</div>
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const brutos = resultadoRealizado.filtros?.ctesBrutos ?? 0;
                const naMalha = resultadoRealizado.filtros?.ctesNaMalha ?? resultadoRealizado.ctesAnalisados;
                const descartados = brutos - naMalha;
                const pctDescartados = brutos > 0 ? (descartados / brutos) * 100 : 0;
                const origemNaoRec = resultadoRealizado.filtros?.origemMalhaNaoReconhecida || [];
                if (descartados > 0 && pctDescartados > 5) {
                  return (
                    <div className="sim-alert warning">
                      <strong>⚠ Atenção ao filtro de malha:</strong> {brutos.toLocaleString('pt-BR')} CT-es foram buscados do banco, mas apenas {naMalha.toLocaleString('pt-BR')} ({(100 - pctDescartados).toFixed(1)}%) têm a cidade de origem cadastrada na malha da transportadora selecionada. Os outros {descartados.toLocaleString('pt-BR')} CT-es foram excluídos da simulação por não terem origem reconhecida na malha. Para ver todos os CT-es do período, mude para o modo <strong>"Usar apenas filtros informados"</strong>.
                      {origemNaoRec.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: '0.82rem' }}>
                          Origens do realizado não encontradas na malha: <strong>{origemNaoRec.join(', ')}</strong>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}

              {(() => {
                const resumoGanhas = calcularResumoGanhasNegociacao(resultadoRealizado);
                const variacaoTodas = Number(resultadoRealizado.variacaoPercentualFreteComTabela || 0);
                const variacaoGanhas = Number(resumoGanhas.variacaoPercentual || 0);
                const corVariacaoTodas = variacaoTodas > 0 ? '#dc2626' : variacaoTodas < 0 ? '#15803d' : '#64748b';
                const corVariacaoGanhas = variacaoGanhas > 0 ? '#dc2626' : variacaoGanhas < 0 ? '#15803d' : '#64748b';
                return (
                  <div className="sim-parametros-box" style={{ border: '1px solid #d8b4fe', background: '#fbf7ff' }}>
                    <div className="sim-parametros-header">
                      <div>
                        <strong>📊 % frete — total coberto pela tabela × somente cargas ganhas</strong>
                        <p>A primeira visão considera todos os CT-es em que a tabela tem preço. A segunda mostra apenas o que ela efetivamente carregaria por ganhar.</p>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
                      <div className="summary-card" style={{ alignItems: 'flex-start' }}>
                        <span>Todos os CT-es com tabela</span>
                        <strong>{resultadoRealizado.ctesComTabelaSelecionada.toLocaleString('pt-BR')} CT-es</strong>
                        <small style={{ display: 'grid', gap: 3, marginTop: 6 }}>
                          <span>Realizado: <strong>{formatPercent(resultadoRealizado.percentualFreteRealizadoComTabela)}</strong></span>
                          <span>Tabela: <strong>{formatPercent(resultadoRealizado.percentualFreteSelecionadaComTabela)}</strong></span>
                          <span style={{ color: corVariacaoTodas }}>Variação: <strong>{formatPercent(variacaoTodas)}</strong></span>
                        </small>
                      </div>
                      <div className="summary-card" style={{ alignItems: 'flex-start' }}>
                        <span>Somente CT-es que a tabela ganha</span>
                        <strong>{resumoGanhas.ctesGanhas.toLocaleString('pt-BR')} CT-es</strong>
                        <small style={{ display: 'grid', gap: 3, marginTop: 6 }}>
                          <span>Realizado: <strong>{formatPercent(resumoGanhas.percentualRealizadoGanhas)}</strong></span>
                          <span>Tabela: <strong>{formatPercent(resumoGanhas.percentualTabelaGanhas)}</strong></span>
                          <span style={{ color: corVariacaoGanhas }}>Variação: <strong>{formatPercent(variacaoGanhas)}</strong></span>
                        </small>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const resumoGanhas = calcularResumoGanhasNegociacao(resultadoRealizado);
                return (
                  <div className="sim-parametros-box" style={{ border: '1px solid #bfdbfe', background: '#f8fbff' }}>
                    <div className="sim-parametros-header">
                      <div>
                        <strong>🎯 Resultado da negociação — somente rotas/CT-es que a tabela ganha</strong>
                        <p>Essa é a visão principal para negociar: mostra apenas o que a transportadora realmente carregaria por estar abaixo do realizado.</p>
                      </div>
                    </div>
                    <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginTop: 12 }}>
                      <div className="summary-card"><span>CT-es que ganha</span><strong>{resumoGanhas.ctesGanhas}</strong><small>{formatPercent(resumoGanhas.aderencia)} de aderência • {resumoGanhas.ctesComTabela.toLocaleString('pt-BR')} comparados</small></div>
                      <div className="summary-card"><span>Faturamento no período</span><strong>{formatMoney(resumoGanhas.freteTabelaGanhas)}</strong><small>só nas rotas/CT-es vencedores</small></div>
                      <div className="summary-card"><span>Faturamento mensal</span><strong>{formatMoney(resumoGanhas.faturamentoMes)}</strong><small>{resultadoRealizado.meses} mês(es) base</small></div>
                      <div className="summary-card"><span>Faturamento 12 meses</span><strong>{formatMoney(resumoGanhas.faturamentoAno)}</strong><small>projeção só das ganhas</small></div>
                      <div className="summary-card"><span>Saving no período</span><strong>{formatMoney(resumoGanhas.savingGanhas)}</strong><small>realizado − tabela nas ganhas</small></div>
                      <div className="summary-card"><span>Saving mensal</span><strong>{formatMoney(resumoGanhas.savingMes)}</strong><small>projeção mensal das ganhas</small></div>
                      <div className="summary-card"><span>Saving 12 meses</span><strong>{formatMoney(resumoGanhas.savingAno)}</strong><small>projeção anual das ganhas</small></div>
                      <div className="summary-card"><span>% NF antes</span><strong>{formatPercent(resumoGanhas.percentualRealizadoGanhas)}</strong><small>frete realizado nas cargas ganhas</small></div>
                      <div className="summary-card"><span>% NF tabela</span><strong>{formatPercent(resumoGanhas.percentualTabelaGanhas)}</strong><small>{formatPercent(resumoGanhas.variacaoPercentual)} vs realizado</small></div>
                      <div className="summary-card"><span>Cargas/dia</span><strong>{Number(resumoGanhas.cargasDia || 0).toFixed(1)}</strong><small>{Number(resumoGanhas.cargasMes || 0).toFixed(0)} cargas/mês</small></div>
                      <div className="summary-card"><span>Volumes/dia</span><strong>{Number(resumoGanhas.volumesDia || 0).toFixed(1)}</strong><small>{Number(resumoGanhas.volumesMes || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} volumes/mês</small></div>
                      <div className="summary-card"><span>Cubagem/dia</span><strong>{Number(resumoGanhas.cubagemDia || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong><small>{Number(resumoGanhas.cubagemMes || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³/mês</small></div>
                      <VeiculoOcupacaoCard
                        titulo="Veículo sugerido nas cargas ganhas"
                        cubagemDia={resumoGanhas.cubagemDia}
                        pesoDia={resumoGanhas.pesoDia}
                      />
                    </div>
                  </div>
                );
              })()}

              <div className="sim-parametros-box">
                <div className="sim-parametros-header"><div><strong>📌 Visão geral do recorte analisado</strong><p>Base total simulada. Use como contexto; a visão da negociação fica no quadro acima.</p></div></div>
              <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                <div className="summary-card"><span>Fonte tabela</span><strong>{resultadoRealizado.filtros?.fonteTabela === 'rotas_realizadas' ? 'Rotas realizadas' : 'Malha selecionada'}</strong><small>{Number(resultadoRealizado.filtros?.tabelasCarregadas || 0).toLocaleString('pt-BR')} tabela(s) carregada(s) • {Number(resultadoRealizado.filtros?.rotasReaisComIbge || 0).toLocaleString('pt-BR')} rota(s) reais</small></div>
                <div className="summary-card"><span>Frete realizado</span><strong>{formatMoney(resultadoRealizado.freteRealizado)}</strong><small>{formatPercent(resultadoRealizado.percentualFreteRealizado)} sobre NF</small></div>
                <div className="summary-card"><span>Faturamento tabela</span><strong>{formatMoney(resultadoRealizado.freteSelecionada)}</strong><small>nos CT-es com tabela</small></div>
                <div className="summary-card"><span>Projeção mensal</span><strong>{formatMoney(resultadoRealizado.faturamentoSelecionadaMes)}</strong><small>{resultadoRealizado.meses} mês(es) base</small></div>
                <div className="summary-card"><span>Projeção 12 meses</span><strong>{formatMoney(resultadoRealizado.faturamentoSelecionadaAno)}</strong><small>faturamento potencial</small></div>
                <div className="summary-card"><span>Saving ganhadora vs realizado</span><strong>{formatMoney(resultadoRealizado.savingSelecionadaVsReal)}</strong><small>{formatPercent(resultadoRealizado.percentualSavingSelecionada)} só CT-es que ganharia</small></div>
                <div className="summary-card"><span>Saving mercado</span><strong>{formatMoney(resultadoRealizado.savingVencedorVsReal)}</strong><small>{formatPercent(resultadoRealizado.percentualSavingVencedor)} melhor tabela geral</small></div>
                <div className="summary-card"><span>Saving tabela amplo</span><strong>{formatMoney(resultadoRealizado.savingTabelaSelecionadaVsRealBruto)}</strong><small>{formatPercent(resultadoRealizado.percentualSavingSelecionadaBruto)} todos CT-es com tabela</small></div>
                <div className="summary-card"><span>Saving 12 meses</span><strong>{formatMoney(resultadoRealizado.savingSelecionadaVsRealAno)}</strong><small>projeção só nas ganhas</small></div>
                <div className="summary-card"><span>% NF realizado nas ganhas</span><strong>{formatPercent(resultadoRealizado.percentualFreteRealizadoGanharia)}</strong><small>antes, nas cargas que ganharia</small></div>
                <div className="summary-card"><span>% NF tabela ganhadora</span><strong>{formatPercent(resultadoRealizado.percentualFreteTabelaGanharia)}</strong><small>{formatPercent(resultadoRealizado.variacaoPercentualFreteGanharia)} vs realizado</small></div>
                <div className="summary-card"><span>Cargas/dia</span><strong>{Number(resultadoRealizado.cargasDia || 0).toFixed(1)}</strong><small>{resultadoRealizado.dias} dia(s)</small></div>
                <div className="summary-card"><span>Volumes/dia</span><strong>{Number(resultadoRealizado.volumesDia || 0).toFixed(1)}</strong><small>{Number(resultadoRealizado.volumes || 0).toLocaleString('pt-BR')} volumes via Tracking • {Number(resultadoRealizado.linhasComTracking || 0).toLocaleString('pt-BR')} CT-es vinculados</small></div>
                <div className="summary-card"><span>Cubagem tracking</span><strong>{Number(resultadoRealizado.cubagemTotal || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong><small>m³ cruzado por NF/CT-e</small></div>
                <div className="summary-card"><span>Redução média p/ ganhar</span><strong>{formatPercent(resultadoRealizado.reducaoMediaNecessaria)}</strong><small>rotas perdidas</small></div>
                <div className="summary-card"><span>Perda para concorrentes</span><strong>{formatMoney(resultadoRealizado.diferencaSelecionadaVsVencedor)}</strong><small>diferença nas perdidas</small></div>
              </div>
              </div>

              {/* Botões colapso + alerta de discrepância */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="sim-tab" onClick={() => setSecoesFechadas(new Set())} style={{ fontSize: '0.8rem' }}>📂 Abrir tudo</button>
                <button className="sim-tab" onClick={() => setSecoesFechadas(new Set(['laudo', 'ganho-perdido', 'pareto', 'transp-realizado', 'rotas-perda-box', 'rotas-prioritarias', 'detalhes']))} style={{ fontSize: '0.8rem' }}>📁 Fechar tudo</button>
              </div>

              {/* Alerta de discrepância extrema de valores */}
              {(() => {
                const rotasDiscrepantes = (resultadoRealizado.rotas || []).filter((r) => r.freteSelecionada > 0 && r.freteVencedor > 0 && r.freteSelecionada / r.freteVencedor > 5);
                if (!rotasDiscrepantes.length) return null;
                const maxRatio = Math.max(...rotasDiscrepantes.map((r) => r.freteSelecionada / r.freteVencedor));
                return (
                  <div className="sim-alert warning" style={{ borderColor: '#dc2626', background: '#fff1f2' }}>
                    <strong>🚨 Atenção: discrepância suspeita nos valores calculados</strong>
                    <p style={{ margin: '6px 0 0', fontSize: '0.85rem' }}>
                      {rotasDiscrepantes.length} rota(s) têm o faturamento da tabela selecionada {maxRatio.toFixed(0)}× maior que o vencedor do mercado — o que não faz sentido competitivo.
                      <strong> Causa mais provável: o campo "valor_nf" nos CT-es importados está com valor incorreto (talvez o valor total da fatura do cliente em vez do valor da mercadoria por entrega).</strong>
                      Rotas afetadas: {rotasDiscrepantes.slice(0, 3).map((r) => `${r.rota} (${(r.freteSelecionada / r.freteVencedor).toFixed(0)}×)`).join(', ')}.
                      Clique em um CT-e na aba de detalhes para ver o "Valor NF utilizado" e confirmar.
                    </p>
                  </div>
                );
              })()}

              {resultadoRealizado.filtros?.trackingErro && (
                <div className="sim-alert warning">
                  <strong>Tracking não foi cruzado.</strong> {resultadoRealizado.filtros.trackingErro}. Volumes e cubagem do CT-e foram desconsiderados; CT-es sem Tracking ficam com volume/cubagem zerados.
                </div>
              )}

              {Number(resultadoRealizado.filtros?.trackingSemVinculo || 0) > 0 && (
                <div className="sim-alert warning">
                  <strong>Tracking incompleto:</strong> {Number(resultadoRealizado.filtros.trackingSemVinculo || 0).toLocaleString('pt-BR')} CT-e(s) não encontraram vínculo no Tracking por chave do CT-e, chave da NF, número da NF ou número do CT-e. Para esses casos, volumes e cubagem foram zerados no cálculo.
                </div>
              )}

              {Number(resultadoRealizado.filtros?.trackingCubagemOutliers || 0) > 0 && (
                <div className="sim-alert warning">
                  <strong>Cubagem fora do padrão:</strong> {Number(resultadoRealizado.filtros.trackingCubagemOutliers || 0).toLocaleString('pt-BR')} CT-e(s) vieram do Tracking com cubagem muito acima do limite operacional estimado. Para evitar distorção, a cubagem desses casos foi desconsiderada e o cálculo usou o peso real.
                </div>
              )}

              {resultadoRealizado.ctesSimulados === 0 && (
                <div className="sim-alert warning">
                  <strong>Nenhum CT-e foi simulado.</strong> O sistema encontrou o realizado, mas não achou tabela compatível por origem/destino/canal. Confira abaixo o diagnóstico para saber onde travou.
                  <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                    <div>Sem IBGE destino: <strong>{resultadoRealizado.diagnostico?.linhasSemIbgeDestino || 0}</strong></div>
                    <div>Com IBGE, mas sem tabela encontrada: <strong>{resultadoRealizado.diagnostico?.linhasSemResultado || 0}</strong></div>
                    <div>Canais usados na simulação: <strong>{(resultadoRealizado.diagnostico?.canaisUsados || []).map(([c, q]) => `${c}: ${q}`).join(' | ') || '-'}</strong></div>
                    <div>Origens mais usadas: <strong>{(resultadoRealizado.diagnostico?.origensUsadas || []).map(([o, q]) => `${o}: ${q}`).join(' | ') || '-'}</strong></div>
                    <div>Destinos sem tabela: <strong>{(resultadoRealizado.diagnostico?.destinosSemResultado || []).map(([d, q]) => `${d}: ${q}`).join(' | ') || '-'}</strong></div>
                  </div>
                </div>
              )}
              {resultadoRealizado.ctesSimulados > 0 && resultadoRealizado.ctesComTabelaSelecionada === 0 && (
                <div className="sim-alert warning">
                  <strong>Concorrentes foram simulados, mas a tabela selecionada não apareceu nas rotas.</strong> Isso indica que a transportadora escolhida não tem tabela para esses CT-es ou o nome da tabela/vínculo está diferente.
                </div>
              )}

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('laudo')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>Laudos da simulação</strong>
                    <p>Versões prontas para diretoria e para devolutiva comercial à transportadora.</p>
                  </div>
                  <span style={{ fontSize: '1.2rem', color: '#64748b' }}>{secaoAberta('laudo') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('laudo') && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {[
                      ['diretoria', 'Diretoria'],
                      ['transportadora', 'Transportadora'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        className={abaLaudoRealizado === id ? 'primary' : 'sim-tab'}
                        type="button"
                        onClick={() => setAbaLaudoRealizado(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {laudoEmailAtual && (
                    <div style={{ marginTop: 12, display: 'grid', gap: 12, minWidth: 0 }}>
                      <div style={{ border: '1px solid #bfdbfe', background: '#f8fbff', borderRadius: 12, padding: 14, display: 'grid', gap: 10, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                          <div>
                            <strong>{laudoEmailAtual.titulo}</strong>
                            <p style={{ margin: '4px 0 0', color: '#64748b' }}>Assunto e corpo prontos para copiar e enviar por e-mail.</p>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="sim-tab" type="button" onClick={() => copiarTextoLaudo(laudoEmailAtual.assunto, 'Assunto')}>Copiar assunto</button>
                            <button className="sim-tab" type="button" onClick={() => copiarTextoLaudo(laudoEmailAtual.corpo, 'Corpo')}>Copiar corpo</button>
                            <button className="sim-tab" type="button" onClick={() => copiarTextoLaudo(laudoEmailAtual.completo, 'Laudo completo')}>Copiar laudo</button>
                            <button className="primary" type="button" onClick={() => exportarLaudoEmailRealizado(abaLaudoRealizado)}>Exportar XLSX</button>
                          </div>
                        </div>
                        {feedbackCopiaLaudo && <div className="sim-alert info" style={{ margin: 0 }}>{feedbackCopiaLaudo}</div>}
                        <div>
                          <span style={{ display: 'block', fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 4 }}>Assunto sugerido</span>
                          <div style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 8, padding: '10px 12px', fontWeight: 700, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{laudoEmailAtual.assunto}</div>
                        </div>
                        <div>
                          <span style={{ display: 'block', fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 4 }}>Corpo do e-mail</span>
                          <pre style={{ margin: 0, background: '#fff', border: '1px solid #dbeafe', borderRadius: 8, padding: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', fontFamily: 'inherit', lineHeight: 1.55, maxHeight: 520, overflowY: 'auto' }}>{laudoEmailAtual.corpo}</pre>
                        </div>
                      </div>

                      <div className="summary-grid">
                        {(laudoEmailAtual.kpis || []).map(([label, valor]) => (
                          <div className="summary-card" key={`${abaLaudoRealizado}-${label}`}>
                            <span>{label}</span>
                            <strong>{valor}</strong>
                          </div>
                        ))}
                      </div>

                      {laudoEmailAtual.observacaoCubagem && (
                        <div className="sim-alert info" style={{ margin: 0 }}>{laudoEmailAtual.observacaoCubagem}</div>
                      )}

                      <div className="feature-grid import-grid">
                        <div className="sim-parametros-box">
                          <div className="sim-parametros-header"><div><strong>Principais rotas ganhas</strong><p>Rotas em que a tabela ficou competitiva no recorte.</p></div></div>
                          <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
                            <table className="sim-analise-tabela">
                              <thead><tr><th>Rota</th><th>CT-es</th><th>{abaLaudoRealizado === 'diretoria' ? 'Faturamento' : 'Posicionamento'}</th><th>{abaLaudoRealizado === 'diretoria' ? 'Saving' : 'Observação'}</th></tr></thead>
                              <tbody>
                                {(laudoEmailAtual.rotasGanhas || []).slice(0, 6).map((item) => (
                                  <tr key={`${abaLaudoRealizado}-ganha-${item.rota}`}>
                                    <td><strong>{item.rota}</strong></td>
                                    <td>{formatNumberBR(item.qtdGanhasSelecionada || 0)}</td>
                                    <td>{abaLaudoRealizado === 'diretoria' ? formatMoney(item.freteSelecionadaGanhadora || 0) : 'Boa competitividade'}</td>
                                    <td>{abaLaudoRealizado === 'diretoria' ? formatMoney(item.savingGanhasSelecionada || item.savingSelecionada || 0) : 'Manter competitividade'}</td>
                                  </tr>
                                ))}
                                {!(laudoEmailAtual.rotasGanhas || []).length && <tr><td colSpan={4}>Nenhuma rota ganhadora encontrada.</td></tr>}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="sim-parametros-box">
                          <div className="sim-parametros-header"><div><strong>Principais rotas perdidas</strong><p>Rotas prioritárias para revisão comercial.</p></div></div>
                          <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
                            <table className="sim-analise-tabela">
                              <thead><tr><th>Rota</th><th>CT-es</th><th>Redução média</th><th>Referência</th></tr></thead>
                              <tbody>
                                {(laudoEmailAtual.rotasPerdidas || []).slice(0, 6).map((item) => (
                                  <tr key={`${abaLaudoRealizado}-perda-${item.rota}`}>
                                    <td><strong>{item.rota}</strong></td>
                                    <td>{formatNumberBR(item.qtdPerdidasSelecionada || item.ctes || 0)}</td>
                                    <td>{formatPercent(item.reducaoMediaNecessaria || 0)}</td>
                                    <td>{item.principalVencedor || '-'}</td>
                                  </tr>
                                ))}
                                {!(laudoEmailAtual.rotasPerdidas || []).length && <tr><td colSpan={4}>Nenhuma rota perdida crítica encontrada.</td></tr>}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="sim-parametros-box">
                          <div className="sim-parametros-header"><div><strong>Resumo por estado</strong><p>Leitura rápida de aderência por UF.</p></div></div>
                          <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
                            {(laudoEmailAtual.estados || []).slice(0, 6).map((item) => (
                              <div key={`${abaLaudoRealizado}-uf-${item.uf}`}>
                                <strong>{item.uf}</strong> · {formatNumberBR(item.ctesGanhas || 0)} ganhos · {formatNumberBR(item.ctesPerdidas || 0)} perdidos · aderência {formatPercent(item.aderencia || 0)}
                              </div>
                            ))}
                            {!(laudoEmailAtual.estados || []).length && <div>Resumo por UF não disponível.</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#475569' }}>Ver resumo legado em bullets</summary>
                  <ul style={{ marginTop: 12 }}>
                    {(resultadoRealizado.laudo || []).map((linha, index) => <li key={index}>{linha}</li>)}
                  </ul>
                  <div className="summary-grid" style={{ marginTop: 12 }}>
                    <div className="summary-card"><span>Rotas com ganho</span><strong>{Number(resultadoRealizado.qtdRotasComGanhoSelecionada || 0).toLocaleString('pt-BR')}</strong><small>{Number(resultadoRealizado.qtdRotasGanhasSelecionada || 0).toLocaleString('pt-BR')} 100% ganhas · {Number(resultadoRealizado.qtdRotasParciaisSelecionada || 0).toLocaleString('pt-BR')} parciais</small></div>
                    <div className="summary-card"><span>Faturamento ganho</span><strong>{formatMoney(resultadoRealizado.freteSelecionadaGanhadora || 0)}</strong><small>{formatMoney(resultadoRealizado.faturamentoSelecionadaGanhadoraMes || 0)} / mês</small></div>
                    <div className="summary-card"><span>Estados com ganho</span><strong>{Number((resultadoRealizado.estadosGanhadoresDestaque || []).length || 0).toLocaleString('pt-BR')}</strong><small>{(resultadoRealizado.estadosGanhadoresDestaque || []).slice(0, 3).map((item) => item.uf).join(', ') || 'Sem UF ganhadora'}</small></div>
                    <div className="summary-card"><span>Quem perde fat.</span><strong>{formatMoney(resultadoRealizado.freteCapturadoRealizado || 0)}</strong><small>{Number(resultadoRealizado.ctesCapturadosDeOutras || 0).toLocaleString('pt-BR')} CT-es capturados</small></div>
                  </div>

                  <div className="feature-grid import-grid" style={{ marginTop: 12 }}>
                    <div className="sim-parametros-box">
                      <div className="sim-parametros-header">
                        <div><strong>Rotas ganhadoras</strong><p>Principais rotas onde a tabela entra vencedora.</p></div>
                      </div>
                      <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
                        {(resultadoRealizado.rotasGanhasDestaque || []).slice(0, 8).map((item) => (
                          <div key={`${item.rota}-${item.tipo}-ganha`}>
                            <strong>{item.rota}</strong> · {Number(item.qtdGanhasSelecionada || 0).toLocaleString('pt-BR')} CT-es · {formatMoney(item.freteSelecionadaGanhadora || 0)} · saving {formatMoney(item.savingGanhasSelecionada || 0)}
                          </div>
                        ))}
                        {!(resultadoRealizado.rotasGanhasDestaque || []).length && <div>Nenhuma rota ganhadora encontrada com os filtros atuais.</div>}
                      </div>
                    </div>

                    <div className="sim-parametros-box">
                      <div className="sim-parametros-header">
                        <div><strong>Resumo por estado</strong><p>Onde ganha, onde perde e onde precisa negociar.</p></div>
                      </div>
                      <div className="sim-analise-tabela-wrap" style={{ marginTop: 10 }}>
                        <table className="sim-analise-tabela">
                          <thead>
                            <tr><th>UF</th><th>Ganha</th><th>Perde</th><th>Aderência</th><th>Fat. ganho</th><th>Dif. p/ virar</th></tr>
                          </thead>
                          <tbody>
                            {(resultadoRealizado.resumoPorEstado || []).slice(0, 8).map((item) => (
                              <tr key={`laudo-uf-${item.uf}`}>
                                <td><strong>{item.uf}</strong></td>
                                <td>{Number(item.ctesGanhas || 0).toLocaleString('pt-BR')}</td>
                                <td>{Number(item.ctesPerdidas || 0).toLocaleString('pt-BR')}</td>
                                <td>{formatPercent(item.aderencia || 0)}</td>
                                <td>{formatMoney(item.freteSelecionadaGanhas || 0)}</td>
                                <td>{formatMoney(item.diferencaParaVencedor || 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="sim-parametros-box">
                      <div className="sim-parametros-header">
                        <div><strong>Faturamento que muda de transportadora</strong><p>Quem tende a perder volume se a negociação for aplicada.</p></div>
                      </div>
                      <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
                        {(resultadoRealizado.transportadorasPerdaDestaque || []).slice(0, 8).map((item) => (
                          <div key={`laudo-perda-${item.transportadora}`}>
                            <strong>{item.transportadora}</strong> · perde {formatMoney(item.freteCedidoSelecionada || 0)} · {Number(item.ctesCedidosSelecionada || 0).toLocaleString('pt-BR')} CT-es · redução {formatPercent(item.reducaoFaturamentoPct || 0)}
                          </div>
                        ))}
                        {!(resultadoRealizado.transportadorasPerdaDestaque || []).length && <div>Nenhuma transportadora atual perderia faturamento para a selecionada nos filtros atuais.</div>}
                      </div>
                    </div>
                  </div>
                  </details>
                </>
                )}
              </div>

              <div className="feature-grid import-grid">
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header" onClick={() => toggleSecao('transp-realizado')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <div><strong>Transportadoras atuais no realizado</strong><p>Quem está carregando nos CT-es filtrados.</p></div>
                    <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('transp-realizado') ? '▲' : '▼'}</span>
                  </div>
                  {secaoAberta('transp-realizado') && (
                  <>
                    <div className="summary-grid" style={{ marginTop: 12 }}>
                      <div className="summary-card"><span>CT-es capturados</span><strong>{(resultadoRealizado.ctesCapturadosDeOutras || 0).toLocaleString('pt-BR')}</strong><small>volume que sai das atuais</small></div>
                      <div className="summary-card"><span>Faturamento que baixa</span><strong>{formatMoney(resultadoRealizado.freteCapturadoRealizado || 0)}</strong><small>{formatPercent(resultadoRealizado.reducaoFaturamentoTotalPct || 0)} do realizado filtrado</small></div>
                      <div className="summary-card"><span>Faturamento na tabela</span><strong>{formatMoney(resultadoRealizado.freteCapturadoTabela || 0)}</strong><small>valor absorvido pela selecionada</small></div>
                      <div className="summary-card"><span>Saving capturado</span><strong>{formatMoney(resultadoRealizado.savingCapturado || 0)}</strong><small>diferença do realizado para tabela</small></div>
                    </div>

                    <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                      <table className="sim-analise-tabela">
                        <thead>
                          <tr>
                            <th>Transportadora atual</th>
                            <th>CT-es atuais</th>
                            <th>Frete atual</th>
                            <th>% frete atual</th>
                            <th>CT-es cedidos</th>
                            <th>Frete que baixa</th>
                            <th>% redução fat.</th>
                            <th>Novo fat. proj.</th>
                            <th>Nova % frete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(resultadoRealizado.impactoTransportadoras || resultadoRealizado.porTransportadoraReal || []).slice(0, 20).map((item) => (
                            <tr key={item.transportadora}>
                              <td><strong>{item.transportadora}</strong></td>
                              <td>{Number(item.ctes || 0).toLocaleString('pt-BR')}</td>
                              <td>{formatMoney(item.frete)}</td>
                              <td>{formatPercent(item.pctFrete)}</td>
                              <td style={{ color: item.ctesCedidosSelecionada ? '#dc2626' : '#64748b', fontWeight: item.ctesCedidosSelecionada ? 700 : 400 }}>{Number(item.ctesCedidosSelecionada || 0).toLocaleString('pt-BR')}</td>
                              <td style={{ color: item.freteCedidoSelecionada ? '#dc2626' : '#64748b', fontWeight: item.freteCedidoSelecionada ? 700 : 400 }}>{formatMoney(item.freteCedidoSelecionada || 0)}</td>
                              <td style={{ color: item.reducaoFaturamentoPct ? '#dc2626' : '#64748b', fontWeight: item.reducaoFaturamentoPct ? 700 : 400 }}>{formatPercent(item.reducaoFaturamentoPct || 0)}</td>
                              <td>{formatMoney(item.novoFaturamentoProjetado ?? item.frete)}</td>
                              <td>{formatPercent(item.pctFreteProjetado ?? item.pctFrete)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <small style={{ display: 'block', marginTop: 8, color: '#64748b' }}>
                      CT-es cedidos considera somente cargas em que a tabela selecionada ganha da transportadora atual e fica abaixo do frete realizado. Quando a própria selecionada já carregava o CT-e, o volume é tratado como retenção, não como perda de outra transportadora.
                    </small>
                  </>
                  )}
                </div>

                <div className="sim-parametros-box">
                  <div className="sim-parametros-header" onClick={() => toggleSecao('rotas-perda-box')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <div><strong>Rotas acima do realizado / perdidas</strong><p>Maiores diferenças contra o realizado e, quando houver concorrentes, contra a melhor tabela.</p></div>
                    <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('rotas-perda-box') ? '▲' : '▼'}</span>
                  </div>
                  {secaoAberta('rotas-perda-box') && (
                  <div className="sim-cobertura-lista" style={{ marginTop: 12 }}>
                    {(resultadoRealizado.rotas || []).filter((item) => item.diferencaParaVencedor > 0).slice(0, 12).map((item) => (
                      <div key={`${item.rota}-${item.tipo}`}>
                        <strong>{item.rota}</strong> · {item.ctes} CT-es · perde para {item.principalVencedor} · reduzir média {formatPercent(item.reducaoMediaNecessaria)}
                      </div>
                    ))}
                    {!(resultadoRealizado.rotas || []).some((item) => item.diferencaParaVencedor > 0) && <div>Nenhuma rota perdida encontrada com os filtros atuais.</div>}
                  </div>
                  )}
                </div>
              </div>

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('ganho-perdido')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>💰 Faturamento Ganho × Perdido</strong>
                    <p>Visão consolidada do que a tabela ganha e perde no período analisado.</p>
                  </div>
                  <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('ganho-perdido') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('ganho-perdido') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 8 }}>✅ Rotas GANHAS</div>
                    <div style={{ display: 'grid', gap: 6, fontSize: '0.88rem' }}>
                      <div>CT-es ganharia: <strong>{resultadoRealizado.ctesGanhariaSelecionada}</strong></div>
                      <div>Faturamento tabela (período): <strong>{formatMoney(resultadoRealizado.freteSelecionadaGanhadora)}</strong></div>
                      <div>Faturamento mensal projetado: <strong style={{ fontSize: '1.05em' }}>{formatMoney(resultadoRealizado.meses ? resultadoRealizado.freteSelecionadaGanhadora / resultadoRealizado.meses : 0)}</strong></div>
                      <div>Faturamento 12 meses projetado: <strong style={{ fontSize: '1.05em' }}>{formatMoney(resultadoRealizado.meses ? (resultadoRealizado.freteSelecionadaGanhadora / resultadoRealizado.meses) * 12 : 0)}</strong></div>
                      <div>% NF nas rotas ganhas: <strong>{formatPercent(resultadoRealizado.percentualFreteTabelaGanharia)}</strong></div>
                    </div>
                  </div>
                  <div style={{ background: '#fff7f0', border: '1px solid #fed7aa', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontWeight: 700, color: '#c2410c', marginBottom: 8 }}>❌ Rotas PERDIDAS</div>
                    <div style={{ display: 'grid', gap: 6, fontSize: '0.88rem' }}>
                      <div>CT-es perderia: <strong>{resultadoRealizado.ctesPerdidosSelecionada}</strong></div>
                      <div>Faturamento tabela (perdidas): <strong>{formatMoney((resultadoRealizado.freteSelecionada || 0) - (resultadoRealizado.freteSelecionadaGanhadora || 0))}</strong></div>
                      <div>Faturamento mensal nas perdidas: <strong style={{ fontSize: '1.05em' }}>{formatMoney(resultadoRealizado.meses ? ((resultadoRealizado.freteSelecionada || 0) - (resultadoRealizado.freteSelecionadaGanhadora || 0)) / resultadoRealizado.meses : 0)}</strong></div>
                      <div>Diferença para o vencedor: <strong style={{ color: '#dc2626' }}>{formatMoney(resultadoRealizado.diferencaSelecionadaVsVencedor)}</strong></div>
                      <div>Redução média necessária: <strong style={{ color: '#dc2626' }}>{formatPercent(resultadoRealizado.reducaoMediaNecessaria)}</strong></div>
                    </div>
                  </div>
                </div>
                )}
              </div>

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('pareto')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>🎯 Pareto 80% — Rotas Prioritárias com Redução Necessária</strong>
                    <p>Rotas que concentram ~80% do volume. Linha a linha com quanto precisa reduzir para virar ganhadora. <strong>Use para negociação e devolutiva ao transportador.</strong></p>
                  </div>
                  <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('pareto') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('pareto') && (<>
                <div className="sim-analise-resumo" style={{ marginTop: 12 }}>
                  <div><span>Rotas no 80%</span><strong>{resultadoRealizado.pareto80Volume?.qtdRotas || 0}</strong></div>
                  <div><span>Volume coberto</span><strong>{formatPercent(resultadoRealizado.pareto80Volume?.pctCoberto || 0)}</strong></div>
                  <div><span>Faturamento tabela (80%)</span><strong>{formatMoney(resultadoRealizado.pareto80Volume?.freteSelecionada || 0)}</strong></div>
                  <div><span>Faturamento perdido (80%)</span><strong style={{color:'#dc2626'}}>{formatMoney(resultadoRealizado.pareto80Volume?.diferencaParaVencedor || 0)}</strong></div>
                  <div><span>Redução média (80%)</span><strong style={{color:'#c2410c'}}>{formatPercent(resultadoRealizado.pareto80Volume?.reducaoMediaNecessaria || 0)}</strong></div>
                </div>
                <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                  <table className="sim-analise-tabela" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Rota</th>
                        <th>CT-es</th>
                        <th>Volumes</th>
                        <th>% vol.</th>
                        <th>% acum.</th>
                        <th>Frete realizado</th>
                        <th>Faturamento tabela</th>
                        <th>Frete melhor tabela</th>
                        <th>% NF tabela</th>
                        <th>% NF melhor</th>
                        <th>Status predominante</th>
                        <th style={{color:'#dc2626'}}>⬇ Redução necessária</th>
                        <th>Principal melhor tabela</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resultadoRealizado.pareto80Volume?.rotas || []).map((item, idx) => {
                        const statusPred = item.qtdGanhasSelecionada >= item.qtdPerdidasSelecionada ? 'Ganharia' : 'Perderia';
                        return (
                          <tr key={`pareto-${item.rota}-${item.tipo}`}
                            style={{ background: statusPred === 'Ganharia' ? '#f0fdf4' : item.reducaoMediaNecessaria > 0 ? '#fff7f0' : undefined }}>
                            <td style={{ color: '#94a3b8' }}>{idx + 1}</td>
                            <td><strong>{item.rota}</strong></td>
                            <td>{item.ctes}</td>
                            <td>{Number(item.volumes || item.ctes || 0).toLocaleString('pt-BR')}</td>
                            <td>{formatPercent(item.pctVolume)}</td>
                            <td>{formatPercent(item.pctAcumulado)}</td>
                            <td>{formatMoney(item.freteRealizado)}</td>
                            <td>{formatMoney(item.freteSelecionada)}</td>
                            <td>{formatMoney(item.freteVencedor)}</td>
                            <td>{formatPercent(item.percentualFreteSelecionada)}</td>
                            <td>{formatPercent(item.percentualFreteVencedor)}</td>
                            <td>
                              <span style={{
                                padding: '2px 7px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
                                background: statusPred === 'Ganharia' ? '#dcfce7' : '#fee2e2',
                                color: statusPred === 'Ganharia' ? '#15803d' : '#dc2626',
                              }}>{statusPred}</span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: item.reducaoMediaNecessaria > 0 ? '#dc2626' : '#15803d' }}>
                              {item.reducaoMediaNecessaria > 0 ? `↓ ${formatPercent(item.reducaoMediaNecessaria)}` : '✓ Ganhador'}
                            </td>
                            <td style={{ color: '#64748b' }}>{item.principalVencedor || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </>)}
              </div>

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('rotas-prioritarias')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>Rotas prioritárias para ajuste</strong>
                    <p>Ordenado por oportunidade: saving contra realizado + diferença para o vencedor + volume.</p>
                  </div>
                  <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('rotas-prioritarias') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('rotas-prioritarias') && (
                <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                  <table className="sim-analise-tabela">
                    <thead>
                      <tr>
                        <th>Rota</th>
                        <th>Tipo</th>
                        <th>CT-es</th>
                        <th>Volumes</th>
                        <th>Realizado</th>
                        <th>Tabela selecionada</th>
                        <th>Melhor tabela</th>
                        <th>% NF real</th>
                        <th>% NF tabela</th>
                        <th>% NF melhor</th>
                        <th>Saving ganhadora</th>
                        <th>Saving tabela amplo</th>
                        <th>Dif. vencedor</th>
                        <th>Redução média</th>
                        <th>Principal melhor tabela</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resultadoRealizado.rotas || []).slice(0, 80).map((item) => (
                        <tr key={`${item.rota}-${item.tipo}`}>
                          <td><strong>{item.rota}</strong></td>
                          <td>{item.tipo}</td>
                          <td>{item.ctes}</td>
                          <td>{Number(item.volumes || 0).toLocaleString('pt-BR')}</td>
                          <td>{formatMoney(item.freteRealizado)}</td>
                          <td>{formatMoney(item.freteSelecionada)}</td>
                          <td>{formatMoney(item.freteVencedor)}</td>
                          <td>{formatPercent(item.percentualFreteRealizado)}</td>
                          <td>{formatPercent(item.percentualFreteSelecionada)}</td>
                          <td>{formatPercent(item.percentualFreteVencedor)}</td>
                          <td className={item.savingSelecionada > 0 ? 'positivo' : ''}>{formatMoney(item.savingSelecionada)}</td>
                          <td>{formatMoney(item.savingTabelaSelecionadaBruto || 0)}</td>
                          <td className={item.diferencaParaVencedor > 0 ? 'negativo' : ''}>{formatMoney(item.diferencaParaVencedor)}</td>
                          <td>{formatPercent(item.reducaoMediaNecessaria)}</td>
                          <td>{item.principalVencedor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
              </div>

              <div className="sim-parametros-box">
                <div className="sim-parametros-header" onClick={() => toggleSecao('detalhes')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div>
                    <strong>Análise Detalhada</strong>
                    <p>
                      {(resultadoRealizado.ctesDetalhes || []).length.toLocaleString('pt-BR')} CT-es com detalhes de cálculo disponíveis. A lista não é mais limitada a 1.000; a paginação abaixo controla apenas a visualização.
                      Clique em qualquer linha para ver o cálculo completo.
                    </p>
                  </div>
                  <span style={{ fontSize: '1.1rem', color: '#64748b' }}>{secaoAberta('detalhes') ? '▲' : '▼'}</span>
                </div>
                {secaoAberta('detalhes') && (<>
                {/* Mini-abas */}
                <div style={{ display: 'flex', gap: 8, margin: '12px 0 0', borderBottom: '2px solid #e2e8f0', paddingBottom: 0 }}>
                  {[['ctes', '📋 CT-e a CT-e'], ['uf', '🗺 Por Estado (UF)']].map(([id, label]) => (
                    <button key={id}
                      onClick={() => setAbaDetalheRealizado(id)}
                      style={{
                        padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                        background: 'none', borderBottom: abaDetalheRealizado === id ? '2px solid #3b82f6' : '2px solid transparent',
                        color: abaDetalheRealizado === id ? '#2563eb' : '#64748b', marginBottom: -2,
                      }}>{label}</button>
                  ))}
                </div>

                {/* ── ABA: POR UF ── */}
                {abaDetalheRealizado === 'uf' && (() => {
                  const porUf = new Map();
                  (resultadoRealizado.ctesDetalhes || []).forEach((item) => {
                    const uf = item.ufDestino || 'N/A';
                    const d = porUf.get(uf) || { uf, ctes: 0, ganhou: 0, perdeu: 0, semTabela: 0, freteRealizado: 0, freteSelecionada: 0, freteVencedor: 0, valorNF: 0, diferencaTotal: 0, reducaoSoma: 0, reducaoQtd: 0 };
                    d.ctes += 1;
                    d.freteRealizado += item.freteRealizado || 0;
                    d.freteSelecionada += item.freteSelecionada || 0;
                    d.freteVencedor += item.freteVencedor || 0;
                    d.valorNF += item.valorNF || 0;
                    if (item.statusSelecionada === 'Ganharia') d.ganhou += 1;
                    else if (item.statusSelecionada === 'Perderia') { d.perdeu += 1; d.diferencaTotal += item.diferencaParaVencedor || 0; if (item.reducaoNecessaria > 0) { d.reducaoSoma += item.reducaoNecessaria; d.reducaoQtd += 1; } }
                    else d.semTabela += 1;
                    porUf.set(uf, d);
                  });
                  const lista = [...porUf.values()].sort((a, b) => b.ctes - a.ctes);
                  return (
                    <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                      <table className="sim-analise-tabela" style={{ fontSize: '0.8rem' }}>
                        <thead>
                          <tr>
                            <th>UF Destino</th><th>CT-es</th><th>Ganharia</th><th>Perderia</th><th>Aderência</th>
                            <th>Frete realizado</th><th>Faturamento tabela</th><th>Frete melhor tabela</th>
                            <th>% NF tabela</th><th>% NF melhor</th>
                            <th style={{color:'#dc2626'}}>Dif. total vencedor</th>
                            <th style={{color:'#dc2626'}}>Redução média</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lista.map((d) => {
                            const aderencia = (d.ganhou + d.perdeu) > 0 ? (d.ganhou / (d.ganhou + d.perdeu)) * 100 : 0;
                            const pctNFTabela = d.valorNF > 0 ? (d.freteSelecionada / d.valorNF) * 100 : 0;
                            const pctNFVencedor = d.valorNF > 0 ? (d.freteVencedor / d.valorNF) * 100 : 0;
                            const reducaoMedia = d.reducaoQtd > 0 ? d.reducaoSoma / d.reducaoQtd : 0;
                            return (
                              <tr key={d.uf} style={{ background: aderencia > 60 ? '#f0fdf4' : aderencia > 0 ? '#fff7f0' : undefined }}>
                                <td><strong>{d.uf}</strong></td>
                                <td>{d.ctes}</td>
                                <td style={{ color: '#15803d', fontWeight: 600 }}>{d.ganhou}</td>
                                <td style={{ color: '#dc2626', fontWeight: 600 }}>{d.perdeu}</td>
                                <td style={{ fontWeight: 700, color: aderencia > 60 ? '#15803d' : aderencia > 30 ? '#c2410c' : '#dc2626' }}>{aderencia > 0 ? formatPercent(aderencia) : '-'}</td>
                                <td>{formatMoney(d.freteRealizado)}</td>
                                <td>{d.freteSelecionada > 0 ? formatMoney(d.freteSelecionada) : '-'}</td>
                                <td>{formatMoney(d.freteVencedor)}</td>
                                <td>{pctNFTabela > 0 ? formatPercent(pctNFTabela) : '-'}</td>
                                <td>{formatPercent(pctNFVencedor)}</td>
                                <td style={{ color: '#dc2626', fontWeight: d.diferencaTotal > 0 ? 600 : undefined }}>{d.diferencaTotal > 0 ? formatMoney(d.diferencaTotal) : '-'}</td>
                                <td style={{ color: '#dc2626' }}>{reducaoMedia > 0 ? `↓ ${formatPercent(reducaoMedia)}` : <span style={{ color: '#15803d' }}>✓</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* ── ABA: CT-E A CT-E ── */}
                {abaDetalheRealizado === 'ctes' && (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        value={filtroDetalhe}
                        onChange={(e) => { setFiltroDetalhe(e.target.value); setPaginaDetalhe(0); }}
                        placeholder="Filtrar por CT-e, transportadora, origem, destino, status..."
                        style={{ flex: 1, minWidth: 220, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.85rem' }}
                      />
                      <button className="sim-tab" onClick={() => setLinhasExpandidas(new Set())} style={{ fontSize: '0.8rem' }}>Fechar todos</button>
                      <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {(() => {
                          const q = filtroDetalhe.toLowerCase();
                          return `${(resultadoRealizado.ctesDetalhes || []).filter((item) => !q || [item.cte, item.transportadoraReal, item.origem, item.destino, item.vencedor, item.statusSelecionada, item.canal, item.ufDestino].some((v) => String(v || '').toLowerCase().includes(q))).length} CT-e(s)`;
                        })()}
                      </span>
                    </div>
                    <div className="sim-analise-tabela-wrap" style={{ marginTop: 4 }}>
                      <table className="sim-analise-tabela" style={{ fontSize: '0.78rem' }}>
                        <thead>
                          <tr>
                            <th></th><th>#</th><th>CT-e</th><th>Data</th><th>Origem</th><th>Destino/UF</th>
                            <th>Transp. real</th><th>Peso</th><th>Cubagem</th><th>Valor NF</th><th>Vol.</th>
                            <th>Frete realizado</th><th>% NF real</th>
                            <th>Tabela selecionada</th><th>% NF tabela</th>
                            <th>Melhor tabela</th><th>Frete melhor tabela</th><th>% NF melhor</th>
                            <th>Status</th><th>Rank</th><th>Redução</th><th>Conc.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const todos = resultadoRealizado.ctesDetalhes || [];
                            const q = filtroDetalhe.toLowerCase();
                            const filtrados = q ? todos.filter((item) => [item.cte, item.transportadoraReal, item.origem, item.destino, item.vencedor, item.statusSelecionada, item.canal, item.ufDestino, item.ufOrigem].some((v) => String(v || '').toLowerCase().includes(q))) : todos;
                            const totalPaginas = Math.ceil(filtrados.length / DETALHE_POR_PAGINA);
                            const pagina = Math.min(paginaDetalhe, Math.max(0, totalPaginas - 1));
                            const slice = filtrados.slice(pagina * DETALHE_POR_PAGINA, (pagina + 1) * DETALHE_POR_PAGINA);
                            return slice.map((item, index) => {
                              const key = `${item.cte}-${pagina * DETALHE_POR_PAGINA + index}`;
                              const expandido = linhasExpandidas.has(key);
                              const statusC = statusCombinadoCte(item);
                              const bgRow = statusC.label === 'Ganha tudo' ? '#f0fdf4' : statusC.label === 'Ganha realizado' ? '#fffbeb' : statusC.label === 'Acima do realizado' ? '#fff7f0' : statusC.label === 'Perde tudo' ? '#fff7f0' : undefined;
                              return (
                                <>
                                  <tr key={key}
                                    onClick={() => setLinhasExpandidas((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
                                    style={{ background: bgRow, cursor: 'pointer' }}
                                    title="Clique para ver detalhes do cálculo">
                                    <td style={{ textAlign: 'center', color: '#3b82f6', fontSize: '1em' }}>{expandido ? '▼' : '▶'}</td>
                                    <td style={{ color: '#94a3b8' }}>{pagina * DETALHE_POR_PAGINA + index + 1}</td>
                                    <td style={{ fontFamily: 'monospace', fontSize: '0.73rem' }}>{item.cte || '-'}{item.fallbackOrigem ? ' ⚡' : ''}</td>
                                    <td>{item.data ? String(item.data).slice(0, 10) : '-'}</td>
                                    <td>{item.origemUsada || item.origem}/{item.ufOrigem}</td>
                                    <td><strong>{item.destino}</strong>/{item.ufDestino}</td>
                                    <td>{item.transportadoraReal}</td>
                                    <td style={{ textAlign: 'right' }}>{Number(item.peso || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                                    <td style={{ textAlign: 'right' }}>{Number(item.cubagem || 0).toFixed(4)}</td>
                                    <td style={{ textAlign: 'right' }}>{formatMoney(item.valorNF)}</td>
                                    <td style={{ textAlign: 'right' }}>{Number(item.volumes || 0).toLocaleString('pt-BR')}{item.trackingMatch ? ' ✓' : ''}</td>
                                    <td style={{ textAlign: 'right' }}><strong>{formatMoney(item.freteRealizado)}</strong></td>
                                    <td style={{ textAlign: 'right', color: item.percentualFreteRealizado < 1 ? '#dc2626' : undefined }}>{formatPercent(item.percentualFreteRealizado)}</td>
                                    <td style={{ textAlign: 'right' }}>{item.freteSelecionada ? formatMoney(item.freteSelecionada) : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                                    <td style={{ textAlign: 'right' }}>{item.freteSelecionada ? formatPercent(item.percentualFreteSelecionada) : '—'}</td>
                                    <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.vencedor || '-'}</td>
                                    <td style={{ textAlign: 'right' }}>{formatMoney(item.freteVencedor)}</td>
                                    <td style={{ textAlign: 'right' }}>{formatPercent(item.percentualFreteVencedor)}</td>
                                    <td><span style={{ padding: '2px 6px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 700, background: statusC.bg, color: statusC.color, whiteSpace: 'nowrap' }}>{statusC.icon} {statusC.label}</span></td>
                                    <td style={{ textAlign: 'center' }}>{item.rankingSelecionada || '—'}</td>
                                    <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{item.reducaoNecessaria > 0 ? `↓${formatPercent(item.reducaoNecessaria)}` : ''}</td>
                                    <td style={{ textAlign: 'center' }}>{item.concorrentes}</td>
                                  </tr>
                                  {expandido && (
                                    <tr key={`${key}-detail`} style={{ background: '#f8fafc' }}>
                                      <td colSpan={22} style={{ padding: '12px 16px', borderTop: '2px solid #3b82f6' }}>
                                        {/* Painel de cálculo detalhado */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>

                                          {/* Bloco: Vencedor da simulação */}
                                          {item.vencedorDetalhes && (
                                            <div style={{ background: '#fff', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12 }}>
                                              <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 8, fontSize: '0.85rem' }}>
                                                🏆 Melhor tabela simulada: {item.vencedor} — {formatMoney(item.freteVencedor)}
                                              </div>
                                              {/* Status combinado em destaque */}
                                              {item.freteSelecionada > 0 && (() => { const s = statusCombinadoCte(item); return (
                                                <div style={{ marginBottom: 8, padding: '4px 8px', borderRadius: 6, background: s.bg, color: s.color, fontSize: '0.78rem', fontWeight: 700 }}>
                                                  {s.icon} {s.label}
                                                  {item.ganhouRealizado && <span style={{ fontWeight: 400, marginLeft: 6 }}>— economia de {formatMoney(item.freteRealizado - item.freteSelecionada)} vs realizado</span>}
                                                  {!item.ganhouRealizado && item.freteSelecionada > 0 && <span style={{ fontWeight: 400, marginLeft: 6 }}>— tabela {formatPercent(((item.freteSelecionada - item.freteRealizado) / item.freteRealizado) * 100)} acima do realizado</span>}
                                                </div>
                                              ); })()}
                                              <div style={{ display: 'grid', gap: 3, fontSize: '0.78rem', color: '#334155' }}>
                                                <div>Tipo de cálculo: <strong>{item.vencedorDetalhes?.frete?.tipoCalculo || '—'}</strong></div>
                                                <div>Prazo: <strong>{item.vencedorDetalhes?.prazo} dia(s)</strong></div>
                                                <div>Faixa aplicada: <strong>{item.vencedorDetalhes?.frete?.faixaPeso || '—'}</strong></div>
                                                <div>Peso considerado: <strong>{Number(item.vencedorDetalhes?.frete?.pesoConsiderado || 0).toFixed(2)} kg</strong></div>
                                                <div>Peso cubado: <strong>{Number(item.vencedorDetalhes?.frete?.pesoCubado || 0).toFixed(2)} kg</strong> (fator {item.vencedorDetalhes?.frete?.fatorCubagem})</div>
                                                <div>Cubagem usada: <strong>{Number(item.vencedorDetalhes?.frete?.cubagemAplicada || 0).toFixed(6)} m³</strong></div>
                                                {item.cubagemOutlierTracking && (
                                                  <div style={{ color: '#b45309', fontWeight: 700 }}>
                                                    ⚠ Cubagem do Tracking desconsiderada: {Number(item.cubagemOriginalTracking || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m³ acima do limite estimado de {Number(item.limiteCubagemTracking || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³. Cálculo feito pelo peso real.
                                                  </div>
                                                )}
                                                <div>R$/kg: <strong>{Number(item.vencedorDetalhes?.frete?.rsKgAplicado || 0).toFixed(4)}</strong></div>
                                                <div>% aplicado: <strong style={{ color: Number(item.vencedorDetalhes?.frete?.percentualAplicado || 0) < 1 ? '#dc2626' : undefined }}>{formatPercent(item.vencedorDetalhes?.frete?.percentualAplicado)}</strong></div>
                                                <div>Valor NF usado: <strong>{formatMoney(item.vencedorDetalhes?.frete?.valorNFInformado)}</strong></div>
                                                <div>Valor fixo/faixa: <strong>{formatMoney(item.vencedorDetalhes?.frete?.valorFixoAplicado)}</strong></div>
                                                {(() => {
                                                  const frete = item.vencedorDetalhes?.frete || {};
                                                  const limiteExcedente = Number(frete.pesoLimiteExcedente || 0);
                                                  const pesoExcedente = Number(frete.pesoExcedente || 0);
                                                  const valorExcedente = Number(frete.valorExcedente || 0);
                                                  const valorExcedenteUnitario = Number(frete.valorExcedenteUnitario || (pesoExcedente > 0 ? valorExcedente / pesoExcedente : 0));
                                                  const valorFaixaSemExcedente = Number(frete.valorFaixaSemExcedente ?? frete.valorFixoAplicado ?? 0);
                                                  const valorFaixaComExcedente = Number(frete.valorFaixaComExcedente ?? (valorFaixaSemExcedente + valorExcedente));
                                                  return (
                                                    <>
                                                      <div>Limite para excedente: <strong>{limiteExcedente > 0 ? `${limiteExcedente.toFixed(0)} kg` : '—'}</strong></div>
                                                      <div>Peso excedente: <strong>{pesoExcedente.toFixed(2)} kg</strong></div>
                                                      <div>R$/kg excedente: <strong>{valorExcedenteUnitario > 0 ? formatMoney(valorExcedenteUnitario) : '—'}</strong></div>
                                                      <div>Valor excedente: <strong>{formatMoney(valorExcedente)}</strong></div>
                                                      <div>Base faixa + excedente: <strong>{formatMoney(valorFaixaSemExcedente)}</strong> + <strong>{formatMoney(valorExcedente)}</strong> = <strong>{formatMoney(valorFaixaComExcedente)}</strong></div>
                                                    </>
                                                  );
                                                })()}
                                                <div>Mínimo rota: <strong>{formatMoney(item.vencedorDetalhes?.frete?.minimoRota)}</strong></div>
                                                <div>Valor base: <strong>{formatMoney(item.vencedorDetalhes?.frete?.valorBase)}</strong></div>
                                                <div>Ad Valorem: <strong>{formatMoney(item.vencedorDetalhes?.taxas?.adValorem)}</strong> ({formatPercent(item.vencedorDetalhes?.taxas?.adValPct)})</div>
                                                <div>GRIS: <strong>{formatMoney(item.vencedorDetalhes?.taxas?.gris)}</strong> ({formatPercent(item.vencedorDetalhes?.taxas?.grisPct)})</div>
                                                <div>Pedágio: <strong>{formatMoney(item.vencedorDetalhes?.taxas?.pedagio)}</strong></div>
                                                <div>Subtotal: <strong>{formatMoney(item.vencedorDetalhes?.frete?.subtotal)}</strong></div>
                                                <div>ICMS ({formatPercent(item.vencedorDetalhes?.frete?.aliquotaIcms)}): <strong>{formatMoney(item.vencedorDetalhes?.frete?.icms)}</strong> <span style={{ color: '#64748b' }}>({item.vencedorDetalhes?.frete?.origemAliquotaIcms})</span></div>
                                                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 4, marginTop: 4 }}>Total: <strong style={{ fontSize: '1.05em', color: '#15803d' }}>{formatMoney(item.freteVencedor)}</strong></div>
                                              </div>
                                            </div>
                                          )}

                                          {/* Bloco: Tabela Selecionada (se diferente do vencedor) */}
                                          {item.selecionadaDetalhes && item.vencedor !== (item.rankingSelecionada === 1 ? item.vencedor : 'outro') && (
                                            <div style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 12 }}>
                                              <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: 8, fontSize: '0.85rem' }}>
                                                📋 Tabela selecionada — {formatMoney(item.freteSelecionada)} (rank {item.rankingSelecionada})
                                              </div>
                                              <div style={{ display: 'grid', gap: 3, fontSize: '0.78rem', color: '#334155' }}>
                                                <div>Tipo de cálculo: <strong>{item.selecionadaDetalhes?.frete?.tipoCalculo || '—'}</strong></div>
                                                <div>Prazo: <strong>{item.selecionadaDetalhes?.prazo} dia(s)</strong></div>
                                                <div>Faixa: <strong>{item.selecionadaDetalhes?.frete?.faixaPeso || '—'}</strong></div>
                                                <div>Peso considerado: <strong>{Number(item.selecionadaDetalhes?.frete?.pesoConsiderado || 0).toFixed(2)} kg</strong></div>
                                                <div>% aplicado: <strong style={{ color: Number(item.selecionadaDetalhes?.frete?.percentualAplicado || 0) < 1 ? '#dc2626' : undefined }}>{formatPercent(item.selecionadaDetalhes?.frete?.percentualAplicado)}</strong></div>
                                                <div>Valor NF usado: <strong>{formatMoney(item.selecionadaDetalhes?.frete?.valorNFInformado)}</strong></div>
                                                {(() => {
                                                  const frete = item.selecionadaDetalhes?.frete || {};
                                                  const limiteExcedente = Number(frete.pesoLimiteExcedente || 0);
                                                  const pesoExcedente = Number(frete.pesoExcedente || 0);
                                                  const valorExcedente = Number(frete.valorExcedente || 0);
                                                  const valorExcedenteUnitario = Number(frete.valorExcedenteUnitario || (pesoExcedente > 0 ? valorExcedente / pesoExcedente : 0));
                                                  const valorFaixaSemExcedente = Number(frete.valorFaixaSemExcedente ?? frete.valorFixoAplicado ?? 0);
                                                  const valorFaixaComExcedente = Number(frete.valorFaixaComExcedente ?? (valorFaixaSemExcedente + valorExcedente));
                                                  return (
                                                    <>
                                                      <div>Valor fixo/faixa: <strong>{formatMoney(frete.valorFixoAplicado)}</strong></div>
                                                      <div>Limite para excedente: <strong>{limiteExcedente > 0 ? `${limiteExcedente.toFixed(0)} kg` : '—'}</strong></div>
                                                      <div>Peso excedente: <strong>{pesoExcedente.toFixed(2)} kg</strong></div>
                                                      <div>R$/kg excedente: <strong>{valorExcedenteUnitario > 0 ? formatMoney(valorExcedenteUnitario) : '—'}</strong></div>
                                                      <div>Valor excedente: <strong>{formatMoney(valorExcedente)}</strong></div>
                                                      <div>Base faixa + excedente: <strong>{formatMoney(valorFaixaSemExcedente)}</strong> + <strong>{formatMoney(valorExcedente)}</strong> = <strong>{formatMoney(valorFaixaComExcedente)}</strong></div>
                                                    </>
                                                  );
                                                })()}
                                                <div>Valor base: <strong>{formatMoney(item.selecionadaDetalhes?.frete?.valorBase)}</strong></div>
                                                <div>Ad Valorem: <strong>{formatMoney(item.selecionadaDetalhes?.taxas?.adValorem)}</strong></div>
                                                <div>GRIS: <strong>{formatMoney(item.selecionadaDetalhes?.taxas?.gris)}</strong></div>
                                                <div>Subtotal: <strong>{formatMoney(item.selecionadaDetalhes?.frete?.subtotal)}</strong></div>
                                                <div>ICMS ({formatPercent(item.selecionadaDetalhes?.frete?.aliquotaIcms)}): <strong>{formatMoney(item.selecionadaDetalhes?.frete?.icms)}</strong></div>
                                                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 4, marginTop: 4 }}>Total: <strong style={{ fontSize: '1.05em', color: '#1d4ed8' }}>{formatMoney(item.freteSelecionada)}</strong></div>
                                                {item.reducaoNecessaria > 0 && <div style={{ color: '#dc2626', fontWeight: 700 }}>⬇ Precisa reduzir {formatPercent(item.reducaoNecessaria)} para ganhar</div>}
                                              </div>
                                            </div>
                                          )}

                                          {/* Bloco: Ranking de todos concorrentes */}
                                          {(item.todosResultados || []).length > 0 && (
                                            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                                              <div style={{ fontWeight: 700, color: '#475569', marginBottom: 8, fontSize: '0.85rem' }}>
                                                🏁 Ranking completo ({item.concorrentes} tabelas)
                                              </div>
                                              <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse' }}>
                                                <thead><tr style={{ color: '#64748b' }}><th style={{ textAlign: 'left', paddingBottom: 4 }}>Pos.</th><th style={{ textAlign: 'left' }}>Transportadora</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>% NF</th></tr></thead>
                                                <tbody>
                                                  {(item.todosResultados || []).map((r, ri) => (
                                                    <tr key={ri} style={{ background: ri === 0 ? '#f0fdf4' : undefined }}>
                                                      <td style={{ padding: '2px 4px', color: ri === 0 ? '#15803d' : '#64748b', fontWeight: ri === 0 ? 700 : undefined }}>{ri + 1}º</td>
                                                      <td style={{ padding: '2px 4px', fontWeight: ri === 0 ? 700 : undefined }}>{r.transportadora}</td>
                                                      <td style={{ textAlign: 'right', padding: '2px 4px' }}>{formatMoney(r.total)}</td>
                                                      <td style={{ textAlign: 'right', padding: '2px 4px', color: item.valorNF > 0 && (r.total / item.valorNF) * 100 < 1 ? '#dc2626' : undefined }}>{item.valorNF > 0 ? formatPercent((r.total / item.valorNF) * 100) : '—'}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                              {/* Alerta de % muito baixo */}
                                              {item.vencedorDetalhes?.frete?.percentualAplicado > 0 && item.vencedorDetalhes.frete.percentualAplicado < 1 && (
                                                <div style={{ marginTop: 8, padding: '6px 8px', background: '#fef3c7', borderRadius: 6, fontSize: '0.75rem', color: '#78350f' }}>
                                                  ⚠ % aplicado ({formatPercent(item.vencedorDetalhes.frete.percentualAplicado)}) abaixo de 1% — verifique se o valor da NF ({formatMoney(item.vencedorDetalhes.frete.valorNFInformado)}) está correto na tabela.
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>

                    {/* Paginação */}
                    {(() => {
                      const q = filtroDetalhe.toLowerCase();
                      const filtrados = q ? (resultadoRealizado.ctesDetalhes || []).filter((item) => [item.cte, item.transportadoraReal, item.origem, item.destino, item.vencedor, item.statusSelecionada].some((v) => String(v || '').toLowerCase().includes(q))) : (resultadoRealizado.ctesDetalhes || []);
                      const totalPaginas = Math.ceil(filtrados.length / DETALHE_POR_PAGINA);
                      if (totalPaginas <= 1) return null;
                      const pagina = Math.min(paginaDetalhe, Math.max(0, totalPaginas - 1));
                      return (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                          <button className="sim-tab" disabled={pagina === 0} onClick={() => { setPaginaDetalhe(0); setLinhasExpandidas(new Set()); }}>« Início</button>
                          <button className="sim-tab" disabled={pagina === 0} onClick={() => { setPaginaDetalhe((p) => Math.max(0, p - 1)); setLinhasExpandidas(new Set()); }}>‹ Anterior</button>
                          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Página {pagina + 1} de {totalPaginas} ({filtrados.length} CT-es)</span>
                          <button className="sim-tab" disabled={pagina >= totalPaginas - 1} onClick={() => { setPaginaDetalhe((p) => Math.min(totalPaginas - 1, p + 1)); setLinhasExpandidas(new Set()); }}>Próxima ›</button>
                          <button className="sim-tab" disabled={pagina >= totalPaginas - 1} onClick={() => { setPaginaDetalhe(totalPaginas - 1); setLinhasExpandidas(new Set()); }}>Final »</button>
                        </div>
                      );
                    })()}
                  </>
                )}

                {/* CT-es sem tabela concorrente */}
                {resultadoRealizado.ctesSemTabelaGeral > 0 && (
                  <div style={{ marginTop: 16, padding: 12, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8 }}>
                    <strong>⚠ {resultadoRealizado.ctesSemTabelaGeral} CT-e(s) sem tabela concorrente</strong>
                    <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#78350f' }}>
                      Esses CT-es foram analisados mas não encontraram nenhuma tabela de frete compatível (sem IBGE destino ou sem cobertura nas transportadoras carregadas).
                      Detalhes: {resultadoRealizado.diagnostico?.linhasSemIbgeDestino || 0} sem IBGE destino,
                      {' '}{resultadoRealizado.diagnostico?.linhasSemResultado || 0} com IBGE mas sem tabela cobrindo o destino.
                      {(resultadoRealizado.diagnostico?.destinosSemResultado || []).length > 0 && (
                        <> Destinos sem cobertura: {(resultadoRealizado.diagnostico.destinosSemResultado || []).slice(0, 5).map(([d, q]) => `${d} (${q}x)`).join(', ')}.</>
                      )}
                    </p>
                  </div>
                )}
                </>)}
              </div>

            </div>
          )}
        </div>
      )}

      {aba === 'cobertura' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top"><h2 style={{ margin: 0 }}>Cobertura de tabela</h2><button className="sim-tab" type="button" onClick={exportarCobertura}>Exportar faltantes</button></div>
          <div className="sim-form-grid sim-grid-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <label>Canal<select value={canalCobertura} onChange={(e) => setCanalCobertura(e.target.value)}>{canais.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Origem<input list="origens-cobertura-lista" value={origemCobertura} onChange={(e) => setOrigemCobertura(e.target.value)} placeholder="Todas ou digite a origem" /><datalist id="origens-cobertura-lista">{todasOrigens.map((item) => <option key={item} value={item} />)}</datalist></label>
            <label>Transportadora<input list="transportadoras-cobertura-lista" value={transportadoraCobertura} onChange={(e) => setTransportadoraCobertura(e.target.value)} placeholder="Todas ou digite a transportadora" /><datalist id="transportadoras-cobertura-lista">{transportadorasPorCanalCobertura.map((item) => <option key={item} value={item} />)}</datalist></label>
            <label>UF destino<select value={ufCobertura} onChange={(e) => setUfCobertura(e.target.value)}>{UF_OPTIONS.map((item) => <option key={item} value={item}>{item || 'Todas'}</option>)}</select></label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onAnalisarCobertura} disabled={carregandoSimulacao || processamentoUi.ativo}>{carregandoSimulacao || processamentoUi.ativo ? "Analisando..." : "Analisar cobertura"}</button></div>
          {resultadoCobertura && (
            <div className="sim-cobertura-box">
              <p>{resultadoCobertura.explicacao}</p>
              <div className="sim-resultado-grade" style={{ marginTop: 12 }}>
                <div><span>Combinações possíveis</span><strong>{resultadoCobertura.totalCombinacoes}</strong></div>
                <div><span>Cobertas</span><strong>{resultadoCobertura.totalCobertas}</strong></div>
                <div><span>Sem tabela</span><strong>{resultadoCobertura.totalFaltantes}</strong></div>
                <div><span>Cobertura</span><strong>{formatPercent(resultadoCobertura.percentualCobertura)}</strong></div>
              </div>
              <div className="sim-grid-2" style={{ display: 'grid', gap: 16, marginTop: 12 }}>
                <div><strong>Faltantes</strong><div className="sim-cobertura-lista">{resultadoCobertura.faltantes.slice(0, 40).map((item, idx) => <div key={`${item.ibge}-${idx}`}>{item.origem} • {item.cidade || `IBGE ${item.ibge}`} • {item.uf}</div>)}</div></div>
                <div><strong>Exemplos com tabela</strong><div className="sim-cobertura-lista">{resultadoCobertura.cobertas.slice(0, 40).map((item, idx) => <div key={`${item.ibge}-${idx}`}>{item.origem} • {item.cidade || `IBGE ${item.ibge}`} • {item.uf} • {item.transportadora}</div>)}</div></div>
              </div>
            </div>
          )}
        </section>
      )}

      {laudoVisualAberto && resultadoRealizado && (
        <div
          className="modal-overlay"
          onClick={() => setLaudoVisualAberto(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.72)',
            zIndex: 9999,
            overflow: 'auto',
            padding: 24,
          }}
        >
          <div onClick={(event) => event.stopPropagation()} style={{ maxWidth: 1060, margin: '54px auto 0', display: 'grid', gap: 12 }}>
            <div
              className="laudo-print-actions"
              style={{
                position: 'fixed',
                top: 12,
                right: 24,
                zIndex: 10000,
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                flexWrap: 'wrap',
                padding: 8,
                background: 'rgba(255,255,255,0.96)',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                boxShadow: '0 12px 28px rgba(15,23,42,0.18)',
              }}
            >
              <button className="sim-tab" type="button" onClick={() => {
                const contextoLaudos = {
                  transportadora: resultadoRealizado.filtros?.transportadora,
                  canal: resultadoRealizado.filtros?.canal,
                  origem: resultadoRealizado.filtros?.origem,
                };
                const laudo = prepararLaudosNegociacao(resultadoRealizado, contextoLaudos)?.[laudoVisualAberto]?.dados;
                copiarTextoLaudo(laudo?.relatorioTexto, 'Relatorio');
              }}>
                Copiar relatório
              </button>
              <button className="sim-tab" type="button" onClick={() => {
                const contextoLaudos = {
                  transportadora: resultadoRealizado.filtros?.transportadora,
                  canal: resultadoRealizado.filtros?.canal,
                  origem: resultadoRealizado.filtros?.origem,
                };
                const laudo = prepararLaudosNegociacao(resultadoRealizado, contextoLaudos)?.[laudoVisualAberto]?.dados;
                copiarTextoLaudo(laudo?.corpoEmail, 'E-mail');
              }}>
                Copiar e-mail
              </button>
              <button className="sim-tab" type="button" onClick={baixarLaudoVisualHtml}>
                Baixar HTML editável
              </button>
              <button className="sim-tab" type="button" onClick={imprimirLaudoVisualIsolado}>
                Gerar PDF
              </button>
              <button className="sim-tab" type="button" onClick={() => setLaudoVisualAberto(null)}>
                Fechar
              </button>
            </div>

            <LaudoNegociacaoTemplate
              tipo={laudoVisualAberto}
              resultado={resultadoRealizado}
            />
          </div>
        </div>
      )}
    </div>
  );
}
