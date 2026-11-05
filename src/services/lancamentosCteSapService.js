import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { chaveCasamentoCte, cnpj14 } from '../utils/lancamentosCteSap';

const TABELA = 'ctes_lancamentos_sap';
const PAGINA = 1000;

function tabelaAusente(mensagem = '') {
  return /relation .* does not exist|could not find the table|schema cache|42P01|PGRST205/i.test(String(mensagem));
}

const AVISO_MIGRATION = 'Tabela ctes_lancamentos_sap nao existe: aplique a migration supabase/migrations/20261105_002_ctes_lancamentos_sap.sql.';

// Grava as linhas de CT-e do relatorio SAP. Reimportar nao duplica (chave unica).
export async function salvarLancamentosCteSap(linhas = [], onProgress) {
  if (!isSupabaseConfigured() || !linhas.length) return { enviadas: 0 };
  const client = getSupabaseClient();
  for (let inicio = 0; inicio < linhas.length; inicio += PAGINA) {
    const { error } = await client.from(TABELA).upsert(linhas.slice(inicio, inicio + PAGINA), { onConflict: 'chave', ignoreDuplicates: true });
    if (error) {
      if (tabelaAusente(error.message)) return { enviadas: 0, erro: AVISO_MIGRATION };
      throw new Error(`Erro ao salvar lancamentos de CT-e: ${error.message}`);
    }
    onProgress?.({ carregados: Math.min(inicio + PAGINA, linhas.length), total: linhas.length });
  }
  return { enviadas: linhas.length };
}

function intervaloCompetencia(competencia) {
  const [ano, mes] = competencia.split('-').map(Number);
  const proximo = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
  return { inicio: `${competencia}-01`, fim: `${proximo}-01` };
}

async function paginarPorId(montar) {
  const todos = [];
  let ultimo = null;
  for (;;) {
    let q = montar().order('id').limit(PAGINA);
    if (ultimo) q = q.gt('id', ultimo);
    const { data, error } = await q;
    if (error) throw error;
    todos.push(...(data || []));
    if ((data || []).length < PAGINA) break;
    ultimo = data[data.length - 1].id;
  }
  return todos;
}

// CT-es emitidos na competencia (base realizado_local_ctes).
export async function carregarCtesCompetencia(competencia, onProgress) {
  const client = getSupabaseClient();
  const { inicio, fim } = intervaloCompetencia(competencia);
  const todos = [];
  let ultimo = null;
  for (;;) {
    let q = client.from('realizado_local_ctes')
      .select('id,chave_cte,numero_cte,cnpj_transportadora,transportadora,valor_cte,data_emissao,canal,uf_origem,cidade_origem,uf_destino,cidade_destino')
      .gte('data_emissao', inicio).lt('data_emissao', fim)
      .order('id').limit(PAGINA);
    if (ultimo) q = q.gt('id', ultimo);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao ler CT-es da competencia: ${error.message}`);
    todos.push(...(data || []));
    onProgress?.(`Lendo CT-es emitidos: ${todos.length.toLocaleString('pt-BR')}`);
    if ((data || []).length < PAGINA) break;
    ultimo = data[data.length - 1].id;
  }
  return todos;
}

// Linhas SAP dos emitentes informados lancadas a partir do inicio da competencia
// (CT-e nao e' lancado antes de ser emitido). Indexadas pela chave de casamento.
export async function carregarLancamentosPorCnpj(cnpjs = [], competencia, onProgress) {
  const client = getSupabaseClient();
  const { inicio } = intervaloCompetencia(competencia);
  const lista = [...new Set(cnpjs.map(cnpj14).filter(Boolean))];
  const porChave = new Map();
  let total = 0;
  const LOTE = 40;
  for (let i = 0; i < lista.length; i += LOTE) {
    const chunk = lista.slice(i, i + LOTE);
    let linhas;
    try {
      linhas = await paginarPorId(() => client.from(TABELA)
        .select('id,cnpj_emitente,numero_cte,serie_cte,lancamento_contabil,data_lancamento,montante')
        .in('cnpj_emitente', chunk).gte('data_lancamento', inicio));
    } catch (error) {
      if (tabelaAusente(error.message)) throw new Error(AVISO_MIGRATION);
      throw new Error(`Erro ao ler lancamentos de CT-e: ${error.message}`);
    }
    for (const l of linhas) {
      const k = chaveCasamentoCte({ cnpj: l.cnpj_emitente, numero: l.numero_cte, serie: l.serie_cte });
      if (!porChave.has(k)) porChave.set(k, []);
      porChave.get(k).push(l);
    }
    total += linhas.length;
    onProgress?.(`Lendo lancamentos SAP: ${total.toLocaleString('pt-BR')} (${Math.min(i + LOTE, lista.length)}/${lista.length} transportadoras)`);
  }
  return porChave;
}

// Para CT-es sem lancamento proprio: fatura em que o CT-e esta e a data do
// primeiro lancamento dessa fatura no SAP (financeiro_pagamentos).
export async function carregarFaturasLancadasDosCtes(chavesCte = [], onProgress) {
  const client = getSupabaseClient();
  const chaves = [...new Set(chavesCte.map((c) => String(c || '').replace(/\D/g, '')).filter((c) => c.length === 44))];
  const faturaDaChave = new Map();
  const LOTE = 150;
  for (let i = 0; i < chaves.length; i += LOTE) {
    const { data, error } = await client.from('fatura_detalhes')
      .select('chave_cte,fatura_id,numero_fatura,excluido_da_versao')
      .in('chave_cte', chaves.slice(i, i + LOTE));
    if (error) throw new Error(`Erro ao ler CT-es das faturas: ${error.message}`);
    for (const d of data || []) {
      if (d.excluido_da_versao === true || !d.fatura_id) continue;
      faturaDaChave.set(String(d.chave_cte).replace(/\D/g, ''), d);
    }
    onProgress?.(`Procurando CT-es sem lancamento nas faturas: ${Math.min(i + LOTE, chaves.length).toLocaleString('pt-BR')}/${chaves.length.toLocaleString('pt-BR')}`);
  }
  const faturaIds = [...new Set([...faturaDaChave.values()].map((d) => d.fatura_id))];
  const lancamentoDaFatura = new Map();
  for (let i = 0; i < faturaIds.length; i += LOTE) {
    const { data, error } = await client.from('financeiro_pagamentos')
      .select('fatura_id,data_lancamento,data_pagamento,lancamento_contabil')
      .in('fatura_id', faturaIds.slice(i, i + LOTE));
    if (error) throw new Error(`Erro ao ler lancamentos das faturas: ${error.message}`);
    for (const p of data || []) {
      const data = p.data_lancamento || p.data_pagamento;
      if (!data) continue;
      const atual = lancamentoDaFatura.get(p.fatura_id);
      if (!atual || String(data) < String(atual.data_lancamento)) lancamentoDaFatura.set(p.fatura_id, { data_lancamento: String(data).slice(0, 10), lancamento_contabil: p.lancamento_contabil });
    }
  }
  const resultado = new Map();
  for (const [chave, d] of faturaDaChave) {
    resultado.set(chave, { numero_fatura: d.numero_fatura, ...(lancamentoDaFatura.get(d.fatura_id) || {}) });
  }
  return resultado;
}
