import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'descontos_obtidos_sap';
const LOTE = 500;
const PAGINA_CONSULTA = 1000; // limite padrão de linhas por resposta do PostgREST

function exigirClient() {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const client = getSupabaseClient();
  if (!client) throw new Error('Não foi possível obter o cliente Supabase.');
  return client;
}

// O PostgREST (API do Supabase) trunca a resposta em 1000 linhas por padrão,
// mesmo pedindo .limit() maior — por isso pagina com .range() até a página
// vir incompleta.
async function buscarTodasPaginas(montarQuery) {
  const todos = [];
  let pagina = 0;

  for (;;) {
    const inicio = pagina * PAGINA_CONSULTA;
    const fim = inicio + PAGINA_CONSULTA - 1;
    const { data, error } = await montarQuery().range(inicio, fim);
    if (error) throw error;

    todos.push(...(data || []));
    if (!data || data.length < PAGINA_CONSULTA) break;
    pagina += 1;
  }

  return todos;
}

export async function importarDescontosObtidos({ registros, arquivoOrigem, onProgress }) {
  const client = exigirClient();

  const linhas = registros.map((registro) => ({
    ano: registro.ano,
    mes: registro.mes,
    data_lancamento: registro.dataLancamento,
    conta_razao: registro.contaRazao,
    regra_aplicada: registro.regraAplicada,
    transportadora_nome: registro.transportadoraNome,
    transportadora_codigo: registro.transportadoraCodigo,
    empresa: registro.empresa,
    centro_lucro: registro.centroLucro,
    valor: registro.valor,
    lancamento_contabil: registro.lancamentoContabil,
    texto_partida: registro.textoPartida,
    arquivo_origem: arquivoOrigem,
    linha_hash: registro.linhaHash,
  }));

  let inseridos = 0;
  let duplicados = 0;

  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    const { data, error } = await client
      .from(TABELA)
      .upsert(lote, { onConflict: 'linha_hash', ignoreDuplicates: true })
      .select('id');

    if (error) throw new Error(`Erro ao gravar descontos obtidos: ${error.message}`);

    inseridos += data?.length || 0;
    duplicados += lote.length - (data?.length || 0);

    onProgress?.({
      enviados: Math.min(i + LOTE, linhas.length),
      total: linhas.length,
    });
  }

  return { totalLinhas: linhas.length, inseridos, duplicados };
}

export async function listarResumoDescontosObtidos({ ano, mesInicio, mesFim } = {}) {
  const client = exigirClient();

  try {
    return await buscarTodasPaginas(() => {
      let query = client
        .from(TABELA)
        .select('ano, mes, data_lancamento, transportadora_nome, valor, regra_aplicada')
        .order('id', { ascending: true });

      if (ano) query = query.eq('ano', ano);
      if (mesInicio) query = query.gte('mes', mesInicio);
      if (mesFim) query = query.lte('mes', mesFim);

      return query;
    });
  } catch (error) {
    throw new Error(`Erro ao consultar descontos obtidos: ${error.message}`);
  }
}

export async function listarLancamentosDescontosObtidos({ ano, mes, transportadoraNome }) {
  const client = exigirClient();

  try {
    return await buscarTodasPaginas(() => {
      let query = client
        .from(TABELA)
        .select('data_lancamento, transportadora_nome, valor, regra_aplicada, empresa, centro_lucro, lancamento_contabil, texto_partida, arquivo_origem')
        .order('data_lancamento', { ascending: false });

      if (ano) query = query.eq('ano', ano);
      if (mes) query = query.eq('mes', mes);
      if (transportadoraNome) query = query.eq('transportadora_nome', transportadoraNome);

      return query;
    });
  } catch (error) {
    throw new Error(`Erro ao consultar lançamentos: ${error.message}`);
  }
}

export async function listarAnosDisponiveis() {
  const client = exigirClient();

  let data;
  try {
    data = await buscarTodasPaginas(() => client.from(TABELA).select('ano').order('id', { ascending: true }));
  } catch (error) {
    throw new Error(`Erro ao consultar anos disponíveis: ${error.message}`);
  }

  return Array.from(new Set(data.map((r) => r.ano))).sort((a, b) => b - a);
}

export async function obterUltimaAtualizacaoDescontosObtidos() {
  const client = exigirClient();

  const { data, error } = await client
    .from(TABELA)
    .select('criado_em')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Erro ao consultar a última atualização: ${error.message}`);
  return data?.criado_em || null;
}

// Histórico de qual auditor era responsável por cada transportadora, em cada
// data (auditoria_carteiras_historico é populado pela tela de Ferramentas/
// Transportadoras ao atribuir carteira). Usado para atribuir cada lançamento
// de desconto ao auditor que era dono da transportadora naquela data.
export async function listarHistoricoCarteirasTodas() {
  const client = exigirClient();

  try {
    return await buscarTodasPaginas(() => client
      .from('auditoria_carteiras_historico')
      .select('transportadora, auditor_nome, atribuido_em')
      .order('atribuido_em', { ascending: true }));
  } catch (error) {
    throw new Error(`Erro ao consultar histórico de carteiras: ${error.message}`);
  }
}

// Atribuição atual de auditor por transportadora (tela de Transportadoras/
// Ferramentas). É a fonte confiável — o histórico acima às vezes não grava
// (falha silenciosa documentada em auditoriaFretesService.js), então nem
// toda transportadora com carteira aparece lá.
export async function listarCarteirasAtuais() {
  const client = exigirClient();

  try {
    return await buscarTodasPaginas(() => client
      .from('auditoria_carteiras')
      .select('transportadora, auditor_nome, ativo, atribuido_em')
      .eq('ativo', true));
  } catch (error) {
    throw new Error(`Erro ao consultar carteiras atuais: ${error.message}`);
  }
}

export async function listarMesesImportados() {
  const client = exigirClient();

  try {
    return await buscarTodasPaginas(() => client.from(TABELA).select('ano, mes, arquivo_origem, valor').order('id', { ascending: true }));
  } catch (error) {
    throw new Error(`Erro ao consultar meses importados: ${error.message}`);
  }
}
