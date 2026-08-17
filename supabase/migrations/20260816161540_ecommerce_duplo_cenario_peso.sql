alter table public.ecommerce_sim_candidatos_origem
  add column if not exists peso_base text not null default 'cotado';

alter table public.ecommerce_sim_candidatos_origem
  drop constraint if exists ecommerce_sim_candidatos_origem_peso_base_check;

alter table public.ecommerce_sim_candidatos_origem
  add constraint ecommerce_sim_candidatos_origem_peso_base_check
  check (peso_base in ('cotado', 'faturado'));

alter table public.ecommerce_order_snapshot
  add column if not exists sim_resultado_cotado jsonb,
  add column if not exists sim_resultado_faturado jsonb;

create index if not exists idx_sim_cand_pedido_peso
  on public.ecommerce_sim_candidatos_origem (pedido_id, peso_base);

drop function if exists public.ecommerce_candidatos_dedup(uuid[]);

create function public.ecommerce_candidatos_dedup(p_pedido_ids uuid[])
returns table(pedido_id uuid, canal text, peso_base text, candidato jsonb)
language sql
stable
security invoker
set search_path = ''
as $function$
  select distinct on (
    e.pedido_id,
    e.peso_base,
    upper(trim(coalesce(e.candidato->>'transportadora', ''))),
    upper(trim(coalesce(e.candidato->>'origem', ''))),
    coalesce(e.candidato->>'ibgeDestino', ''),
    upper(trim(coalesce(e.candidato->>'rotaNome', ''))),
    coalesce(e.candidato->>'faixaPeso', ''),
    coalesce(e.candidato->>'total', '0'),
    coalesce(e.candidato->>'prazo', '0')
  ) e.pedido_id, e.canal, e.peso_base, e.candidato
  from public.ecommerce_sim_candidatos_origem e
  where e.pedido_id = any(p_pedido_ids)
  order by
    e.pedido_id,
    e.peso_base,
    upper(trim(coalesce(e.candidato->>'transportadora', ''))),
    upper(trim(coalesce(e.candidato->>'origem', ''))),
    coalesce(e.candidato->>'ibgeDestino', ''),
    upper(trim(coalesce(e.candidato->>'rotaNome', ''))),
    coalesce(e.candidato->>'faixaPeso', ''),
    coalesce(e.candidato->>'total', '0'),
    coalesce(e.candidato->>'prazo', '0'),
    e.id;
$function$;

grant execute on function public.ecommerce_candidatos_dedup(uuid[]) to anon, authenticated;
