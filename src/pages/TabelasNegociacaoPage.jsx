import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { importarTemplatePadraoSeparado } from '../utils/importadorTemplatePadrao';
import { baixarModeloTemplateFretes, baixarModeloTemplateRotas } from '../utils/modelosTemplateFormatacao';
import {
  importarTemplateCantu,
  importarModeloLotacao,
  baixarModeloLotacao,
} from '../utils/importadorTemplatesCantu';
import {
  STATUS_TABELA_NEGOCIACAO,
  TIPOS_TABELA_NEGOCIACAO,
  DEFAULT_GENERALIDADES,
  alternarTabelaNegociacaoNaSimulacao,
  aprovarTabelaNegociacao,
  atualizarTabelaNegociacao,
  criarTabelaNegociacao,
  excluirTabelaNegociacao,
  listarItensTabelaNegociacao,
  listarTabelasNegociacao,
  substituirItensTabelaNegociacao,
  listarTaxasDestino,
  salvarTaxaDestino,
  excluirTaxaDestino,
  substituirTaxasDestino,
  salvarGeneralidades,
} from '../services/tabelasNegociacaoService';

// ─── helpers ──────────────────────────────────────────────────────────────────

function hojeISO() { return new Date().toISOString().slice(0, 10); }
function fimTresAnosISO() {
  const d = new Date(); d.setFullYear(d.getFullYear() + 3); return d.toISOString().slice(0, 10);
}
function gerarId(p) {
  return globalThis.crypto?.randomUUID
    ? p + '-' + globalThis.crypto.randomUUID()
    : p + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
function normalizarTexto(v) { return String(v ?? '').trim(); }
function numeroOuVazio(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v); return Number.isFinite(n) ? n : v;
}
function formatMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatPercent(v) { return Number(v || 0).toFixed(2) + '%'; }
function formatNumber(v, casas = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
function formatDateBR(v) {
  if (!v) return '-';
  var d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('pt-BR');
}
function getResumoTabela(tabela) {
  return tabela && tabela.resumo_simulacao && typeof tabela.resumo_simulacao === 'object' && !Array.isArray(tabela.resumo_simulacao)
    ? tabela.resumo_simulacao
    : {};
}
function getHistoricoRodadasTabela(tabela) {
  var resumo = getResumoTabela(tabela);
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}
function getRodadaAtualTabela(tabela) {
  var resumo = getResumoTabela(tabela);
  var hist = getHistoricoRodadasTabela(tabela);
  return Number(resumo.rodada_atual || (hist.length ? hist[hist.length - 1].rodada : 1) || 1);
}
function getIndicadoresTabela(tabela) {
  var resumo = getResumoTabela(tabela);
  var ultimaSim = resumo.ultima_simulacao && resumo.ultima_simulacao.indicadores ? resumo.ultima_simulacao.indicadores : {};
  var savingMes = Number(tabela.saving_projetado || ultimaSim.saving_mes || resumo.savingSelecionadaVsRealMes || resumo.savingSelecionadaVsReal || 0);
  var savingAno = Number(ultimaSim.saving_ano || resumo.savingSelecionadaVsRealAno || (savingMes * 12) || 0);
  var faturamentoMes = Number(tabela.faturamento_projetado || ultimaSim.faturamento_mes || resumo.faturamentoSelecionadaMes || resumo.freteSelecionada || 0);
  var faturamentoAno = Number(ultimaSim.faturamento_ano || resumo.faturamentoSelecionadaAno || (faturamentoMes * 12) || 0);
  var pedidosDia = Number(tabela.volumetria_dia || ultimaSim.pedidos_dia || resumo.cargasDia || 0);
  var pedidosMes = pedidosDia * 22;
  var pedidosAno = pedidosMes * 12;
  var volumesDia = Number(ultimaSim.volumes_dia || resumo.volumesDia || 0);
  var volumesMes = volumesDia * 22;
  var volumesAno = volumesMes * 12;
  var percentualReal = Number(ultimaSim.percentual_frete_realizado || resumo.percentualFreteRealizado || 0);
  var percentualTabela = Number(tabela.percentual_frete_projetado || ultimaSim.percentual_frete_simulado || resumo.percentualFreteTabelaGanharia || resumo.percentualFreteSelecionada || 0);
  return {
    temSimulacao: Boolean(resumo.ultima_simulacao || resumo.salvo_em || tabela.aderencia_projetada || tabela.saving_projetado || tabela.faturamento_projetado),
    rodada: getRodadaAtualTabela(tabela),
    aderencia: Number(tabela.aderencia_projetada || ultimaSim.aderencia || resumo.aderenciaSelecionada || 0),
    savingMes: savingMes, savingAno: savingAno, faturamentoMes: faturamentoMes, faturamentoAno: faturamentoAno,
    pedidosDia: pedidosDia, pedidosMes: pedidosMes, pedidosAno: pedidosAno,
    volumesDia: volumesDia, volumesMes: volumesMes, volumesAno: volumesAno,
    percentualReal: percentualReal, percentualTabela: percentualTabela, reducaoPercentual: percentualReal && percentualTabela ? percentualReal - percentualTabela : 0,
    ctesAnalisados: Number(tabela.ctes_analisados || resumo.ctesAnalisados || 0),
    ctesAtendidos: Number(tabela.ctes_atendidos || resumo.ctesComTabelaSelecionada || 0),
    rotasSemCobertura: Number(tabela.rotas_sem_cobertura || resumo.ctesSemTabelaSelecionada || 0),
  };
}
function origemTabelaLabel(tabela) {
  var origem = normalizarTexto(tabela && tabela.origem);
  var ufOrigem = normalizarTexto(tabela && tabela.uf_origem);
  var ufDestino = normalizarTexto(tabela && tabela.uf_destino);
  var resumo = getResumoTabela(tabela);
  var origensDetectadas = Array.isArray(resumo.origens_detectadas) ? resumo.origens_detectadas : [];
  var partes = [];

  if (origem || ufOrigem) {
    partes.push('Origem: ' + (origem || 'Todas') + (ufOrigem ? '/' + ufOrigem : ''));
  } else if (origensDetectadas.length) {
    var principais = origensDetectadas.slice(0, 2).map(function(o) {
      var cidade = normalizarTexto(o.cidade);
      var uf = normalizarTexto(o.uf);
      return (cidade || 'Origem') + (uf ? '/' + uf : '');
    }).join(', ');
    var extra = origensDetectadas.length > 2 ? ' +' + (origensDetectadas.length - 2) : '';
    partes.push('Origem detectada: ' + principais + extra);
  }

  if (ufDestino) partes.push('Destino: ' + ufDestino);
  return partes.join(' · ') || '-';
}

// ─── constantes ───────────────────────────────────────────────────────────────

const CANAIS = ['ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA'];
const UF_OPTIONS = ['','AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const TIPOS_IMPORTACAO = [
  { value: 'VERUM_ROTAS_FRETES', label: '1. Verum/Sistema — Rotas + Fretes' },
  { value: 'CANTU_MODELO_UNICO', label: '2. Cantu Fracionado — Arquivo único' },
  { value: 'LOTACAO_TRANSPORTADORA', label: '3. Lotação — Modelo Transportadora' },
];
const SUBTIPOS_CANTU = [
  { value: 'B2B_FAIXA_PESO', label: 'B2B — Faixa de Peso' },
  { value: 'B2B_PERCENTUAL', label: 'B2B — Percentual' },
  { value: 'B2C_FAIXA_PESO', label: 'B2C — Faixa de Peso' },
  { value: 'B2C_PERCENTUAL', label: 'B2C — Percentual' },
];
const TAXA_VAZIA = {
  ibge_destino: '', uf_destino: '', cidade_destino: '',
  tda: '', tdr: '', trt: '', suframa: '', outras_taxas: '',
  gris: '', gris_minimo: '', advalorem: '', advalorem_minimo: '', observacao: '',
};
const FORM_VAZIO = {
  transportadora: '', canal: 'ATACADO', tipo_tabela: 'FRACIONADO',
  status: 'EM NEGOCIAÇÃO', descricao: '', regiao: '', origem: '',
  uf_origem: '', uf_destino: '', data_recebimento: hojeISO(),
  data_inicio_prevista: '', incluir_simulacao: false, observacao: '',
  saving_projetado: '', aderencia_projetada: '',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function exportarXlsx(linhas, nomeArquivo, aba) {
  if (!linhas || !linhas.length) return;
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, aba || 'Dados');
  XLSX.writeFile(wb, nomeArquivo);
}

// Monta as linhas intermediárias de rotas e cotações a partir do resultado
// bruto do importador. A saída é usada apenas para preview e para alimentar
// montarItensVerum — não é salva diretamente no banco.
function montarLinhasFormatadas({ resultado, transportadora, canal, inicioVigencia, fimVigencia, origemFallback, ufOrigemFallback }) {
  const nomeT = normalizarTexto(transportadora);
  const c = normalizarTexto(canal || 'ATACADO').toUpperCase();
  const rotas = (resultado.rotas || []).map(function(item) {
    return {
      id: gerarId('rota'),
      nomeRota: item.cotacaoFinal || item.cotacao || (item.origem + ' - ' + item.ufDestino + ' - ' + item.cotacaoBase),
      ibgeOrigem: item.ibgeOrigem || '',
      cidadeOrigem: item.origem || origemFallback || '',
      ufOrigem: item.ufOrigem || ufOrigemFallback || '',
      ibgeDestino: item.ibgeDestino || '', cidadeDestino: item.cidadeDestino || '', ufDestino: item.ufDestino || '',
      canal: c, prazoEntregaDias: item.prazo || '', cotacaoBase: item.cotacaoBase || '',
      cotacaoFinal: item.cotacaoFinal || item.cotacao || '', inicioVigencia: inicioVigencia, fimVigencia: fimVigencia,
    };
  });
  const cotacoes = (resultado.fretes || []).map(function(item) {
    return {
      id: gerarId('cotacao'),
      // rota = nome limpo da cotação (após expansão, já sem prefixo UF)
      rota: item.cotacaoFinal || item.cotacao || (item.origem + ' - ' + item.ufDestino + ' - ' + item.cotacaoBase),
      origem: item.origem || origemFallback || '',
      ufOrigem: item.ufOrigem || ufOrigemFallback || '',
      cidadeDestino: item.cidadeDestino || '',
      ufDestino: item.ufDestino || '',
      ibgeDestino: item.ibgeDestino || '',
      cotacaoBase: item.cotacaoBase || '', faixaPeso: item.faixaPeso || '',
      pesoMin: item.pesoInicial != null ? item.pesoInicial : '',
      pesoMax: item.pesoFinal != null ? item.pesoFinal : '',
      taxaAplicada: item.taxaAplicada != null ? item.taxaAplicada : (item.freteValor != null ? item.freteValor : ''),
      // excesso = limiar kg (ex.: 100); valorExcedente = R$/kg acima do limiar
      excesso: item.excessoKg != null ? item.excessoKg : (item.excedente != null ? item.excedente : ''),
      valorExcedente: item.valorExcedente != null ? item.valorExcedente : '',
      percentual: item.fretePercentual != null ? item.fretePercentual : '',
      freteMinimo: item.freteMinimo != null ? item.freteMinimo : '',
      advalorem: item.advalorem != null ? item.advalorem : '',
      prazo: item.prazo != null ? item.prazo : '',
      canal: c, inicioVigencia: inicioVigencia, fimVigencia: fimVigencia,
    };
  });
  return { rotas: rotas, cotacoes: cotacoes };
}

// Converte as cotações formatadas para itens prontos para salvar em
// tabelas_negociacao_itens. Gera SOMENTE linhas COTAÇÃO/FAIXA (igual ao Cantu),
// sem linhas técnicas de ROTA.
function montarItensVerum(formatado) {
  if (!formatado) return [];

  var itensCotacoes = (formatado.cotacoes || []).map(function(cotacao) {
    // ── faixa_peso: "COTAÇÃO | FAIXA" ou "COTAÇÃO" (igual ao padrão Cantu) ──
    // Exemplos:
    //   faixa de peso : "CAPITAL | 0 a 2"
    //   percentual    : "CAPITAL"
    var cotNome  = String(cotacao.rota || '').toUpperCase().trim();
    var faixaRaw = String(cotacao.faixaPeso || '').trim();
    var faixaPesoFormatada = faixaRaw
      ? (cotNome ? cotNome + ' | ' + faixaRaw : faixaRaw)
      : cotNome || '';

    return {
      // dados_originais.tipo_item = 'COTACAO' para que getTipoItem() funcione
      cidade_origem: cotacao.origem || '',
      uf_origem: cotacao.ufOrigem || '',
      ibge_origem: '',
      cidade_destino: cotacao.cidadeDestino || '',
      uf_destino: cotacao.ufDestino || '',
      ibge_destino: cotacao.ibgeDestino || '',
      faixa_peso: faixaPesoFormatada,
      peso_inicial: cotacao.pesoMin != null ? cotacao.pesoMin : '',
      peso_final: cotacao.pesoMax != null ? cotacao.pesoMax : '',
      frete_minimo: cotacao.freteMinimo != null ? cotacao.freteMinimo : '',
      taxa_aplicada: cotacao.taxaAplicada != null ? cotacao.taxaAplicada : '',
      frete_percentual: cotacao.percentual != null ? cotacao.percentual : '',
      // excesso_kg  = limiar kg onde começa a cobrar excedente (ex.: 100)
      // valor_excedente = R$/kg acima do limiar (ex.: 0.50)
      excesso_kg: cotacao.excesso != null ? cotacao.excesso : '',
      valor_excedente: cotacao.valorExcedente != null ? cotacao.valorExcedente : '',
      advalorem: cotacao.advalorem != null ? cotacao.advalorem : '',
      prazo: cotacao.prazo || '',
      observacao: cotacao.rota || '',
      origem_importacao: 'VERUM_ROTAS_FRETES',
      dados_originais: { tipo_item: 'COTACAO', ...cotacao },
    };
  });

  return itensCotacoes;
}

function getTipoItem(item) {
  return (item && item.dados_originais && item.dados_originais.tipo_item)
    || (item && item.item_tipo)
    || (item && item.faixa_peso === 'ROTA' ? 'ROTA' : 'COTACAO');
}

function statusStyle(status) {
  if (status === 'APROVADA') return { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' };
  if (status === 'EM TESTE') return { background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' };
  if (status === 'REPROVADA' || status === 'CANCELADA') return { background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' };
  if (status === 'PROMOVIDA PARA OFICIAL') return { background: '#f3e8ff', color: '#7c3aed', border: '1px solid #c4b5fd' };
  return { background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d' };
}

function BadgeImportacao({ tipo }) {
  if (!tipo) return null;
  var map = {
    VERUM_ROTAS_FRETES: { label: 'Verum', bg: '#e0f2fe', color: '#0369a1' },
    CANTU_MODELO_UNICO: { label: 'Cantu', bg: '#fef3c7', color: '#b45309' },
    LOTACAO_TRANSPORTADORA: { label: 'Lotação', bg: '#f3e8ff', color: '#7c3aed' },
  };
  var s = map[tipo];
  if (!s) return null;
  return React.createElement('span', {
    style: { background: s.bg, color: s.color, borderRadius: 999, padding: '2px 7px', fontSize: 11, fontWeight: 700, marginLeft: 6 }
  }, s.label);
}

function normalizarCabecalhoTaxa(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function normalizarLinhaModeloTaxa(row) {
  var normalizado = {};
  Object.keys(row || {}).forEach(function(key) {
    normalizado[normalizarCabecalhoTaxa(key)] = row[key];
  });
  return normalizado;
}

function pegarCampoModeloTaxa(row, aliases) {
  var normalizado = normalizarLinhaModeloTaxa(row);
  for (var i = 0; i < aliases.length; i += 1) {
    var chave = normalizarCabecalhoTaxa(aliases[i]);
    if (normalizado[chave] !== undefined && normalizado[chave] !== null && String(normalizado[chave]).trim() !== '') {
      return normalizado[chave];
    }
  }
  return '';
}

function numeroModeloTaxa(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  var texto = String(value).replace(/R\$/gi, '').replace(/%/g, '').trim();
  if (!texto) return '';
  texto = texto.replace(/\s/g, '');
  if (texto.includes(',') && texto.includes('.')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (texto.includes(',')) texto = texto.replace(',', '.');
  var n = Number(texto.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : '';
}

function montarTaxaDestinoDoModelo(row) {
  return {
    ibge_destino: normalizarTexto(pegarCampoModeloTaxa(row, ['IBGE Destino', 'IBGE', 'Código IBGE', 'Codigo IBGE', 'Código IBGE Destino', 'Codigo IBGE Destino'])),
    uf_destino: normalizarTexto(pegarCampoModeloTaxa(row, ['UF Destino', 'UF', 'Estado Destino', 'Estado'])).toUpperCase(),
    cidade_destino: normalizarTexto(pegarCampoModeloTaxa(row, ['Cidade Destino', 'Cidade', 'Município Destino', 'Municipio Destino', 'Destino'])),
    tda: numeroModeloTaxa(pegarCampoModeloTaxa(row, ['TDA (R$)', 'TDA', 'Taxa TDA'])),
    tdr: numeroModeloTaxa(pegarCampoModeloTaxa(row, ['TDR (R$)', 'TDR', 'Taxa TDR'])),
    trt: numeroModeloTaxa(pegarCampoModeloTaxa(row, ['TRT (R$)', 'TRT', 'TDE (R$)', 'TDE', 'Taxa TRT', 'Taxa TDE'])),
    suframa: numeroModeloTaxa(pegarCampoModeloTaxa(row, ['SUFRAMA (R$)', 'SUFRAMA'])),
    outras_taxas: numeroModeloTaxa(pegarCampoModeloTaxa(row, ['Outras (R$)', 'Outras', 'Outras Taxas', 'Outras Taxas (R$)'])),
    gris: numeroModeloTaxa(pegarCampoModeloTaxa(row, ['GRIS %', 'GRIS', '% GRIS'])),
    gris_minimo: numeroModeloTaxa(pegarCampoModeloTaxa(row, ['GRIS mín (R$)', 'GRIS min (R$)', 'GRIS mínimo', 'GRIS minimo', 'GRIS Mínimo (R$)', 'GRIS Minimo (R$)'])),
    advalorem: numeroModeloTaxa(pegarCampoModeloTaxa(row, ['Ad Valorem %', 'ADV %', 'AdValorem %', 'Ad Valorem', 'ADV', '% NF', 'Ad Val'])),
    advalorem_minimo: numeroModeloTaxa(pegarCampoModeloTaxa(row, ['Ad Val mín (R$)', 'Ad Val min (R$)', 'Ad Val mínimo', 'Ad Val minimo', 'Ad Valorem mín (R$)', 'Ad Valorem min (R$)', 'ADV mín (R$)', 'ADV min (R$)'])),
    observacao: normalizarTexto(pegarCampoModeloTaxa(row, ['Observação', 'Observacao', 'Obs'])),
  };
}

function baixarModeloTaxasDestinoNegociacao() {
  var linhas = [
    {
      'IBGE Destino': '3550308',
      'UF Destino': 'SP',
      'Cidade Destino': 'SÃO PAULO',
      'TDA (R$)': 0,
      'TDR (R$)': 0,
      'TRT (R$)': 0,
      'SUFRAMA (R$)': 0,
      'Outras (R$)': 0,
      'GRIS %': 0.2,
      'GRIS mín (R$)': 0,
      'Ad Valorem %': 0.15,
      'Ad Val mín (R$)': 0,
      'Observação': 'Exemplo: preencha uma linha por IBGE/cidade',
    },
    {
      'IBGE Destino': '3106200',
      'UF Destino': 'MG',
      'Cidade Destino': 'BELO HORIZONTE',
      'TDA (R$)': 25,
      'TDR (R$)': 0,
      'TRT (R$)': 0,
      'SUFRAMA (R$)': 0,
      'Outras (R$)': 0,
      'GRIS %': '',
      'GRIS mín (R$)': '',
      'Ad Valorem %': '',
      'Ad Val mín (R$)': '',
      'Observação': 'Campos vazios usam a generalidade da tabela',
    },
  ];
  var ws = XLSX.utils.json_to_sheet(linhas);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Taxas por Destino');
  XLSX.writeFile(wb, 'modelo_taxas_por_destino_negociacao.xlsx');
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function TabelasNegociacaoPage() {
  const [tabelas, setTabelas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [itensSelecionada, setItensSelecionada] = useState([]);
  const [generalidades, setGeneralidades] = useState(Object.assign({}, DEFAULT_GENERALIDADES));
  const [salvandoGen, setSalvandoGen] = useState(false);
  const [taxasDestino, setTaxasDestino] = useState([]);
  const [novaTaxa, setNovaTaxa] = useState(Object.assign({}, TAXA_VAZIA));
  const [editandoTaxa, setEditandoTaxa] = useState(null);
  const [salvandoTaxa, setSalvandoTaxa] = useState(false);
  const [abaNegoc, setAbaNegoc] = useState('importacao');
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [filtros, setFiltros] = useState({ status: '', tipoTabela: '', canal: '', transportadora: '' });
  const [form, setForm] = useState(Object.assign({}, FORM_VAZIO));
  const inputTaxasDestinoRef = useRef(null);

  const [tipoImportacao, setTipoImportacao] = useState('VERUM_ROTAS_FRETES');
  const [subtipoCantu, setSubtipoCantu] = useState('B2B_FAIXA_PESO');

  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);
  const [resultadoTemplate, setResultadoTemplate] = useState(null);
  const [formatado, setFormatado] = useState(null);
  const [mostrarPreview, setMostrarPreview] = useState(false);

  const [arquivoCantu, setArquivoCantu] = useState(null);
  const [resultadoCantu, setResultadoCantu] = useState(null);

  const [arquivoLotacao, setArquivoLotacao] = useState(null);
  const [resultadoLotacao, setResultadoLotacao] = useState(null);
  const [filtroItens, setFiltroItens] = useState('COTACAO');

  const [inicioVigencia, setInicioVigencia] = useState(hojeISO());
  const [fimVigencia, setFimVigencia] = useState(fimTresAnosISO());

  const [modalAprovacao, setModalAprovacao] = useState(null);
  const [aprovacao, setAprovacao] = useState({
    data_inicio_vigencia: hojeISO(), substituir_tabela_anterior: false, justificativa_aprovacao: '',
  });

  const resumo = useMemo(() => ({
    total: tabelas.length,
    emSimulacao: tabelas.filter(function(t) { return t.incluir_simulacao; }).length,
    emTeste: tabelas.filter(function(t) { return t.status === 'EM TESTE'; }).length,
    aprovadas: tabelas.filter(function(t) { return t.status === 'APROVADA'; }).length,
    lotacao: tabelas.filter(function(t) { return t.tipo_tabela === 'LOTACAO'; }).length,
    fracionado: tabelas.filter(function(t) { return t.tipo_tabela === 'FRACIONADO'; }).length,
  }), [tabelas]);

  const resumoItens = useMemo(() => {
    var rotas = itensSelecionada.filter(function(i) { return getTipoItem(i) === 'ROTA'; });
    var cotacoes = itensSelecionada.filter(function(i) { return getTipoItem(i) !== 'ROTA'; });
    var ufs = new Set(itensSelecionada.map(function(i) { return i.uf_destino; }).filter(Boolean));
    return { rotas: rotas.length, cotacoes: cotacoes.length, ufs: ufs.size };
  }, [itensSelecionada]);

  const itensVisualizacao = useMemo(function() {
    return [].concat(itensSelecionada || []).sort(function(a, b) {
      var tipoA = getTipoItem(a) === 'ROTA' ? 1 : 0;
      var tipoB = getTipoItem(b) === 'ROTA' ? 1 : 0;
      if (tipoA !== tipoB) return tipoA - tipoB;

      var ufA = String(a.uf_destino || '');
      var ufB = String(b.uf_destino || '');
      if (ufA !== ufB) return ufA.localeCompare(ufB, 'pt-BR');

      var ibgeA = String(a.ibge_destino || '');
      var ibgeB = String(b.ibge_destino || '');
      if (ibgeA !== ibgeB) return ibgeA.localeCompare(ibgeB, 'pt-BR');

      return Number(a.peso_inicial || 0) - Number(b.peso_inicial || 0);
    });
  }, [itensSelecionada]);

  const itensFiltrados = useMemo(function() {
    if (filtroItens === 'TODOS') return itensVisualizacao;
    if (filtroItens === 'ROTA') return itensVisualizacao.filter(function(i) { return getTipoItem(i) === 'ROTA'; });
    return itensVisualizacao.filter(function(i) { return getTipoItem(i) !== 'ROTA'; });
  }, [itensVisualizacao, filtroItens]);

  function labelTipoItem(item) {
    return getTipoItem(item) === 'ROTA' ? 'ROTA' : 'COTAÇÃO/FAIXA';
  }

  function destinoItem(item) {
    var cidade = normalizarTexto(item.cidade_destino);
    var uf = normalizarTexto(item.uf_destino);
    var ibge = normalizarTexto(item.ibge_destino);

    if (cidade) {
      return cidade + (uf ? '/' + uf : '') + (ibge ? ' · ' + ibge : '');
    }

    if (ibge) {
      return ibge + (uf ? '/' + uf : '');
    }

    return uf || '-';
  }

  function origemItem(item) {
    var cidade = normalizarTexto(item.cidade_origem);
    var uf = normalizarTexto(item.uf_origem);
    if (!cidade && !uf) return '-';
    return cidade + (uf ? '/' + uf : '');
  }

  function limparImport() {
    setResultadoTemplate(null); setFormatado(null); setMostrarPreview(false);
    setResultadoCantu(null); setResultadoLotacao(null);
    setArquivoRotas(null); setArquivoFretes(null);
    setArquivoCantu(null); setArquivoLotacao(null);
  }

  async function carregar() {
    setCarregando(true); setErro('');
    try { setTabelas(await listarTabelasNegociacao(filtros)); }
    catch (e) { setErro(e.message || 'Erro ao carregar.'); }
    finally { setCarregando(false); }
  }

  useEffect(function() { carregar(); }, []); // eslint-disable-line

  async function abrirTabela(tabela) {
    setSelecionada(tabela); limparImport(); setErro(''); setSucesso('');
    setAbaNegoc('importacao');
    try {
      var results = await Promise.all([
        listarItensTabelaNegociacao(tabela.id),
        listarTaxasDestino(tabela.id).catch(function() { return []; }),
      ]);
      var itens = results[0];
      var taxas = results[1];
      setItensSelecionada(itens);
      setTaxasDestino(taxas);
      setGeneralidades(Object.assign({}, DEFAULT_GENERALIDADES, tabela.generalidades || {}));
      setInicioVigencia(tabela.data_inicio_prevista || hojeISO());
      setFimVigencia(fimTresAnosISO());
      if (itens.length > 0 && itens[0].origem_importacao) setTipoImportacao(itens[0].origem_importacao);
    } catch (e) { setErro(e.message || 'Erro ao abrir itens.'); }
  }

  async function salvarNovaTabela() {
    setSalvando(true); setErro(''); setSucesso('');
    try {
      var nova = await criarTabelaNegociacao(form);
      setSucesso('Tabela criada com sucesso.');
      setForm(Object.assign({}, FORM_VAZIO));
      await carregar();
      await abrirTabela(nova);
    } catch (e) { setErro(e.message || 'Erro ao salvar.'); }
    finally { setSalvando(false); }
  }

  async function alternarSimulacao(tabela) {
    setErro(''); setSucesso('');
    try {
      var at = await alternarTabelaNegociacaoNaSimulacao(tabela.id, !tabela.incluir_simulacao);
      setTabelas(function(p) { return p.map(function(i) { return i.id === tabela.id ? at : i; }); });
      if (selecionada && selecionada.id === tabela.id) setSelecionada(at);
      setSucesso(at.incluir_simulacao ? 'Marcada para simulação.' : 'Removida da simulação.');
    } catch (e) { setErro(e.message || 'Erro.'); }
  }

  async function atualizarStatus(tabela, status) {
    setErro(''); setSucesso('');
    try {
      var at = await atualizarTabelaNegociacao(tabela.id, { status: status });
      setTabelas(function(p) { return p.map(function(i) { return i.id === tabela.id ? at : i; }); });
      if (selecionada && selecionada.id === tabela.id) setSelecionada(at);
      setSucesso('Status atualizado.');
    } catch (e) { setErro(e.message || 'Erro.'); }
  }

  async function excluirTabela(tabela) {
    if (!window.confirm('Excluir tabela de ' + tabela.transportadora + '?')) return;
    setErro(''); setSucesso('');
    try {
      await excluirTabelaNegociacao(tabela.id);
      if (selecionada && selecionada.id === tabela.id) { setSelecionada(null); setItensSelecionada([]); }
      await carregar();
      setSucesso('Tabela excluída.');
    } catch (e) { setErro(e.message || 'Erro.'); }
  }

  async function salvarItens(itens, origemImportacao, extraUpdate) {
    setSalvando(true); setErro(''); setSucesso('');
    try {
      var salvos = await substituirItensTabelaNegociacao(selecionada, itens);
      var updates = Object.assign({
        data_inicio_prevista: inicioVigencia,
        status: selecionada.status === 'EM NEGOCIAÇÃO' ? 'EM TESTE' : selecionada.status,
        origem_importacao: origemImportacao,
      }, extraUpdate || {});
      var at = await atualizarTabelaNegociacao(selecionada.id, updates);
      setSelecionada(at);
      setTabelas(function(p) { return p.map(function(i) { return i.id === at.id ? at : i; }); });
      setItensSelecionada(salvos);
      setSucesso(salvos.length + ' item(ns) salvos.');
    } catch (e) { setErro(e.message || 'Erro ao salvar itens.'); }
    finally { setSalvando(false); }
  }

  async function processarVerum() {
    if (!selecionada) return setErro('Abra uma tabela antes de importar.');
    setErro(''); setSucesso(''); setResultadoTemplate(null); setFormatado(null);
    try {
      var r = await importarTemplatePadraoSeparado({ arquivoRotas: arquivoRotas, arquivoFretes: arquivoFretes });
      setResultadoTemplate(r);
      setSucesso('Lido: ' + r.rotas.length + ' rota(s), ' + r.quebrasFaixa.length + ' quebra(s), ' + r.fretes.length + ' frete(s). Clique em "Formatar".');
    } catch (e) { setErro(e.message || 'Erro ao importar template.'); }
  }

  function formatarVerum() {
    if (!resultadoTemplate) return setErro('Leia o template primeiro.');
    var f = montarLinhasFormatadas({
      resultado: resultadoTemplate, transportadora: selecionada.transportadora,
      canal: selecionada.canal, inicioVigencia: inicioVigencia, fimVigencia: fimVigencia,
      origemFallback: selecionada.origem || '', ufOrigemFallback: selecionada.uf_origem || '',
    });
    setFormatado(f); setMostrarPreview(true);
    setSucesso('Formatado: ' + f.cotacoes.length + ' cotação(ões) prontas para salvar.');
  }

  async function processarCantu() {
    if (!selecionada) return setErro('Abra uma tabela antes de importar.');
    if (!arquivoCantu) return setErro('Selecione o arquivo Cantu.');
    setErro(''); setSucesso(''); setResultadoCantu(null);
    try {
      var r = await importarTemplateCantu(arquivoCantu, subtipoCantu, selecionada.origem || '');
      setResultadoCantu(r);
      setSucesso('Cantu lido: ' + r.meta.totalItens + ' item(ns). Canal: ' + r.meta.canal + '. Revise e salve.');
    } catch (e) { setErro(e.message || 'Erro ao importar Cantu.'); }
  }

  async function processarLotacao() {
    if (!selecionada) return setErro('Abra uma tabela antes de importar.');
    if (!arquivoLotacao) return setErro('Selecione o arquivo de Lotação.');
    setErro(''); setSucesso(''); setResultadoLotacao(null);
    try {
      var r = await importarModeloLotacao(arquivoLotacao, selecionada.origem || '');
      setResultadoLotacao(r);
      setSucesso('Lotação lida: ' + r.meta.totalItens + ' rota(s). Revise e salve.');
    } catch (e) { setErro(e.message || 'Erro ao importar Lotação.'); }
  }

  async function handleSalvarGeneralidades() {
    if (!selecionada) return;
    setSalvandoGen(true); setErro(''); setSucesso('');
    try {
      var at = await salvarGeneralidades(selecionada.id, generalidades);
      setSelecionada(at);
      setTabelas(function(p) { return p.map(function(i) { return i.id === at.id ? at : i; }); });
      setSucesso('Generalidades salvas.');
    } catch (e) { setErro(e.message || 'Erro ao salvar generalidades.'); }
    finally { setSalvandoGen(false); }
  }

  function handleGenField(campo, valor) {
    setGeneralidades(function(p) { return Object.assign({}, p, { [campo]: valor }); });
  }

  async function handleSalvarTaxa() {
    if (!selecionada) return;
    if (!novaTaxa.ibge_destino && !novaTaxa.cidade_destino) return setErro('Informe IBGE ou cidade destino.');
    setSalvandoTaxa(true); setErro(''); setSucesso('');
    try {
      var taxa = editandoTaxa ? Object.assign({}, novaTaxa, { id: editandoTaxa.id }) : novaTaxa;
      var salva = await salvarTaxaDestino(selecionada.id, taxa);
      if (editandoTaxa) {
        setTaxasDestino(function(p) { return p.map(function(t) { return t.id === salva.id ? salva : t; }); });
        setSucesso('Taxa atualizada.');
      } else {
        setTaxasDestino(function(p) { return p.concat([salva]); });
        setSucesso('Taxa adicionada.');
      }
      setNovaTaxa(Object.assign({}, TAXA_VAZIA));
      setEditandoTaxa(null);
    } catch (e) { setErro(e.message || 'Erro ao salvar taxa.'); }
    finally { setSalvandoTaxa(false); }
  }

  function handleEditarTaxa(taxa) {
    setEditandoTaxa(taxa);
    setNovaTaxa({
      ibge_destino: taxa.ibge_destino || '', uf_destino: taxa.uf_destino || '',
      cidade_destino: taxa.cidade_destino || '', tda: taxa.tda || '',
      tdr: taxa.tdr || '', trt: taxa.trt || '', suframa: taxa.suframa || '',
      outras_taxas: taxa.outras_taxas || '', gris: taxa.gris || '',
      gris_minimo: taxa.gris_minimo || '', advalorem: taxa.advalorem || '',
      advalorem_minimo: taxa.advalorem_minimo || '', observacao: taxa.observacao || '',
    });
    setAbaNegoc('taxas');
  }

  async function handleExcluirTaxa(taxa) {
    if (!window.confirm('Excluir taxa do IBGE ' + (taxa.ibge_destino || taxa.cidade_destino) + '?')) return;
    setErro(''); setSucesso('');
    try {
      await excluirTaxaDestino(taxa.id);
      setTaxasDestino(function(p) { return p.filter(function(t) { return t.id !== taxa.id; }); });
      setSucesso('Taxa excluída.');
    } catch (e) { setErro(e.message || 'Erro ao excluir taxa.'); }
  }

  function handleImportarTaxasDoAtendimento() {
    var comTaxas = itensSelecionada.filter(function(i) {
      return i.ibge_destino && (Number(i.tda) > 0 || Number(i.tde) > 0);
    });
    if (!comTaxas.length) return setErro('Nenhum item com TDA ou TRT encontrado nos itens salvos.');
    var novas = comTaxas.map(function(i) {
      return {
        ibge_destino: i.ibge_destino, uf_destino: i.uf_destino, cidade_destino: i.cidade_destino,
        tda: i.tda || 0, tdr: 0, trt: i.tde || 0, suframa: 0,
        outras_taxas: i.outras_taxas || 0, gris: 0, gris_minimo: 0, advalorem: 0, advalorem_minimo: 0, observacao: '',
      };
    });
    setSalvandoTaxa(true); setErro(''); setSucesso('');
    substituirTaxasDestino(selecionada.id, novas)
      .then(function(salvas) { setTaxasDestino(salvas); setSucesso(salvas.length + ' taxas importadas dos itens.'); })
      .catch(function(e) { setErro(e.message || 'Erro ao importar taxas.'); })
      .finally(function() { setSalvandoTaxa(false); });
  }

  async function handleImportarModeloTaxasDestino(event) {
    var file = event && event.target && event.target.files ? event.target.files[0] : null;
    if (event && event.target) event.target.value = '';
    if (!file) return;
    if (!selecionada) return setErro('Abra uma negociação antes de importar taxas.');

    setSalvandoTaxa(true); setErro(''); setSucesso('');
    try {
      var buffer = await file.arrayBuffer();
      var wb = XLSX.read(buffer, { type: 'array' });
      var sheetName = wb.SheetNames[0];
      var sheet = wb.Sheets[sheetName];
      var rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      var novas = rows
        .map(montarTaxaDestinoDoModelo)
        .filter(function(taxa) {
          return taxa.ibge_destino || taxa.cidade_destino || taxa.uf_destino;
        });

      if (!novas.length) throw new Error('Nenhuma taxa válida encontrada no arquivo. Verifique o modelo.');

      var mensagem = taxasDestino.length
        ? 'Importar ' + novas.length + ' taxa(s) e substituir as ' + taxasDestino.length + ' taxa(s) atuais desta negociação?'
        : 'Importar ' + novas.length + ' taxa(s) para esta negociação?';
      if (!window.confirm(mensagem)) return;

      var salvas = await substituirTaxasDestino(selecionada.id, novas);
      setTaxasDestino(salvas);
      setSucesso(salvas.length + ' taxa(s) importada(s) pelo modelo.');
    } catch (e) {
      setErro(e.message || 'Erro ao importar modelo de taxas.');
    } finally {
      setSalvandoTaxa(false);
    }
  }

  function abrirModalAprovacao(tabela) {
    setModalAprovacao(tabela);
    setAprovacao({ data_inicio_vigencia: hojeISO(), substituir_tabela_anterior: false, justificativa_aprovacao: '' });
  }

  async function confirmarAprovacao() {
    if (!modalAprovacao) return;
    if (!aprovacao.justificativa_aprovacao.trim()) return setErro('Informe uma justificativa.');
    setSalvando(true); setErro(''); setSucesso('');
    try {
      var at = await aprovarTabelaNegociacao(modalAprovacao.id, aprovacao);
      setTabelas(function(p) { return p.map(function(i) { return i.id === at.id ? at : i; }); });
      if (selecionada && selecionada.id === at.id) setSelecionada(at);
      setModalAprovacao(null);
      setSucesso('Tabela aprovada.');
    } catch (e) { setErro(e.message || 'Erro ao aprovar.'); }
    finally { setSalvando(false); }
  }

  var styBtn = function(active) {
    return {
      padding: '8px 16px', borderRadius: 8, border: '2px solid',
      borderColor: active ? '#3b82f6' : '#e2e8f0',
      background: active ? '#eff6ff' : '#fff',
      color: active ? '#1d4ed8' : '#374151',
      fontWeight: active ? 700 : 400, cursor: 'pointer', transition: 'all 0.15s',
    };
  };

  var ABAS = [
    { key: 'importacao', label: '📥 Importação' },
    { key: 'generalidades', label: '⚙️ Generalidades' },
    { key: 'taxas', label: '🏷️ Taxas por Destino' },
    { key: 'itens', label: '📋 Itens (' + itensSelecionada.length + ')' },
    { key: 'rodadas', label: '🔁 Rodadas' },
  ];

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Negociações</div>
        <h1>Tabelas em Negociação</h1>
        <p>Cadastre tabelas temporárias, simule aderência e promova para o cadastro oficial após aprovação.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {sucesso ? <div className="sim-alert success">{sucesso}</div> : null}

      <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="summary-card"><span>Total</span><strong>{resumo.total}</strong><small>em negociação</small></div>
        <div className="summary-card"><span>Em simulação</span><strong>{resumo.emSimulacao}</strong><small>entram no simulador</small></div>
        <div className="summary-card"><span>Em teste</span><strong>{resumo.emTeste}</strong><small>em análise</small></div>
        <div className="summary-card"><span>Aprovadas</span><strong>{resumo.aprovadas}</strong><small>aguardando promoção</small></div>
        <div className="summary-card"><span>Fracionado</span><strong>{resumo.fracionado}</strong><small>Atacado/B2C</small></div>
        <div className="summary-card"><span>Lotação</span><strong>{resumo.lotacao}</strong><small>lotação</small></div>
      </div>

      {/* NOVA TABELA */}
      <section className="sim-card">
        <h2>Nova tabela em negociação</h2>
        <div className="sim-form-grid sim-grid-5">
          <label>Transportadora
            <input value={form.transportadora} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { transportadora: e.target.value }); }); }} placeholder="Ex: JADLOG" />
          </label>
          <label>Canal
            <select value={form.canal} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { canal: e.target.value }); }); }}>
              {CANAIS.map(function(c) { return <option key={c}>{c}</option>; })}
            </select>
          </label>
          <label>Tipo
            <select value={form.tipo_tabela} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { tipo_tabela: e.target.value }); }); }}>
              {TIPOS_TABELA_NEGOCIACAO.map(function(t) { return <option key={t}>{t}</option>; })}
            </select>
          </label>
          <label>Status
            <select value={form.status} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { status: e.target.value }); }); }}>
              {STATUS_TABELA_NEGOCIACAO.map(function(s) { return <option key={s}>{s}</option>; })}
            </select>
          </label>
          <label>Data recebimento
            <input type="date" value={form.data_recebimento} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { data_recebimento: e.target.value }); }); }} />
          </label>
        </div>
        <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
          <label>Origem
            <input value={form.origem} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { origem: e.target.value }); }); }} placeholder="Ex: Itajaí" />
          </label>
          <label>UF origem
            <select value={form.uf_origem} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { uf_origem: e.target.value }); }); }}>
              {UF_OPTIONS.map(function(uf) { return <option key={uf || 't'} value={uf}>{uf || 'Todas'}</option>; })}
            </select>
          </label>
          <label>UF destino
            <select value={form.uf_destino} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { uf_destino: e.target.value }); }); }}>
              {UF_OPTIONS.map(function(uf) { return <option key={uf || 't'} value={uf}>{uf || 'Todas'}</option>; })}
            </select>
          </label>
          <label>Início previsto
            <input type="date" value={form.data_inicio_prevista} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { data_inicio_prevista: e.target.value }); }); }} />
          </label>
          <label className="sim-flag" style={{ justifyContent: 'end' }}>
            <input type="checkbox" checked={form.incluir_simulacao} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { incluir_simulacao: e.target.checked }); }); }} />
            Incluir nas simulações
          </label>
        </div>
        <div className="sim-form-grid sim-grid-3" style={{ marginTop: 12 }}>
          <label>Descrição<input value={form.descricao} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { descricao: e.target.value }); }); }} /></label>
          <label>Região<input value={form.regiao} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { regiao: e.target.value }); }); }} placeholder="Ex: SP/MG/ES" /></label>
          <label>Observação<input value={form.observacao} onChange={function(e) { setForm(function(p) { return Object.assign({}, p, { observacao: e.target.value }); }); }} /></label>
        </div>
        <div className="sim-actions" style={{ marginTop: 14 }}>
          <button className="primary" type="button" onClick={salvarNovaTabela} disabled={salvando}>{salvando ? 'Salvando...' : 'Criar tabela em negociação'}</button>
          <button className="sim-tab" type="button" onClick={function() { setForm(Object.assign({}, FORM_VAZIO)); }}>Limpar</button>
        </div>
      </section>

      {/* LISTA */}
      <section className="sim-card">
        <div className="sim-resultado-topo compact-top">
          <div><h2 style={{ margin: 0 }}>Tabelas cadastradas</h2></div>
          <button className="sim-tab" type="button" onClick={carregar} disabled={carregando}>{carregando ? 'Atualizando...' : 'Atualizar'}</button>
        </div>
        <div className="sim-form-grid sim-grid-4">
          <label>Status
            <select value={filtros.status} onChange={function(e) { setFiltros(function(p) { return Object.assign({}, p, { status: e.target.value }); }); }}>
              <option value="">Todos</option>
              {STATUS_TABELA_NEGOCIACAO.map(function(s) { return <option key={s}>{s}</option>; })}
            </select>
          </label>
          <label>Tipo
            <select value={filtros.tipoTabela} onChange={function(e) { setFiltros(function(p) { return Object.assign({}, p, { tipoTabela: e.target.value }); }); }}>
              <option value="">Todos</option>
              {TIPOS_TABELA_NEGOCIACAO.map(function(t) { return <option key={t}>{t}</option>; })}
            </select>
          </label>
          <label>Canal
            <select value={filtros.canal} onChange={function(e) { setFiltros(function(p) { return Object.assign({}, p, { canal: e.target.value }); }); }}>
              <option value="">Todos</option>
              {CANAIS.map(function(c) { return <option key={c}>{c}</option>; })}
            </select>
          </label>
          <label>Transportadora
            <input value={filtros.transportadora} onChange={function(e) { setFiltros(function(p) { return Object.assign({}, p, { transportadora: e.target.value }); }); }} placeholder="Buscar" />
          </label>
        </div>
        <div className="sim-actions" style={{ marginTop: 12 }}>
          <button className="primary" type="button" onClick={carregar}>Filtrar</button>
          <button className="sim-tab" type="button" onClick={function() { setFiltros({ status: '', tipoTabela: '', canal: '', transportadora: '' }); }}>Limpar filtros</button>
        </div>
        <div className="sim-analise-tabela-wrap" style={{ marginTop: 14 }}>
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Negociação</th>
                <th>Status</th>
                <th>Rodada</th>
                <th>Simulação</th>
                <th>Indicadores principais</th>
                <th>Operação</th>
                <th>Frete % NF</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tabelas.map(function(tabela) {
                var ind = getIndicadoresTabela(tabela);
                var historicoRodadas = getHistoricoRodadasTabela(tabela);
                return (
                  <tr key={tabela.id}>
                    <td style={{ minWidth: 230 }}>
                      <strong>{tabela.transportadora}</strong>
                      <BadgeImportacao tipo={tabela.origem_importacao} />
                      <div style={{ fontSize: 12, color: '#334155', marginTop: 3 }}>{origemTabelaLabel(tabela)}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                        {tabela.descricao || tabela.regiao || 'Sem descrição'}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                        {tabela.tipo_tabela} · {tabela.canal} · Recebida em {formatDateBR(tabela.data_recebimento)}
                      </div>
                    </td>
                    <td>
                      <span style={Object.assign({}, statusStyle(tabela.status), { borderRadius: 999, padding: '4px 8px', fontSize: 12, fontWeight: 700 })}>
                        {tabela.status}
                      </span>
                    </td>
                    <td>
                      <strong>{ind.rodada}ª</strong>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{historicoRodadas.length} registro(s)</div>
                    </td>
                    <td>
                      <button className="sim-tab" type="button" onClick={function() { alternarSimulacao(tabela); }}>
                        {tabela.incluir_simulacao ? 'Sim' : 'Não'}
                      </button>
                      <div style={{ fontSize: 11, color: ind.temSimulacao ? '#15803d' : '#64748b', marginTop: 4 }}>
                        {ind.temSimulacao ? 'Com análise salva' : 'Ainda sem simulação'}
                      </div>
                    </td>
                    <td style={{ minWidth: 240 }}>
                      {ind.temSimulacao ? (
                        <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          <div><strong>Aderência:</strong> {formatPercent(ind.aderencia)}</div>
                          <div><strong>Saving mês:</strong> {formatMoney(ind.savingMes)} · <strong>ano:</strong> {formatMoney(ind.savingAno)}</div>
                          <div><strong>Faturamento mês:</strong> {formatMoney(ind.faturamentoMes)} · <strong>ano:</strong> {formatMoney(ind.faturamentoAno)}</div>
                        </div>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: 12 }}>Execute o Simulador Realizado e salve o resultado.</span>
                      )}
                    </td>
                    <td style={{ minWidth: 180 }}>
                      {ind.temSimulacao ? (
                        <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          <div><strong>NF/dia:</strong> {formatNumber(ind.pedidosDia, 1)} · <strong>mês:</strong> {formatNumber(ind.pedidosMes, 0)}</div>
                          <div><strong>Volumes/dia:</strong> {formatNumber(ind.volumesDia, 1)} · <strong>ano:</strong> {formatNumber(ind.volumesAno, 0)}</div>
                          <div style={{ color: '#64748b' }}>{ind.ctesAtendidos}/{ind.ctesAnalisados} CT-es com tabela</div>
                        </div>
                      ) : '-' }
                    </td>
                    <td style={{ minWidth: 150 }}>
                      {ind.temSimulacao ? (
                        <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          <div>Realizado: <strong>{formatPercent(ind.percentualReal)}</strong></div>
                          <div>Tabela: <strong>{formatPercent(ind.percentualTabela)}</strong></div>
                          <div style={{ color: ind.reducaoPercentual >= 0 ? '#15803d' : '#dc2626' }}>
                            {ind.reducaoPercentual >= 0 ? 'Redução' : 'Aumento'}: {formatPercent(Math.abs(ind.reducaoPercentual))}
                          </div>
                        </div>
                      ) : '-' }
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="sim-tab" type="button" onClick={function() { abrirTabela(tabela); }}>Abrir</button>
                        <select value={tabela.status} onChange={function(e) { atualizarStatus(tabela, e.target.value); }}>
                          {STATUS_TABELA_NEGOCIACAO.map(function(s) { return <option key={s}>{s}</option>; })}
                        </select>
                        <button className="sim-tab" type="button" onClick={function() { abrirModalAprovacao(tabela); }}>Aprovar</button>
                        <button className="sim-tab" type="button" onClick={function() { excluirTabela(tabela); }}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!tabelas.length && <tr><td colSpan="8">Nenhuma tabela encontrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* PAINEL DE DETALHE */}
      {selecionada ? (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <div>
              <h2 style={{ margin: 0 }}>
                {selecionada.transportadora}
                <BadgeImportacao tipo={selecionada.origem_importacao} />
              </h2>
              <p>{selecionada.tipo_tabela} · {selecionada.canal} · {selecionada.status} · Rodada {getRodadaAtualTabela(selecionada)}ª</p>
              <p style={{ marginTop: 4, color: '#475569' }}>{origemTabelaLabel(selecionada)}{selecionada.descricao ? ' · ' + selecionada.descricao : ''}</p>
            </div>
            <button className="sim-tab" type="button" onClick={function() { abrirTabela(selecionada); }}>Recarregar</button>
          </div>

          {selecionada ? (function() {
            var ind = getIndicadoresTabela(selecionada);
            return ind.temSimulacao ? (
              <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 18 }}>
                <div className="summary-card"><span>Aderência</span><strong>{formatPercent(ind.aderencia)}</strong><small>{ind.ctesAtendidos}/{ind.ctesAnalisados} CT-es com tabela</small></div>
                <div className="summary-card"><span>Saving mês</span><strong>{formatMoney(ind.savingMes)}</strong><small>Ano: {formatMoney(ind.savingAno)}</small></div>
                <div className="summary-card"><span>Faturamento mês</span><strong>{formatMoney(ind.faturamentoMes)}</strong><small>Ano: {formatMoney(ind.faturamentoAno)}</small></div>
                <div className="summary-card"><span>Pedidos</span><strong>{formatNumber(ind.pedidosDia, 1)}/dia</strong><small>{formatNumber(ind.pedidosMes, 0)}/mês</small></div>
                <div className="summary-card"><span>Volumes</span><strong>{formatNumber(ind.volumesDia, 1)}/dia</strong><small>{formatNumber(ind.volumesAno, 0)}/ano</small></div>
                <div className="summary-card"><span>Frete % NF</span><strong>{formatPercent(ind.percentualTabela)}</strong><small>Real: {formatPercent(ind.percentualReal)} · Redução: {formatPercent(ind.reducaoPercentual)}</small></div>
              </div>
            ) : (
              <div className="sim-alert info" style={{ marginBottom: 18 }}>
                Esta negociação ainda não tem simulação salva. Execute o Simulador Realizado, selecione esta tabela e salve o resultado para alimentar aderência, saving, faturamento, pedidos e volumes.
              </div>
            );
          })() : null}

          {/* abas */}
          <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', marginBottom: 20, borderBottom: '2px solid #e2e8f0' }}>
            {ABAS.map(function(aba) {
              return (
                <button key={aba.key} type="button" onClick={function() { setAbaNegoc(aba.key); }}
                  style={{ padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                    fontWeight: abaNegoc === aba.key ? 700 : 400,
                    color: abaNegoc === aba.key ? '#3b82f6' : '#64748b',
                    borderBottom: abaNegoc === aba.key ? '3px solid #3b82f6' : '3px solid transparent',
                    marginBottom: -2, fontSize: 14 }}>
                  {aba.label}
                </button>
              );
            })}
          </div>

          {/* ABA: IMPORTAÇÃO */}
          {abaNegoc === 'importacao' ? (
            <div>
              <div className="sim-parametros-box" style={{ marginBottom: 20 }}>
                <div className="sim-parametros-header"><div><strong>Tipo de importação</strong><p>Escolha o modelo de acordo com o arquivo recebido.</p></div></div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                  {TIPOS_IMPORTACAO.map(function(tipo) {
                    return (
                      <button key={tipo.value} type="button" style={styBtn(tipoImportacao === tipo.value)}
                        onClick={function() { setTipoImportacao(tipo.value); setErro(''); setSucesso(''); limparImport(); }}>
                        {tipo.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {tipoImportacao === 'VERUM_ROTAS_FRETES' ? (
                <div>
                  <div className="sim-alert info">Usa o motor da tela <strong>Importar Template</strong>: dois arquivos separados (Rotas e Fretes).</div>
                  <div className="sim-parametros-box" style={{ marginTop: 14 }}>
                    <div className="sim-parametros-header"><div><strong>Modelos oficiais</strong></div></div>
                    <div className="sim-actions" style={{ marginTop: 12 }}>
                      <button className="sim-tab" type="button" onClick={baixarModeloTemplateRotas}>Baixar modelo de Rotas</button>
                      <button className="sim-tab" type="button" onClick={baixarModeloTemplateFretes}>Baixar modelo de Fretes</button>
                    </div>
                  </div>
                  <div className="sim-form-grid sim-grid-4" style={{ marginTop: 14 }}>
                    <label>Início vigência<input type="date" value={inicioVigencia} onChange={function(e) { setInicioVigencia(e.target.value); }} /></label>
                    <label>Fim vigência<input type="date" value={fimVigencia} onChange={function(e) { setFimVigencia(e.target.value); }} /></label>
                    <label>Arquivo de Rotas<input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={function(e) { setArquivoRotas(e.target.files ? e.target.files[0] : null); }} /></label>
                    <label>Arquivo de Fretes<input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={function(e) { setArquivoFretes(e.target.files ? e.target.files[0] : null); }} /></label>
                  </div>
                  <div className="sim-actions" style={{ marginTop: 12 }}>
                    <button className="primary" type="button" onClick={processarVerum}>Ler template</button>
                    <button className="sim-tab" type="button" onClick={formatarVerum} disabled={!resultadoTemplate}>Formatar no padrão do sistema</button>
                    <button className="sim-tab" type="button" onClick={function() { setMostrarPreview(function(p) { return !p; }); }} disabled={!formatado}>{mostrarPreview ? 'Recolher' : 'Visualizar tabela'}</button>
                    <button className="sim-tab" type="button" onClick={function() { exportarXlsx(formatado ? formatado.cotacoes : [], 'fretes-negoc-' + normalizarTexto(selecionada.transportadora) + '.xlsx', 'Fretes'); }} disabled={!formatado}>Baixar fretes</button>
                    <button className="primary" type="button" onClick={function() { salvarItens(montarItensVerum(formatado), 'VERUM_ROTAS_FRETES'); }} disabled={!formatado || salvando}>{salvando ? 'Salvando...' : 'Salvar na negociação'}</button>
                  </div>
                  {resultadoTemplate ? (
                    <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 14 }}>
                      <div className="summary-card"><span>Rotas lidas</span><strong>{resultadoTemplate.rotas.length}</strong></div>
                      <div className="summary-card"><span>Quebras</span><strong>{resultadoTemplate.quebrasFaixa.length}</strong></div>
                      <div className="summary-card"><span>Fretes lidos</span><strong>{resultadoTemplate.fretes.length}</strong></div>
                    </div>
                  ) : null}
                  {formatado && mostrarPreview ? (
                    <div className="sim-parametros-box" style={{ marginTop: 14 }}>
                      <div className="sim-parametros-header"><div><strong>Revisão</strong><p>{formatado.cotacoes.length} cotação(ões) prontas.</p></div></div>
                      <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                        <table className="sim-analise-tabela">
                          <thead><tr><th>Faixa/Rota</th><th>Origem</th><th>Destino</th><th>IBGE</th><th>Peso ini</th><th>Peso fim</th><th>Taxa</th><th>% NF</th><th>Mín</th><th>ADV%</th><th>Excedente</th><th>Prazo</th></tr></thead>
                          <tbody>
                            {formatado.cotacoes.slice(0, 100).map(function(item) {
                              var cotNome  = String(item.rota || '').toUpperCase().trim();
                              var faixaRaw = String(item.faixaPeso || '').trim();
                              var faixaLabel = faixaRaw ? (cotNome ? cotNome + ' | ' + faixaRaw : faixaRaw) : cotNome || '-';
                              return (
                                <tr key={item.id}>
                                  <td>{faixaLabel}</td>
                                  <td>{item.origem}</td>
                                  <td>{item.cidadeDestino || item.ufDestino || '-'}</td>
                                  <td style={{ fontSize: 11, color: '#64748b' }}>{item.ibgeDestino || '-'}</td>
                                  <td>{numeroOuVazio(item.pesoMin)}</td>
                                  <td>{numeroOuVazio(item.pesoMax)}</td>
                                  <td>{numeroOuVazio(item.taxaAplicada)}</td>
                                  <td>{numeroOuVazio(item.percentual)}</td>
                                  <td>{numeroOuVazio(item.freteMinimo)}</td>
                                  <td>{numeroOuVazio(item.advalorem)}</td>
                                  <td>{Number(item.excesso || 0) > 0 ? item.excesso + ' kg · R$ ' + (item.valorExcedente || 0) : '-'}</td>
                                  <td>{item.prazo || '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {formatado.cotacoes.length > 100 ? <div className="empty-note">Primeiras 100 linhas.</div> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tipoImportacao === 'CANTU_MODELO_UNICO' ? (
                <div>
                  <div className="sim-alert info">Importa o template Cantu. O sistema lê automaticamente as abas <strong>FICHA DE CADASTRO</strong>, <strong>TABELA</strong> e <strong>ATENDIMENTO</strong>.</div>
                  <div className="sim-form-grid sim-grid-4" style={{ marginTop: 14 }}>
                    <label>Subtipo do modelo
                      <select value={subtipoCantu} onChange={function(e) { setSubtipoCantu(e.target.value); setResultadoCantu(null); }}>
                        {SUBTIPOS_CANTU.map(function(s) { return <option key={s.value} value={s.value}>{s.label}</option>; })}
                      </select>
                    </label>
                    <label>Início vigência<input type="date" value={inicioVigencia} onChange={function(e) { setInicioVigencia(e.target.value); }} /></label>
                    <label>Fim vigência<input type="date" value={fimVigencia} onChange={function(e) { setFimVigencia(e.target.value); }} /></label>
                    <label>Arquivo Cantu (único)<input type="file" accept=".xlsx,.xls,.xlsb" onChange={function(e) { setArquivoCantu(e.target.files ? e.target.files[0] : null); setResultadoCantu(null); }} /></label>
                  </div>
                  <div className="sim-actions" style={{ marginTop: 12 }}>
                    <button className="primary" type="button" onClick={processarCantu} disabled={!arquivoCantu}>Ler modelo Cantu</button>
                    <button className="sim-tab" type="button" onClick={function() { exportarXlsx(resultadoCantu ? resultadoCantu.itens.map(function(i) { return { IBGE: i.ibge_destino, Cidade: i.cidade_destino, UF: i.uf_destino, Regiao: i.faixa_peso, Perc: i.frete_percentual, Min: i.frete_minimo, TDA: i.tda, Prazo: i.prazo }; }) : [], 'cantu-prev-' + normalizarTexto(selecionada.transportadora) + '.xlsx', 'Prévia'); }} disabled={!resultadoCantu}>Exportar prévia</button>
                    <button className="primary" type="button" onClick={function() { salvarItens(resultadoCantu ? resultadoCantu.itens : [], 'CANTU_MODELO_UNICO', { canal: resultadoCantu ? resultadoCantu.meta.canal : undefined }); }} disabled={!resultadoCantu || salvando}>{salvando ? 'Salvando...' : 'Salvar na negociação'}</button>
                  </div>
                  {resultadoCantu ? (
                    <div>
                      <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 14 }}>
                        <div className="summary-card"><span>Itens extraídos</span><strong>{resultadoCantu.meta.totalItens}</strong></div>
                        <div className="summary-card"><span>Canal</span><strong>{resultadoCantu.meta.canal}</strong></div>
                        <div className="summary-card"><span>Subtipo</span><strong>{subtipoCantu.replace('_', ' ')}</strong></div>
                        {resultadoCantu.meta.temAtendimento ? (
                          <div className="summary-card"><span>Cidades c/ prazo</span><strong>{resultadoCantu.meta.totalCidades}</strong></div>
                        ) : null}
                        {resultadoCantu.meta.cidadesComTarifa != null ? (
                          <div className="summary-card"><span>Com tarifa</span><strong>{resultadoCantu.meta.cidadesComTarifa}</strong></div>
                        ) : null}
                        <div className="summary-card"><span>Ficha lida</span><strong>{resultadoCantu.meta.fichaLida ? 'Sim' : 'Não'}</strong></div>
                      </div>
                      <div className="sim-parametros-box" style={{ marginTop: 14 }}>
                        <div className="sim-parametros-header"><div><strong>Prévia dos itens</strong></div></div>
                        <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                          <table className="sim-analise-tabela">
                            <thead><tr><th>IBGE</th><th>Cidade</th><th>UF</th><th>Região/Faixa</th><th>% NF</th><th>Frete Mín</th><th>TDA</th><th>Prazo</th></tr></thead>
                            <tbody>
                              {resultadoCantu.itens.slice(0, 150).map(function(item, i) {
                                return (
                                  <tr key={i}>
                                    <td style={{ fontSize: 11, color: '#64748b' }}>{item.ibge_destino || '-'}</td>
                                    <td>{item.cidade_destino || '-'}</td>
                                    <td><strong>{item.uf_destino}</strong></td>
                                    <td>{item.faixa_peso}</td>
                                    <td>{Number(item.frete_percentual || 0).toFixed(4)}%</td>
                                    <td>{formatMoney(item.frete_minimo)}</td>
                                    <td>{item.tda ? formatMoney(item.tda) : '-'}</td>
                                    <td>{item.prazo || '-'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {resultadoCantu.itens.length > 150 ? <div className="empty-note">Mostrando 150 de {resultadoCantu.itens.length} itens.</div> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tipoImportacao === 'LOTACAO_TRANSPORTADORA' ? (
                <div>
                  <div className="sim-alert info">Importa modelo de Lotação. Aba: <strong>MODELO TRANSPORTADORA</strong>. Colunas: Transportadora · Origem · UF ORIGEM · Destino · UF DESTINO · KM · TIPO · TARGET · ICMS · Pedágio.</div>
                  <div className="sim-parametros-box" style={{ marginTop: 14 }}>
                    <div className="sim-parametros-header"><div><strong>Modelo oficial de Lotação</strong></div></div>
                    <div className="sim-actions" style={{ marginTop: 12 }}>
                      <button className="sim-tab" type="button" onClick={baixarModeloLotacao}>Baixar modelo de Lotação (.xlsx)</button>
                    </div>
                  </div>
                  <div className="sim-form-grid sim-grid-3" style={{ marginTop: 14 }}>
                    <label>Início vigência<input type="date" value={inicioVigencia} onChange={function(e) { setInicioVigencia(e.target.value); }} /></label>
                    <label>Fim vigência<input type="date" value={fimVigencia} onChange={function(e) { setFimVigencia(e.target.value); }} /></label>
                    <label>Arquivo de Lotação<input type="file" accept=".xlsx,.xls,.xlsb" onChange={function(e) { setArquivoLotacao(e.target.files ? e.target.files[0] : null); setResultadoLotacao(null); }} /></label>
                  </div>
                  <div className="sim-actions" style={{ marginTop: 12 }}>
                    <button className="primary" type="button" onClick={processarLotacao} disabled={!arquivoLotacao}>Ler modelo de Lotação</button>
                    <button className="sim-tab" type="button" onClick={function() { exportarXlsx(resultadoLotacao ? resultadoLotacao.itens.map(function(i) { return { Origem: i.cidade_origem, UFOrig: i.uf_origem, Destino: i.cidade_destino, UFDest: i.uf_destino, KM: i.km, Tipo: i.tipo_veiculo, Target: i.valor_lotacao, ICMS: i.icms, Pedagio: i.pedagio, Prazo: i.prazo }; }) : [], 'lotacao-prev-' + normalizarTexto(selecionada.transportadora) + '.xlsx', 'Lotação'); }} disabled={!resultadoLotacao}>Exportar prévia</button>
                    <button className="primary" type="button" onClick={function() { salvarItens(resultadoLotacao ? resultadoLotacao.itens : [], 'LOTACAO_TRANSPORTADORA', { tipo_tabela: 'LOTACAO', canal: 'LOTACAO' }); }} disabled={!resultadoLotacao || salvando}>{salvando ? 'Salvando...' : 'Salvar na negociação'}</button>
                  </div>
                  {resultadoLotacao ? (
                    <div>
                      <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 14 }}>
                        <div className="summary-card"><span>Rotas extraídas</span><strong>{resultadoLotacao.meta.totalItens}</strong></div>
                        <div className="summary-card"><span>Tipo</span><strong>LOTAÇÃO</strong></div>
                      </div>
                      <div className="sim-parametros-box" style={{ marginTop: 14 }}>
                        <div className="sim-parametros-header"><div><strong>Prévia das rotas de lotação</strong></div></div>
                        <div className="sim-analise-tabela-wrap" style={{ marginTop: 12 }}>
                          <table className="sim-analise-tabela">
                            <thead><tr><th>Origem</th><th>UF Orig</th><th>Destino</th><th>UF Dest</th><th>KM</th><th>Tipo Veículo</th><th>Target</th><th>ICMS</th><th>Pedágio</th><th>Prazo</th></tr></thead>
                            <tbody>
                              {resultadoLotacao.itens.slice(0, 200).map(function(item, i) {
                                return (
                                  <tr key={i}>
                                    <td>{item.cidade_origem}</td><td>{item.uf_origem}</td>
                                    <td>{item.cidade_destino}</td><td>{item.uf_destino}</td>
                                    <td>{item.km}</td><td>{item.tipo_veiculo || '-'}</td>
                                    <td>{formatMoney(item.valor_lotacao)}</td>
                                    <td>{Number(item.icms || 0).toFixed(2)}%</td>
                                    <td>{formatMoney(item.pedagio)}</td><td>{item.prazo || '-'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {resultadoLotacao.itens.length > 200 ? <div className="empty-note">Mostrando 200 de {resultadoLotacao.itens.length} rotas.</div> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ABA: GENERALIDADES */}
          {abaNegoc === 'generalidades' ? (
            <div>
              <h3 style={{ margin: '0 0 16px' }}>Generalidades</h3>
              <p style={{ color: '#64748b', marginBottom: 16 }}>Taxas e condições aplicadas a todas as rotas desta tabela. Taxas especiais por IBGE prevalecem sobre as generalidades.</p>
              <div className="sim-form-grid sim-grid-5">
                <label>Tipo de cálculo
                  <select value={generalidades.tipoCalculo || 'PERCENTUAL'} onChange={function(e) { handleGenField('tipoCalculo', e.target.value); }}>
                    <option value="PERCENTUAL">PERCENTUAL</option>
                    <option value="FAIXA_DE_PESO">FAIXA_DE_PESO</option>
                    <option value="PESO_CUBADO">PESO_CUBADO</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                  <input type="checkbox" checked={generalidades.incideIcms ? true : false} onChange={function(e) { handleGenField('incideIcms', e.target.checked); }} />
                  Incide ICMS
                </label>
                <label>Alíquota ICMS %
                  <input type="number" step="0.01" value={generalidades.aliquotaIcms || 0} onChange={function(e) { handleGenField('aliquotaIcms', e.target.value); }} />
                </label>
                <label>Cubagem (kg/m³)
                  <input type="number" step="1" value={generalidades.cubagem || 300} onChange={function(e) { handleGenField('cubagem', e.target.value); }} />
                </label>
                <label>CTRC emitido (R$)
                  <input type="number" step="0.01" value={generalidades.ctrc || 0} onChange={function(e) { handleGenField('ctrc', e.target.value); }} />
                </label>
              </div>
              <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
                <label>GRIS %<input type="number" step="0.0001" value={generalidades.gris || 0} onChange={function(e) { handleGenField('gris', e.target.value); }} /></label>
                <label>GRIS mínimo (R$)<input type="number" step="0.01" value={generalidades.grisMinimo || 0} onChange={function(e) { handleGenField('grisMinimo', e.target.value); }} /></label>
                <label>Ad Valorem %<input type="number" step="0.0001" value={generalidades.adValorem || 0} onChange={function(e) { handleGenField('adValorem', e.target.value); }} /></label>
                <label>Ad Valorem mínimo (R$)<input type="number" step="0.01" value={generalidades.adValoremMinimo || 0} onChange={function(e) { handleGenField('adValoremMinimo', e.target.value); }} /></label>
                <label>Pedágio (R$/100kg)<input type="number" step="0.01" value={generalidades.pedagio || 0} onChange={function(e) { handleGenField('pedagio', e.target.value); }} /></label>
              </div>
              <div className="sim-form-grid sim-grid-3" style={{ marginTop: 12 }}>
                <label>TAS (R$)<input type="number" step="0.01" value={generalidades.tas || 0} onChange={function(e) { handleGenField('tas', e.target.value); }} /></label>
                <label style={{ gridColumn: 'span 2' }}>Observações<input value={generalidades.observacoes || ''} onChange={function(e) { handleGenField('observacoes', e.target.value); }} /></label>
              </div>
              <div className="sim-actions" style={{ marginTop: 16 }}>
                <button className="primary" type="button" onClick={handleSalvarGeneralidades} disabled={salvandoGen}>{salvandoGen ? 'Salvando...' : 'Salvar generalidades'}</button>
                <button className="sim-tab" type="button" onClick={function() { setGeneralidades(Object.assign({}, DEFAULT_GENERALIDADES)); }}>Resetar padrões</button>
              </div>
            </div>
          ) : null}

          {/* ABA: TAXAS POR DESTINO */}
          {abaNegoc === 'taxas' ? (
            <div>
              <h3 style={{ margin: '0 0 8px' }}>Taxas por Destino (IBGE)</h3>
              <p style={{ color: '#64748b', marginBottom: 16 }}>Taxas específicas por IBGE/cidade. Prevalecem sobre as generalidades. GRIS e Ad Valorem específicos têm prioridade no cálculo.</p>

              <div className="sim-alert info" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <strong>Importação em massa de taxas por destino</strong>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
                    Baixe o modelo, preencha uma linha por IBGE/cidade e importe para substituir as taxas especiais desta negociação.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="sim-tab" type="button" onClick={baixarModeloTaxasDestinoNegociacao}>Baixar modelo</button>
                  <button className="primary" type="button" onClick={function() { if (inputTaxasDestinoRef.current) inputTaxasDestinoRef.current.click(); }} disabled={salvandoTaxa || !selecionada}>
                    {salvandoTaxa ? 'Importando...' : 'Importar modelo'}
                  </button>
                  <input
                    ref={inputTaxasDestinoRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={handleImportarModeloTaxasDestino}
                  />
                </div>
              </div>

              {itensSelecionada.some(function(i) { return i.ibge_destino && (Number(i.tda) > 0 || Number(i.tde) > 0); }) ? (
                <div className="sim-alert info" style={{ marginBottom: 16 }}>
                  Itens importados contêm TDA/TRT por cidade.
                  <button className="sim-tab" type="button" onClick={handleImportarTaxasDoAtendimento} style={{ marginLeft: 12 }}>
                    Importar taxas dos itens salvos
                  </button>
                </div>
              ) : null}

              <div className="sim-parametros-box" style={{ marginBottom: 20 }}>
                <div className="sim-parametros-header">
                  <div><strong>{editandoTaxa ? 'Editando taxa' : 'Nova taxa por destino'}</strong></div>
                </div>
                <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
                  <label>IBGE Destino<input value={novaTaxa.ibge_destino} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { ibge_destino: e.target.value }); }); }} placeholder="Ex: 4209102" /></label>
                  <label>UF
                    <select value={novaTaxa.uf_destino} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { uf_destino: e.target.value }); }); }}>
                      {UF_OPTIONS.map(function(uf) { return <option key={uf || 't'} value={uf}>{uf || 'UF'}</option>; })}
                    </select>
                  </label>
                  <label>Cidade<input value={novaTaxa.cidade_destino} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { cidade_destino: e.target.value }); }); }} /></label>
                  <label>TDA (R$)<input type="number" step="0.01" value={novaTaxa.tda} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { tda: e.target.value }); }); }} /></label>
                  <label>TDR (R$)<input type="number" step="0.01" value={novaTaxa.tdr} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { tdr: e.target.value }); }); }} /></label>
                </div>
                <div className="sim-form-grid sim-grid-5" style={{ marginTop: 12 }}>
                  <label>TRT (R$)<input type="number" step="0.01" value={novaTaxa.trt} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { trt: e.target.value }); }); }} /></label>
                  <label>SUFRAMA (R$)<input type="number" step="0.01" value={novaTaxa.suframa} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { suframa: e.target.value }); }); }} /></label>
                  <label>Outras (R$)<input type="number" step="0.01" value={novaTaxa.outras_taxas} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { outras_taxas: e.target.value }); }); }} /></label>
                  <label>GRIS % <small style={{ color: '#94a3b8' }}>(vazio=geral)</small><input type="number" step="0.0001" value={novaTaxa.gris} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { gris: e.target.value }); }); }} /></label>
                  <label>GRIS mín (R$)<input type="number" step="0.01" value={novaTaxa.gris_minimo} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { gris_minimo: e.target.value }); }); }} /></label>
                </div>
                <div className="sim-form-grid sim-grid-4" style={{ marginTop: 12 }}>
                  <label>Ad Valorem % <small style={{ color: '#94a3b8' }}>(vazio=geral)</small><input type="number" step="0.0001" value={novaTaxa.advalorem} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { advalorem: e.target.value }); }); }} /></label>
                  <label>Ad Val mín (R$)<input type="number" step="0.01" value={novaTaxa.advalorem_minimo} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { advalorem_minimo: e.target.value }); }); }} /></label>
                  <label style={{ gridColumn: 'span 2' }}>Observação<input value={novaTaxa.observacao} onChange={function(e) { setNovaTaxa(function(p) { return Object.assign({}, p, { observacao: e.target.value }); }); }} /></label>
                </div>
                <div className="sim-actions" style={{ marginTop: 14 }}>
                  <button className="primary" type="button" onClick={handleSalvarTaxa} disabled={salvandoTaxa}>{salvandoTaxa ? 'Salvando...' : editandoTaxa ? 'Atualizar taxa' : 'Adicionar taxa'}</button>
                  {editandoTaxa ? (
                    <button className="sim-tab" type="button" onClick={function() { setEditandoTaxa(null); setNovaTaxa(Object.assign({}, TAXA_VAZIA)); }}>Cancelar edição</button>
                  ) : null}
                </div>
              </div>

              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr><th>IBGE</th><th>Cidade</th><th>UF</th><th>TDA</th><th>TDR</th><th>TRT</th><th>SUFRAMA</th><th>Outras</th><th>GRIS %</th><th>ADV %</th><th>Ações</th></tr>
                  </thead>
                  <tbody>
                    {taxasDestino.map(function(taxa) {
                      return (
                        <tr key={taxa.id}>
                          <td style={{ fontSize: 11, color: '#64748b' }}>{taxa.ibge_destino || '-'}</td>
                          <td>{taxa.cidade_destino || '-'}</td>
                          <td><strong>{taxa.uf_destino}</strong></td>
                          <td>{Number(taxa.tda) > 0 ? formatMoney(taxa.tda) : '-'}</td>
                          <td>{Number(taxa.tdr) > 0 ? formatMoney(taxa.tdr) : '-'}</td>
                          <td>{Number(taxa.trt) > 0 ? formatMoney(taxa.trt) : '-'}</td>
                          <td>{Number(taxa.suframa) > 0 ? formatMoney(taxa.suframa) : '-'}</td>
                          <td>{Number(taxa.outras_taxas) > 0 ? formatMoney(taxa.outras_taxas) : '-'}</td>
                          <td>{Number(taxa.gris) > 0 ? <strong>{Number(taxa.gris).toFixed(4)}%</strong> : <span style={{ color: '#94a3b8', fontSize: 11 }}>geral</span>}</td>
                          <td>{Number(taxa.advalorem) > 0 ? <strong>{Number(taxa.advalorem).toFixed(4)}%</strong> : <span style={{ color: '#94a3b8', fontSize: 11 }}>geral</span>}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="sim-tab" type="button" onClick={function() { handleEditarTaxa(taxa); }}>Editar</button>
                              <button className="sim-tab" type="button" onClick={function() { handleExcluirTaxa(taxa); }}>Excluir</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!taxasDestino.length ? <tr><td colSpan="11">Nenhuma taxa especial cadastrada. Adicione acima ou importe dos itens salvos.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              <div className="empty-note" style={{ marginTop: 8 }}>{taxasDestino.length} taxa(s) cadastrada(s)</div>
            </div>
          ) : null}

          {/* ABA: ITENS SALVOS */}
          {abaNegoc === 'itens' ? (
            <div>
              <h3 style={{ margin: '0 0 12px' }}>Itens salvos nesta negociação</h3>
              <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 14 }}>
                <div className="summary-card"><span>Total</span><strong>{itensSelecionada.length}</strong></div>
                <div className="summary-card"><span>Rotas</span><strong>{resumoItens.rotas}</strong></div>
                <div className="summary-card"><span>Cotações/Faixas</span><strong>{resumoItens.cotacoes}</strong></div>
                <div className="summary-card"><span>UF destino</span><strong>{resumoItens.ufs}</strong></div>
              </div>

              <div className="sim-actions" style={{ marginBottom: 12 }}>
                <button
                  className="sim-tab"
                  type="button"
                  onClick={function() { setFiltroItens('COTACAO'); }}
                  style={filtroItens === 'COTACAO' ? { background: '#dbeafe', color: '#1d4ed8', borderColor: '#93c5fd' } : null}
                >
                  Cotações/Faixas ({resumoItens.cotacoes})
                </button>
                <button
                  className="sim-tab"
                  type="button"
                  onClick={function() { setFiltroItens('ROTA'); }}
                  style={filtroItens === 'ROTA' ? { background: '#dbeafe', color: '#1d4ed8', borderColor: '#93c5fd' } : null}
                >
                  Rotas ({resumoItens.rotas})
                </button>
                <button
                  className="sim-tab"
                  type="button"
                  onClick={function() { setFiltroItens('TODOS'); }}
                  style={filtroItens === 'TODOS' ? { background: '#dbeafe', color: '#1d4ed8', borderColor: '#93c5fd' } : null}
                >
                  Todos ({itensSelecionada.length})
                </button>
              </div>

              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Origem</th>
                      <th>Destino</th>
                      <th>Faixa/Rota</th>
                      <th>Peso inicial</th>
                      <th>Peso final</th>
                      <th>Taxa</th>
                      <th>% NF</th>
                      <th>ADV %</th>
                      <th>Excedente</th>
                      <th>Prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensFiltrados.slice(0, 120).map(function(item) {
                      return (
                        <tr key={item.id}>
                          <td>
                            <strong>{labelTipoItem(item)}</strong>
                            {getTipoItem(item) === 'ROTA' ? (
                              <div style={{ fontSize: 11, color: '#64748b' }}>linha técnica</div>
                            ) : null}
                          </td>
                          <td>{origemItem(item)}</td>
                          <td>{destinoItem(item)}</td>
                          <td>{item.faixa_peso || '-'}</td>
                          <td>{Number(item.peso_inicial || 0).toLocaleString('pt-BR')}</td>
                          <td>{Number(item.peso_final || 0).toLocaleString('pt-BR')}</td>
                          <td>{formatMoney(item.taxa_aplicada)}</td>
                          <td>{Number(item.frete_percentual || 0).toFixed(4)}</td>
                          <td>{Number(item.advalorem || 0).toFixed(4)}</td>
                          <td>{Number(item.excesso_kg || 0) > 0 || Number(item.valor_excedente || 0) > 0 ? (
                            <span>{Number(item.excesso_kg || 0).toLocaleString('pt-BR')} kg · {formatMoney(item.valor_excedente)}</span>
                          ) : '-'}</td>
                          <td>{item.prazo || '-'}</td>
                        </tr>
                      );
                    })}
                    {!itensFiltrados.length ? <tr><td colSpan="11">Nenhum item encontrado para este filtro.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              {itensFiltrados.length > 120 ? (
                <div className="empty-note">
                  Mostrando 120 de {itensFiltrados.length} itens filtrados. Total salvo: {itensSelecionada.length}.
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ABA: RODADAS */}
          {abaNegoc === 'rodadas' ? (function() {
            var historico = getHistoricoRodadasTabela(selecionada).slice().reverse();
            var simulacoes = historico.filter(function(r) { return r.tipo_registro === 'SIMULACAO'; });
            return (
              <div>
                <h3 style={{ margin: '0 0 12px' }}>Histórico de rodadas e análises</h3>
                <div className="sim-alert info" style={{ marginBottom: 14 }}>
                  Rotas e fretes da mesma proposta ficam na mesma rodada. Uma nova rodada deve ser aberta somente quando chegar uma nova proposta/tabela do transportador; os resultados salvos continuam guardados para comparação.
                </div>

                {simulacoes.length > 1 ? (
                  <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: 14 }}>
                    {simulacoes.slice(0, 4).map(function(rodada) {
                      var ind = rodada.indicadores || {};
                      return (
                        <div className="summary-card" key={rodada.id || rodada.criado_em}>
                          <span>{rodada.rodada}ª rodada</span>
                          <strong>{formatPercent(ind.aderencia || 0)}</strong>
                          <small>Saving mês: {formatMoney(ind.saving_mes || 0)}</small>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="sim-analise-tabela-wrap">
                  <table className="sim-analise-tabela">
                    <thead>
                      <tr>
                        <th>Rodada</th>
                        <th>Tipo</th>
                        <th>Data</th>
                        <th>Aderência</th>
                        <th>Saving mês/ano</th>
                        <th>Faturamento mês/ano</th>
                        <th>Pedidos/Volumes</th>
                        <th>Frete % NF</th>
                        <th>Observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historico.map(function(rodada, idx) {
                        var ind = rodada.indicadores || {};
                        var imp = rodada.itens_importados || {};
                        var salvos = rodada.itens_salvos_apos_importacao || {};
                        var isSim = rodada.tipo_registro === 'SIMULACAO';
                        return (
                          <tr key={rodada.id || rodada.criado_em || idx}>
                            <td><strong>{rodada.rodada || '-' }ª</strong></td>
                            <td>{isSim ? 'SIMULAÇÃO' : 'IMPORTAÇÃO'}</td>
                            <td>{formatDateBR(rodada.criado_em)}</td>
                            <td>{isSim ? formatPercent(ind.aderencia || 0) : '-'}</td>
                            <td>{isSim ? <span>{formatMoney(ind.saving_mes || 0)}<br /><small>{formatMoney(ind.saving_ano || 0)}</small></span> : '-'}</td>
                            <td>{isSim ? <span>{formatMoney(ind.faturamento_mes || 0)}<br /><small>{formatMoney(ind.faturamento_ano || 0)}</small></span> : '-'}</td>
                            <td>{isSim ? <span>{formatNumber(ind.pedidos_dia || 0, 1)} NF/dia<br /><small>{formatNumber(ind.volumes_dia || 0, 1)} vol/dia</small></span> : <span>{imp.rotas || 0} rotas · {imp.cotacoes || 0} fretes<br /><small>Ativo: {salvos.rotas || 0} rotas · {salvos.cotacoes || 0} fretes</small></span>}</td>
                            <td>{isSim ? <span>Real: {formatPercent(ind.percentual_frete_realizado || 0)}<br /><small>Tabela: {formatPercent(ind.percentual_frete_simulado || 0)}</small></span> : '-'}</td>
                            <td style={{ fontSize: 12, color: '#475569' }}>{rodada.observacao || rodada.origem_importacao || rodada.modo_substituicao || '-'}</td>
                          </tr>
                        );
                      })}
                      {!historico.length ? <tr><td colSpan="9">Nenhuma rodada registrada ainda.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })() : null}

        </section>
      ) : null}

      {/* MODAL APROVAÇÃO */}
      {modalAprovacao ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div className="sim-card" style={{ width: 'min(720px,100%)', maxHeight: '90vh', overflow: 'auto' }}>
            <h2>Aprovar tabela</h2>
            <p>A tabela de <strong>{modalAprovacao.transportadora}</strong> será marcada como aprovada.</p>
            <div className="sim-form-grid sim-grid-2">
              <label>Data início de vigência
                <input type="date" value={aprovacao.data_inicio_vigencia} onChange={function(e) { setAprovacao(function(p) { return Object.assign({}, p, { data_inicio_vigencia: e.target.value }); }); }} />
              </label>
              <label className="sim-flag" style={{ justifyContent: 'end' }}>
                <input type="checkbox" checked={aprovacao.substituir_tabela_anterior} onChange={function(e) { setAprovacao(function(p) { return Object.assign({}, p, { substituir_tabela_anterior: e.target.checked }); }); }} />
                Substitui tabela anterior
              </label>
            </div>
            <label style={{ marginTop: 12 }}>Justificativa
              <textarea value={aprovacao.justificativa_aprovacao} onChange={function(e) { setAprovacao(function(p) { return Object.assign({}, p, { justificativa_aprovacao: e.target.value }); }); }} placeholder="Explique o motivo da aprovação..." style={{ minHeight: 100 }} />
            </label>
            <div className="sim-actions" style={{ marginTop: 14 }}>
              <button className="primary" type="button" onClick={confirmarAprovacao} disabled={salvando}>{salvando ? 'Aprovando...' : 'Confirmar aprovação'}</button>
              <button className="sim-tab" type="button" onClick={function() { setModalAprovacao(null); }}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
