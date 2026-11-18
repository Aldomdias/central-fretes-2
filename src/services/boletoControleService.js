import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'fatura_boleto_controle';
const CHAVE_LOCAL = 'central_fretes_boleto_controle_v1';

export const STATUS_BOLETO = { NA_PASTA: 'NA_PASTA', DISPENSADO: 'DISPENSADO' };

function lerLocal() {
  try { return JSON.parse(localStorage.getItem(CHAVE_LOCAL) || '[]'); } catch { return []; }
}

function gravarLocal(lista) {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(lista)); } catch { /* sem armazenamento local */ }
}

// Sem a migration 20261014_001 aplicada a tabela nao existe: a confirmacao fica so
// neste navegador ate a tabela existir, sem travar o painel.
const tabelaAusente = (error) => ['42P01', 'PGRST205'].includes(error?.code) || /does not exist|schema cache/i.test(error?.message || '');

export async function listarControleBoletos() {
  if (!isSupabaseConfigured()) return { lista: lerLocal(), local: true };
  const { data, error } = await getSupabaseClient().from(TABELA).select('*').order('confirmado_em', { ascending: false }).limit(10000);
  if (error) {
    if (tabelaAusente(error)) return { lista: lerLocal(), local: true };
    throw new Error(`Erro ao carregar controle de boletos: ${error.message}`);
  }
  return { lista: data || [], local: false };
}

// faturas: [{ id, numero_fatura, transportadora }]. status: NA_PASTA | DISPENSADO.
export async function confirmarBoletos(faturas, { status = STATUS_BOLETO.NA_PASTA, metodo = 'MANUAL', observacao = '', usuario = {} } = {}) {
  const agora = new Date().toISOString();
  const registros = faturas.map((f) => ({
    fatura_id: String(f.id),
    numero_fatura: f.numero_fatura || null,
    transportadora: f.transportadora || null,
    status,
    metodo,
    observacao: observacao || null,
    confirmado_por: usuario.nome || usuario.email || '',
    confirmado_email: usuario.email || '',
    confirmado_em: agora,
  }));
  if (!registros.length) return { registros, local: false };
  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    let tabelaFaltando = false;
    for (let i = 0; i < registros.length; i += 200) {
      const { error } = await client.from(TABELA).upsert(registros.slice(i, i + 200), { onConflict: 'fatura_id' });
      if (error) {
        if (tabelaAusente(error)) { tabelaFaltando = true; break; }
        throw new Error(`Erro ao salvar confirmacao de boleto: ${error.message}`);
      }
    }
    if (!tabelaFaltando) return { registros, local: false };
  }
  const lista = lerLocal();
  registros.forEach((r) => {
    const i = lista.findIndex((x) => x.fatura_id === r.fatura_id);
    if (i >= 0) lista[i] = r; else lista.unshift(r);
  });
  gravarLocal(lista);
  return { registros, local: true };
}

export async function desfazerConfirmacaoBoleto(faturaId) {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseClient().from(TABELA).delete().eq('fatura_id', String(faturaId));
    if (!error) return;
    if (!tabelaAusente(error)) throw new Error(`Erro ao desfazer confirmacao: ${error.message}`);
  }
  gravarLocal(lerLocal().filter((r) => r.fatura_id !== String(faturaId)));
}

// ---- PDF do boleto guardado ate a fatura ser paga ----
const BUCKET_BOLETOS = 'boletos-financeiro';
const MSG_MIGRATION = 'Aplicar a migration 20261026_001_boleto_arquivo_guardado.sql.';

const nomeSeguro = (n) => String(n || 'boleto.pdf').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');

export async function hashArquivo(arquivo) {
  const bytes = await arquivo.arrayBuffer();
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function listarVersoesBoletos() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseClient().from('boleto_arquivo_versoes').select('*').order('created_at', { ascending: false }).limit(10000);
  if (error) {
    if (tabelaAusente(error)) return [];
    throw new Error(`Erro ao carregar versões de boletos: ${error.message}`);
  }
  return data || [];
}

export async function registrarLeituraPasta({ origem = 'PASTA_LOCAL', status = 'SUCESSO', total = 0, novos = 0, repetidos = 0, erro = '', usuario = {} } = {}) {
  if (!isSupabaseConfigured()) return null;
  const payload = { origem, status, total_arquivos: total, novos, repetidos, erro: erro || null, executado_por: usuario.nome || usuario.email || null };
  const { data, error: falha } = await getSupabaseClient().from('boleto_pasta_leituras').insert(payload).select('*').single();
  if (falha) {
    if (tabelaAusente(falha)) return null;
    throw new Error(`Erro ao registrar leitura da pasta: ${falha.message}`);
  }
  return data;
}

export async function carregarUltimaLeituraPasta() {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from('boleto_pasta_leituras').select('*').eq('status', 'SUCESSO').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  return data || null;
}

// itens: [{ fatura, arquivo: File, leitura: {valor, vencimento, linhaDigitavel}, atual: registro do controle (opcional) }].
// Sobe o PDF, grava a informacao lida e apaga o PDF anterior da fatura (boleto substituido).
export async function guardarBoletos(itens, { usuario = {} } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado: nao da para guardar o arquivo do boleto.');
  const client = getSupabaseClient();
  const agora = new Date().toISOString();
  const guardados = [];
  for (const { fatura, arquivo, leitura, atual } of itens) {
    const hash = leitura?.hash || await hashArquivo(arquivo);
    // A versao e' por (fatura, conteudo): o mesmo PDF pode legitimamente servir a outra fatura.
    const { data: existente } = await client.from('boleto_arquivo_versoes').select('*').eq('hash_conteudo', hash).eq('fatura_id', String(fatura.id)).maybeSingle();
    // Repetido de verdade: o controle da fatura ja aponta para esse mesmo arquivo. Nada a fazer (idempotente).
    if (existente && atual?.boleto_arquivo_path && atual.boleto_arquivo_path === existente.arquivo_path) {
      guardados.push({ ...existente, repetido: true });
      continue;
    }
    // Conteudo ja guardado para esta fatura, mas o controle foi desfeito ou aponta para outro arquivo: refaz o
    // controle reaproveitando o PDF existente (sem novo upload e sem nova versao).
    const reaproveitar = Boolean(existente?.arquivo_path);
    const path = reaproveitar ? existente.arquivo_path : `${fatura.id}/${Date.now()}-${nomeSeguro(arquivo.name)}`;
    if (!reaproveitar) {
      const { error: erroUp } = await client.storage.from(BUCKET_BOLETOS).upload(path, arquivo, { upsert: false, contentType: 'application/pdf' });
      if (erroUp) throw new Error(`Erro ao guardar "${arquivo.name}": ${erroUp.message}. ${MSG_MIGRATION}`);
    }
    const registro = {
      fatura_id: String(fatura.id),
      numero_fatura: fatura.numero_fatura || null,
      transportadora: fatura.transportadora || null,
      status: STATUS_BOLETO.NA_PASTA,
      metodo: 'PASTA',
      confirmado_por: usuario.nome || usuario.email || '',
      confirmado_email: usuario.email || '',
      confirmado_em: agora,
      boleto_arquivo_nome: arquivo.name,
      boleto_arquivo_path: path,
      boleto_valor: leitura?.valor ?? null,
      boleto_vencimento: leitura?.vencimento ?? null,
      boleto_linha_digitavel: leitura?.linhaDigitavel ?? null,
      boleto_apagado_em: null,
      boleto_apagado_motivo: null,
      boleto_copiado_em: null, // boleto novo: ainda nao foi para a pasta de rede
      boleto_copiado_por: null,
    };
    const { error } = await client.from(TABELA).upsert(registro, { onConflict: 'fatura_id' });
    if (error) {
      if (!reaproveitar) await client.storage.from(BUCKET_BOLETOS).remove([path]);
      throw new Error(`Erro ao salvar o boleto: ${error.message}. ${MSG_MIGRATION}`);
    }
    if (reaproveitar) { guardados.push(registro); continue; }
    const versao = {
      fatura_id: String(fatura.id), hash_conteudo: hash, nome_arquivo: arquivo.name,
      arquivo_path: path, valor: leitura?.valor ?? null, vencimento: leitura?.vencimento ?? null,
      linha_digitavel: leitura?.linhaDigitavel ?? null, origem_leitura: leitura?.origemLeitura || null,
      status_vinculo: 'LOCALIZADO_NA_PASTA', campos_comparados: { referencia: true, valor: true, vencimento: true },
      candidatos: [], confirmado_manualmente: false, confirmado_por: usuario.nome || usuario.email || null,
    };
    const { error: erroVersao } = await client.from('boleto_arquivo_versoes').insert(versao);
    if (erroVersao && !tabelaAusente(erroVersao)) throw new Error(`Boleto salvo, mas a versão não foi registrada: ${erroVersao.message}`);
    // O arquivo anterior permanece no histórico de versões. A limpeza ocorre somente após
    // pagamento confirmado, nunca durante um simples reprocessamento/substituição.
    guardados.push(registro);
  }
  return guardados;
}

export async function urlBoletoGuardado(path) {
  const { data, error } = await getSupabaseClient().storage.from(BUCKET_BOLETOS).createSignedUrl(path, 300);
  if (error) throw new Error(`Nao foi possivel abrir o boleto: ${error.message}`);
  return data.signedUrl;
}

// Apaga o PDF das faturas ja pagas e mantem a informacao lida. A mesma regra roda todo dia no servidor
// (api/limpar-boletos); aqui e a limpeza imediata ao abrir o painel.
export async function apagarBoletosPagos(controle, faturaPagaFn, faturas) {
  if (!isSupabaseConfigured()) return 0;
  const porId = new Map((faturas || []).map((f) => [String(f.id), f]));
  const alvos = (controle || []).filter((c) => c.boleto_arquivo_path && porId.has(String(c.fatura_id)) && faturaPagaFn(porId.get(String(c.fatura_id))));
  if (!alvos.length) return 0;
  const client = getSupabaseClient();
  const { error } = await client.storage.from(BUCKET_BOLETOS).remove(alvos.map((c) => c.boleto_arquivo_path));
  if (error) return 0;
  await client.from(TABELA).update({ boleto_arquivo_path: null, boleto_apagado_em: new Date().toISOString(), boleto_apagado_motivo: 'PAGA' })
    .in('fatura_id', alvos.map((c) => String(c.fatura_id)));
  return alvos.length;
}

export async function baixarBoletoGuardado(path) {
  const { data, error } = await getSupabaseClient().storage.from(BUCKET_BOLETOS).download(path);
  if (error) throw new Error(`Nao foi possivel baixar o boleto: ${error.message}`);
  return data;
}

export async function marcarBoletosCopiados(faturaIds, usuario = {}) {
  if (!faturaIds.length) return;
  const { error } = await getSupabaseClient().from(TABELA)
    .update({ boleto_copiado_em: new Date().toISOString(), boleto_copiado_por: usuario.nome || usuario.email || '' })
    .in('fatura_id', faturaIds.map(String));
  if (error) throw new Error(`Erro ao marcar boleto como copiado: ${error.message}`);
}
