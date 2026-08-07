-- Retorna somente os limites superiores distintos da tabela aprovada, sem levar
-- dezenas de milhares de itens repetidos para o navegador.
create or replace function public.faixas_peso_negociacao(p_tabela_negociacao_id uuid)
returns table (peso_inicial numeric, peso_final numeric, rotas bigint)
language sql stable security invoker
set search_path = public, pg_temp
as $function$
  select i.peso_inicial, i.peso_final, count(*) as rotas
  from public.tabelas_negociacao_itens i
  where i.tabela_negociacao_id = p_tabela_negociacao_id
    and i.peso_final > i.peso_inicial
  group by i.peso_inicial, i.peso_final
  order by i.peso_inicial, i.peso_final;
$function$;

revoke all on function public.faixas_peso_negociacao(uuid) from public;
grant execute on function public.faixas_peso_negociacao(uuid) to anon, authenticated;

comment on function public.faixas_peso_negociacao(uuid) is
  'Faixas de peso distintas dos itens de uma negociação para cálculo de saving pós-aprovação.';
