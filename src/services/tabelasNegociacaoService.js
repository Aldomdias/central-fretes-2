import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

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

function supabaseOrThrow() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado.');
  }
  return getSupabaseClient();
}

function texto(value) {
  return String(value || '').trim();
}

function upper(value) {
  return texto(value).toUpperCase();
}

function numero(value) {
  if (value === null || value === undefined || value === '') return 0;
  const limpo = String(value)
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

function inteiro(value) {
  const n = parseInt(numero(value), 10);
  return Number.isFinite(n) ? n : 0;
}

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
    .from('tabelas_negociacao')
    .select('*')
    .eq('id', id)
    .single();

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
  };

  if (!novo.transportadora) throw new Error('Informe a transportadora.');
  if (!TIPOS_TABELA_NEGOCIACAO.includes(novo.tipo_tabela)) throw new Error('Tipo de tabela inválido.');

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .insert(novo)
    .select()
    .single();

  if (error) throw new Error(error.message || 'Erro ao criar tabela em negociação.');
  return data;
}

export async function atualizarTabelaNegociacao(id, payload = {}) {
  const supabase = supabaseOrThrow();

  const atualizacao = {
    transportadora: payload.transportadora !== undefined ? texto(payload.transportadora) : undefined,
    canal: payload.canal !== undefined ? upper(payload.canal) : undefined,
    tipo_tabela: payload.tipo_tabela !== undefined ? upper(payload.tipo_tabela) : undefined,
    status: payload.status !== undefined ? payload.status : undefined,
    descricao: payload.descricao !== undefined ? texto(payload.descricao) : undefined,
    regiao: payload.regiao !== undefined ? texto(payload.regiao) : undefined,
    origem: payload.origem !== undefined ? texto(payload.origem) : undefined,
    uf_origem: payload.uf_origem !== undefined ? upper(payload.uf_origem) : undefined,
    uf_destino: payload.uf_destino !== undefined ? upper(payload.uf_destino) : undefined,
    data_recebimento: payload.data_recebimento !== undefined ? payload.data_recebimento || null : undefined,
    data_inicio_prevista: payload.data_inicio_prevista !== undefined ? payload.data_inicio_prevista || null : undefined,
    data_inicio_vigencia: payload.data_inicio_vigencia !== undefined ? payload.data_inicio_vigencia || null : undefined,
    incluir_simulacao: payload.incluir_simulacao !== undefined ? Boolean(payload.incluir_simulacao) : undefined,
    substituir_tabela_anterior: payload.substituir_tabela_anterior !== undefined ? Boolean(payload.substituir_tabela_anterior) : undefined,
    observacao: payload.observacao !== undefined ? texto(payload.observacao) : undefined,
    justificativa_aprovacao: payload.justificativa_aprovacao !== undefined ? texto(payload.justificativa_aprovacao) : undefined,
    saving_projetado: payload.saving_projetado !== undefined ? numero(payload.saving_projetado) : undefined,
    aderencia_projetada: payload.aderencia_projetada !== undefined ? numero(payload.aderencia_projetada) : undefined,
  };

  Object.keys(atualizacao).forEach((key) => {
    if (atualizacao[key] === undefined) delete atualizacao[key];
  });

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update(atualizacao)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message || 'Erro ao atualizar tabela em negociação.');
  return data;
}

export async function excluirTabelaNegociacao(id) {
  const supabase = supabaseOrThrow();

  const { error } = await supabase
    .from('tabelas_negociacao')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message || 'Erro ao excluir tabela em negociação.');
  return true;
}

export async function listarItensTabelaNegociacao(tabelaId) {
  const supabase = supabaseOrThrow();

  const { data, error } = await supabase
    .from('tabelas_negociacao_itens')
    .select('*')
    .eq('tabela_negociacao_id', tabelaId)
    .order('cidade_origem', { ascending: true })
    .order('uf_destino', { ascending: true })
    .order('cidade_destino', { ascending: true });

  if (error) throw new Error(error.message || 'Erro ao listar itens da tabela.');
  return data || [];
}

export async function substituirItensTabelaNegociacao(tabela, itens = []) {
  const supabase = supabaseOrThrow();

  if (!tabela?.id) throw new Error('Tabela de negociação inválida.');

  const linhas = (itens || []).map((item) => ({
    tabela_negociacao_id: tabela.id,
    transportadora: tabela.transportadora,
    canal: tabela.canal,
    tipo_tabela: tabela.tipo_tabela,

    cidade_origem: texto(item.cidade_origem || item.origem),
    uf_origem: upper(item.uf_origem),
    ibge_origem: texto(item.ibge_origem),

    cidade_destino: texto(item.cidade_destino || item.destino),
    uf_destino: upper(item.uf_destino),
    ibge_destino: texto(item.ibge_destino),

    faixa_peso: texto(item.faixa_peso),
    peso_inicial: numero(item.peso_inicial),
    peso_final: numero(item.peso_final),

    frete_minimo: numero(item.frete_minimo),
    taxa_aplicada: numero(item.taxa_aplicada),
    frete_percentual: numero(item.frete_percentual),
    excesso_kg: numero(item.excesso_kg),
    valor_excedente: numero(item.valor_excedente),

    prazo: inteiro(item.prazo),

    tipo_veiculo: texto(item.tipo_veiculo),
    valor_lotacao: numero(item.valor_lotacao),
    km: numero(item.km),
    icms: numero(item.icms),

    gris: numero(item.gris),
    advalorem: numero(item.advalorem),
    pedagio: numero(item.pedagio),
    tas: numero(item.tas),
    tda: numero(item.tda),
    tde: numero(item.tde),
    outras_taxas: numero(item.outras_taxas),

    origem_importacao: texto(item.origem_importacao),
    observacao: texto(item.observacao),
    dados_originais: item.dados_originais ?? item,
  }));

  const { error: deleteError } = await supabase
    .from('tabelas_negociacao_itens')
    .delete()
    .eq('tabela_negociacao_id', tabela.id);

  if (deleteError) throw new Error(deleteError.message || 'Erro ao limpar itens antigos.');

  if (!linhas.length) return [];

  const { data, error } = await supabase
    .from('tabelas_negociacao_itens')
    .insert(linhas)
    .select();

  if (error) throw new Error(error.message || 'Erro ao salvar itens da tabela.');
  return data || [];
}

export async function alternarTabelaNegociacaoNaSimulacao(id, incluir) {
  return atualizarTabelaNegociacao(id, { incluir_simulacao: incluir });
}

export async function aprovarTabelaNegociacao(id, dados = {}) {
  const payload = {
    status: 'APROVADA',
    data_inicio_vigencia: dados.data_inicio_vigencia || null,
    data_aprovacao: new Date().toISOString(),
    justificativa_aprovacao: dados.justificativa_aprovacao || '',
    substituir_tabela_anterior: Boolean(dados.substituir_tabela_anterior),
  };

  const supabase = supabaseOrThrow();

  const { data, error } = await supabase
    .from('tabelas_negociacao')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message || 'Erro ao aprovar tabela.');
  return data;
}

export async function buscarTabelasNegociacaoParaSimulacao(filtros = {}) {
  const supabase = supabaseOrThrow();

  let query = supabase
    .from('tabelas_negociacao')
    .select(`
      *,
      tabelas_negociacao_itens (*)
    `)
    .eq('incluir_simulacao', true)
    .in('status', ['EM NEGOCIAÇÃO', 'EM TESTE', 'APROVADA']);

  if (filtros.tipoTabela) query = query.eq('tipo_tabela', filtros.tipoTabela);
  if (filtros.canal) query = query.eq('canal', filtros.canal);

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Erro ao buscar tabelas em negociação para simulação.');

  return data || [];
}