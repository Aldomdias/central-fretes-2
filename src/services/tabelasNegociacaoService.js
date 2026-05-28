import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { salvarSecaoDb } from './freteDatabaseService';
import { converterTabelaNegociacaoParaSimulador } from '../utils/tabelasNegociacaoSimuladorAdapter';

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

  const novo = {
    transportadora: texto(payload.transportadora),
    canal: upper(payload.canal || 'ATACADO'),
    tipo_tabela: upper(payload.tipo_tabela || 'FRACIONADO'),
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

  const { data, error } = await supabase
    .from('tabelas_negociacao').insert(novo).select().single();
  if (error) throw new Error(error.message || 'Erro ao criar tabela em negociação.');
  return data;
}

export async function atualizarTabelaNegociacao(id, payload = {}) {
  const supabase = supabaseOrThrow();

  const atualizacao = {
    transportadora:            payload.transportadora !== undefined ? texto(payload.transportadora) : undefined,
    canal:                     payload.canal !== undefined ? upper(payload.canal) : undefined,
    tipo_tabela:               payload.tipo_tabela !== undefined ? upper(payload.tipo_tabela) : undefined,
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
    .select('*')
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
    .select('resumo_simulacao')
    .eq('id', id)
    .maybeSingle();

  const resumoAnterior = getResumoSimulacaoSeguro(tabelaAtual || {});
  const historicoAnterior = getHistoricoRodadas(tabelaAtual || {});
  const agora = new Date().toISOString();

  const entradaAprovacao = {
    id: `APROVACAO-${Date.now()}`,
    tipo_registro: promocaoOficial ? 'PROMOCAO_OFICIAL' : 'APROVACAO',
    rodada: inteiro(resumoAnterior.rodada_atual || 1) || 1,
    criado_em: agora,
    data_inicio_vigencia: dados.data_inicio_vigencia || null,
    observacao: dados.justificativa_aprovacao || '',
    promocao_oficial: promocaoOficial,
  };

  const payload = {
    status: promocaoOficial ? 'PROMOVIDA PARA OFICIAL' : 'APROVADA',
    data_inicio_vigencia: dados.data_inicio_vigencia || null,
    data_aprovacao: agora,
    justificativa_aprovacao: dados.justificativa_aprovacao || '',
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
    .select('*')
    .eq('incluir_simulacao', true)
    .in('status', ['EM NEGOCIAÇÃO', 'EM TESTE', 'APROVADA'])
    .order('criado_em', { ascending: false });

  if (filtros.tipoTabela) query = query.eq('tipo_tabela', filtros.tipoTabela);
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



// ─── helpers de comparação de base entre rodadas ─────────────────────────────

function montarFingerprintBase(resultado = {}) {
  return {
    ctes_brutos: inteiro(resultado.filtros?.ctesBrutos ?? resultado.ctesBrutos ?? 0),
    ctes_na_malha: inteiro(resultado.filtros?.ctesNaMalha ?? resultado.ctesNaMalha ?? resultado.ctesAnalisados ?? 0),
    ctes_analisados: inteiro(resultado.ctesAnalisados ?? 0),
    frete_realizado: numero(resultado.freteRealizado ?? 0),
    valor_nf: numero(resultado.valorNF ?? 0),
    filtros: {
      inicio: String(resultado.filtros?.inicio ?? ''),
      fim: String(resultado.filtros?.fim ?? ''),
      canal: String(resultado.filtros?.canal ?? ''),
      origem: String(resultado.filtros?.origem ?? ''),
      ufDestino: Array.isArray(resultado.filtros?.ufDestino) ? resultado.filtros.ufDestino : [],
    },
  };
}

function calcularDivergenciaBase(atual = {}, inicial = {}) {
  if (!inicial || !Object.keys(inicial).length) return null;

  const difCtes = inteiro(atual.ctes_na_malha) - inteiro(inicial.ctes_na_malha);
  const difFrete = numero(atual.frete_realizado) - numero(inicial.frete_realizado);
  const difNf = numero(atual.valor_nf) - numero(inicial.valor_nf);
  const divergiu = Math.abs(difCtes) > 0 || Math.abs(difFrete) > 0.01 || Math.abs(difNf) > 0.01;

  return {
    divergiu,
    dif_ctes: difCtes,
    dif_frete_realizado: difFrete,
    dif_valor_nf: difNf,
    base_inicial_ctes: inteiro(inicial.ctes_na_malha),
    base_atual_ctes: inteiro(atual.ctes_na_malha),
    base_inicial_frete: numero(inicial.frete_realizado),
    base_atual_frete: numero(atual.frete_realizado),
  };
}

function calcularIndicadoresGanhasResultado(resultado = {}) {
  const detalhes = Array.isArray(resultado.ctesDetalhes) ? resultado.ctesDetalhes : [];
  const ganhas = detalhes.filter((item) => item && (
    item.statusSelecionada === 'Ganharia' ||
    item.ganhouRealizado === true ||
    numero(item.savingSelecionada || 0) > 0
  ));

  const meses = Math.max(1, numero(resultado.meses || 1));
  const soma = (lista, campo) => lista.reduce((acc, item) => acc + numero(item?.[campo] || 0), 0);

  const ctesGanhas = ganhas.length || inteiro(resultado.ctesGanhariaSelecionada || resultado.ctesCapturadosDeOutras || 0);
  const volumesGanhas = ganhas.length
    ? soma(ganhas, 'volumes')
    : numero(resultado.volumesCapturados || 0);
  const pesoGanhas = ganhas.length ? soma(ganhas, 'peso') : numero(resultado.pesoCapturado || 0);
  const valorNFGanhas = ganhas.length ? soma(ganhas, 'valorNF') : numero(resultado.valorNFCapturado || 0);

  const pedidosMes = meses ? ctesGanhas / meses : ctesGanhas;
  const volumesMes = meses ? volumesGanhas / meses : volumesGanhas;

  return {
    ctesGanhas,
    volumesGanhas,
    pesoGanhas,
    valorNFGanhas,
    pedidosMes,
    pedidosDia: pedidosMes / 22,
    volumesMes,
    volumesDia: volumesMes / 22,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function excluirRegistroRodadaNegociacao(id, registroId) {
  const supabase = supabaseOrThrow();

  if (!id) throw new Error('Negociação inválida para excluir registro.');
  if (!registroId) throw new Error('Registro da rodada inválido para exclusão.');

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

function formatarLimiteFaixaServico(valor) {
  const nValor = numero(valor);
  if (Math.abs(nValor - Math.round(nValor)) < 0.0001) return String(Math.round(nValor));
  return String(nValor).replace('.', ',');
}

function gradeFaixasLaudoServico(resultado = {}) {
  const canal = upper(resultado.filtros?.canal || resultado.canal || 'ATACADO');
  const gradeRecebida = Array.isArray(resultado.gradeFaixasLaudo) ? resultado.gradeFaixasLaudo : [];
  const fallbackB2C = [2, 5, 10, 20, 30, 50, 70, 100, 999999999].map((peso) => ({ peso }));
  const fallbackAtacado = [20, 30, 50, 70, 100, 150, 250, 500, 999999999].map((peso) => ({ peso }));
  const base = gradeRecebida.length ? gradeRecebida : (canal.includes('B2C') ? fallbackB2C : fallbackAtacado);
  return base
    .map((item) => ({
      peso: numero(item.peso || item.limite || item.limite_kg || item.peso_final || item.pesoFinal),
      label: texto(item.label || item.faixa || item.faixaPeso || item.faixa_peso),
    }))
    .filter((item) => item.peso > 0)
    .sort((a, b) => a.peso - b.peso);
}

function faixaB2CLaudoServico(peso, resultado = {}) {
  const p = numero(peso);
  if (!p) return '';
  const grade = gradeFaixasLaudoServico(resultado);
  if (!grade.length) return '';
  let anterior = 0;
  for (const item of grade) {
    if (p <= item.peso) {
      if (item.label) return item.label;
      if (item.peso >= 999999 || item.peso === Infinity) return 'Acima de ' + formatarLimiteFaixaServico(anterior) + ' kg';
      return formatarLimiteFaixaServico(anterior) + ' a ' + formatarLimiteFaixaServico(item.peso) + ' kg';
    }
    anterior = item.peso;
  }
  const ultimo = grade[grade.length - 1]?.peso || anterior;
  return 'Acima de ' + formatarLimiteFaixaServico(ultimo) + ' kg';
}

function pesoFaixaLaudoServico(item = {}) {
  return numero(item.pesoConsiderado || item.peso || item.pesoDeclarado || item.pesoRealizado || item.pesoCubado || item.selecionadaDetalhes?.frete?.pesoConsiderado || item.vencedorDetalhes?.frete?.pesoConsiderado || item.todosResultados?.[0]?.detalhes?.frete?.pesoConsiderado);
}

function cotacaoLaudoServico(item = {}) {
  const rotaResultado = Array.isArray(item.todosResultados)
    ? item.todosResultados.map((r) => r?.detalhes?.frete?.rotaCotacao || r?.detalhes?.frete?.cotacaoComercial || r?.rotaNome).find((v) => texto(v))
    : '';
  const candidatos = [item.rotaCotacao, item.rotaSelecionada, item.rotaVencedora, item.cotacaoComercial, item.selecionadaDetalhes?.frete?.rotaCotacao, item.selecionadaDetalhes?.frete?.cotacaoComercial, item.vencedorDetalhes?.frete?.rotaCotacao, item.vencedorDetalhes?.frete?.cotacaoComercial, rotaResultado, item.cotacao, item.cotacaoFinal, item.faixaCotacao, item.rota, item.nomeRota].map((v) => texto(v)).filter(Boolean);
  const invalida = (v) => {
    const s = String(v || '').toUpperCase().trim();
    if (!s) return true;
    if (s.includes('IBGE')) return true;
    if (/^\d+[.,]?\d*\s*(ATE|ATÉ|A)\s*\d+[.,]?\d*/i.test(s)) return true;
    if (/^ACIMA DE\s*\d+/i.test(s)) return true;
    return false;
  };
  const bruto = candidatos.find((v) => !invalida(v)) || texto(item.destino || item.cidadeDestino || 'Destino');
  const partes = bruto.split('|').map((p) => texto(p)).filter(Boolean);
  const base = partes[0] || bruto;
  return base.replace(/ [0-9][0-9.,]* *A *[0-9][0-9.,]* *KG.*$/i, '').trim() || base;
}

function montarAnaliseFaixasB2CLaudoServico(resultado = {}) {
  const detalhes = Array.isArray(resultado.ctesDetalhes) ? resultado.ctesDetalhes : [];
  const mapa = new Map();
  detalhes.forEach((item) => {
    const peso = pesoFaixaLaudoServico(item);
    const faixa = faixaB2CLaudoServico(peso, resultado);
    if (!faixa) return;
    const origem = texto(item.origem || item.cidadeOrigem || resultado.filtros?.origem || 'Origem');
    const destino = texto(item.destino || item.cidadeDestino || 'Destino');
    const ufDestino = upper(item.ufDestino || item.uf || item.estadoDestino || '');
    const rota = cotacaoLaudoServico(item);
    const chave = [origem, ufDestino, rota, faixa].map(upper).join('|');
    if (!mapa.has(chave)) mapa.set(chave, { chave, origem, destino: '', destinoExemplo: destino, ufDestino, rota, cotacao: rota, faixa, ctesAnalisados: 0, ctesGanhos: 0, ctesPerdidos: 0, volumes: 0, pesoTotal: 0, faturamentoPotencial: 0, faturamentoCapturado: 0, faturamentoNaoCapturado: 0, reducaoSoma: 0, reducaoQtd: 0 });
    const acc = mapa.get(chave);
    const status = upper(item.statusSelecionada);
    const ganhou = status === 'GANHARIA' || item.ganhouRealizado === true || numero(item.savingSelecionada) > 0;
    const perdeu = status === 'PERDERIA' || (!ganhou && numero(item.freteSelecionada) > 0);
    acc.ctesAnalisados += 1;
    if (ganhou) acc.ctesGanhos += 1;
    if (perdeu) acc.ctesPerdidos += 1;
    acc.volumes += numero(item.volumes || item.qtdVolumes);
    acc.pesoTotal += peso;
    acc.faturamentoPotencial += numero(item.freteRealizado);
    if (ganhou) acc.faturamentoCapturado += numero(item.freteRealizado);
    if (perdeu) acc.faturamentoNaoCapturado += numero(item.freteRealizado);
    if (perdeu && numero(item.reducaoNecessaria)) { acc.reducaoSoma += numero(item.reducaoNecessaria); acc.reducaoQtd += 1; }
  });
  return Array.from(mapa.values()).map((x) => {
    const base = x.ctesGanhos + x.ctesPerdidos || x.ctesAnalisados;
    const aderencia = base ? (x.ctesGanhos / base) * 100 : 0;
    const ajusteMedio = x.reducaoQtd ? x.reducaoSoma / x.reducaoQtd : 0;
    let prioridade = 'BAIXA';
    if (x.faturamentoNaoCapturado >= 50000 || x.ctesPerdidos >= 100 || ajusteMedio >= 15) prioridade = 'ALTA';
    else if (x.faturamentoNaoCapturado >= 15000 || x.ctesPerdidos >= 30 || ajusteMedio >= 8) prioridade = 'MÉDIA';
    return { ...x, aderencia, ajusteMedio, prioridade };
  }).sort((a,b) => numero(b.faturamentoNaoCapturado) - numero(a.faturamentoNaoCapturado) || numero(b.ctesPerdidos) - numero(a.ctesPerdidos));
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

  const fingerprintAtual = montarFingerprintBase(resultado);
  const baseInicialExistente = tabelaAtual.base_comparacao_inicial || null;
  const divergenciaBase = calcularDivergenciaBase(fingerprintAtual, baseInicialExistente);
  const naoCalculadosPorMotivo = Array.isArray(resultado.naoCalculadosPorMotivo)
    ? resultado.naoCalculadosPorMotivo
    : [];
  const indicadoresGanhas = calcularIndicadoresGanhasResultado(resultado);
  const deveGravarBaseInicial = !baseInicialExistente;
  const baseInicialParaGravar = deveGravarBaseInicial
    ? { ...fingerprintAtual, registrada_em: agora, rodada: rodadaAtual }
    : undefined;

  const resumoResultado = {
    salvo_em: agora,
    rodada: rodadaAtual,
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

    rotas: (resultado.rotas || []).slice(0, 100),
    rotasGanhasDestaque: (resultado.rotasGanhasDestaque || []).slice(0, 20),
    rotasPerdidasDestaque: (resultado.rotasPerdidasDestaque || []).slice(0, 20),
    resumoPorEstado: (resultado.resumoPorEstado || []).slice(0, 27),
    estadosGanhadoresDestaque: (resultado.estadosGanhadoresDestaque || []).slice(0, 10),
    estadosPerdidosDestaque: (resultado.estadosPerdidosDestaque || []).slice(0, 10),
    transportadorasPerdaDestaque: (resultado.transportadorasPerdaDestaque || []).slice(0, 10),
    laudo: (resultado.laudo || []).slice(0, 20),
    laudosEmail: resultado.laudosEmail || null,
    laudos: resultado.laudos || null,
    pareto80Volume: resultado.pareto80Volume || null,
    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 10000),
    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 10000),
    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 10000),
    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 10000),
    analiseFaixasB2C: (resultado.analiseFaixasB2C || montarAnaliseFaixasB2CLaudoServico(resultado)).slice(0, 10000),
    diagnostico: resultado.diagnostico || {},
    ctesDetalhes: (resultado.ctesDetalhes || []).slice(0, 3000).map((item) => ({
      cte: item.cte || '',
      origem: item.origem || '',
      ufOrigem: item.ufOrigem || '',
      destino: item.destino || '',
      ufDestino: item.ufDestino || '',
      ibgeDestino: item.ibgeDestino || item.codigoIbgeDestino || item.ibge_destino || item.codIbgeDestino || '',
      mesorregiaoDestino: item.mesorregiaoDestino || item.mesorregiao || item.mesoRegiaoDestino || item.mesoRegiao || item.meso_regiao || item.microrregiao || item.regiaoDestino || '',
      peso: item.peso || 0,
      valorNF: item.valorNF || item.valorNf || item.valor_nf || item.valorNota || item.nf || 0,
      percentualFreteRealizado: item.percentualFreteRealizado || 0,
      percentualFreteSelecionada: item.percentualFreteSelecionada || 0,
      percentualFreteVencedor: item.percentualFreteVencedor || 0,
      volumes: item.volumes || 0,
      freteRealizado: item.freteRealizado || 0,
      freteSelecionada: item.freteSelecionada || 0,
      statusSelecionada: item.statusSelecionada || '',
      ganhouRealizado: item.ganhouRealizado || false,
      savingSelecionada: item.savingSelecionada || 0,
      diferencaParaVencedor: item.diferencaParaVencedor || 0,
      reducaoNecessaria: item.reducaoNecessaria || 0,
      nomeRota: item.nomeRota || item.nomeRotaCotacao || item.cotacaoComercial || item.rotaCotacao || '',
      faixaPeso: item.faixaPeso || item.faixaPesoCotacao || '',
    })),
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
      pedidos_dia: numero(indicadoresGanhas.pedidosDia || resultado.volumetria_dia || resultado.cargasDia || 0),
      pedidos_ganhos_dia: numero(indicadoresGanhas.pedidosDia || 0),
      pedidos_ganhos_mes: numero(indicadoresGanhas.pedidosMes || 0),
      volumes_dia: numero(indicadoresGanhas.volumesDia || resultado.volumesDia || 0),
      volumes_ganhos_dia: numero(indicadoresGanhas.volumesDia || 0),
      volumes_ganhos_mes: numero(indicadoresGanhas.volumesMes || 0),
      volumes_capturados: numero(indicadoresGanhas.volumesGanhas || 0),
      percentual_frete_realizado: numero(resultado.percentualFreteRealizado ?? 0),
      percentual_frete_simulado: numero(resultado.percentual_frete_projetado ?? resultado.percentualFreteTabelaGanharia ?? resultado.percentualFreteSelecionada ?? 0),
      rotas_com_ganho: inteiro(resultado.qtdRotasComGanhoSelecionada ?? 0),
      rotas_ganhas: inteiro(resultado.qtdRotasGanhasSelecionada ?? 0),
      rotas_parciais: inteiro(resultado.qtdRotasParciaisSelecionada ?? 0),
      frete_capturado: numero(resultado.freteCapturadoRealizado ?? 0),
      ctes_capturados: inteiro(indicadoresGanhas.ctesGanhas || resultado.ctesCapturadosDeOutras || 0),
    },
    base: fingerprintAtual,
    divergencia_base: divergenciaBase,
    nao_calculados_por_motivo: naoCalculadosPorMotivo,
  };

  const historicoAtualizado = historicoAnterior.concat([entradaRodada]).slice(-30);

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
      indicadoresGanhas.pedidosDia ??
      indicadoresGanhas.pedidosDia ??
      indicadoresGanhas.pedidosDia ??
      indicadoresGanhas.pedidosDia ??
      indicadoresGanhas.pedidosDia ??
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

    incluir_simulacao: false,

    // base de comparação (só grava na primeira simulação)
    ...(baseInicialParaGravar ? { base_comparacao_inicial: baseInicialParaGravar } : {}),

    resumo_simulacao: {
      ...resumoAnterior,
      ...resumoResultado,
      rodada_atual: rodadaAtual,
      ultima_simulacao_em: agora,
      ultima_simulacao: entradaRodada,
      historico_rodadas: historicoAtualizado,
    },
  };

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message || 'Erro ao salvar resultado da simulação na negociação.');
  }

  return data;
}
