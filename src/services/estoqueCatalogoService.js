import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

// Disponível = soma do "Estoque detalhado" (estoque_por_centro), a mesma base
// usada pra mapear origens — assim catálogo e simulação mostram o mesmo número.
export async function listarEstoquePorCodigos(codigos = []) {
  if (!isSupabaseConfigured()) return new Map();
  const unicos = Array.from(new Set((codigos || []).map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)));
  if (!unicos.length) return new Map();

  const mapa = new Map();
  const TAMANHO_LOTE = 100;
  const TAMANHO_PAGINA = 1000;
  for (let i = 0; i < unicos.length; i += TAMANHO_LOTE) {
    const lote = unicos.slice(i, i + TAMANHO_LOTE);
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await getSupabaseClient()
        .from('estoque_por_centro')
        .select('id,codigo,quantidade')
        .in('codigo', lote)
        .order('id', { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (error) throw new Error(`Não foi possível carregar o estoque: ${error.message}`);
      (data || []).forEach((item) => {
        const chave = String(item.codigo).toUpperCase();
        const atual = mapa.get(chave) || { codigo: chave, disponivel: 0 };
        atual.disponivel += Number(item.quantidade || 0);
        mapa.set(chave, atual);
      });
      if (!data || data.length < TAMANHO_PAGINA) break;
    }
  }
  return mapa;
}

const TABELA_POR_CENTRO = 'estoque_por_centro';

// Estoque de um produto quebrado por centro (origem), usado pra mapear só as
// cidades que têm estoque suficiente antes de buscar as transportadoras.
export async function listarEstoquePorCentroDoCodigo(codigo) {
  if (!isSupabaseConfigured() || !codigo) return [];
  const { data, error } = await getSupabaseClient()
    .from(TABELA_POR_CENTRO)
    .select('centro,quantidade')
    .eq('codigo', String(codigo).trim().toUpperCase());
  if (error) throw new Error(`Não foi possível carregar o estoque por centro: ${error.message}`);
  return data || [];
}

// Substitui todo o estoque por centro pelo conteúdo da planilha "Estoque detalhado".
export async function importarEstoquePorCentro(linhas) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const mapeados = (linhas || [])
    .map((linha) => ({
      codigo: String(linha.codigo || '').trim().toUpperCase(),
      centro: String(linha.centro || '').trim().toUpperCase(),
      quantidade: Number(linha.quantidade) || 0,
      updated_at: new Date().toISOString(),
    }))
    .filter((linha) => linha.codigo && linha.centro);

  const porChave = new Map();
  mapeados.forEach((linha) => porChave.set(`${linha.codigo}::${linha.centro}`, linha));
  const registros = Array.from(porChave.values());

  if (!registros.length) return { inseridos: 0 };

  // A planilha é uma foto completa do estoque: célula vazia = zerou. Só com upsert,
  // um centro que zerou continuaria com o saldo antigo, então apaga tudo antes.
  const { error: erroLimpeza } = await getSupabaseClient().from(TABELA_POR_CENTRO).delete().not('codigo', 'is', null);
  if (erroLimpeza) throw new Error(`Não foi possível limpar o estoque por centro anterior: ${erroLimpeza.message}`);

  const TAMANHO_LOTE = 500;
  let total = 0;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
    const lote = registros.slice(i, i + TAMANHO_LOTE);
    // eslint-disable-next-line no-await-in-loop
    const { error } = await getSupabaseClient().from(TABELA_POR_CENTRO).upsert(lote, { onConflict: 'codigo,centro', ignoreDuplicates: false });
    if (error) throw new Error(`Falha ao importar estoque por centro (lote ${i / TAMANHO_LOTE + 1}): ${error.message}`);
    total += lote.length;
  }
  return { inseridos: total };
}
