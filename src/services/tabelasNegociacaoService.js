import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  anexarResumoCapaNoPayload,
  erroColunaResumoCapaAusente,
  removerResumoCapaDoSelect,
} from '../utils/tabelasNegociacaoResumoCapa';
import {
  carregarHistoricoGestaoNegociacoes,
  carregarLaudoTransportadoraConsolidado,
  carregarResumoCompletoNegociacao,
  listarNegociacoesCapaEditor,
  listarNegociacoesResumo,
  obterNegociacaoCapa,
} from './tabelasNegociacaoSnapshotService';
import { salvarSecaoDb } from './freteDatabaseService';
import { converterTabelaNegociacaoParaSimulador } from '../utils/tabelasNegociacaoSimuladorAdapter';
import { carregarCargasLotacaoSupabase } from './lotacaoSupabaseService';
import { normalizarTexto as normalizarTextoLotacao } from '../utils/lotacaoTables';
import {
  normalizarStatusGestao,
  statusLegadoPorGestao,
  podePublicarOficial,
} from '../utils/tabelasNegociacaoGestao';

export const STATUS_TABELA_NEGOCIACAO = [
  'EM NEGOCIAÇÃO',
  'EM TESTE',
  'APROVADA',
  'REPROVADA',
  'PROMOVIDA PARA OFICIAL',
  'CANCELADA',
];

export const TIPOS_TABELA_NEGOCIACAO = [
  'FRACIONADO',
  'LOTACAO',
];

export const TIPOS_NEGOCIACAO = [
  { value: 'NOVA_TABELA', label: 'Nova tabela / Novo transportador' },
  { value: 'REAJUSTE_TABELA_EXISTENTE', label: 'Reajuste de tabela existente' },
  { value: 'TABELA_LOTACAO', label: 'Tabela de Lotacao' },
];

export const TIPOS_NEGOCIACAO_VALUES = TIPOS_NEGOCIACAO.map((item) => item.value);

export const DEFAULT_GENERALIDADES = {
  incideIcms: false,
  aliquotaIcms: 0,
  adValorem: 0,
  adValoremMinimo: 0,
  pedagio: 0,
  gris: 0,
  grisMinimo: 0,
  tas: 0,
  ctrc: 0,
  cubagem: 300,
  tipoCalculo: 'PERCENTUAL',
  observacoes: '',
};

function supabaseOrThrow() {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  return getSupabaseClient();
}

function texto(value) { return String(value || '').trim(); }
function upper(value) { return texto(value).toUpperCase(); }
function numero(value) {
  if (value === null || value === undefined || value === '') return 0;

  // Quando vem do Excel/SheetJS como número, preserva decimal.
  // Antes, 2.5 virava texto "2.5", o ponto era removido e salvava 25.
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  let texto = String(value)
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .trim();

  if (!texto) return 0;

  texto = texto.replace(/\s/g, '');

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) {
    // Ex.: 1.234,56
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    // Ex.: 2,5
    texto = texto.replace(',', '.');
  } else if (temPonto) {
    // Ex.: 2.5 ou 0.025: mantém como decimal.
    // Só trata como milhar quando o padrão for claramente 1.234 ou 12.345.
    const partes = texto.split('.');
    const pareceMilhar = partes.length > 1 && partes.slice(1).every((p) => p.length === 3) && partes[0].length <= 3 && Number(partes[0]) >= 1;
    if (pareceMilhar) texto = texto.replace(/\./g, '');
  }

  const limpo = texto.replace(/[^\d.-]/g, '');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}
function inteiro(value) {
  const n = parseInt(numero(value), 10);
  return Number.isFinite(n) ? n : 0;
}

function dataOuNull(value) {
  const raw = texto(value);
  return raw || null;
}

/** Amostra representativa para o laudo: evita enviesar só CT-es com maior saving (quase sempre ganhos). */
function selecionarCtesDetalhesParaPersistencia(detalhes = [], limite = 800) {
  if (!Array.isArray(detalhes) || !detalhes.length) return [];
  if (detalhes.length <= limite) return detalhes;

  const porRelevancia = (a, b) => numero(b.volumes || 1) - numero(a.volumes || 1)
    || numero(b.peso || 0) - numero(a.peso || 0)
    || String(b.destino || '').localeCompare(String(a.destino || ''), 'pt-BR');

  const perdidas = detalhes.filter((item) => item.statusSelecionada === 'Perderia').sort(porRelevancia);
  const ganhas = detalhes.filter((item) => item.statusSelecionada === 'Ganharia').sort(porRelevancia);
  const outros = detalhes.filter((item) => item.statusSelecionada !== 'Perderia' && item.statusSelecionada !== 'Ganharia').sort(porRelevancia);

  const total = detalhes.length;
  const pctPerdidas = perdidas.length / total;
  const minPerdidas = perdidas.length ? Math.min(perdidas.length, Math.max(250, Math.round(limite * 0.35))) : 0;
  const quotaPerdidas = Math.min(perdidas.length, Math.max(Math.round(limite * pctPerdidas), minPerdidas));
  const quotaGanhas = Math.min(ganhas.length, limite - quotaPerdidas);
  const quotaOutros = Math.max(limite - quotaPerdidas - quotaGanhas, 0);

  return [
    ...perdidas.slice(0, quotaPerdidas),
    ...ganhas.slice(0, quotaGanhas),
    ...outros.slice(0, quotaOutros),
  ].slice(0, limite);
}

export function normalizarTipoNegociacao(payload = {}) {
  const tipo = upper(payload.tipo_negociacao || payload.tipoNegociacao);
  if (TIPOS_NEGOCIACAO_VALUES.includes(tipo)) return tipo;
  if (upper(payload.tipo_tabela) === 'LOTACAO') return 'TABELA_LOTACAO';
  return 'NOVA_TABELA';
}

function normalizarTipoTabelaPorNegociacao(payload = {}) {
  const tipoNegociacao = normalizarTipoNegociacao(payload);
  if (tipoNegociacao === 'TABELA_LOTACAO') return 'LOTACAO';
  return upper(payload.tipo_tabela || 'FRACIONADO') || 'FRACIONADO';
}

function normalizarCanalPorNegociacao(payload = {}) {
  const tipoNegociacao = normalizarTipoNegociacao(payload);
  if (tipoNegociacao === 'TABELA_LOTACAO') return 'LOTACAO';
  return upper(payload.canal || 'ATACADO');
}

function dataISO() {
  return new Date().toISOString();
}

function normalizarTipoItem(item = {}) {
  const tipo = upper(
    item.tipo_item ||
    item.item_tipo ||
    item.tipo ||
    item.dados_originais?.tipo_item ||
    item.dados_originais?.item_tipo ||
    item.dados_originais?.tipo
  );

  if (tipo.includes('ROTA') || texto(item.faixa_peso).toUpperCase() === 'ROTA') return 'ROTA';
  return 'COTACAO';
}

function getResumoSimulacaoSeguro(tabela = {}) {
  const capa = tabela && typeof tabela === 'object' ? tabela : {};
  const resumo = capa.resumo_simulacao;
  if (!resumo || typeof resumo !== 'object' || Array.isArray(resumo)) {
    return {};
  }
  return resumo;
}

function getHistoricoRodadas(tabela = {}) {
  const resumo = getResumoSimulacaoSeguro(tabela);
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}

function calcularProximaRodada(tabela = {}, deveAbrirNovaRodada = false) {
  const resumo = getResumoSimulacaoSeguro(tabela);
  const rodadaAtual = inteiro(resumo.rodada_atual || tabela.rodada_atual || 1) || 1;
  return deveAbrirNovaRodada ? rodadaAtual + 1 : rodadaAtual;
}

function resumirItensPorTipo(itens = []) {
  return (itens || []).reduce((acc, item) => {
    const tipo = normalizarTipoItem(item);
    if (tipo === 'ROTA') acc.rotas += 1;
    else acc.cotacoes += 1;
    acc.total += 1;
    return acc;
  }, { total: 0, rotas: 0, cotacoes: 0 });
}

function resumirOrigensItens(itens = []) {
  const mapa = new Map();
  (itens || []).forEach((item) => {
    const cidade = texto(item.cidade_origem || item.origem);
    const uf = upper(item.uf_origem);
    if (!cidade && !uf) return;
    const chave = `${upper(cidade)}|${uf}`;
    if (!mapa.has(chave)) {
      mapa.set(chave, { cidade, uf, total: 0, rotas: 0, cotacoes: 0 });
    }
    const registro = mapa.get(chave);
    registro.total += 1;
    if (normalizarTipoItem(item) === 'ROTA') registro.rotas += 1;
    else registro.cotacoes += 1;
  });

  return Array.from(mapa.values())
    .sort((a, b) => b.total - a.total || upper(a.cidade).localeCompare(upper(b.cidade)))
    .slice(0, 20);
}

function montarLinhaItem(tabela, item = {}, rodadaNumero = null) {
  const tipoItem = normalizarTipoItem(item);
  const dadosOriginaisBase = item.dados_originais && typeof item.dados_originais === 'object'
    ? item.dados_originais
    : item;
  const origemNegociacao = texto(tabela?.origem);
  const ufOrigemNegociacao = upper(tabela?.uf_origem);

  return {
    tabela_negociacao_id: tabela.id,
    transportadora: tabela.transportadora,
    canal: tabela.canal,
    tipo_tabela: tabela.tipo_tabela,

    cidade_origem:    origemNegociacao || texto(item.cidade_origem || item.origem),
    uf_origem:        ufOrigemNegociacao || upper(item.uf_origem),
    ibge_origem:      texto(item.ibge_origem),

    cidade_destino:   texto(item.cidade_destino || item.destino),
    uf_destino:       upper(item.uf_destino),
    ibge_destino:     texto(item.ibge_destino),

    faixa_peso:       texto(item.faixa_peso),
    peso_inicial:     numero(item.peso_inicial),
    peso_final:       numero(item.peso_final),

    frete_minimo:     numero(item.frete_minimo),
    taxa_aplicada:    numero(item.taxa_aplicada),
    frete_percentual: numero(item.frete_percentual),
    excesso_kg:       numero(item.excesso_kg),
    valor_excedente:  numero(item.valor_excedente),

    prazo:            inteiro(item.prazo),

    tipo_veiculo:     texto(item.tipo_veiculo),
    valor_lotacao:    numero(item.valor_lotacao),
    km:               numero(item.km),
    icms:             numero(item.icms),

    gris:             numero(item.gris),
    advalorem:        numero(item.advalorem),
    pedagio:          numero(item.pedagio),
    tas:              numero(item.tas),
    tda:              numero(item.tda),
    tde:              numero(item.tde),
    outras_taxas:     numero(item.outras_taxas),

    origem_importacao: texto(item.origem_importacao),
    observacao:        texto(item.observacao),
    dados_originais: {
      ...dadosOriginaisBase,
      tipo_item: tipoItem,
      rodada: rodadaNumero || item.dados_originais?.rodada || item.rodada || null,
    },
  };
}

const LIMITE_CARREGAMENTO_ITENS_UI = 500;

async function listarTodosItensTabelaNegociacao(tabelaId) {
  const supabase = supabaseOrThrow();
  const pageSize = 1000;
  let inicio = 0;
  let todos = [];

  while (true) {
    const { data, error } = await supabase
      .from('tabelas_negociacao_itens')
      .select('*')
      .eq('tabela_negociacao_id', tabelaId)
      .order('id', { ascending: true })
      .range(inicio, inicio + pageSize - 1);

    if (error) throw new Error(error.message || 'Erro ao listar itens atuais da negociação.');

    const lote = data || [];
    todos = todos.concat(lote);
    if (lote.length < pageSize) break;
    inicio += pageSize;
  }

  return todos;
}

export async function contarItensTabelaNegociacao(tabelaId) {
  const supabase = supabaseOrThrow();
  const { count, error } = await supabase
    .from('tabelas_negociacao_itens')
    .select('id', { count: 'exact', head: true })
    .eq('tabela_negociacao_id', tabelaId);
  if (error) throw new Error(error.message || 'Erro ao contar itens da negociação.');
  return count || 0;
}

export async function listarItensTabelaNegociacaoPreview(tabelaId, limite = LIMITE_CARREGAMENTO_ITENS_UI) {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase
    .from('tabelas_negociacao_itens')
    .select('*')
    .eq('tabela_negociacao_id', tabelaId)
    .order('id', { ascending: true })
    .limit(limite);
  if (error) throw new Error(error.message || 'Erro ao listar amostra de itens da negociação.');
  return data || [];
}

/** Quantidade de itens gravada no resumo da negociação (fallback quando a contagem ao vivo falha). */
export function extrairQtdItensResumoTabela(tabela = {}) {
  const capa = tabela && typeof tabela === 'object' ? tabela : {};
  const resumo = getResumoSimulacaoSeguro(capa);
  const totais = resumo.totais_itens || {};
  let total = inteiro(totais.total || 0);
  if (total > 0) return total;

  const ultima = resumo.ultima_importacao || {};
  const salvos = ultima.itens_salvos_apos_importacao || ultima.itens_importados || {};
  total = inteiro(salvos.total || 0);
  if (total > 0) return total;

  const somaTipos = inteiro(salvos.rotas || 0) + inteiro(salvos.cotacoes || 0);
  if (somaTipos > 0) return somaTipos;

  const historico = getHistoricoRodadas(capa);
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const entrada = historico[i] || {};
    if (String(entrada.tipo_registro || '').toUpperCase() !== 'IMPORTACAO') continue;
    const importados = entrada.itens_salvos_apos_importacao || entrada.itens_importados || {};
    total = inteiro(importados.total || 0);
    if (total > 0) return total;
    const somaHist = inteiro(importados.rotas || 0) + inteiro(importados.cotacoes || 0);
    if (somaHist > 0) return somaHist;
  }

  return 0;
}

/** Contagem confiável no banco + amostra leve para a UI (evita carregar centenas de milhares de linhas). */
export async function carregarItensTabelaNegociacaoParaUI(tabelaId) {
  let total = 0;
  let itens = [];
  let erroContagem = null;
  let erroPreview = null;

  try {
    total = await contarItensTabelaNegociacao(tabelaId);
  } catch (error) {
    erroContagem = error?.message || 'Erro ao contar itens da negociação.';
  }

  try {
    itens = await listarItensTabelaNegociacaoPreview(tabelaId);
  } catch (error) {
    erroPreview = error?.message || 'Erro ao listar amostra de itens da negociação.';
  }

  if (erroContagem && erroPreview) {
    throw new Error(erroContagem);
  }

  if (!total && itens.length) {
    total = itens.length;
  }

  return {
    total,
    itens,
    carregamentoParcial: total > itens.length,
    erroContagem,
    erroPreview,
  };
}

// ─── TABELAS NEGOCIAÇÃO ───────────────────────────────────────────────────────

const COLUNAS_GESTAO_TABELAS_NEGOCIACAO = [
  'criado_por',
  'criado_por_nome',
  'negociador_id',
  'negociador_nome',
  'aprovador_id',
  'aprovador_nome',
  'status_gestao',
  'status_aprovacao',
  'aprovado_em',
  'publicado_em',
  'enviado_aprovacao_em',
  'historico_gestao',
];

function erroColunaGestaoAusente(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('schema cache')
    && COLUNAS_GESTAO_TABELAS_NEGOCIACAO.some((col) => msg.includes(col));
}

function prepararPayloadPersistencia(payload = {}) {
  return anexarResumoCapaNoPayload(payload);
}

async function atualizarNegociacaoPersistencia(supabase, id, payload, selectCols = '*') {
  let finalPayload = prepararPayloadPersistencia(payload);
  let result = await supabase.from('tabelas_negociacao').update(finalPayload).eq('id', id).select(selectCols).single();
  if (result.error && erroColunaResumoCapaAusente(result.error)) {
    finalPayload = { ...payload };
    delete finalPayload.resumo_capa;
    const selectFallback = removerResumoCapaDoSelect(selectCols);
    result = await supabase.from('tabelas_negociacao').update(finalPayload).eq('id', id).select(selectFallback).single();
  }
  return result;
}

function semColunasGestao(payload = {}) {
  const next = Object.assign({}, payload);
  COLUNAS_GESTAO_TABELAS_NEGOCIACAO.forEach(function(col) { delete next[col]; });
  return next;
}

async function inserirTabelaNegociacaoComFallback(supabase, payload) {
  let result = await supabase.from('tabelas_negociacao').insert(payload).select().single();
  if (result.error && erroColunaGestaoAusente(result.error)) {
    result = await supabase.from('tabelas_negociacao').insert(semColunasGestao(payload)).select().single();
  }
  if (result.error) throw new Error(result.error.message || 'Erro ao criar tabela em negociação.');
  return result.data;
}

async function atualizarTabelaNegociacaoComFallback(supabase, id, payload) {
  let result = await supabase.from('tabelas_negociacao').update(payload).eq('id', id).select().single();
  if (result.error && erroColunaGestaoAusente(result.error)) {
    result = await supabase.from('tabelas_negociacao').update(semColunasGestao(payload)).eq('id', id).select().single();
  }
  if (result.error) throw new Error(result.error.message || 'Erro ao atualizar tabela em negociação.');
  return result.data;
}

export async function listarTabelasNegociacao(filtros = {}) {
  return listarNegociacoesResumo(filtros);
}

export async function listarTabelasNegociacaoEditor() {
  return listarNegociacoesCapaEditor();
}

export { carregarHistoricoGestaoNegociacoes };

export async function obterTabelaNegociacao(id, opcoes = {}) {
  if (opcoes.completo) {
    const supabase = supabaseOrThrow();
    const { data, error } = await supabase
      .from('tabelas_negociacao')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message || 'Erro ao buscar tabela em negociação.');
    return data;
  }
  return obterNegociacaoCapa(id);
}

export { carregarResumoCompletoNegociacao, carregarLaudoTransportadoraConsolidado };

export async function criarTabelaNegociacao(payload = {}) {
  const supabase = supabaseOrThrow();
  const tipoNegociacao = normalizarTipoNegociacao(payload);
  const tipoTabela = normalizarTipoTabelaPorNegociacao(payload);

  const novo = {
    transportadora: texto(payload.transportadora),
    canal: normalizarCanalPorNegociacao(payload),
    tipo_tabela: tipoTabela,
    tipo_negociacao: tipoNegociacao,
    transportadora_base_id: texto(payload.transportadora_base_id || payload.transportadoraBaseId),
    transportadora_base_nome: texto(payload.transportadora_base_nome || payload.transportadoraBaseNome) || (tipoNegociacao === 'REAJUSTE_TABELA_EXISTENTE' ? texto(payload.transportadora) : ''),
    tabela_base_id: texto(payload.tabela_base_id || payload.tabelaBaseId),
    modalidade: texto(payload.modalidade),
    comparar_com_proprio_realizado: tipoNegociacao === 'REAJUSTE_TABELA_EXISTENTE'
      ? true
      : Boolean(payload.comparar_com_proprio_realizado || payload.compararComProprioRealizado),
    periodo_realizado_inicio: dataOuNull(payload.periodo_realizado_inicio || payload.periodoRealizadoInicio),
    periodo_realizado_fim: dataOuNull(payload.periodo_realizado_fim || payload.periodoRealizadoFim),
    tipo_veiculo: texto(payload.tipo_veiculo || payload.tipoVeiculo),
    status: payload.status || 'EM NEGOCIAÇÃO',
    descricao: texto(payload.descricao),
    regiao: texto(payload.regiao),
    origem: texto(payload.origem),
    uf_origem: upper(payload.uf_origem),
    uf_destino: upper(payload.uf_destino),
    data_recebimento: payload.data_recebimento || new Date().toISOString().slice(0, 10),
    data_inicio_prevista: payload.data_inicio_prevista || null,
    incluir_simulacao: Boolean(payload.incluir_simulacao),
    observacao: texto(payload.observacao),
    saving_projetado: numero(payload.saving_projetado),
    aderencia_projetada: numero(payload.aderencia_projetada),
    origem_importacao: texto(payload.origem_importacao),
    generalidades: payload.generalidades || DEFAULT_GENERALIDADES,
    criado_por: texto(payload.criado_por || payload.usuario?.id),
    criado_por_nome: texto(payload.criado_por_nome || payload.usuario?.nome || payload.usuario_nome),
    negociador_id: texto(payload.negociador_id || payload.usuario?.id),
    negociador_nome: texto(payload.negociador_nome || payload.usuario?.nome || payload.usuario_nome),
    status_gestao: payload.status_gestao || 'EM_NEGOCIACAO',
    status_aprovacao: 'PENDENTE',
    historico_gestao: [{
      id: `CRIACAO-${Date.now()}`,
      tipo: 'CRIACAO',
      criado_em: dataISO(),
      usuario_id: texto(payload.criado_por || payload.usuario?.id),
      usuario_nome: texto(payload.criado_por_nome || payload.usuario?.nome),
      observacao: texto(payload.observacao) || 'Negociação criada',
      status_anterior: null,
      status_novo: payload.status_gestao || 'EM_NEGOCIACAO',
    }],
  };

  if (!novo.transportadora) throw new Error('Informe a transportadora.');
  if (!TIPOS_TABELA_NEGOCIACAO.includes(novo.tipo_tabela)) throw new Error('Tipo de tabela inválido.');
  if (!TIPOS_NEGOCIACAO_VALUES.includes(novo.tipo_negociacao)) throw new Error('Tipo de negociação inválido.');

  return inserirTabelaNegociacaoComFallback(supabase, novo);
}

export async function atualizarTabelaNegociacao(id, payload = {}) {
  const supabase = supabaseOrThrow();
  const tipoNegociacao = payload.tipo_negociacao !== undefined || payload.tipoNegociacao !== undefined || payload.tipo_tabela !== undefined
    ? normalizarTipoNegociacao(payload)
    : undefined;
  const tipoTabela = payload.tipo_tabela !== undefined || tipoNegociacao === 'TABELA_LOTACAO'
    ? normalizarTipoTabelaPorNegociacao(payload)
    : undefined;

  const atualizacao = {
    transportadora:            payload.transportadora !== undefined ? texto(payload.transportadora) : undefined,
    canal:                     payload.canal !== undefined || tipoNegociacao === 'TABELA_LOTACAO' ? normalizarCanalPorNegociacao(payload) : undefined,
    tipo_tabela:               tipoTabela,
    tipo_negociacao:           tipoNegociacao,
    transportadora_base_id:    payload.transportadora_base_id !== undefined || payload.transportadoraBaseId !== undefined ? texto(payload.transportadora_base_id || payload.transportadoraBaseId) : undefined,
    transportadora_base_nome:  payload.transportadora_base_nome !== undefined || payload.transportadoraBaseNome !== undefined ? texto(payload.transportadora_base_nome || payload.transportadoraBaseNome) : undefined,
    tabela_base_id:            payload.tabela_base_id !== undefined || payload.tabelaBaseId !== undefined ? texto(payload.tabela_base_id || payload.tabelaBaseId) : undefined,
    modalidade:                payload.modalidade !== undefined ? texto(payload.modalidade) : undefined,
    comparar_com_proprio_realizado: payload.comparar_com_proprio_realizado !== undefined || payload.compararComProprioRealizado !== undefined
      ? Boolean(payload.comparar_com_proprio_realizado || payload.compararComProprioRealizado)
      : (tipoNegociacao === 'REAJUSTE_TABELA_EXISTENTE' ? true : undefined),
    periodo_realizado_inicio:  payload.periodo_realizado_inicio !== undefined || payload.periodoRealizadoInicio !== undefined ? dataOuNull(payload.periodo_realizado_inicio || payload.periodoRealizadoInicio) : undefined,
    periodo_realizado_fim:     payload.periodo_realizado_fim !== undefined || payload.periodoRealizadoFim !== undefined ? dataOuNull(payload.periodo_realizado_fim || payload.periodoRealizadoFim) : undefined,
    tipo_veiculo:              payload.tipo_veiculo !== undefined || payload.tipoVeiculo !== undefined ? texto(payload.tipo_veiculo || payload.tipoVeiculo) : undefined,
    status:                    payload.status !== undefined ? payload.status : undefined,
    descricao:                 payload.descricao !== undefined ? texto(payload.descricao) : undefined,
    regiao:                    payload.regiao !== undefined ? texto(payload.regiao) : undefined,
    origem:                    payload.origem !== undefined ? texto(payload.origem) : undefined,
    uf_origem:                 payload.uf_origem !== undefined ? upper(payload.uf_origem) : undefined,
    uf_destino:                payload.uf_destino !== undefined ? upper(payload.uf_destino) : undefined,
    data_recebimento:          payload.data_recebimento !== undefined ? payload.data_recebimento || null : undefined,
    data_inicio_prevista:      payload.data_inicio_prevista !== undefined ? payload.data_inicio_prevista || null : undefined,
    data_inicio_vigencia:      payload.data_inicio_vigencia !== undefined ? payload.data_inicio_vigencia || null : undefined,
    incluir_simulacao:         payload.incluir_simulacao !== undefined ? Boolean(payload.incluir_simulacao) : undefined,
    substituir_tabela_anterior:payload.substituir_tabela_anterior !== undefined ? Boolean(payload.substituir_tabela_anterior) : undefined,
    observacao:                payload.observacao !== undefined ? texto(payload.observacao) : undefined,
    justificativa_aprovacao:   payload.justificativa_aprovacao !== undefined ? texto(payload.justificativa_aprovacao) : undefined,
    saving_projetado:          payload.saving_projetado !== undefined ? numero(payload.saving_projetado) : undefined,
    aderencia_projetada:       payload.aderencia_projetada !== undefined ? numero(payload.aderencia_projetada) : undefined,
    valor_atual_realizado:     payload.valor_atual_realizado !== undefined ? numero(payload.valor_atual_realizado) : undefined,
    valor_simulado_nova_tabela: payload.valor_simulado_nova_tabela !== undefined ? numero(payload.valor_simulado_nova_tabela) : undefined,
    impacto_valor:             payload.impacto_valor !== undefined ? numero(payload.impacto_valor) : undefined,
    impacto_percentual:        payload.impacto_percentual !== undefined ? numero(payload.impacto_percentual) : undefined,
    impacto_mensal:            payload.impacto_mensal !== undefined ? numero(payload.impacto_mensal) : undefined,
    impacto_anual:             payload.impacto_anual !== undefined ? numero(payload.impacto_anual) : undefined,
    frete_percentual_nf_atual: payload.frete_percentual_nf_atual !== undefined ? numero(payload.frete_percentual_nf_atual) : undefined,
    frete_percentual_nf_simulado: payload.frete_percentual_nf_simulado !== undefined ? numero(payload.frete_percentual_nf_simulado) : undefined,
    qtd_registros_analisados:  payload.qtd_registros_analisados !== undefined ? inteiro(payload.qtd_registros_analisados) : undefined,
    qtd_registros_com_tabela:  payload.qtd_registros_com_tabela !== undefined ? inteiro(payload.qtd_registros_com_tabela) : undefined,
    resultado_simulacao_json:  payload.resultado_simulacao_json !== undefined ? payload.resultado_simulacao_json : undefined,
    usuario_aprovacao:         payload.usuario_aprovacao !== undefined ? texto(payload.usuario_aprovacao) : undefined,
    observacao_aprovacao:      payload.observacao_aprovacao !== undefined ? texto(payload.observacao_aprovacao) : undefined,
    tabela_anterior_id:        payload.tabela_anterior_id !== undefined ? texto(payload.tabela_anterior_id) : undefined,
    percentual_medio_impacto:  payload.percentual_medio_impacto !== undefined ? numero(payload.percentual_medio_impacto) : undefined,
    origem_importacao:         payload.origem_importacao !== undefined ? texto(payload.origem_importacao) : undefined,
    generalidades:             payload.generalidades !== undefined ? payload.generalidades : undefined,
    criado_por:                payload.criado_por !== undefined ? texto(payload.criado_por) : undefined,
    criado_por_nome:           payload.criado_por_nome !== undefined ? texto(payload.criado_por_nome) : undefined,
    negociador_id:             payload.negociador_id !== undefined ? texto(payload.negociador_id) : undefined,
    negociador_nome:           payload.negociador_nome !== undefined ? texto(payload.negociador_nome) : undefined,
    aprovador_id:              payload.aprovador_id !== undefined ? texto(payload.aprovador_id) : undefined,
    aprovador_nome:            payload.aprovador_nome !== undefined ? texto(payload.aprovador_nome) : undefined,
    status_gestao:             payload.status_gestao !== undefined ? payload.status_gestao : undefined,
    status_aprovacao:          payload.status_aprovacao !== undefined ? texto(payload.status_aprovacao) : undefined,
    aprovado_em:               payload.aprovado_em !== undefined ? payload.aprovado_em : undefined,
    publicado_em:               payload.publicado_em !== undefined ? payload.publicado_em : undefined,
    enviado_aprovacao_em:      payload.enviado_aprovacao_em !== undefined ? payload.enviado_aprovacao_em : undefined,
    historico_gestao:          payload.historico_gestao !== undefined ? payload.historico_gestao : undefined,
  };

  Object.keys(atualizacao).forEach((key) => {
    if (atualizacao[key] === undefined) delete atualizacao[key];
  });

  return atualizarTabelaNegociacaoComFallback(supabase, id, atualizacao);
}

export async function excluirTabelaNegociacao(id) {
  const supabase = supabaseOrThrow();
  const { error } = await supabase.from('tabelas_negociacao').delete().eq('id', id);
  if (error) throw new Error(error.message || 'Erro ao excluir tabela em negociação.');
  return true;
}

// ─── ITENS (rotas / cotações / faixas) ───────────────────────────────────────

export async function listarItensTabelaNegociacao(tabelaId) {
  const itens = await listarTodosItensTabelaNegociacao(tabelaId);
  return itens.sort((a, b) => {
    const tipoA = normalizarTipoItem(a) === 'ROTA' ? 0 : 1;
    const tipoB = normalizarTipoItem(b) === 'ROTA' ? 0 : 1;
    if (tipoA !== tipoB) return tipoA - tipoB;
    const ufA = upper(a.uf_destino);
    const ufB = upper(b.uf_destino);
    if (ufA !== ufB) return ufA.localeCompare(ufB);
    const cidadeA = upper(a.cidade_destino);
    const cidadeB = upper(b.cidade_destino);
    if (cidadeA !== cidadeB) return cidadeA.localeCompare(cidadeB);
    return upper(a.faixa_peso).localeCompare(upper(b.faixa_peso));
  });
}

export async function substituirItensTabelaNegociacao(tabela, itens = [], opcoes = {}) {
  const supabase = supabaseOrThrow();
  if (!tabela?.id) throw new Error('Tabela de negociação inválida.');
  const onProgress = typeof opcoes.onProgress === 'function' ? opcoes.onProgress : null;

  const itensEntrada = Array.isArray(itens) ? itens : [];
  const modo = opcoes.modo || 'porTipo';

  if (!itensEntrada.length && !opcoes.limparQuandoVazio) {
    return listarItensTabelaNegociacao(tabela.id);
  }

  const tiposEntrada = [...new Set(itensEntrada.map(normalizarTipoItem))];
  const substituirTudo = modo === 'total' || tiposEntrada.length > 1 || opcoes.substituirTudo === true;
  const limparSomente = !itensEntrada.length && opcoes.limparQuandoVazio;

  let itensAtuais = [];
  if (!substituirTudo) {
    if (onProgress) await onProgress('Carregando itens atuais da negociacao...');
    itensAtuais = await listarTodosItensTabelaNegociacao(tabela.id);
  } else if (limparSomente) {
    if (onProgress) await onProgress('Apagando itens salvos desta negociacao...');
  } else if (onProgress) {
    await onProgress('Substituindo tabela importada (' + itensEntrada.length.toLocaleString('pt-BR') + ' itens)...');
  }

  const tiposSubstituidos = substituirTudo ? ['ROTA', 'COTACAO'] : (tiposEntrada.length ? tiposEntrada : ['COTACAO']);
  // Rodada não deve aumentar automaticamente a cada reimportação.
  // Rotas e fretes da mesma proposta podem ser importados em momentos diferentes
  // e continuam pertencendo à rodada atual. Uma nova rodada só nasce quando a UI
  // passar explicitamente novaRodada/abrirNovaRodada como true.
  const abrirNovaRodada = opcoes.novaRodada === true || opcoes.abrirNovaRodada === true;
  const rodadaNumero = calcularProximaRodada(tabela, abrirNovaRodada);

  const preservados = substituirTudo
    ? []
    : itensAtuais.filter((item) => !tiposSubstituidos.includes(normalizarTipoItem(item)));

  const linhasPreservadas = preservados.map((item) => montarLinhaItem(tabela, item, item.dados_originais?.rodada || rodadaNumero));
  const linhasNovas = itensEntrada.map((item) => montarLinhaItem(tabela, item, rodadaNumero));
  const linhas = linhasPreservadas.concat(linhasNovas);

  if (onProgress) {
    await onProgress(linhas.length
      ? 'Apagando registros antigos antes de salvar a nova tabela...'
      : 'Removendo itens antigos desta negociacao...');
  }
  const { error: deleteError } = await supabase
    .from('tabelas_negociacao_itens').delete().eq('tabela_negociacao_id', tabela.id);
  if (deleteError) throw new Error(deleteError.message || 'Erro ao limpar itens antigos.');

  if (linhas.length) {
    if (onProgress) {
      await onProgress('Tabela anterior apagada. Subindo nova tabela agora (' + linhas.length.toLocaleString('pt-BR') + ' itens)...');
    }
    const pageSize = 1000;
    for (let i = 0; i < linhas.length; i += pageSize) {
      const lote = linhas.slice(i, i + pageSize);
      if (onProgress) {
        await onProgress('Salvando lote ' + Math.min(i + pageSize, linhas.length).toLocaleString('pt-BR') + ' de ' + linhas.length.toLocaleString('pt-BR') + ' itens...');
      }
      const { error } = await supabase
        .from('tabelas_negociacao_itens').insert(lote);
      if (error) throw new Error(error.message || 'Erro ao salvar itens da tabela.');
    }
  } else if (onProgress && limparSomente) {
    await onProgress('Itens removidos com sucesso.');
  }

  const resumoAtual = getResumoSimulacaoSeguro(tabela);
  const historico = getHistoricoRodadas(tabela);
  const totaisSalvos = resumirItensPorTipo(linhas);
  const totaisImportados = resumirItensPorTipo(itensEntrada);
  const origensDetectadas = resumirOrigensItens(linhas);
  const agora = dataISO();

  const entradaImportacao = {
    id: `${rodadaNumero}-${Date.now()}`,
    tipo_registro: 'IMPORTACAO',
    rodada: rodadaNumero,
    criado_em: agora,
    tipos_importados: tiposSubstituidos,
    modo_substituicao: substituirTudo ? 'TOTAL' : 'POR_TIPO',
    origem_importacao: opcoes.origemImportacao || itensEntrada[0]?.origem_importacao || tabela.origem_importacao || '',
    arquivo: opcoes.arquivo || opcoes.nomeArquivo || '',
    observacao: opcoes.observacao || '',
    itens_importados: totaisImportados,
    itens_salvos_apos_importacao: totaisSalvos,
    origens_detectadas: origensDetectadas,
  };

  const resumoAtualizado = {
    ...resumoAtual,
    rodada_atual: rodadaNumero,
    ultima_importacao_em: agora,
    ultima_importacao: entradaImportacao,
    totais_itens: totaisSalvos,
    origens_detectadas: origensDetectadas,
    historico_rodadas: historico.concat([entradaImportacao]).slice(-30),
    ...(linhas.length === 0 ? { ultima_simulacao: null, salvo_em: null } : {}),
  };

  await atualizarNegociacaoPersistencia(supabase, tabela.id, { resumo_simulacao: resumoAtualizado }, 'id');
}

export async function limparItensTabelaNegociacao(tabela, opcoes = {}) {
  if (!tabela?.id) throw new Error('Tabela de negociação inválida.');
  return substituirItensTabelaNegociacao(tabela, [], {
    limparQuandoVazio: true,
    modo: 'total',
    observacao: opcoes.observacao || 'Itens importados apagados manualmente',
    onProgress: opcoes.onProgress,
  });
}

// ─── TAXAS ESPECIAIS POR IBGE DESTINO ────────────────────────────────────────

export async function listarTaxasDestino(tabelaId) {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase
    .from('tabelas_negociacao_taxas_destino')
    .select('*')
    .eq('tabela_negociacao_id', tabelaId)
    .order('uf_destino', { ascending: true })
    .order('cidade_destino', { ascending: true });
  if (error) throw new Error(error.message || 'Erro ao listar taxas por destino.');
  return data || [];
}

export async function salvarTaxaDestino(tabelaId, taxa) {
  const supabase = supabaseOrThrow();

  const linha = {
    tabela_negociacao_id: tabelaId,
    ibge_destino:    texto(taxa.ibge_destino || taxa.ibgeDestino),
    uf_destino:      upper(taxa.uf_destino || taxa.ufDestino),
    cidade_destino:  texto(taxa.cidade_destino || taxa.cidadeDestino),
    tda:             numero(taxa.tda),
    tdr:             numero(taxa.tdr),
    trt:             numero(taxa.trt),
    suframa:         numero(taxa.suframa),
    outras_taxas:    numero(taxa.outras_taxas || taxa.outras),
    gris:            numero(taxa.gris),
    gris_minimo:     numero(taxa.gris_minimo || taxa.grisMinimo),
    advalorem:       numero(taxa.advalorem || taxa.adVal),
    advalorem_minimo:numero(taxa.advalorem_minimo || taxa.adValMinimo),
    observacao:      texto(taxa.observacao),
  };

  if (taxa.id) {
    const { data, error } = await supabase
      .from('tabelas_negociacao_taxas_destino')
      .update({ ...linha, atualizado_em: new Date().toISOString() })
      .eq('id', taxa.id).select().single();
    if (error) throw new Error(error.message || 'Erro ao atualizar taxa por destino.');
    return data;
  }

  const { data, error } = await supabase
    .from('tabelas_negociacao_taxas_destino').insert(linha).select().single();
  if (error) throw new Error(error.message || 'Erro ao salvar taxa por destino.');
  return data;
}

export async function excluirTaxaDestino(id) {
  const supabase = supabaseOrThrow();
  const { error } = await supabase
    .from('tabelas_negociacao_taxas_destino').delete().eq('id', id);
  if (error) throw new Error(error.message || 'Erro ao excluir taxa por destino.');
  return true;
}

export async function substituirTaxasDestino(tabelaId, taxas = []) {
  const supabase = supabaseOrThrow();

  const { error: delErr } = await supabase
    .from('tabelas_negociacao_taxas_destino').delete().eq('tabela_negociacao_id', tabelaId);
  if (delErr) throw new Error(delErr.message || 'Erro ao limpar taxas antigas.');

  if (!taxas.length) return [];

  const linhas = taxas.map((taxa) => ({
    tabela_negociacao_id: tabelaId,
    ibge_destino:    texto(taxa.ibge_destino || taxa.ibgeDestino),
    uf_destino:      upper(taxa.uf_destino || taxa.ufDestino),
    cidade_destino:  texto(taxa.cidade_destino || taxa.cidadeDestino),
    tda:             numero(taxa.tda),
    tdr:             numero(taxa.tdr),
    trt:             numero(taxa.trt),
    suframa:         numero(taxa.suframa),
    outras_taxas:    numero(taxa.outras_taxas || taxa.outras),
    gris:            numero(taxa.gris),
    gris_minimo:     numero(taxa.gris_minimo || taxa.grisMinimo),
    advalorem:       numero(taxa.advalorem || taxa.adVal),
    advalorem_minimo:numero(taxa.advalorem_minimo || taxa.adValMinimo),
    observacao:      texto(taxa.observacao),
  }));

  const { data, error } = await supabase
    .from('tabelas_negociacao_taxas_destino').insert(linhas).select();
  if (error) throw new Error(error.message || 'Erro ao salvar taxas por destino.');
  return data || [];
}

// ─── GENERALIDADES ────────────────────────────────────────────────────────────

export async function salvarGeneralidades(tabelaId, generalidades) {
  return atualizarTabelaNegociacao(tabelaId, { generalidades });
}

// ─── OUTROS ──────────────────────────────────────────────────────────────────

export async function alternarTabelaNegociacaoNaSimulacao(id, incluir) {
  return atualizarTabelaNegociacao(id, { incluir_simulacao: incluir });
}


export async function abrirNovaRodadaTabelaNegociacao(id, dados = {}) {
  const supabase = supabaseOrThrow();

  const { data: tabelaAtual, error: tabelaError } = await supabase
    .from('tabelas_negociacao')
    .select('id,transportadora,canal,tipo_tabela,tipo_negociacao,tabela_base_id,transportadora_base_nome,resumo_simulacao')
    .eq('id', id)
    .single();

  if (tabelaError) throw new Error(tabelaError.message || 'Erro ao buscar negociação para nova rodada.');

  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual);
  const historicoAnterior = getHistoricoRodadas(tabelaAtual);
  const rodadaAtual = inteiro(resumoAnterior.rodada_atual || tabelaAtual.rodada_atual || 1) || 1;
  const proximaRodada = rodadaAtual + 1;
  const agora = dataISO();

  const entradaRodada = {
    id: `${proximaRodada}-ABERTURA-${Date.now()}`,
    tipo_registro: 'NOVA_RODADA',
    rodada: proximaRodada,
    criado_em: agora,
    observacao: texto(dados.observacao) || `Nova rodada aberta para ${tabelaAtual.transportadora || 'negociação'}`,
    origem_importacao: 'NOVA_RODADA',
  };

  const resumoAtualizado = {
    ...resumoAnterior,
    rodada_atual: proximaRodada,
    rodada_aberta_em: agora,
    ultima_rodada_aberta: entradaRodada,
    historico_rodadas: historicoAnterior.concat([entradaRodada]).slice(-30),
  };

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update({
      resumo_simulacao: resumoAtualizado,
      incluir_simulacao: true,
      status: tabelaAtual.status === 'APROVADA' || tabelaAtual.status === 'PROMOVIDA PARA OFICIAL'
        ? 'EM NEGOCIAÇÃO'
        : tabelaAtual.status,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message || 'Erro ao abrir nova rodada.');
  return data;
}

async function promoverTabelaNegociacaoParaOficialInterno(id, dados = {}) {
  const tabela = await obterTabelaNegociacao(id);
  const itens = await listarTodosItensTabelaNegociacao(id);
  const taxasDestino = await listarTodasTaxasDestinoTabela(id);

  if (!itens.length) {
    throw new Error('Não há itens salvos para promover a negociação para a base oficial.');
  }

  const tabelaCompleta = {
    ...tabela,
    transportadora: texto(dados.transportadora_oficial_nome || dados.transportadoraOficialNome) || tabela.transportadora,
    tabelas_negociacao_itens: itens,
    tabelas_negociacao_taxas_destino: taxasDestino,
  };

  const transportadoraOficial = converterTabelaNegociacaoParaSimulador(tabelaCompleta);
  if (!transportadoraOficial?.origens?.length) {
    throw new Error('Não foi possível montar origem/rotas/cotações para cadastro oficial. Revise os itens da negociação.');
  }

  const baseOficial = [{
    ...transportadoraOficial,
    nome: tabelaCompleta.transportadora,
    status: 'Ativa',
    origens: (transportadoraOficial.origens || []).map((origem) => ({
      ...origem,
      status: 'Ativa',
      canal: origem.canal || tabela.canal || 'ATACADO',
      generalidades: {
        ...(origem.generalidades || {}),
        ...(tabela.generalidades || {}),
      },
      rotas: (origem.rotas || []).map((rota) => ({
        ...rota,
        inicioVigencia: dados.data_inicio_vigencia || tabela.data_inicio_vigencia || tabela.data_inicio_prevista || '',
      })),
    })),
  }];

  await salvarSecaoDb(baseOficial, 'generalidades');
  await salvarSecaoDb(baseOficial, 'rotas');
  await salvarSecaoDb(baseOficial, 'cotacoes');
  await salvarSecaoDb(baseOficial, 'taxas');

  return {
    transportadora: baseOficial[0].nome,
    origens: baseOficial[0].origens.length,
    rotas: baseOficial[0].origens.reduce((acc, origem) => acc + (origem.rotas || []).length, 0),
    cotacoes: baseOficial[0].origens.reduce((acc, origem) => acc + (origem.cotacoes || []).length, 0),
    taxas: baseOficial[0].origens.reduce((acc, origem) => acc + (origem.taxasEspeciais || []).length, 0),
  };
}

export async function aprovarTabelaNegociacao(id, dados = {}) {
  const supabase = supabaseOrThrow();
  let promocaoOficial = null;

  const { data: tabelaPrevia } = await supabase
    .from('tabelas_negociacao')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (dados.promover_para_oficial || dados.promoverParaOficial) {
    if (!podePublicarOficial(tabelaPrevia || {})) {
      throw new Error(
        'Publicação na base oficial bloqueada: a negociação precisa estar aprovada pelo gestor antes de ser promovida.'
      );
    }
    promocaoOficial = await promoverTabelaNegociacaoParaOficialInterno(id, dados);
  }

  const { data: tabelaAtual } = await supabase
    .from('tabelas_negociacao')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual || {});
  const historicoAnterior = getHistoricoRodadas(tabelaAtual || {});
  const agora = new Date().toISOString();
  const impactoAtual = calcularImpactoResultado(tabelaAtual?.resultado_simulacao_json || resumoAnterior || {}, tabelaAtual || {});

  const entradaAprovacao = {
    id: `APROVACAO-${Date.now()}`,
    tipo_registro: promocaoOficial ? 'PROMOCAO_OFICIAL' : 'APROVACAO',
    rodada: inteiro(resumoAnterior.rodada_atual || 1) || 1,
    criado_em: agora,
    data_inicio_vigencia: dados.data_inicio_vigencia || null,
    usuario_aprovacao: texto(dados.usuario_aprovacao || dados.usuarioAprovacao || dados.usuario),
    observacao: dados.observacao_aprovacao || dados.justificativa_aprovacao || '',
    tipo_negociacao: tabelaAtual?.tipo_negociacao || null,
    tabela_base_id: dados.tabela_base_id || tabelaAtual?.tabela_base_id || null,
    transportadora_base_nome: dados.transportadora_base_nome || tabelaAtual?.transportadora_base_nome || tabelaAtual?.transportadora || '',
    percentual_medio_impacto: numero(dados.percentual_medio_impacto ?? impactoAtual.impactoPercentual),
    promocao_oficial: promocaoOficial,
  };

  const payload = {
    status: promocaoOficial ? 'PROMOVIDA PARA OFICIAL' : 'APROVADA',
    data_inicio_vigencia: dados.data_inicio_vigencia || null,
    data_aprovacao: agora,
    justificativa_aprovacao: dados.justificativa_aprovacao || '',
    usuario_aprovacao: texto(dados.usuario_aprovacao || dados.usuarioAprovacao || dados.usuario),
    observacao_aprovacao: texto(dados.observacao_aprovacao || dados.justificativa_aprovacao),
    tabela_anterior_id: texto(dados.tabela_anterior_id || dados.tabela_base_id || tabelaAtual?.tabela_base_id),
    tabela_anterior_snapshot: dados.tabela_anterior_snapshot || null,
    nova_tabela_aprovada_snapshot: promocaoOficial || null,
    percentual_medio_impacto: numero(dados.percentual_medio_impacto ?? impactoAtual.impactoPercentual),
    substituir_tabela_anterior: Boolean(dados.substituir_tabela_anterior),
    // Persiste o periodo analisado para que rodadas subsequentes possam
    // ser automaticamente preenchidas com o mesmo recorte de dados.
    periodo_realizado_inicio: dataOuNull(
      tabelaAtual?.resultado_simulacao_json?.filtros?.inicio
      || resumoAnterior?.filtros?.inicio
      || tabelaAtual?.periodo_realizado_inicio
      || null
    ),
    periodo_realizado_fim: dataOuNull(
      tabelaAtual?.resultado_simulacao_json?.filtros?.fim
      || resumoAnterior?.filtros?.fim
      || tabelaAtual?.periodo_realizado_fim
      || null
    ),

    incluir_simulacao: false,
    resumo_simulacao: {
      ...resumoAnterior,
      aprovada_em: agora,
      promocao_oficial: promocaoOficial,
      ultima_aprovacao: entradaAprovacao,
      historico_rodadas: historicoAnterior.concat([entradaAprovacao]).slice(-30),
    },
  };
  const { data, error } = await supabase
    .from('tabelas_negociacao').update(payload).eq('id', id).select().single();
  if (error) throw new Error(error.message || 'Erro ao aprovar tabela.');
  return data;
}

async function listarTodasTaxasDestinoTabela(tabelaId) {
  const supabase = supabaseOrThrow();
  const pageSize = 1000;
  let inicio = 0;
  let todos = [];

  while (true) {
    const { data, error } = await supabase
      .from('tabelas_negociacao_taxas_destino')
      .select('*')
      .eq('tabela_negociacao_id', tabelaId)
      .range(inicio, inicio + pageSize - 1);

    if (error) throw new Error(error.message || 'Erro ao listar taxas da negociação para simulação.');

    const lote = data || [];
    todos = todos.concat(lote);
    if (lote.length < pageSize) break;
    inicio += pageSize;
  }

  return todos;
}

// Colunas da "capa" da negociação. Nunca inclui itens/rotas/taxas.
const COLUNAS_CAPA_NEGOCIACAO_SIMULACAO =
  'id,transportadora,canal,tipo_tabela,tipo_negociacao,status,descricao,regiao,origem,uf_origem,uf_destino,data_recebimento,data_inicio_prevista,data_inicio_vigencia,incluir_simulacao,observacao,origem_importacao,generalidades,resumo_simulacao,criado_em,atualizado_em,saving_projetado,aderencia_projetada,faturamento_projetado,impacto_projetado,percentual_frete_projetado,volumetria_dia,ctes_analisados,ctes_atendidos,rotas_sem_cobertura,substituir_tabela_anterior,tabela_base_id,transportadora_base_nome,percentual_medio_impacto';

// Lista LEVE: apenas as capas das negociações elegíveis à simulação.
// Não carrega itens/rotas/taxas — é uma única query rápida usada para
// montar a lista de seleção do Simulador do Realizado.
export async function listarCapasNegociacaoParaSimulacao(filtros = {}) {
  const supabase = supabaseOrThrow();

  let query = supabase
    .from('tabelas_negociacao')
    .select(COLUNAS_CAPA_NEGOCIACAO_SIMULACAO)
    .eq('incluir_simulacao', true)
    .in('status', ['EM NEGOCIAÇÃO', 'EM TESTE', 'APROVADA'])
    .order('criado_em', { ascending: false });

  if (filtros.tipoTabela) query = query.eq('tipo_tabela', filtros.tipoTabela);
  if (filtros.tipoNegociacao) query = query.eq('tipo_negociacao', filtros.tipoNegociacao);
  if (filtros.canal) query = query.eq('canal', filtros.canal);

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Erro ao buscar lista de negociações para simulação.');
  return data || [];
}

// Detalhe de UMA negociação: itens (rotas/fretes) + taxas de destino.
// Buscamos itens e taxas em paralelo para a tabela selecionada.
export async function carregarDetalhesNegociacaoParaSimulacao(tabela) {
  const capa = tabela && typeof tabela === 'object' ? tabela : null;
  const tabelaId = capa ? capa.id : tabela;
  if (!tabelaId) throw new Error('Negociação inválida para carregar detalhes.');

  const [itens, taxasDestino] = await Promise.all([
    listarTodosItensTabelaNegociacao(tabelaId),
    listarTodasTaxasDestinoTabela(tabelaId),
  ]);

  const base = capa || { id: tabelaId };
  return {
    ...base,
    tabelas_negociacao_itens: itens,
    tabelas_negociacao_taxas_destino: taxasDestino,
  };
}

// Executa tarefas assíncronas com limite de concorrência, preservando a ordem
// de entrada. Evita disparar centenas de queries simultâneas no Supabase.
async function executarComConcorrencia(itens, limite, executor) {
  const resultados = new Array(itens.length);
  let cursor = 0;

  const trabalhadores = new Array(Math.min(limite, itens.length)).fill(null).map(async () => {
    while (cursor < itens.length) {
      const indiceAtual = cursor;
      cursor += 1;
      resultados[indiceAtual] = await executor(itens[indiceAtual], indiceAtual);
    }
  });

  await Promise.all(trabalhadores);
  return resultados;
}

// Carrega capas + itens/taxas de TODAS as negociações elegíveis.
// Continua disponível para fluxos que precisam comparar com várias tabelas em
// negociação ao mesmo tempo. Agora a hidratação é feita em paralelo (com limite
// de concorrência) para não travar a tela em "atualizando negociações...".
export async function buscarTabelasNegociacaoParaSimulacao(filtros = {}) {
  const capas = await listarCapasNegociacaoParaSimulacao(filtros);
  if (!capas.length) return [];

  return executarComConcorrencia(capas, 4, (capa) => carregarDetalhesNegociacaoParaSimulacao(capa));
}

function tipoNegociacaoResultado(resultado = {}, tabela = {}) {
  return normalizarTipoNegociacao({
    tipo_negociacao:
      resultado.tipo_negociacao ||
      resultado.tipoNegociacao ||
      resultado.filtros?.tipoNegociacao ||
      tabela.tipo_negociacao,
    tipo_tabela: tabela.tipo_tabela || resultado.tipo_tabela,
  });
}

function calcularImpactoResultado(resultado = {}, tabela = {}) {
  const tipoNegociacao = tipoNegociacaoResultado(resultado, tabela);
  const meses = numero(resultado.meses) || 1;
  const valorAtual = numero(
    resultado.valor_atual_realizado ??
    resultado.valorAtualRealizado ??
    resultado.freteRealizadoComTabelaSelecionada ??
    resultado.freteRealizado ??
    0
  );
  const valorSimulado = numero(
    resultado.valor_simulado_nova_tabela ??
    resultado.valorSimuladoNovaTabela ??
    resultado.freteSelecionada ??
    resultado.valorSimulado ??
    0
  );
  const impactoValor = numero(
    resultado.impacto_valor ??
    resultado.impactoValor ??
    (valorSimulado - valorAtual)
  );
  const impactoPercentual = resultado.impacto_percentual !== undefined || resultado.impactoPercentual !== undefined
    ? numero(resultado.impacto_percentual ?? resultado.impactoPercentual)
    : (valorAtual ? (impactoValor / valorAtual) * 100 : 0);
  const impactoMensal = resultado.impacto_mensal !== undefined || resultado.impactoMensal !== undefined
    ? numero(resultado.impacto_mensal ?? resultado.impactoMensal)
    : (meses ? impactoValor / meses : impactoValor);
  const impactoAnual = resultado.impacto_anual !== undefined || resultado.impactoAnual !== undefined
    ? numero(resultado.impacto_anual ?? resultado.impactoAnual)
    : impactoMensal * 12;
  const fretePctAtual = numero(
    resultado.frete_percentual_nf_atual ??
    resultado.fretePercentualNfAtual ??
    resultado.percentualFreteRealizadoComTabela ??
    resultado.percentualFreteRealizado ??
    0
  );
  const fretePctSimulado = numero(
    resultado.frete_percentual_nf_simulado ??
    resultado.fretePercentualNfSimulado ??
    resultado.percentualFreteSelecionadaComTabela ??
    resultado.percentualFreteSelecionada ??
    resultado.percentual_frete_projetado ??
    0
  );
  const qtdAnalisados = inteiro(
    resultado.qtd_registros_analisados ??
    resultado.qtdRegistrosAnalisados ??
    resultado.viagensAnalisadas ??
    resultado.ctesAnalisados ??
    0
  );
  const qtdComTabela = inteiro(
    resultado.qtd_registros_com_tabela ??
    resultado.qtdRegistrosComTabela ??
    resultado.viagensComTabela ??
    resultado.ctesComTabelaSelecionada ??
    0
  );

  return {
    tipoNegociacao,
    valorAtual,
    valorSimulado,
    impactoValor,
    impactoPercentual,
    impactoMensal,
    impactoAnual,
    fretePctAtual,
    fretePctSimulado,
    qtdAnalisados,
    qtdComTabela,
  };
}



export async function excluirRegistroRodadaNegociacao(id, registroId) {
  const supabase = supabaseOrThrow();

  if (!id) throw new Error('Negociação inválida para excluir registro.');
  if (!registroId) throw new Error('Registro da rodada inválido para exclusão.');

  const { data: tabelaAtual, error: tabelaError } = await supabase
    .from('tabelas_negociacao')
    .select('id,resumo_simulacao')
    .eq('id', id)
    .single();

  if (tabelaError) {
    throw new Error(tabelaError.message || 'Erro ao buscar negociação atual.');
  }

  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual);
  const historicoAnterior = getHistoricoRodadas(tabelaAtual);
  const historicoAtualizado = historicoAnterior.filter((item) => String(item.id || item.criado_em || '') !== String(registroId));

  if (historicoAtualizado.length === historicoAnterior.length) {
    throw new Error('Registro não encontrado no histórico da negociação.');
  }

  const simulacoesRestantes = historicoAtualizado.filter((item) => item.tipo_registro === 'SIMULACAO');
  const ultimaSimulacao = simulacoesRestantes.length ? simulacoesRestantes[simulacoesRestantes.length - 1] : null;
  const resumoUltima = ultimaSimulacao && ultimaSimulacao.resumo ? ultimaSimulacao.resumo : {};
  const indUltima = ultimaSimulacao && ultimaSimulacao.indicadores ? ultimaSimulacao.indicadores : {};
  const maiorRodada = historicoAtualizado.reduce((acc, item) => Math.max(acc, inteiro(item.rodada || 0)), 1);

  const resumoSimulacaoAtualizado = ultimaSimulacao
    ? {
        ...resumoAnterior,
        ...resumoUltima,
        rodada_atual: maiorRodada,
        ultima_simulacao: ultimaSimulacao,
        ultima_simulacao_em: ultimaSimulacao.criado_em || null,
        historico_rodadas: historicoAtualizado,
      }
    : {
        ...resumoAnterior,
        rodada_atual: maiorRodada,
        ultima_simulacao: null,
        ultima_simulacao_em: null,
        historico_rodadas: historicoAtualizado,
        ctesAnalisados: 0,
        ctesSimulados: 0,
        ctesComTabelaSelecionada: 0,
        ctesGanhariaSelecionada: 0,
        ctesPerdidosSelecionada: 0,
        ctesSemTabelaSelecionada: 0,
        freteRealizado: 0,
        freteSelecionada: 0,
        faturamentoSelecionadaMes: 0,
        faturamentoSelecionadaAno: 0,
        faturamentoSelecionadaGanhadoraMes: 0,
        faturamentoSelecionadaGanhadoraAno: 0,
        savingSelecionadaVsReal: 0,
        savingSelecionadaVsRealMes: 0,
        savingSelecionadaVsRealAno: 0,
        aderenciaSelecionada: 0,
        cargasDia: 0,
        volumesDia: 0,
        volumes: 0,
        peso: 0,
        valorNF: 0,
        rotasGanhasDestaque: [],
        estadosGanhadoresDestaque: [],
        transportadorasPerdaDestaque: [],
      };

  const payload = {
    resumo_simulacao: resumoSimulacaoAtualizado,
    saving_projetado: numero(indUltima.saving_mes || resumoUltima.savingSelecionadaVsRealMes || 0),
    aderencia_projetada: numero(indUltima.aderencia || resumoUltima.aderenciaSelecionada || 0),
    faturamento_projetado: numero(indUltima.faturamento_mes || resumoUltima.faturamentoSelecionadaGanhadoraMes || resumoUltima.faturamentoSelecionadaMes || 0),
    impacto_projetado: numero(resumoUltima.diferencaSelecionadaVsVencedor || 0),
    percentual_frete_projetado: numero(indUltima.percentual_frete_simulado || resumoUltima.percentualFreteTabelaGanharia || resumoUltima.percentualFreteSelecionada || 0),
    volumetria_dia: numero(indUltima.pedidos_ganhos_dia || indUltima.pedidos_dia || resumoUltima.cargasDia || 0),
    ctes_analisados: inteiro(resumoUltima.ctesAnalisados || 0),
    ctes_atendidos: inteiro(resumoUltima.ctesComTabelaSelecionada || 0),
    rotas_sem_cobertura: inteiro(resumoUltima.ctesSemTabelaSelecionada || 0),
  };

  const { data, error } = await atualizarNegociacaoPersistencia(supabase, id, payload);

  if (error) {
    throw new Error(error.message || 'Erro ao excluir registro da rodada.');
  }

  return data;
}


export async function excluirRodadaNegociacao(id, rodadaNumero) {
  const supabase = supabaseOrThrow();

  if (!id) throw new Error('Negociação inválida para excluir rodada.');
  const rodadaAlvo = inteiro(rodadaNumero);
  if (!rodadaAlvo) throw new Error('Número da rodada inválido para exclusão.');

  const { data: tabelaAtual, error: tabelaError } = await supabase
    .from('tabelas_negociacao')
    .select('id,resumo_simulacao')
    .eq('id', id)
    .single();

  if (tabelaError) {
    throw new Error(tabelaError.message || 'Erro ao buscar negociação atual.');
  }

  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual);
  const historicoAnterior = getHistoricoRodadas(tabelaAtual);

  const historicoAtualizado = historicoAnterior.filter(function(item) {
    const mesmaRodada = inteiro(item?.rodada || 0) === rodadaAlvo;
    if (!mesmaRodada) return true;

    const tipoRegistro = String(item?.tipo_registro || '').toUpperCase();
    const origemRegistro = String(item?.origem_importacao || '').toUpperCase();
    const observacaoRegistro = String(item?.observacao || '').toUpperCase();
    const importados = item?.itens_importados || {};
    const salvos = item?.itens_salvos_apos_importacao || {};
    const totalItens =
      inteiro(importados.total || 0) +
      inteiro(importados.rotas || 0) +
      inteiro(importados.cotacoes || 0) +
      inteiro(salvos.total || 0) +
      inteiro(salvos.rotas || 0) +
      inteiro(salvos.cotacoes || 0);

    // A importação real é o histórico da subida da tabela e não pode ser apagada
    // pelo botão de apagar rodada/análise.
    const ehImportacaoReal = tipoRegistro === 'IMPORTACAO' && totalItens > 0;
    if (ehImportacaoReal) return true;

    const ehSimulacao = tipoRegistro === 'SIMULACAO';

    const ehMarcadorVazio =
      totalItens === 0 &&
      (
        tipoRegistro === 'NOVA_RODADA' ||
        tipoRegistro === 'ABERTURA' ||
        origemRegistro === 'NOVA_RODADA' ||
        observacaoRegistro.includes('NOVA RODADA')
      );

    // Remove a simulação da rodada e marcadores vazios de abertura.
    // Preserva qualquer importação real da tabela.
    return !(ehSimulacao || ehMarcadorVazio);
  });

  if (historicoAtualizado.length === historicoAnterior.length) {
    throw new Error('Nenhuma simulação ou marcador vazio encontrado para esta rodada. Importações reais foram preservadas.');
  }

  const simulacoesRestantes = historicoAtualizado.filter(function(item) {
    return String(item?.tipo_registro || '').toUpperCase() === 'SIMULACAO';
  });

  const ultimaSimulacao = simulacoesRestantes.length ? simulacoesRestantes[simulacoesRestantes.length - 1] : null;
  const resumoUltima = ultimaSimulacao && ultimaSimulacao.resumo ? ultimaSimulacao.resumo : {};
  const indUltima = ultimaSimulacao && ultimaSimulacao.indicadores ? ultimaSimulacao.indicadores : {};
  const maiorRodada = historicoAtualizado.reduce(function(acc, item) {
    return Math.max(acc, inteiro(item?.rodada || 0));
  }, 1);

  const resumoSimulacaoAtualizado = ultimaSimulacao
    ? {
        ...resumoAnterior,
        ...resumoUltima,
        rodada_atual: maiorRodada,
        ultima_simulacao: ultimaSimulacao,
        ultima_simulacao_em: ultimaSimulacao.criado_em || null,
        historico_rodadas: historicoAtualizado,
      }
    : {
        ...resumoAnterior,
        rodada_atual: maiorRodada,
        ultima_simulacao: null,
        ultima_simulacao_em: null,
        historico_rodadas: historicoAtualizado,
        ctesAnalisados: 0,
        ctesSimulados: 0,
        ctesComTabelaSelecionada: 0,
        ctesGanhariaSelecionada: 0,
        ctesPerdidosSelecionada: 0,
        ctesSemTabelaSelecionada: 0,
        freteRealizado: 0,
        freteSelecionada: 0,
        faturamentoSelecionadaMes: 0,
        faturamentoSelecionadaAno: 0,
        faturamentoSelecionadaGanhadoraMes: 0,
        faturamentoSelecionadaGanhadoraAno: 0,
        savingSelecionadaVsReal: 0,
        savingSelecionadaVsRealMes: 0,
        savingSelecionadaVsRealAno: 0,
        aderenciaSelecionada: 0,
        cargasDia: 0,
        volumesDia: 0,
        volumes: 0,
        peso: 0,
        valorNF: 0,
        rotasGanhasDestaque: [],
        estadosGanhadoresDestaque: [],
        transportadorasPerdaDestaque: [],
      };

  const payload = {
    resumo_simulacao: resumoSimulacaoAtualizado,
    saving_projetado: numero(indUltima.saving_mes || resumoUltima.savingSelecionadaVsRealMes || 0),
    aderencia_projetada: numero(indUltima.aderencia || resumoUltima.aderenciaSelecionada || 0),
    faturamento_projetado: numero(indUltima.faturamento_mes || resumoUltima.faturamentoSelecionadaGanhadoraMes || resumoUltima.faturamentoSelecionadaMes || 0),
    impacto_projetado: numero(resumoUltima.diferencaSelecionadaVsVencedor || 0),
    percentual_frete_projetado: numero(indUltima.percentual_frete_simulado || resumoUltima.percentualFreteTabelaGanharia || resumoUltima.percentualFreteSelecionada || 0),
    volumetria_dia: numero(indUltima.pedidos_ganhos_dia || indUltima.pedidos_dia || resumoUltima.cargasDia || 0),
    ctes_analisados: inteiro(resumoUltima.ctesAnalisados || 0),
    ctes_atendidos: inteiro(resumoUltima.ctesComTabelaSelecionada || 0),
    rotas_sem_cobertura: inteiro(resumoUltima.ctesSemTabelaSelecionada || 0),
  };

  const { data, error } = await atualizarNegociacaoPersistencia(supabase, id, payload);

  if (error) {
    throw new Error(error.message || 'Erro ao excluir rodada.');
  }

  return data;
}


export async function salvarResultadoSimulacaoNegociacao(id, resultado = {}) {
  const supabase = supabaseOrThrow();

  if (!id) {
    throw new Error('Negociação inválida para salvar resultado.');
  }

  const { data: tabelaAtual, error: tabelaError } = await supabase
    .from('tabelas_negociacao')
    .select('*')
    .eq('id', id)
    .single();

  if (tabelaError) {
    throw new Error(tabelaError.message || 'Erro ao buscar negociação atual.');
  }

  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual);
  const historicoAnterior = getHistoricoRodadas(tabelaAtual);
  const rodadaAtual = inteiro(resumoAnterior.rodada_atual || 1) || 1;
  const agora = dataISO();
  const impacto = calcularImpactoResultado(resultado, tabelaAtual);

  const resumoResultado = {
    salvo_em: agora,
    rodada: rodadaAtual,
    tipoNegociacao: impacto.tipoNegociacao,
    filtros: resultado.filtros || {},

    ctesAnalisados: resultado.ctesAnalisados || 0,
    ctesSimulados: resultado.ctesSimulados || 0,
    ctesComTabelaSelecionada: resultado.ctesComTabelaSelecionada || 0,
    ctesGanhariaSelecionada: resultado.ctesGanhariaSelecionada || 0,
    ctesPerdidosSelecionada: resultado.ctesPerdidosSelecionada || 0,
    ctesSemTabelaSelecionada: resultado.ctesSemTabelaSelecionada || 0,
    ctesSemTabelaGeral: resultado.ctesSemTabelaGeral || 0,

    freteRealizado: resultado.freteRealizado || 0,
    freteSelecionada: resultado.freteSelecionada || 0,
    freteVencedor: resultado.freteVencedor || 0,

    faturamentoSelecionadaMes: resultado.faturamentoSelecionadaMes || 0,
    faturamentoSelecionadaAno: resultado.faturamentoSelecionadaAno || 0,
    faturamentoSelecionadaGanhadoraMes: resultado.faturamentoSelecionadaGanhadoraMes || 0,
    faturamentoSelecionadaGanhadoraAno: resultado.faturamentoSelecionadaGanhadoraAno || 0,

    savingSelecionadaVsReal: resultado.savingSelecionadaVsReal || 0,
    savingSelecionadaVsRealMes: resultado.savingSelecionadaVsRealMes || 0,
    savingSelecionadaVsRealAno: resultado.savingSelecionadaVsRealAno || 0,
    savingTabelaSelecionadaVsRealBruto: resultado.savingTabelaSelecionadaVsRealBruto || 0,
    savingVencedorVsReal: resultado.savingVencedorVsReal || 0,

    aderenciaSelecionada: resultado.aderenciaSelecionada || 0,
    percentualSavingSelecionada: resultado.percentualSavingSelecionada || 0,
    percentualFreteRealizado: resultado.percentualFreteRealizado || 0,
    percentualFreteTabelaGanharia: resultado.percentualFreteTabelaGanharia || 0,
    percentualFreteSelecionada: resultado.percentualFreteSelecionada || 0,
    reducaoMediaNecessaria: resultado.reducaoMediaNecessaria || 0,

    valor_atual_realizado: impacto.valorAtual,
    valor_simulado_nova_tabela: impacto.valorSimulado,
    impacto_valor: impacto.impactoValor,
    impacto_percentual: impacto.impactoPercentual,
    impacto_mensal: impacto.impactoMensal,
    impacto_anual: impacto.impactoAnual,
    frete_percentual_nf_atual: impacto.fretePctAtual,
    frete_percentual_nf_simulado: impacto.fretePctSimulado,
    qtd_registros_analisados: impacto.qtdAnalisados,
    qtd_registros_com_tabela: impacto.qtdComTabela,

    cargasDia: resultado.cargasDia || 0,
    volumesDia: resultado.volumesDia || 0,
    dias: resultado.dias || 0,
    meses: resultado.meses || 1,
    freteRealizadoMes: resultado.freteRealizadoMes || 0,
    freteRealizadoAno: resultado.freteRealizadoAno || 0,
    volumes: resultado.volumes || 0,
    peso: resultado.peso || 0,
    valorNF: resultado.valorNF || 0,

    freteSelecionadaGanhadora: resultado.freteSelecionadaGanhadora || 0,
    freteCapturadoRealizado: resultado.freteCapturadoRealizado || 0,
    freteCapturadoTabela: resultado.freteCapturadoTabela || 0,
    savingCapturado: resultado.savingCapturado || 0,
    ctesCapturadosDeOutras: resultado.ctesCapturadosDeOutras || 0,
    qtdRotasComTabelaSelecionada: resultado.qtdRotasComTabelaSelecionada || 0,
    qtdRotasGanhasSelecionada: resultado.qtdRotasGanhasSelecionada || 0,
    qtdRotasComGanhoSelecionada: resultado.qtdRotasComGanhoSelecionada || 0,
    qtdRotasParciaisSelecionada: resultado.qtdRotasParciaisSelecionada || 0,
    qtdRotasPerdidasSelecionada: resultado.qtdRotasPerdidasSelecionada || 0,

    rotas: (resultado.rotas || []).slice(0, 30),
    rotasGanhasDestaque: (resultado.rotasGanhasDestaque || []).slice(0, 10),
    rotasPerdidasDestaque: (resultado.rotasPerdidasDestaque || []).slice(0, 10),
    resumoPorEstado: (resultado.resumoPorEstado || []).slice(0, 27),
    estadosGanhadoresDestaque: (resultado.estadosGanhadoresDestaque || []).slice(0, 10),
    estadosPerdidosDestaque: (resultado.estadosPerdidosDestaque || []).slice(0, 10),
    transportadorasPerdaDestaque: (resultado.transportadorasPerdaDestaque || []).slice(0, 10),
    laudo: (resultado.laudo || []).slice(0, 12),
    laudosEmail: resultado.laudosEmail || null,
    laudos: resultado.laudos || null,
    pareto80Volume: resultado.pareto80Volume
      ? {
          qtdRotas: resultado.pareto80Volume.qtdRotas || 0,
          totalVolume: resultado.pareto80Volume.totalVolume || 0,
          volumeCoberto: resultado.pareto80Volume.volumeCoberto || 0,
          pctCoberto: resultado.pareto80Volume.pctCoberto || 0,
          ctes: resultado.pareto80Volume.ctes || 0,
          volumes: resultado.pareto80Volume.volumes || 0,
          freteRealizado: resultado.pareto80Volume.freteRealizado || 0,
          freteSelecionada: resultado.pareto80Volume.freteSelecionada || 0,
          freteVencedor: resultado.pareto80Volume.freteVencedor || 0,
          savingSelecionada: resultado.pareto80Volume.savingSelecionada || 0,
          savingVencedor: resultado.pareto80Volume.savingVencedor || 0,
          reducaoMediaNecessaria: resultado.pareto80Volume.reducaoMediaNecessaria || 0,
          rotas: (resultado.pareto80Volume.rotas || []).slice(0, 15),
        }
      : null,
    diagnostico: resultado.diagnostico || {},
    analiseReajuste: resultado.analiseReajuste || null,
    gradeFrete: resultado.gradeFrete || null,

    // Detalhes por CT-e: base dos agrupamentos do laudo de rodadas
    // Limitado a 800 itens para nao estourar o payload do Supabase.
    ctesDetalhes: selecionarCtesDetalhesParaPersistencia(resultado.ctesDetalhes || [], 800).map((item) => ({
      origem:                item.origem || '',
      ufOrigem:              item.ufOrigem || '',
      destino:               item.destino || '',
      ufDestino:             item.ufDestino || '',
      canal:                 item.canal || '',
      peso:                  item.peso || 0,
      cubagem:               item.cubagem || 0,
      volumes:               item.volumes || 0,
      valorNF:               item.valorNF || 0,
      freteRealizado:        item.freteRealizado || 0,
      freteSelecionada:      item.freteSelecionada || 0,
      statusSelecionada:     item.statusSelecionada || '',
      ganhouRealizado:       item.ganhouRealizado || false,
      perdeuRealizado:       item.statusSelecionada === 'Perderia'
                               || (Number(item.diferencaParaVencedor || 0) > 0 && !item.ganhouRealizado),
      diferencaParaVencedor: item.diferencaParaVencedor || 0,
      reducaoMediaNecessaria: item.reducaoNecessaria || 0,
      percentualFreteRealizado: item.percentualFreteRealizado || 0,
      percentualFreteSelecionada: item.percentualFreteSelecionada || 0,
      variacaoPctFreteSelecionada: item.variacaoPctFreteSelecionada || 0,
      freteVencedor:         item.freteVencedor || 0,
      savingSelecionada:     item.savingSelecionada || 0,
      faixaPeso:             item.selecionadaDetalhes?.frete?.faixaPeso || '',
      trackingMatch:         item.trackingMatch || false,
      trackingOrigemVinculo: item.trackingOrigemVinculo || '',
      trackingLinhas:        item.trackingLinhas || 0,
      chaveCte:              item.chaveCte || '',
      chaveNfe:              item.chaveNfe || '',
      cubagemOriginalTracking: item.cubagemOriginalTracking || 0,
      cubagemTotalArmazenadaTracking: item.cubagemTotalArmazenadaTracking || 0,
      cubagemOutlierTracking: item.cubagemOutlierTracking || false,
      cubagemCorrigidaTracking: item.cubagemCorrigidaTracking || false,
      limiteCubagemTracking: item.limiteCubagemTracking || 0,
    })),

    // Totais agregados usados como fallback pelo motor de veiculo sugerido
    cubagemTotal:      resultado.cubagemTotal || 0,
    volumesCapturados: resultado.volumesCapturados || 0,
    pesoCapturado:     resultado.pesoCapturado || 0,
  };

  const entradaRodada = {
    id: `${rodadaAtual}-SIM-${Date.now()}`,
    tipo_registro: 'SIMULACAO',
    rodada: rodadaAtual,
    criado_em: agora,
    resumo: resumoResultado,
    indicadores: {
      aderencia: numero(resultado.aderencia_projetada ?? resultado.aderenciaSelecionada ?? 0),
      saving_mes: numero(resultado.saving_projetado ?? resultado.savingSelecionadaVsRealMes ?? resultado.savingSelecionadaVsReal ?? 0),
      saving_ano: numero(resultado.savingSelecionadaVsRealAno ?? 0),
      faturamento_mes: numero(resultado.faturamento_projetado ?? resultado.faturamentoSelecionadaGanhadoraMes ?? resultado.faturamentoSelecionadaMes ?? resultado.freteSelecionada ?? 0),
      faturamento_ano: numero(resultado.faturamentoSelecionadaGanhadoraAno ?? resultado.faturamentoSelecionadaAno ?? 0),
      pedidos_dia: numero(resultado.volumetria_dia ?? resultado.cargasDia ?? 0),
      volumes_dia: numero(resultado.volumesDia ?? 0),
      percentual_frete_realizado: numero(resultado.percentualFreteRealizado ?? 0),
      percentual_frete_simulado: numero(resultado.percentual_frete_projetado ?? resultado.percentualFreteTabelaGanharia ?? resultado.percentualFreteSelecionada ?? 0),
      valor_atual_realizado: impacto.valorAtual,
      valor_simulado_nova_tabela: impacto.valorSimulado,
      impacto_valor: impacto.impactoValor,
      impacto_percentual: impacto.impactoPercentual,
      impacto_mensal: impacto.impactoMensal,
      impacto_anual: impacto.impactoAnual,
      frete_percentual_nf_atual: impacto.fretePctAtual,
      frete_percentual_nf_simulado: impacto.fretePctSimulado,
      qtd_registros_analisados: impacto.qtdAnalisados,
      qtd_registros_com_tabela: impacto.qtdComTabela,
      rotas_com_ganho: inteiro(resultado.qtdRotasComGanhoSelecionada ?? 0),
      rotas_ganhas: inteiro(resultado.qtdRotasGanhasSelecionada ?? 0),
      rotas_parciais: inteiro(resultado.qtdRotasParciaisSelecionada ?? 0),
      frete_capturado: numero(resultado.freteCapturadoRealizado ?? 0),
      ctes_capturados: inteiro(resultado.ctesCapturadosDeOutras ?? 0),
    },
  };

  const historicoSemRegistroVazioDaRodada = historicoAnterior.filter((item) => {
    const mesmaRodada = inteiro(item?.rodada || 0) === rodadaAtual;
    const tipoRegistro = String(item?.tipo_registro || '').toUpperCase();
    const origemRegistro = String(item?.origem_importacao || '').toUpperCase();
    const observacaoRegistro = String(item?.observacao || '').toUpperCase();
    const importados = item?.itens_importados || {};
    const salvos = item?.itens_salvos_apos_importacao || {};
    const totalItens =
      inteiro(importados.total || 0) +
      inteiro(importados.rotas || 0) +
      inteiro(importados.cotacoes || 0) +
      inteiro(salvos.total || 0) +
      inteiro(salvos.rotas || 0) +
      inteiro(salvos.cotacoes || 0);

    // Preserva importação real de tabela, pois é histórico da subida.
    const ehImportacaoReal = tipoRegistro === 'IMPORTACAO' && totalItens > 0;

    // Ao salvar novamente a mesma rodada, substitui a simulação anterior
    // e remove apenas marcadores vazios de abertura/nova rodada.
    const ehSimulacaoDaRodada = tipoRegistro === 'SIMULACAO';
    const ehMarcadorVazio =
      totalItens === 0 &&
      (
        tipoRegistro === 'NOVA_RODADA' ||
        tipoRegistro === 'ABERTURA' ||
        origemRegistro === 'NOVA_RODADA' ||
        observacaoRegistro.includes('NOVA RODADA')
      );

    return !(mesmaRodada && !ehImportacaoReal && (ehSimulacaoDaRodada || ehMarcadorVazio));
  });

  const historicoAtualizado = historicoSemRegistroVazioDaRodada.concat([entradaRodada]).slice(-30);

  const payload = {
    saving_projetado: numero(
      resultado.saving_projetado ??
      resultado.savingSelecionadaVsRealMes ??
      resultado.savingSelecionadaVsReal ??
      0
    ),

    aderencia_projetada: numero(
      resultado.aderencia_projetada ??
      resultado.aderenciaSelecionada ??
      0
    ),

    faturamento_projetado: numero(
      resultado.faturamento_projetado ??
      resultado.faturamentoSelecionadaGanhadoraMes ??
      resultado.faturamentoSelecionadaMes ??
      resultado.freteSelecionada ??
      0
    ),

    impacto_projetado: numero(
      resultado.impacto_projetado ??
      resultado.diferencaSelecionadaVsVencedor ??
      0
    ),

    percentual_frete_projetado: numero(
      resultado.percentual_frete_projetado ??
      resultado.percentualFreteTabelaGanharia ??
      resultado.percentualFreteSelecionada ??
      0
    ),

    volumetria_dia: numero(
      resultado.volumetria_dia ??
      resultado.cargasDia ??
      0
    ),

    ctes_analisados: inteiro(
      resultado.ctes_analisados ??
      resultado.ctesAnalisados ??
      0
    ),

    ctes_atendidos: inteiro(
      resultado.ctes_atendidos ??
      resultado.ctesComTabelaSelecionada ??
      0
    ),

    rotas_sem_cobertura: inteiro(
      resultado.rotas_sem_cobertura ??
      resultado.ctesSemTabelaSelecionada ??
      0
    ),

    valor_atual_realizado: impacto.valorAtual,
    valor_simulado_nova_tabela: impacto.valorSimulado,
    impacto_valor: impacto.impactoValor,
    impacto_percentual: impacto.impactoPercentual,
    impacto_mensal: impacto.impactoMensal,
    impacto_anual: impacto.impactoAnual,
    frete_percentual_nf_atual: impacto.fretePctAtual,
    frete_percentual_nf_simulado: impacto.fretePctSimulado,
    qtd_registros_analisados: impacto.qtdAnalisados,
    qtd_registros_com_tabela: impacto.qtdComTabela,
    resultado_simulacao_json: resumoResultado,
    percentual_medio_impacto: impacto.impactoPercentual,

    incluir_simulacao: false,

    resumo_simulacao: {
      ...resumoAnterior,
      ...resumoResultado,
      rodada_atual: rodadaAtual,
      ultima_simulacao_em: agora,
      ultima_simulacao: entradaRodada,
      laudos: resultado.laudos || resumoAnterior.laudos || null,
      laudosEmail: resultado.laudosEmail || resumoAnterior.laudosEmail || null,
      laudos_gerados_em: resultado.laudos ? agora : resumoAnterior.laudos_gerados_em,
      historico_rodadas: historicoAtualizado,
    },
  };

  const { data, error } = await atualizarNegociacaoPersistencia(
    supabase,
    id,
    payload,
    'id,transportadora,canal,status,resumo_simulacao,resumo_capa,incluir_simulacao,aderencia_projetada,saving_projetado,faturamento_projetado,impacto_projetado',
  );

  if (error) {
    throw new Error(error.message || 'Erro ao salvar resultado da simulação na negociação.');
  }

  if (!data?.id || data.id !== id) {
    throw new Error('O Supabase não confirmou a atualização da negociação correta.');
  }

  const historicoConfirmado = getHistoricoRodadas(data);
  const rodadaConfirmada = historicoConfirmado.some((item) => item?.id === entradaRodada.id);
  if (!rodadaConfirmada) {
    throw new Error('O Supabase respondeu, mas não confirmou a nova rodada no histórico da negociação.');
  }

  return data;
}

function chaveRotaLotacao(origem = '', destino = '', tipo = '') {
  return [
    normalizarTextoLotacao(origem),
    normalizarTextoLotacao(destino),
    normalizarTextoLotacao(tipo || 'GERAL'),
  ].join('|');
}

function valorAtualCargaLotacao(carga = {}) {
  return numero(
    carga.valorComparacao ??
    carga.freteTransp ??
    carga.freteCantu ??
    carga.valor_lancado ??
    carga.valorAutorizadoCarga ??
    0
  );
}

function dataCargaLotacao(carga = {}) {
  return dataOuNull(carga.coletaRealizada || carga.coletaPlanejada || carga.emissaoNf);
}

function mesesPeriodoLotacao(cargas = [], inicioFiltro = '', fimFiltro = '') {
  const datas = (cargas || [])
    .map(dataCargaLotacao)
    .filter(Boolean)
    .sort();
  const inicio = dataOuNull(inicioFiltro) || datas[0];
  const fim = dataOuNull(fimFiltro) || datas[datas.length - 1];
  if (!inicio || !fim) return 1;
  const ini = new Date(inicio);
  const end = new Date(fim);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(end.getTime())) return 1;
  const dias = Math.max(1, Math.ceil((end.getTime() - ini.getTime()) / 86400000) + 1);
  return Math.max(dias / 30.4375, 1);
}

function montarTabelaLotacaoNegociacao(tabela = {}, itens = []) {
  const linhas = (itens || [])
    .filter((item) => numero(item.valor_lotacao || item.taxa_aplicada) > 0)
    .map((item, index) => {
      const origem = texto(item.cidade_origem || item.origem || tabela.origem);
      const destino = texto(item.cidade_destino || item.destino);
      const tipo = texto(item.tipo_veiculo || 'GERAL') || 'GERAL';
      return {
        id: item.id || `neg-lot-${index}`,
        origem,
        ufOrigem: upper(item.uf_origem || tabela.uf_origem),
        destino,
        ufDestino: upper(item.uf_destino || tabela.uf_destino),
        tipo,
        valor: numero(item.valor_lotacao || item.taxa_aplicada),
        km: numero(item.km),
        pedagio: numero(item.pedagio),
        chave: chaveRotaLotacao(origem, destino, tipo),
        chaveSemTipo: chaveRotaLotacao(origem, destino, 'GERAL'),
      };
    });

  return linhas;
}

function indexarLotacaoNegociacao(linhas = []) {
  const mapa = new Map();
  const mapaSemTipo = new Map();
  linhas.forEach((linha) => {
    if (!linha.chave) return;
    if (!mapa.has(linha.chave) || numero(linha.valor) < numero(mapa.get(linha.chave).valor)) mapa.set(linha.chave, linha);
    if (!mapaSemTipo.has(linha.chaveSemTipo) || numero(linha.valor) < numero(mapaSemTipo.get(linha.chaveSemTipo).valor)) {
      mapaSemTipo.set(linha.chaveSemTipo, linha);
    }
  });
  return { mapa, mapaSemTipo };
}

export async function simularLotacaoNegociacao(id, filtros = {}) {
  if (!id) throw new Error('Negociacao de lotacao invalida.');

  const tabela = await obterTabelaNegociacao(id);
  const itens = await listarTodosItensTabelaNegociacao(id);
  const linhasTabela = montarTabelaLotacaoNegociacao(tabela, itens);
  if (!linhasTabela.length) throw new Error('Nao ha rotas de lotacao salvas nesta negociacao.');

  const filtrosCarga = {
    origem: filtros.origem || tabela.origem || '',
    destino: filtros.destino || '',
    tipoVeiculo: filtros.tipoVeiculo || filtros.tipo_veiculo || tabela.tipo_veiculo || '',
    transportadora: filtros.transportadoraBase || filtros.transportadora_base_nome || tabela.transportadora_base_nome || '',
    inicio: filtros.inicio || tabela.periodo_realizado_inicio || '',
    fim: filtros.fim || tabela.periodo_realizado_fim || '',
    limit: filtros.limit || 20000,
  };
  const cargas = await carregarCargasLotacaoSupabase(filtrosCarga);
  if (!cargas.length) throw new Error('Nenhuma carga de lotacao encontrada para os filtros informados.');

  const { mapa, mapaSemTipo } = indexarLotacaoNegociacao(linhasTabela);
  const detalhes = [];
  const rotasMap = new Map();

  let valorAtual = 0;
  let valorSimulado = 0;
  let qtdComTabela = 0;
  let pesoTotal = 0;

  cargas.forEach((carga) => {
    const atual = valorAtualCargaLotacao(carga);
    const chave = chaveRotaLotacao(carga.origem, carga.destino, carga.tipoVeiculo || 'GERAL');
    const chaveSemTipo = chaveRotaLotacao(carga.origem, carga.destino, 'GERAL');
    const linha = mapa.get(chave) || mapaSemTipo.get(chaveSemTipo) || null;
    const simulado = linha ? numero(linha.valor) : 0;
    const diferenca = linha ? simulado - atual : 0;

    if (linha) {
      qtdComTabela += 1;
      valorAtual += atual;
      valorSimulado += simulado;
    }

    pesoTotal += numero(carga.cubagem);

    const rotaKey = chaveSemTipo;
    const rota = rotasMap.get(rotaKey) || {
      rota: `${carga.origem || linha?.origem || '-'} -> ${carga.destino || linha?.destino || '-'}`,
      origem: carga.origem || linha?.origem || '',
      destino: carga.destino || linha?.destino || '',
      tipoVeiculo: carga.tipoVeiculo || linha?.tipo || '',
      viagens: 0,
      comTabela: 0,
      valorAtual: 0,
      valorSimulado: 0,
      diferenca: 0,
    };
    rota.viagens += 1;
    if (linha) {
      rota.comTabela += 1;
      rota.valorAtual += atual;
      rota.valorSimulado += simulado;
      rota.diferenca += diferenca;
    }
    rotasMap.set(rotaKey, rota);

    detalhes.push({
      dist: carga.dist || '',
      origem: carga.origem || linha?.origem || '',
      destino: carga.destino || linha?.destino || '',
      tipoVeiculo: carga.tipoVeiculo || linha?.tipo || '',
      transportadoraAtual: carga.transportadora || '',
      valorAtual: atual,
      valorSimulado: simulado,
      diferenca,
      status: linha ? (diferenca > 0 ? 'Aumento' : diferenca < 0 ? 'Reducao' : 'Sem alteracao') : 'Sem tabela',
    });
  });

  const impactoValor = valorSimulado - valorAtual;
  const impactoPercentual = valorAtual ? (impactoValor / valorAtual) * 100 : 0;
  const meses = mesesPeriodoLotacao(cargas, filtrosCarga.inicio, filtrosCarga.fim);
  const impactoMensal = meses ? impactoValor / meses : impactoValor;
  const impactoAnual = impactoMensal * 12;
  const resultado = {
    tipoNegociacao: 'TABELA_LOTACAO',
    modoNegociacao: 'LOTACAO',
    filtros: filtrosCarga,
    ctesAnalisados: cargas.length,
    ctesComTabelaSelecionada: qtdComTabela,
    viagensAnalisadas: cargas.length,
    viagensComTabela: qtdComTabela,
    valor_atual_realizado: valorAtual,
    valor_simulado_nova_tabela: valorSimulado,
    impacto_valor: impactoValor,
    impacto_percentual: impactoPercentual,
    impacto_mensal: impactoMensal,
    impacto_anual: impactoAnual,
    qtd_registros_analisados: cargas.length,
    qtd_registros_com_tabela: qtdComTabela,
    aderenciaSelecionada: cargas.length ? (qtdComTabela / cargas.length) * 100 : 0,
    freteRealizado: valorAtual,
    freteSelecionada: valorSimulado,
    freteRealizadoComTabelaSelecionada: valorAtual,
    meses,
    peso: pesoTotal,
    rotas: [...rotasMap.values()]
      .map((rota) => ({
        ...rota,
        impactoPercentual: rota.valorAtual ? (rota.diferenca / rota.valorAtual) * 100 : 0,
      }))
      .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
      .slice(0, 100),
    ctesDetalhes: detalhes.slice(0, 500),
  };

  const tabelaAtualizada = await salvarResultadoSimulacaoNegociacao(id, resultado);
  return { resultado, tabela: tabelaAtualizada };
}

// ─── GESTÃO 4.37 — fluxo de aprovação e histórico ───────────────────────────

function getHistoricoGestao(tabela = {}) {
  return Array.isArray(tabela.historico_gestao) ? tabela.historico_gestao : [];
}

function montarEventoGestao(tipo, tabela, dados = {}) {
  const statusAnterior = normalizarStatusGestao(tabela);
  const statusNovo = dados.status_gestao || statusAnterior;
  return {
    id: `${tipo}-${Date.now()}`,
    tipo,
    criado_em: dataISO(),
    usuario_id: texto(dados.usuario_id || dados.usuario?.id),
    usuario_nome: texto(dados.usuario_nome || dados.usuario?.nome || dados.usuario),
    observacao: texto(dados.observacao || dados.justificativa || dados.observacao_aprovacao),
    status_anterior: statusAnterior,
    status_novo: statusNovo,
  };
}

async function aplicarTransicaoGestao(id, transicao = {}) {
  const supabase = supabaseOrThrow();
  const tabela = await obterTabelaNegociacao(id);
  const historico = getHistoricoGestao(tabela);
  const evento = montarEventoGestao(transicao.tipo, tabela, transicao);
  const statusGestao = transicao.status_gestao || normalizarStatusGestao(tabela);
  const statusLegado = statusLegadoPorGestao(statusGestao);

  const payload = {
    status_gestao: statusGestao,
    status: statusLegado,
    status_aprovacao: transicao.status_aprovacao,
    historico_gestao: historico.concat([evento]).slice(-100),
    negociador_id: transicao.negociador_id !== undefined ? texto(transicao.negociador_id) : undefined,
    negociador_nome: transicao.negociador_nome !== undefined ? texto(transicao.negociador_nome) : undefined,
    aprovador_id: transicao.aprovador_id !== undefined ? texto(transicao.aprovador_id) : undefined,
    aprovador_nome: transicao.aprovador_nome !== undefined ? texto(transicao.aprovador_nome) : undefined,
    aprovado_em: transicao.aprovado_em,
    publicado_em: transicao.publicado_em,
    enviado_aprovacao_em: transicao.enviado_aprovacao_em,
    observacao_aprovacao: transicao.observacao_aprovacao !== undefined ? texto(transicao.observacao_aprovacao) : undefined,
    justificativa_aprovacao: transicao.justificativa_aprovacao !== undefined ? texto(transicao.justificativa_aprovacao) : undefined,
    usuario_aprovacao: transicao.usuario_aprovacao !== undefined ? texto(transicao.usuario_aprovacao) : undefined,
    data_aprovacao: transicao.data_aprovacao,
    data_inicio_vigencia: transicao.data_inicio_vigencia,
    substituir_tabela_anterior: transicao.substituir_tabela_anterior,
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message || 'Erro ao atualizar gestão da negociação.');
  return data;
}

export async function enviarParaAprovacaoGestor(id, dados = {}) {
  const tabela = await obterTabelaNegociacao(id);
  const statusAtual = normalizarStatusGestao(tabela);
  if (['PUBLICADA_OFICIAL', 'CANCELADA', 'AGUARDANDO_APROVACAO_GESTOR'].includes(statusAtual)) {
    throw new Error('Esta negociação não pode ser enviada para aprovação no status atual.');
  }

  return aplicarTransicaoGestao(id, {
    tipo: 'ENVIO_APROVACAO',
    status_gestao: 'AGUARDANDO_APROVACAO_GESTOR',
    status_aprovacao: 'AGUARDANDO_GESTOR',
    enviado_aprovacao_em: dataISO(),
    ...dados,
  });
}

export async function aprovarGestorNegociacao(id, dados = {}) {
  const supabase = supabaseOrThrow();
  const agora = dataISO();
  const tabelaAtual = await obterTabelaNegociacao(id);
  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual);
  const historicoAnterior = getHistoricoRodadas(tabelaAtual);
  const impactoAtual = calcularImpactoResultado(tabelaAtual?.resultado_simulacao_json || resumoAnterior || {}, tabelaAtual || {});

  const entradaAprovacao = {
    id: `APROVACAO-GESTOR-${Date.now()}`,
    tipo_registro: 'APROVACAO_GESTOR',
    rodada: inteiro(resumoAnterior.rodada_atual || 1) || 1,
    criado_em: agora,
    data_inicio_vigencia: dados.data_inicio_vigencia || null,
    usuario_aprovacao: texto(dados.aprovador_nome || dados.usuario?.nome || dados.usuario_aprovacao),
    observacao: dados.observacao_aprovacao || dados.justificativa_aprovacao || '',
    percentual_medio_impacto: numero(dados.percentual_medio_impacto ?? impactoAtual.impactoPercentual),
  };

  const eventoGestao = montarEventoGestao('APROVACAO_GESTOR', tabelaAtual, {
    ...dados,
    status_gestao: 'APROVADA_GESTOR',
    observacao: dados.observacao_aprovacao || dados.justificativa_aprovacao,
  });

  const payload = {
    status_gestao: 'APROVADA_GESTOR',
    status: 'APROVADA',
    status_aprovacao: 'APROVADA',
    aprovado_em: agora,
    data_aprovacao: agora,
    data_inicio_vigencia: dados.data_inicio_vigencia || null,
    justificativa_aprovacao: texto(dados.justificativa_aprovacao),
    usuario_aprovacao: texto(dados.aprovador_nome || dados.usuario?.nome || dados.usuario_aprovacao),
    observacao_aprovacao: texto(dados.observacao_aprovacao || dados.justificativa_aprovacao),
    aprovador_id: texto(dados.aprovador_id || dados.usuario?.id),
    aprovador_nome: texto(dados.aprovador_nome || dados.usuario?.nome || dados.usuario_aprovacao),
    substituir_tabela_anterior: Boolean(dados.substituir_tabela_anterior),
    percentual_medio_impacto: numero(dados.percentual_medio_impacto ?? impactoAtual.impactoPercentual),
    incluir_simulacao: false,
    historico_gestao: getHistoricoGestao(tabelaAtual).concat([eventoGestao]).slice(-100),
    resumo_simulacao: {
      ...resumoAnterior,
      aprovada_em: agora,
      ultima_aprovacao: entradaAprovacao,
      historico_rodadas: historicoAnterior.concat([entradaAprovacao]).slice(-30),
    },
  };

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message || 'Erro ao aprovar negociação pelo gestor.');
  return data;
}

export async function recusarGestorNegociacao(id, dados = {}) {
  if (!texto(dados.observacao || dados.justificativa)) {
    throw new Error('Informe o motivo da recusa.');
  }
  return aplicarTransicaoGestao(id, {
    tipo: 'RECUSA_GESTOR',
    status_gestao: 'RECUSADA',
    status_aprovacao: 'RECUSADA',
    ...dados,
  });
}

export async function devolverParaAjusteNegociacao(id, dados = {}) {
  if (!texto(dados.observacao || dados.justificativa)) {
    throw new Error('Informe o motivo da devolução.');
  }
  return aplicarTransicaoGestao(id, {
    tipo: 'DEVOLUCAO_AJUSTE',
    status_gestao: 'DEVOLVIDA_AJUSTE',
    status_aprovacao: 'DEVOLVIDA',
    ...dados,
  });
}

export async function solicitarComplementoNegociacao(id, dados = {}) {
  return aplicarTransicaoGestao(id, {
    tipo: 'SOLICITAR_COMPLEMENTO',
    status_gestao: 'EM_ANALISE',
    status_aprovacao: 'COMPLEMENTO_SOLICITADO',
    ...dados,
  });
}

export async function publicarNegociacaoNaBaseOficial(id, dados = {}) {
  const tabela = await obterTabelaNegociacao(id);
  if (!podePublicarOficial(tabela)) {
    throw new Error('Somente negociações aprovadas pelo gestor podem ser publicadas na base oficial.');
  }

  const promocaoOficial = await promoverTabelaNegociacaoParaOficialInterno(id, dados);
  const agora = dataISO();

  const atualizada = await aplicarTransicaoGestao(id, {
    tipo: 'PUBLICACAO_OFICIAL',
    status_gestao: 'PUBLICADA_OFICIAL',
    status_aprovacao: 'PUBLICADA',
    publicado_em: agora,
    data_inicio_vigencia: dados.data_inicio_vigencia || tabela.data_inicio_vigencia || null,
    substituir_tabela_anterior: Boolean(dados.substituir_tabela_anterior),
    observacao: texto(dados.observacao) || 'Publicada na base oficial',
    ...dados,
  });

  const resumoAnterior = getResumoSimulacaoSeguro(atualizada);
  const historicoAnterior = getHistoricoRodadas(atualizada);
  const entradaAprovacao = {
    id: `PROMOCAO-${Date.now()}`,
    tipo_registro: 'PROMOCAO_OFICIAL',
    rodada: inteiro(resumoAnterior.rodada_atual || 1) || 1,
    criado_em: agora,
    data_inicio_vigencia: dados.data_inicio_vigencia || null,
    usuario_aprovacao: texto(dados.usuario?.nome || dados.usuario_aprovacao),
    observacao: dados.observacao || '',
    promocao_oficial: promocaoOficial,
  };

  return atualizarTabelaNegociacao(id, {
    status: 'PROMOVIDA PARA OFICIAL',
    incluir_simulacao: false,
    nova_tabela_aprovada_snapshot: promocaoOficial,
    resumo_simulacao: {
      ...resumoAnterior,
      promocao_oficial: promocaoOficial,
      ultima_aprovacao: entradaAprovacao,
      historico_rodadas: historicoAnterior.concat([entradaAprovacao]).slice(-30),
    },
  });
}

export async function garantirNegociadorAoAbrir(id, usuario = {}) {
  if (!id || !usuario?.id) return null;
  const tabela = await obterTabelaNegociacao(id);
  if (texto(tabela.negociador_id) || texto(tabela.negociador_nome)) return tabela;

  return atualizarNegociadorResponsavel(id, {
    negociador_id: texto(usuario.id),
    negociador_nome: texto(usuario.nome),
    observacao: 'Negociador atribuído ao abrir a negociação',
    usuario,
  });
}

export async function atualizarNegociadorResponsavel(id, dados = {}) {
  const tabela = await obterTabelaNegociacao(id);
  const historico = getHistoricoGestao(tabela);
  const evento = montarEventoGestao('ALTERACAO_NEGOCIADOR', tabela, {
    ...dados,
    observacao: texto(dados.observacao) || `Negociador alterado para ${texto(dados.negociador_nome)}`,
  });

  return atualizarTabelaNegociacao(id, {
    negociador_id: texto(dados.negociador_id),
    negociador_nome: texto(dados.negociador_nome),
    historico_gestao: historico.concat([evento]).slice(-100),
  });
}

export async function marcarAprovadaNegociador(id, dados = {}) {
  return aplicarTransicaoGestao(id, {
    tipo: 'APROVACAO_NEGOCIADOR',
    status_gestao: 'APROVADA_NEGOCIADOR',
    status_aprovacao: 'APROVADA_NEGOCIADOR',
    ...dados,
  });
}
