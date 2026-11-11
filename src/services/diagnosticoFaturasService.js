import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { identificacaoSapDoCte, resumirCtesFatura } from '../utils/diagnosticoFaturas';
import { chaveCasamentoCte } from '../utils/lancamentosCteSap';
import { ehLinhaNfse } from '../utils/nfseFatura';

const PAGINA = 1000;
const LOTE_FATURAS = 40;
const LOTE_NUMEROS = 200;
const COLUNAS_DETALHE = 'id,fatura_id,chave_cte,numero_cte,serie_cte,cnpj_emissor,cnpj_transportadora,valor_frete,excluido_da_versao';

async function paginarPorId(montar) {
  const todos = [];
  let ultimo = null;
  for (;;) {
    let q = montar().order('id').limit(PAGINA);
    if (ultimo) q = q.gt('id', ultimo);
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await q;
    if (error) throw error;
    todos.push(...(data || []));
    if ((data || []).length < PAGINA) return todos;
    ultimo = data[data.length - 1].id;
  }
}

async function carregarDetalhes(client, faturaIds) {
  const detalhes = [];
  for (let i = 0; i < faturaIds.length; i += LOTE_FATURAS) {
    const lote = faturaIds.slice(i, i + LOTE_FATURAS);
    // eslint-disable-next-line no-await-in-loop
    detalhes.push(...await paginarPorId(() => client.from('fatura_detalhes').select(COLUNAS_DETALHE).in('fatura_id', lote)));
  }
  return detalhes;
}

async function carregarLancamentos(client, detalhes) {
  const numerosPorCnpj = new Map();
  detalhes.forEach((item) => {
    if (item.excluido_da_versao === true || ehLinhaNfse(item)) return;
    const { cnpj, numero } = identificacaoSapDoCte(item);
    if (!cnpj || numero === '0') return;
    if (!numerosPorCnpj.has(cnpj)) numerosPorCnpj.set(cnpj, new Set());
    numerosPorCnpj.get(cnpj).add(numero);
  });
  const porChave = new Map();
  for (const [cnpj, numeros] of numerosPorCnpj) {
    const lista = [...numeros];
    for (let i = 0; i < lista.length; i += LOTE_NUMEROS) {
      const lote = lista.slice(i, i + LOTE_NUMEROS);
      // eslint-disable-next-line no-await-in-loop
      const linhas = await paginarPorId(() => client.from('ctes_lancamentos_sap')
        .select('id,cnpj_emitente,numero_cte,serie_cte,lancamento_contabil,data_lancamento,montante')
        .eq('cnpj_emitente', cnpj).in('numero_cte', lote));
      linhas.forEach((l) => {
        const k = chaveCasamentoCte({ cnpj: l.cnpj_emitente, numero: l.numero_cte, serie: l.serie_cte });
        porChave.set(k, [...(porChave.get(k) || []), l]);
      });
    }
  }
  return porChave;
}

// Resumo de CT-es x partida no SAP de um lote de faturas: Map(faturaId -> resumo).
export async function carregarResumoCtesFaturas(faturaIds = []) {
  if (!isSupabaseConfigured() || !faturaIds.length) return new Map();
  const client = getSupabaseClient();
  const detalhes = await carregarDetalhes(client, faturaIds);
  const lancamentos = await carregarLancamentos(client, detalhes);
  const porFatura = new Map(faturaIds.map((id) => [String(id), []]));
  detalhes.forEach((d) => porFatura.get(String(d.fatura_id))?.push(d));
  return new Map([...porFatura].map(([id, lista]) => [id, resumirCtesFatura(lista, lancamentos)]));
}

// Data do ultimo relatorio SAP importado: mostra ate quando a informacao de partida por CT-e vale.
export async function carregarUltimaImportacaoSap() {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from('ctes_lancamentos_sap')
    .select('data_lancamento').order('data_lancamento', { ascending: false, nullsFirst: false }).limit(1);
  if (error) return null;
  return data?.[0]?.data_lancamento || null;
}
