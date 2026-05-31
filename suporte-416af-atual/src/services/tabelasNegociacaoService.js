import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { salvarSecaoDb } from './freteDatabaseService';
import { converterTabelaNegociacaoParaSimulador } from '../utils/tabelasNegociacaoSimuladorAdapter';
import { carregarCargasLotacaoSupabase } from './lotacaoSupabaseService';
import { normalizarTexto as normalizarTextoLotacao } from '../utils/lotacaoTables';

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
  const resumo = tabela.resumo_simulacao;
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

  return {
    tabela_negociacao_id: tabela.id,
    transportadora: tabela.transportadora,
    canal: tabela.canal,
    tipo_tabela: tabela.tipo_tabela,

    cidade_origem:    texto(item.cidade_origem || item.origem),
    uf_origem:        upper(item.uf_origem),
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
      .range(inicio, inicio + pageSize - 1);

    if (error) throw new Error(error.message || 'Erro ao listar itens atuais da negociação.');

    const lote = data || [];
    todos = todos.concat(lote);
    if (lote.length < pageSize) break;
    inicio += pageSize;
  }

  return todos;
}

// ─── TABELAS NEGOCIAÇÃO ───────────────────────────────────────────────────────

export async function listarTabelasNegociacao(filtros = {}) {
  const supabase = supabaseOrThrow();
  let query = supabase
    .from('tabelas_negociacao')
    .select('*')
    .order('criado_em', { ascending: false });

  if (filtros.status) query = query.eq('status', filtros.status);
  if (filtros.tipoTabela) query = query.eq('tipo_tabela', filtros.tipoTabela);
  if (filtros.tipoNegociacao) query = query.eq('tipo_negociacao', filtros.tipoNegociacao);
  if (filtros.canal) query = query.eq('canal', filtros.canal);
  if (filtros.transportadora) query = query.ilike('transportadora', `%${filtros.transportadora}%`);
  if (filtros.somenteSimulacao) query = query.eq('incluir_simulacao', true);

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Erro ao listar tabelas em negociação.');
  return data || [];
}

export async function obterTabelaNegociacao(id) {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase
    .from('tabelas_negociacao').select('*').eq('id', id).single();
  if (error) throw new Error(error.message || 'Erro ao buscar tabela em negociação.');
  return data;
}

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
  };

  if (!novo.transportadora) throw new Error('Informe a transportadora.');
  if (!TIPOS_TABELA_NEGOCIACAO.includes(novo.tipo_tabela)) throw new Error('Tipo de tabela inválido.');
  if (!TIPOS_NEGOCIACAO_VALUES.includes(novo.tipo_negociacao)) throw new Error('Tipo de negociação inválido.');

  const { data, error } = await supabase
    .from('tabelas_negociacao').insert(novo).select().single();
  if (error) throw new Error(error.message || 'Erro ao criar tabela em negociação.');
  return data;
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
  };

  Object.keys(atualizacao).forEach((key) => {
    if (atualizacao[key] === undefined) delete atualizacao[key];
  });

  const { data, error } = await supabase
    .from('tabelas_negociacao').update(atualizacao).eq('id', id).select().single();
  if (error) throw new Error(error.message || 'Erro ao atualizar tabela em negociação.');
  return data;
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

  const itensEntrada = Array.isArray(itens) ? itens : [];
  const modo = opcoes.modo || 'porTipo';

  if (!itensEntrada.length && !opcoes.limparQuandoVazio) {
    return listarItensTabelaNegociacao(tabela.id);
  }

  const itensAtuais = await listarTodosItensTabelaNegociacao(tabela.id);
  const tiposEntrada = [...new Set(itensEntrada.map(normalizarTipoItem))];
  const substituirTudo = modo === 'total' || tiposEntrada.length > 1 || opcoes.substituirTudo === true;
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

  const { error: deleteError } = await supabase
    .from('tabelas_negociacao_itens').delete().eq('tabela_negociacao_id', tabela.id);
  if (deleteError) throw new Error(deleteError.message || 'Erro ao limpar itens antigos.');

  let salvos = [];

  if (linhas.length) {
    const pageSize = 1000;
    for (let i = 0; i < linhas.length; i += pageSize) {
      const lote = linhas.slice(i, i + pageSize);
      const { data, error } = await supabase
        .from('tabelas_negociacao_itens').insert(lote).select();
      if (error) throw new Error(error.message || 'Erro ao salvar itens da tabela.');
      salvos = salvos.concat(data || []);
    }
  }

  const resumoAtual = getResumoSimulacaoSeguro(tabela);
  const historico = getHistoricoRodadas(tabela);
  const totaisSalvos = resumirItensPorTipo(salvos);
  const totaisImportados = resumirItensPorTipo(itensEntrada);
  const origensDetectadas = resumirOrigensItens(salvos);
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
  };

  await supabase
    .from('tabelas_negociacao')
    .update({ resumo_simulacao: resumoAtualizado })
    .eq('id', tabela.id);

  return salvos;
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

  if (dados.promover_para_oficial || dados.promoverParaOficial) {
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

export async function buscarTabelasNegociacaoParaSimulacao(filtros = {}) {
  const supabase = supabaseOrThrow();

  // Não usar select aninhado com todos os itens aqui.
  // Quando a negociação tem mais de 1000 rotas/fretes, o Supabase pode demorar muito
  // ou devolver dados incompletos. Primeiro buscamos só as capas das negociações e,
  // depois, carregamos itens/taxas paginados por tabela.
  let query = supabase
    .from('tabelas_negociacao')
    .select('id,transportadora,canal,tipo_tabela,tipo_negociacao,status,descricao,regiao,origem,uf_origem,uf_destino,data_recebimento,data_inicio_prevista,data_inicio_vigencia,incluir_simulacao,observacao,origem_importacao,generalidades,criado_em,atualizado_em,saving_projetado,aderencia_projetada,faturamento_projetado,impacto_projetado,percentual_frete_projetado,volumetria_dia,ctes_analisados,ctes_atendidos,rotas_sem_cobertura,substituir_tabela_anterior,tabela_base_id,transportadora_base_nome,percentual_medio_impacto')
    .eq('incluir_simulacao', true)
    .in('status', ['EM NEGOCIAÇÃO', 'EM TESTE', 'APROVADA'])
    .order('criado_em', { ascending: false });

  if (filtros.tipoTabela) query = query.eq('tipo_tabela', filtros.tipoTabela);
  if (filtros.tipoNegociacao) query = query.eq('tipo_negociacao', filtros.tipoNegociacao);
  if (filtros.canal) query = query.eq('canal', filtros.canal);

  const { data: tabelas, error } = await query;
  if (error) throw new Error(error.message || 'Erro ao buscar tabelas para simulação.');

  const lista = tabelas || [];
  const completas = [];

  for (const tabela of lista) {
    const itens = await listarTodosItensTabelaNegociacao(tabela.id);
    const taxasDestino = await listarTodasTaxasDestinoTabela(tabela.id);
    completas.push({
      ...tabela,
      tabelas_negociacao_itens: itens,
      tabelas_negociacao_taxas_destino: taxasDestino,
    });
  }

  return completas;
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

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

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
    return inteiro(item?.rodada || 0) !== rodadaAlvo;
  });

  if (historicoAtualizado.length === historicoAnterior.length) {
    throw new Error('Nenhum registro encontrado para esta rodada.');
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

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

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
    const importados = item?.itens_importados || {};
    const salvos = item?.itens_salvos_apos_importacao || {};
    const totalItens =
      inteiro(importados.total || 0) +
      inteiro(importados.rotas || 0) +
      inteiro(importados.cotacoes || 0) +
      inteiro(salvos.total || 0) +
      inteiro(salvos.rotas || 0) +
      inteiro(salvos.cotacoes || 0);

    const ehRegistroVazio = tipoRegistro !== 'SIMULACAO' && totalItens === 0;
    return !(mesmaRodada && ehRegistroVazio);
  });

  const historicoAtualizado = historicoSemRegistroVazioDaRodada.concat([entradaRodada]).slice(-12);

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

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update(payload)
    .eq('id', id)
    .select('id,transportadora,canal,status,resumo_simulacao')
    .single();

  if (error) {
    throw new Error(error.message || 'Erro ao salvar resultado da simulação na negociação.');
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
