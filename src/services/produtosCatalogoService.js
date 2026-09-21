import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'produtos_catalogo';

export async function listarProdutosCatalogo({ busca = '', apenasAtivos = true, limite = 500 } = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado para consultar o catálogo de produtos.');
  let query = getSupabaseClient().from(TABELA).select('*').order('nome', { ascending: true }).limit(Number(limite) || 500);
  if (apenasAtivos) query = query.eq('ativo', true);
  const termo = String(busca || '').trim();
  if (termo) query = query.or(`codigo.ilike.%${termo}%,nome.ilike.%${termo}%`);
  const { data, error } = await query;
  if (error) throw new Error(`Não foi possível carregar o catálogo de produtos: ${error.message}`);
  return data || [];
}

// Cria um registro mínimo no catálogo (peso/cubagem zerados) para códigos que
// ainda não existem — usado ao importar estoque, pra não deixar produto "órfão"
// que nunca aparece na busca da simulação por produto. Não sobrescreve produtos
// já cadastrados (ignoreDuplicates), então peso/cubagem/nome existentes ficam intactos.
export async function garantirProdutosCatalogo(codigos) {
  if (!isSupabaseConfigured()) return;
  const unicos = Array.from(new Set((codigos || []).map((c) => String(c || '').trim()).filter(Boolean)));
  if (!unicos.length) return;
  const registros = unicos.map((codigo) => ({ codigo, nome: codigo, peso_kg: 0, cubagem_m3: 0, ativo: true }));
  const TAMANHO_LOTE = 500;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
    const lote = registros.slice(i, i + TAMANHO_LOTE);
    const { error } = await getSupabaseClient().from(TABELA).upsert(lote, { onConflict: 'codigo', ignoreDuplicates: true });
    if (error) throw new Error(`Não foi possível garantir os produtos do catálogo: ${error.message}`);
  }
}

export async function salvarProdutoCatalogo({ id, codigo, nome, pesoKg, cubagemM3, ativo = true }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const registro = {
    codigo: String(codigo || '').trim(),
    nome: String(nome || '').trim(),
    peso_kg: Number(pesoKg) || 0,
    cubagem_m3: Number(cubagemM3) || 0,
    ativo: !!ativo,
    updated_at: new Date().toISOString(),
  };
  if (!registro.codigo) throw new Error('Código do produto é obrigatório.');
  if (!registro.nome) throw new Error('Nome do produto é obrigatório.');

  const { data, error } = id
    ? await getSupabaseClient().from(TABELA).update(registro).eq('id', id).select().single()
    : await getSupabaseClient().from(TABELA).insert(registro).select().single();
  if (error) throw new Error(`Não foi possível salvar o produto: ${error.message}`);
  return data;
}

export async function excluirProdutoCatalogo(id) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const { error } = await getSupabaseClient().from(TABELA).delete().eq('id', id);
  if (error) throw new Error(`Não foi possível excluir o produto: ${error.message}`);
}

// Importa em lote via upsert por código (usa a unique index em upper(codigo)).
export async function importarProdutosCatalogo(linhas) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const mapeados = (linhas || [])
    .map((linha) => ({
      codigo: String(linha.codigo || '').trim(),
      nome: String(linha.nome || '').trim(),
      peso_kg: Number(linha.pesoKg) || 0,
      cubagem_m3: Number(linha.cubagemM3) || 0,
      ativo: true,
    }))
    .filter((linha) => linha.codigo && linha.nome);

  // O upsert falha ("cannot affect row a second time") se o mesmo código
  // aparecer duas vezes dentro do mesmo lote — planilhas costumam ter
  // códigos repetidos, então mantém só a última ocorrência de cada um.
  const porCodigo = new Map();
  mapeados.forEach((linha) => porCodigo.set(linha.codigo.toUpperCase(), linha));
  const registros = Array.from(porCodigo.values());

  if (!registros.length) return { inseridos: 0 };

  const TAMANHO_LOTE = 500;
  let total = 0;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
    const lote = registros.slice(i, i + TAMANHO_LOTE);
    const { error } = await getSupabaseClient().from(TABELA).upsert(lote, { onConflict: 'codigo', ignoreDuplicates: false });
    if (error) throw new Error(`Falha ao importar produtos (lote ${i / TAMANHO_LOTE + 1}): ${error.message}`);
    total += lote.length;
  }
  return { inseridos: total };
}
