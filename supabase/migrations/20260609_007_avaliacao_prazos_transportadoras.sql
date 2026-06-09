-- 4.36.2.8 — Lista leve de transportadoras por canal (cadastro/rotas, sem varrer a MV inteira)

create or replace function public.rpc_avaliacao_prazos_transportadoras(
  p_fonte text default 'OFICIAL',
  p_canal text default null,
  p_limite integer default 500
)
returns table (transportadora text)
language sql
stable
as $$
  select distinct tr.nome as transportadora
  from public.transportadoras tr
  inner join public.origens o on o.transportadora_id = tr.id
  inner join public.rotas r on r.origem_id = o.id
  where coalesce(nullif(tr.nome, ''), '') <> ''
    and (
      nullif(trim(coalesce(p_canal, '')), '') is null
      or upper(coalesce(nullif(r.canal, ''), nullif(o.canal, ''), 'N/I')) = upper(trim(p_canal))
    )
  order by tr.nome
  limit greatest(coalesce(p_limite, 500), 0);
$$;

grant execute on function public.rpc_avaliacao_prazos_transportadoras(text, text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
