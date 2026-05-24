create or replace function public.reajustes_realizado_diario_local(
  p_inicio date default null,
  p_fim date default null
)
returns table (
  transportadora text,
  data_emissao date,
  ctes bigint,
  valor_cte numeric,
  valor_nf numeric,
  peso numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    trim(r.transportadora) as transportadora,
    r.data_emissao::date as data_emissao,
    count(*)::bigint as ctes,
    coalesce(sum(r.valor_cte), 0)::numeric as valor_cte,
    coalesce(sum(r.valor_nf), 0)::numeric as valor_nf,
    coalesce(sum(coalesce(r.peso, r.peso_declarado, r.peso_cubado, 0)), 0)::numeric as peso
  from public.realizado_local_ctes r
  where r.data_emissao is not null
    and nullif(trim(coalesce(r.transportadora, '')), '') is not null
    and nullif(trim(coalesce(r.canal, '')), '') is not null
    and (p_inicio is null or r.data_emissao::date >= p_inicio)
    and (p_fim is null or r.data_emissao::date <= p_fim)
  group by trim(r.transportadora), r.data_emissao::date
  order by r.data_emissao::date, trim(r.transportadora);
$$;

grant execute on function public.reajustes_realizado_diario_local(date, date) to anon, authenticated;

