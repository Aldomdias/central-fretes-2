import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

// Fornecedores das operacoes de compras: o expedidor/remetente do CT-e e sempre um destes CNPJs.
// Usado pelo Diagnostico de faturas (card "Compras"). Cadastro na propria tela (Diagnostico) e em Ferramentas.
const TABELA = 'fornecedores_compras';
const COLUNAS = 'id,codigo,nome,cnpj,ativo,created_at,updated_at,criado_por';
const MIGRATION = '20261124_002_fornecedores_compras.sql';
const VALIDADE_CACHE = 2 * 60 * 1000;

export const soDigitosCnpj = (v) => String(v ?? '').replace(/\D/g, '');
export const formatarCnpj = (v) => {
  const d = soDigitosCnpj(v);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d;
};

let cache = null;
const ouvintes = new Set();

// Avisa quem usa a lista (o Diagnostico reverifica as faturas) quando o cadastro muda.
export function aoMudarFornecedoresCompras(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}
function mudou() {
  cache = null;
  ouvintes.forEach((fn) => { try { fn(); } catch { /* ouvinte com erro nao trava o cadastro */ } });
}

const erroTabela = (error) => /fornecedores_compras/.test(error?.message || '') || error?.code === '42P01' || error?.code === 'PGRST205';

export async function carregarFornecedoresCompras({ forcar = false } = {}) {
  if (!isSupabaseConfigured()) return [];
  if (!forcar && cache && Date.now() - cache.em < VALIDADE_CACHE) return cache.lista;
  const { data, error } = await getSupabaseClient().from(TABELA).select(COLUNAS).order('nome').order('cnpj');
  if (error) {
    if (erroTabela(error)) throw new Error(`A migration ${MIGRATION} ainda não foi aplicada no Supabase.`);
    throw error;
  }
  cache = { em: Date.now(), lista: data || [] };
  return cache.lista;
}

// Map(cnpj 14 digitos -> fornecedor). Ativos e inativos: CT-e antigo de fornecedor inativo continua sendo compra.
// Sem a tabela (migration pendente) devolve vazio: o card so fica zerado, o resto do Diagnostico segue.
export async function mapaFornecedoresCompras() {
  try {
    const lista = await carregarFornecedoresCompras();
    return new Map(lista.map((f) => [soDigitosCnpj(f.cnpj), f]).filter(([c]) => c.length === 14));
  } catch (e) {
    console.warn('[Compras] fornecedores nao carregados', e?.message || e);
    return new Map();
  }
}

export async function salvarFornecedorCompras({ id, codigo, nome, cnpj, ativo = true }, usuario = '') {
  const doc = soDigitosCnpj(cnpj);
  if (doc.length !== 14) throw new Error('CNPJ precisa ter 14 dígitos.');
  if (!String(nome || '').trim()) throw new Error('Informe o nome do fornecedor.');
  const linha = { codigo: String(codigo || '').trim() || null, nome: String(nome).trim().toUpperCase(), cnpj: doc, ativo: Boolean(ativo), updated_at: new Date().toISOString() };
  const client = getSupabaseClient();
  const q = id
    ? client.from(TABELA).update(linha).eq('id', id)
    : client.from(TABELA).upsert({ ...linha, criado_por: usuario || null }, { onConflict: 'cnpj' });
  const { error } = await q;
  if (error) {
    if (erroTabela(error)) throw new Error(`A migration ${MIGRATION} ainda não foi aplicada no Supabase.`);
    throw error;
  }
  mudou();
}

export async function removerFornecedorCompras(id) {
  const { error } = await getSupabaseClient().from(TABELA).delete().eq('id', id);
  if (error) throw error;
  mudou();
}

// Colar varias linhas (copiadas da planilha): "CODIGO  NOME  CNPJ  STATUS" ou so "NOME CNPJ".
// O CNPJ e o unico campo obrigatorio por linha; STATUS "INATIVO" marca inativo.
export function lerFornecedoresColados(texto = '') {
  const itens = [];
  String(texto).split(/\r?\n/).forEach((linha) => {
    const bruta = linha.trim();
    if (!bruta) return;
    const cnpjs = bruta.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) || [];
    const cnpj = cnpjs.map(soDigitosCnpj).find((c) => c.length === 14);
    if (!cnpj) return;
    const campos = bruta.split(/\t|\s{2,}|;/).map((c) => c.trim()).filter(Boolean);
    const semCnpj = campos.filter((c) => soDigitosCnpj(c) !== cnpj && !/^(ATIVO|INATIVO)$/i.test(c));
    const codigo = semCnpj.length > 1 && /^\d+$/.test(semCnpj[0]) ? semCnpj[0] : '';
    const nome = semCnpj.filter((c) => c !== codigo).find((c) => /[a-z]/i.test(c)) || '';
    itens.push({ codigo, nome, cnpj, ativo: !/\bINATIVO\b/i.test(bruta) });
  });
  const vistos = new Set();
  return itens.filter((i) => (vistos.has(i.cnpj) ? false : vistos.add(i.cnpj)));
}

export async function salvarFornecedoresEmLote(itens = [], usuario = '') {
  const linhas = itens.filter((i) => soDigitosCnpj(i.cnpj).length === 14).map((i) => ({
    codigo: String(i.codigo || '').trim() || null,
    nome: String(i.nome || '').trim().toUpperCase() || 'SEM NOME',
    cnpj: soDigitosCnpj(i.cnpj),
    ativo: i.ativo !== false,
    updated_at: new Date().toISOString(),
    criado_por: usuario || null,
  }));
  if (!linhas.length) return 0;
  const { error } = await getSupabaseClient().from(TABELA).upsert(linhas, { onConflict: 'cnpj' });
  if (error) {
    if (erroTabela(error)) throw new Error(`A migration ${MIGRATION} ainda não foi aplicada no Supabase.`);
    throw error;
  }
  mudou();
  return linhas.length;
}
