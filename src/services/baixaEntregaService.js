import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { excelDateToISO } from '../utils/auditoriaFretesImport';

// Baixa de entrega em massa: o auditor sobe a planilha (chave do CT-e + data de entrega),
// a baixa fica PENDENTE ate a gestao aprovar. Aprovada, passa a contar como entregue em
// buscarStatusEntregaCtes (auditoriaEntregaCteService). Tambem guarda os CT-es retirados
// de uma fatura que aguardam nova fatura.

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const LOTE = 150;

export const STATUS_BAIXA = { PENDENTE: 'PENDENTE', APROVADO: 'APROVADO', REJEITADO: 'REJEITADO' };

export const COLUNAS_MODELO_BAIXA = ['Chave CT-e', 'Data de entrega'];

// Mesma chave de auditoriaEntregaCteService.chaveEntregaRegistro.
const chaveDoItem = (item = {}) => soDigitos(item.chave_cte) || String(item.numero_cte || '');

export function montarModeloBaixaEntrega(XLSX, detalhes = []) {
  const linhas = detalhes.map((item) => ({
    'Chave CT-e': soDigitos(item.chave_cte),
    'Data de entrega': '',
    'Numero CT-e (referencia)': item.numero_cte || '',
  }));
  const ws = XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ 'Chave CT-e': '', 'Data de entrega': '', 'Numero CT-e (referencia)': '' }]);
  // Chave com 44 digitos precisa ser texto, senao o Excel arredonda para notacao cientifica.
  Object.keys(ws).filter((ref) => /^A\d+$/.test(ref) && ref !== 'A1').forEach((ref) => { ws[ref].t = 's'; ws[ref].z = '@'; });
  ws['!cols'] = [{ wch: 48 }, { wch: 16 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Baixa de entrega');
  return wb;
}

const normalizarCabecalho = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Le a planilha preenchida. Devolve { validas, invalidas }.
 * validas: [{ chave, chave_cte, data_entrega, linha }]; invalidas: [{ linha, motivo }].
 */
export function lerPlanilhaBaixaEntrega(XLSX, arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  const validas = [];
  const invalidas = [];
  const vistas = new Map();
  linhas.forEach((row, idx) => {
    const linha = idx + 2;
    const campos = Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizarCabecalho(k), v]));
    const brutaChave = campos.chavecte ?? campos.chave ?? campos.chavedocte ?? '';
    const brutaData = campos.datadeentrega ?? campos.dataentrega ?? campos.entrega ?? '';
    if (brutaChave === '' && brutaData === '') return;
    if (typeof brutaChave === 'number') {
      invalidas.push({ linha, motivo: 'Chave veio como numero (Excel arredondou). Formate a coluna como texto.' });
      return;
    }
    const chave = soDigitos(brutaChave);
    if (chave.length !== 44) {
      invalidas.push({ linha, motivo: `Chave CT-e invalida (${chave.length} digitos, esperado 44).` });
      return;
    }
    const data = excelDateToISO(brutaData);
    if (!data) {
      invalidas.push({ linha, motivo: 'Data de entrega ausente ou em formato invalido (use dd/mm/aaaa).' });
      return;
    }
    if (data > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) {
      invalidas.push({ linha, motivo: `Data de entrega no futuro (${data.split('-').reverse().join('/')}).` });
      return;
    }
    if (vistas.has(chave)) {
      invalidas.push({ linha, motivo: `Chave repetida (ja aparece na linha ${vistas.get(chave)}).` });
      return;
    }
    vistas.set(chave, linha);
    validas.push({ chave, chave_cte: chave, data_entrega: data, linha });
  });
  return { validas, invalidas };
}

/** Casa as linhas da planilha com os CT-es da fatura aberta. */
export function casarPlanilhaComFatura(validas = [], detalhes = []) {
  const porChave = new Map();
  detalhes.forEach((item) => { const c = soDigitos(item.chave_cte); if (c) porChave.set(c, item); });
  const casadas = [];
  const foraDaFatura = [];
  validas.forEach((v) => {
    const item = porChave.get(v.chave);
    if (item) casadas.push({ ...v, numero_cte: item.numero_cte || '' });
    else foraDaFatura.push(v);
  });
  return { casadas, foraDaFatura };
}

export async function solicitarBaixasEntrega({ fatura, itens = [], usuarioNome = '', justificativa = '' }) {
  if (!isSupabaseConfigured() || !fatura?.id || !itens.length) return { loteId: null, total: 0 };
  if (String(justificativa).trim().length < 5) throw new Error('Informe a justificativa da baixa (minimo 5 caracteres).');
  const loteId = `lote_${Date.now().toString(36)}`;
  const agora = new Date().toISOString();
  const linhas = itens.map((item) => ({
    lote_id: loteId,
    fatura_id: String(fatura.id),
    numero_fatura: fatura.numero_fatura || null,
    transportadora: fatura.transportadora || null,
    chave: chaveDoItem(item),
    chave_cte: soDigitos(item.chave_cte) || null,
    numero_cte: item.numero_cte || null,
    data_entrega: item.data_entrega,
    status: STATUS_BAIXA.PENDENTE,
    solicitado_por: usuarioNome || null,
    solicitado_em: agora,
    justificativa: String(justificativa).trim(),
  })).filter((l) => l.chave);
  const client = getSupabaseClient();
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await client.from('entrega_baixas_manuais').insert(linhas.slice(i, i + 500));
    if (error) throw new Error(`Erro ao registrar baixa (migration 20261002_002 aplicada?): ${error.message}`);
  }
  return { loteId, total: linhas.length };
}

/** Lotes pendentes (agrupados) ou, com faturaId, so os dessa fatura. Falha vira lista vazia. */
export async function listarBaixasPendentes({ faturaId } = {}) {
  if (!isSupabaseConfigured()) return [];
  try {
    let q = getSupabaseClient().from('entrega_baixas_manuais').select('*').eq('status', STATUS_BAIXA.PENDENTE).order('solicitado_em', { ascending: false }).limit(5000);
    if (faturaId) q = q.eq('fatura_id', String(faturaId));
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn('[Baixa de entrega] pendentes indisponiveis.', error?.message || error);
    return [];
  }
}

export function agruparPorLote(linhas = []) {
  const lotes = new Map();
  linhas.forEach((l) => {
    if (!lotes.has(l.lote_id)) {
      lotes.set(l.lote_id, { loteId: l.lote_id, faturaId: l.fatura_id, numeroFatura: l.numero_fatura, transportadora: l.transportadora, solicitadoPor: l.solicitado_por, solicitadoEm: l.solicitado_em, justificativa: l.justificativa || '', status: l.status, decididoPor: l.decidido_por, decididoEm: l.decidido_em, observacao: l.observacao || '', itens: [] });
    }
    lotes.get(l.lote_id).itens.push(l);
  });
  return [...lotes.values()];
}

/** Registro das baixas ja decididas (aprovadas/rejeitadas), mais recentes primeiro; com faturaId, so dessa fatura. */
export async function listarBaixasDecididas({ faturaId, limite = 1500 } = {}) {
  if (!isSupabaseConfigured()) return [];
  try {
    let q = getSupabaseClient().from('entrega_baixas_manuais').select('*')
      .in('status', [STATUS_BAIXA.APROVADO, STATUS_BAIXA.REJEITADO])
      .order('decidido_em', { ascending: false }).limit(limite);
    if (faturaId) q = q.eq('fatura_id', String(faturaId));
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn('[Baixa de entrega] historico indisponivel.', error?.message || error);
    return [];
  }
}

export async function decidirLoteBaixa({ loteId, aprovar, usuarioNome = '', observacao = '' }) {
  const { error } = await getSupabaseClient().from('entrega_baixas_manuais').update({
    status: aprovar ? STATUS_BAIXA.APROVADO : STATUS_BAIXA.REJEITADO,
    decidido_por: usuarioNome || null,
    decidido_em: new Date().toISOString(),
    observacao: observacao || null,
  }).eq('lote_id', loteId).eq('status', STATUS_BAIXA.PENDENTE);
  if (error) throw new Error(`Erro ao decidir a baixa: ${error.message}`);
}

// Chaves com baixa manual aprovada: contam como entregues (data = data informada na planilha).
export async function carregarBaixasAprovadas(chaves = []) {
  const aprovadas = new Map();
  if (!isSupabaseConfigured() || !chaves.length) return aprovadas;
  try {
    const client = getSupabaseClient();
    const unicas = [...new Set(chaves.filter(Boolean))];
    for (let i = 0; i < unicas.length; i += LOTE) {
      const { data, error } = await client.from('entrega_baixas_manuais')
        .select('chave, data_entrega, decidido_em, decidido_por')
        .eq('status', STATUS_BAIXA.APROVADO)
        .in('chave', unicas.slice(i, i + LOTE));
      if (error) throw error;
      (data || []).forEach((row) => aprovadas.set(row.chave, row));
    }
  } catch (error) {
    console.warn('[Baixa de entrega] aprovacoes indisponiveis; segue so com o tracking.', error?.message || error);
  }
  return aprovadas;
}

// --- CT-es aguardando nova fatura -----------------------------------------------------

export async function registrarAguardandoNovaFatura({ fatura, itens = [], motivo = '', usuarioNome = '' }) {
  if (!isSupabaseConfigured() || !fatura?.id || !itens.length) return 0;
  const linhas = itens.map((item) => ({
    chave: chaveDoItem(item),
    chave_cte: soDigitos(item.chave_cte) || null,
    numero_cte: item.numero_cte || null,
    fatura_origem_id: String(fatura.id),
    numero_fatura_origem: fatura.numero_fatura || null,
    transportadora: fatura.transportadora || null,
    valor_cte: Number(item.valor_frete || 0),
    motivo: motivo || 'Sem entrega comprovada: retirado da fatura.',
    criado_por: usuarioNome || null,
    resolvido_em: null,
    resolvido_por: null,
  })).filter((l) => l.chave);
  const { error } = await getSupabaseClient().from('cte_aguardando_nova_fatura').upsert(linhas, { onConflict: 'chave,fatura_origem_id' });
  if (error) throw new Error(`Erro ao registrar CT-es aguardando nova fatura (migration 20261002_002 aplicada?): ${error.message}`);
  return linhas.length;
}

/** Mapa chave -> registro aberto (resolvido_em nulo). Falha/tabela ausente = mapa vazio. */
export async function carregarAguardandoNovaFatura(chaves = []) {
  const mapa = new Map();
  if (!isSupabaseConfigured() || !chaves.length) return mapa;
  try {
    const client = getSupabaseClient();
    const unicas = [...new Set(chaves.filter(Boolean))];
    for (let i = 0; i < unicas.length; i += LOTE) {
      const { data, error } = await client.from('cte_aguardando_nova_fatura')
        .select('chave, numero_fatura_origem, motivo, criado_em, criado_por')
        .is('resolvido_em', null)
        .in('chave', unicas.slice(i, i + LOTE));
      if (error) throw error;
      (data || []).forEach((row) => mapa.set(row.chave, row));
    }
  } catch (error) {
    console.warn('[Aguardando nova fatura] indisponivel.', error?.message || error);
  }
  return mapa;
}

/** Quando o CT-e entra numa nova fatura, sai da espera. */
export async function resolverAguardandoNovaFatura(chaves = [], usuarioNome = '') {
  if (!isSupabaseConfigured() || !chaves.length) return;
  try {
    const unicas = [...new Set(chaves.filter(Boolean))];
    for (let i = 0; i < unicas.length; i += LOTE) {
      await getSupabaseClient().from('cte_aguardando_nova_fatura')
        .update({ resolvido_em: new Date().toISOString(), resolvido_por: usuarioNome || null })
        .is('resolvido_em', null).in('chave', unicas.slice(i, i + LOTE));
    }
  } catch (error) {
    console.warn('[Aguardando nova fatura] nao resolvido.', error?.message || error);
  }
}

/** Todos os CT-es ainda aguardando nova fatura (resolvido_em nulo), para o painel dos auditores. */
export async function listarAguardandoNovaFaturaAbertos() {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await getSupabaseClient().from('cte_aguardando_nova_fatura')
      .select('chave, numero_cte, fatura_origem_id, numero_fatura_origem, transportadora, valor_cte, motivo, criado_em, criado_por')
      .is('resolvido_em', null)
      .order('criado_em', { ascending: true })
      .limit(5000);
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn('[Aguardando nova fatura] lista indisponivel.', error?.message || error);
    return [];
  }
}

// --- CT-es retirados (inativados) da fatura ---------------------------------------------

export const MOTIVOS_RETIRADA_CTE = ['CT-e cancelado', 'CT-e duplicado', 'Emitido por engano / nao pertence a fatura', 'Outro'];

export async function registrarRetiradaCtes({ fatura, itens = [], motivo = '', justificativa = '', usuarioNome = '' }) {
  if (!isSupabaseConfigured() || !fatura?.id || !itens.length) return 0;
  const linhas = itens.map((item) => ({
    fatura_id: String(fatura.id),
    numero_fatura: fatura.numero_fatura || null,
    transportadora: fatura.transportadora || null,
    chave: chaveDoItem(item) || null,
    chave_cte: soDigitos(item.chave_cte) || null,
    numero_cte: item.numero_cte || null,
    valor_cte: Number(item.valor_frete || 0),
    motivo,
    justificativa,
    snapshot: item,
    retirado_por: usuarioNome || null,
  }));
  const { error } = await getSupabaseClient().from('fatura_cte_retiradas').insert(linhas);
  if (error) throw new Error(`Erro ao registrar a retirada (migration 20261002_003 aplicada?): ${error.message}`);
  return linhas.length;
}

export async function listarRetiradasDaFatura(faturaId) {
  if (!isSupabaseConfigured() || !faturaId) return [];
  try {
    const { data, error } = await getSupabaseClient().from('fatura_cte_retiradas')
      .select('id, chave, numero_cte, valor_cte, motivo, justificativa, retirado_por, retirado_em')
      .eq('fatura_id', String(faturaId))
      .is('restaurado_em', null)
      .order('retirado_em', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn('[Retiradas da fatura] indisponivel.', error?.message || error);
    return [];
  }
}
