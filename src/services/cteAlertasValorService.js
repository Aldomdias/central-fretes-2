import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'cte_alertas_valor';
const TABELA_CONFIG = 'cte_alerta_config';
const CONFIG_PADRAO = { limiar: 10000, ativo: true, enviar_email: true, emails: '' };

function client() {
  const supabase = getSupabaseClient();
  if (!supabase || !isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  return supabase;
}

export async function carregarConfigAlertaCte() {
  try {
    const { data, error } = await client().from(TABELA_CONFIG).select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return { ...CONFIG_PADRAO, ...(data || {}), limiar: Number(data?.limiar ?? CONFIG_PADRAO.limiar) };
  } catch {
    return { ...CONFIG_PADRAO };
  }
}

export async function salvarConfigAlertaCte({ limiar, ativo, enviar_email, emails }, usuario = '') {
  const valor = Number(limiar);
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('Informe um limiar maior que zero.');
  const { error } = await client().from(TABELA_CONFIG).upsert({
    id: 1,
    limiar: valor,
    ativo: Boolean(ativo),
    enviar_email: Boolean(enviar_email),
    emails: String(emails || '').trim(),
    atualizado_em: new Date().toISOString(),
    atualizado_por: usuario || null,
  });
  if (error) throw new Error(`Não foi possível salvar a configuração. Detalhe: ${error.message}`);
}

function linhaAlerta(row = {}, limiar) {
  return {
    chave_cte: row.chave_cte,
    numero_cte: row.numero_cte || null,
    transportadora: row.transportadora || null,
    tomador_servico: row.tomador_servico || null,
    cnpj_transportadora: row.cnpj_transportadora || null,
    competencia: row.competencia || null,
    data_emissao: row.data_emissao ? String(row.data_emissao).slice(0, 10) : null,
    valor_cte: Number(row.valor_cte || 0),
    limiar_aplicado: limiar,
    canal: row.canal || null,
    cidade_origem: row.cidade_origem || null,
    uf_origem: row.uf_origem || null,
    cidade_destino: row.cidade_destino || null,
    uf_destino: row.uf_destino || null,
    peso: row.peso != null && row.peso !== '' ? Number(row.peso) : null,
    valor_nf: row.valor_nf != null && row.valor_nf !== '' ? Number(row.valor_nf) : null,
    valor_calculado_verum: Number(row.valor_calculado || 0) > 0 ? Number(row.valor_calculado) : null,
    diferenca_verum: Number(row.valor_calculado || 0) > 0 ? Number(row.valor_cte || 0) - Number(row.valor_calculado) : null,
    arquivo_origem: row.arquivo_origem || null,
  };
}

/**
 * Chamado pela importacao a cada lote gravado na base oficial: separa os CT-e com
 * valor >= limiar e grava como alerta (sem sobrescrever os que ja foram analisados).
 * Nunca lanca erro - o alerta e acessorio e nao pode derrubar a importacao.
 */
export async function registrarAlertasValorCte(rows = [], config = null) {
  try {
    const cfg = config || await carregarConfigAlertaCte();
    if (!cfg.ativo) return 0;
    const altos = rows.filter((row) => row?.chave_cte && Number(row.valor_cte || 0) >= cfg.limiar);
    if (!altos.length) return 0;
    const { error } = await client()
      .from(TABELA)
      .upsert(altos.map((row) => linhaAlerta(row, cfg.limiar)), { onConflict: 'chave_cte', ignoreDuplicates: true });
    if (error) throw error;
    return altos.length;
  } catch (error) {
    console.warn('Alerta de CT-e de valor alto não registrado:', error?.message || error);
    return 0;
  }
}

/**
 * Dispara o e-mail (funcao serverless). Sem `ids`: so os ainda nao enviados.
 * Com `ids`: exatamente esses alertas, inclusive os ja enviados (reenvio). Nunca lanca erro.
 */
export async function enviarEmailAlertasPendentes(ids = null) {
  try {
    const resposta = await fetch('/api/alerta-cte-valor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids ? { ids } : {}),
    });
    const json = await resposta.json().catch(() => null);
    if (!json) {
      return { ok: false, erro: `O envio de e-mail só funciona no site publicado (Vercel); aqui no teste local a rota /api não existe (HTTP ${resposta.status}).` };
    }
    return { ok: resposta.ok, ...json };
  } catch (error) {
    return { ok: false, erro: error?.message || 'Falha ao chamar o envio de e-mail.' };
  }
}

/** Zera a marca de "enviado" para poder mandar de novo. */
export async function limparEnvioAlertasCte(ids = []) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await client().from(TABELA).update({ email_enviado_em: null }).in('id', ids.slice(i, i + 200));
    if (error) throw new Error(`Não foi possível limpar o envio. Detalhe: ${error.message}`);
  }
}

export const LIMITE_LISTA_ALERTAS = 2000;

export async function listarAlertasValorCte({
  status = '', limiarMinimo = 0, busca = '', email = '', canal = '', tomadores = [], transportadora = '', dataInicio = '', dataFim = '', limite = LIMITE_LISTA_ALERTAS,
} = {}) {
  let query = client().from(TABELA).select('*').order('valor_cte', { ascending: false }).limit(limite);
  if (status) query = query.eq('status', status);
  if (Number(limiarMinimo) > 0) query = query.gte('valor_cte', Number(limiarMinimo));
  if (email === 'enviado') query = query.not('email_enviado_em', 'is', null);
  if (email === 'pendente') query = query.is('email_enviado_em', null);
  if (canal) query = query.eq('canal', canal);
  const termosTomador = tomadores.map((t) => String(t).trim().replace(/[%,()*]/g, ' ')).filter(Boolean);
  if (termosTomador.length) query = query.or(termosTomador.map((t) => `tomador_servico.ilike.%${t}%`).join(','));
  if (transportadora.trim()) query = query.ilike('transportadora', `%${transportadora.trim().replace(/[%,]/g, ' ')}%`);
  if (dataInicio) query = query.gte('data_emissao', dataInicio);
  if (dataFim) query = query.lte('data_emissao', dataFim);
  const { data, error } = await query;
  if (error) throw new Error(`Não foi possível carregar os alertas. Detalhe: ${error.message}`);
  const termo = String(busca || '').trim().toLowerCase();
  if (!termo) return data || [];
  return (data || []).filter((a) => [a.numero_cte, a.chave_cte, a.transportadora, a.cidade_origem, a.cidade_destino]
    .some((v) => String(v || '').toLowerCase().includes(termo)));
}

export async function atualizarStatusAlertaCte(id, { status, observacao }, usuario = '') {
  const { error } = await client().from(TABELA).update({
    status,
    observacao: observacao ?? null,
    analisado_por: usuario || null,
    analisado_em: status === 'novo' ? null : new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error(`Não foi possível atualizar o alerta. Detalhe: ${error.message}`);
}

/**
 * Varre a base oficial por CT-e >= limiar num periodo de emissao e cria os alertas que
 * ainda nao existem. Serve para calibrar (baixar o limiar) e para olhar o passado.
 */
export async function varrerBaseAlertasValorCte({ limiar, dataInicio, dataFim }) {
  const supabase = client();
  const cfg = { ativo: true, limiar: Number(limiar) };
  let total = 0;
  let de = 0;
  const pagina = 1000;
  for (;;) {
    let query = supabase
      .from('realizado_local_ctes')
      .select('chave_cte,numero_cte,transportadora,tomador_servico,cnpj_transportadora,competencia,data_emissao,valor_cte,canal,cidade_origem,uf_origem,cidade_destino,uf_destino,peso,valor_nf,valor_calculado,arquivo_origem')
      .gte('valor_cte', cfg.limiar)
      .order('valor_cte', { ascending: false })
      .range(de, de + pagina - 1);
    if (dataInicio) query = query.gte('data_emissao', dataInicio);
    if (dataFim) query = query.lte('data_emissao', dataFim);
    const { data, error } = await query;
    if (error) throw new Error(`Erro ao varrer a base. Detalhe: ${error.message}`);
    if (!data?.length) break;
    total += await registrarAlertasValorCte(data, cfg);
    if (data.length < pagina) break;
    de += pagina;
  }
  return total;
}
