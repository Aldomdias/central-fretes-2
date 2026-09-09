const PAGE_SIZE = 1000;

// O PostgREST/Supabase pode limitar cada resposta a 1.000 linhas mesmo quando
// nenhum .limit() foi informado. O resumo mensal precisa, portanto, reler todas
// as páginas do mês salvo para não consolidar apenas a primeira página.
export async function carregarResultadosSalvosCompetenciaPaginados(supabase, competencia) {
  const registros = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('auditoria_cte_resultados')
      .select('*')
      .eq('competencia', competencia)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { data: registros, error };

    const lote = data || [];
    registros.push(...lote);
    if (lote.length < PAGE_SIZE) break;
  }

  return { data: registros, error: null };
}
