create or replace function public.buscar_realizado_local_ctes_otimizado(
  p_transportadora text,
  p_origem text,
  p_destino text,
  p_canal text,
  p_uf_origem text,
  p_uf_destino text,
  p_inicio date,
  p_fim date,
  p_limite integer,
  p_offset integer
)
returns setof public.realizado_local_ctes
language sql
stable
security invoker
set search_path = public
as $$
  select r.*
  from public.realizado_local_ctes r
  where (coalesce(p_transportadora, '') = '' or upper(coalesce(r.transportadora, '')) like ('%' || upper(p_transportadora) || '%'))
    and (coalesce(p_origem, '') = '' or upper(coalesce(r.cidade_origem, '')) like (upper(p_origem) || '%'))
    and (coalesce(p_destino, '') = '' or upper(coalesce(r.cidade_destino, '')) like (upper(p_destino) || '%'))
    and (coalesce(p_uf_origem, '') = '' or r.uf_origem = p_uf_origem)
    and (coalesce(p_uf_destino, '') = '' or r.uf_destino = p_uf_destino)
    and (p_inicio is null or r.data_emissao >= p_inicio)
    and (p_fim is null or r.data_emissao <= p_fim)
    and (
      coalesce(p_canal, '') = ''
      or (p_canal = 'B2C' and (upper(coalesce(r.canal, '')) like 'B2C%' or upper(coalesce(r.canal, '')) like '%ECOMMERCE%' or upper(coalesce(r.canal, '')) like '%MARKETPLACE%'))
      or (p_canal = 'ATACADO' and (upper(coalesce(r.canal, '')) like 'ATACADO%' or upper(coalesce(r.canal, '')) like 'B2B%'))
      or upper(coalesce(r.canal, '')) like (upper(p_canal) || '%')
    )
  order by r.data_emissao desc nulls last
  limit least(greatest(coalesce(p_limite, 200), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.buscar_realizado_local_ctes_otimizado(text, text, text, text, text, text, date, date, integer, integer) to anon, authenticated;
