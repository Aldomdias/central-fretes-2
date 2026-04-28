-- VIEW DE COBERTURA PARA CONFIABILIDADE DA BASE
-- Rode no Supabase > SQL Editor.
-- Essa view permite que a tela Transportadoras mostre Completa/Parcial/Inconsistente
-- sem abrir cada transportadora e sem baixar as 312 mil rotas no navegador.

create index if not exists idx_rotas_origem_nome_rota_lower
on public.rotas (origem_id, lower(trim(coalesce(nome_rota, ''))));

create index if not exists idx_cotacoes_origem_rota_lower
on public.cotacoes (origem_id, lower(trim(coalesce(rota, ''))));

create or replace view public.vw_cobertura_transportadoras as
with rotas_por_origem as (
  select origem_id, count(*)::bigint as total_rotas
  from public.rotas
  group by origem_id
),
cotacoes_por_origem as (
  select origem_id, count(*)::bigint as total_cotacoes
  from public.cotacoes
  group by origem_id
),
rotas_sem_frete_por_origem as (
  select r.origem_id, count(*)::bigint as rotas_sem_frete
  from public.rotas r
  where not exists (
    select 1
    from public.cotacoes c
    where c.origem_id = r.origem_id
      and lower(trim(coalesce(c.rota, ''))) = lower(trim(coalesce(r.nome_rota, '')))
  )
  group by r.origem_id
),
fretes_sem_rota_por_origem as (
  select c.origem_id, count(*)::bigint as fretes_sem_rota
  from public.cotacoes c
  where not exists (
    select 1
    from public.rotas r
    where r.origem_id = c.origem_id
      and lower(trim(coalesce(r.nome_rota, ''))) = lower(trim(coalesce(c.rota, '')))
  )
  group by c.origem_id
),
cobertura_origem as (
  select
    o.id as origem_id,
    o.transportadora_id,
    coalesce(r.total_rotas, 0)::bigint as total_rotas,
    coalesce(c.total_cotacoes, 0)::bigint as total_cotacoes,
    coalesce(rs.rotas_sem_frete, 0)::bigint as rotas_sem_frete,
    coalesce(fs.fretes_sem_rota, 0)::bigint as fretes_sem_rota,
    case
      when coalesce(rs.rotas_sem_frete, 0) > 0 or coalesce(fs.fretes_sem_rota, 0) > 0 then 'Inconsistente'
      when coalesce(r.total_rotas, 0) = 0 or coalesce(c.total_cotacoes, 0) = 0 then 'Parcial'
      else 'Completa'
    end as status_origem
  from public.origens o
  left join rotas_por_origem r on r.origem_id = o.id
  left join cotacoes_por_origem c on c.origem_id = o.id
  left join rotas_sem_frete_por_origem rs on rs.origem_id = o.id
  left join fretes_sem_rota_por_origem fs on fs.origem_id = o.id
)
select
  t.id as transportadora_id,
  t.nome as transportadora_nome,
  count(co.origem_id)::bigint as total_origens,
  coalesce(sum(co.total_rotas), 0)::bigint as total_rotas,
  coalesce(sum(co.total_cotacoes), 0)::bigint as total_cotacoes,
  coalesce(sum(co.rotas_sem_frete), 0)::bigint as rotas_sem_frete,
  coalesce(sum(co.fretes_sem_rota), 0)::bigint as fretes_sem_rota,
  count(*) filter (where co.status_origem <> 'Completa')::bigint as origens_pendentes,
  count(*) filter (where co.status_origem = 'Inconsistente')::bigint as origens_inconsistentes,
  case
    when count(co.origem_id) = 0 then 'Parcial'
    when count(*) filter (where co.status_origem = 'Inconsistente') > 0 then 'Inconsistente'
    when count(*) filter (where co.status_origem <> 'Completa') > 0 then 'Parcial'
    else 'Completa'
  end as status_cobertura
from public.transportadoras t
left join cobertura_origem co on co.transportadora_id = t.id
group by t.id, t.nome;

select *
from public.vw_cobertura_transportadoras
order by transportadora_nome
limit 20;
