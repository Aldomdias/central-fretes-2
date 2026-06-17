-- Agregado de realizado CT-e para a tela Avaliacao de Prazos.
-- Leve por padrao: agrega no banco por competencia + rota + transportadora
-- e retorna somente o ranking resumido para a aba Transportadoras.

create or replace function public.rpc_avaliacao_prazos_realizado_transportadoras(
  p_competencia text default null,
  p_canal text default null,
  p_transportadora text default null,
  p_uf_origem text default null,
  p_uf_destino text default null,
  p_regiao_origem text default null,
  p_regiao_destino text default null,
  p_busca text default null,
  p_limite integer default 200
)
returns table (
  transportadora text,
  ctes bigint,
  rotas bigint,
  valor_cte_total numeric,
  valor_nf_total numeric,
  ticket_medio numeric,
  percentual_frete_nf numeric,
  pct_medio_sobre_menor_rota numeric,
  menor_ticket_rota numeric,
  maior_ticket_rota numeric
)
language sql
stable
set statement_timeout = '120s'
as $$
  with base as (
    select
      coalesce(nullif(v.nome_tabela, ''), nullif(r.transportadora, ''), 'Nao informado') as transportadora_vinculada,
      coalesce(nullif(r.cidade_origem, ''), 'Origem N/I') as cidade_origem,
      upper(left(coalesce(nullif(r.uf_origem, ''), ''), 2)) as uf_origem,
      coalesce(nullif(r.cidade_destino, ''), 'Destino N/I') as cidade_destino,
      upper(left(coalesce(nullif(r.uf_destino, ''), ''), 2)) as uf_destino,
      upper(coalesce(nullif(r.canal, ''), 'N/I')) as canal,
      coalesce(r.valor_cte, 0)::numeric as valor_cte,
      coalesce(r.valor_nf, 0)::numeric as valor_nf
    from public.realizado_local_ctes r
    left join lateral (
      select tv.nome_tabela
      from public.transportadora_vinculos tv
      where public.normalizar_nome_transportadora(tv.nome_cte) = public.normalizar_nome_transportadora(r.transportadora)
      limit 1
    ) v on true
    where (
        nullif(btrim(coalesce(p_competencia, '')), '') is null
        or r.competencia = btrim(p_competencia)
        or to_char(r.data_emissao::date, 'YYYY-MM') = btrim(p_competencia)
      )
      and (nullif(btrim(coalesce(p_canal, '')), '') is null or upper(coalesce(r.canal, '')) = upper(btrim(p_canal)))
      and (
        nullif(btrim(coalesce(p_transportadora, '')), '') is null
        or public.normalizar_nome_transportadora(coalesce(v.nome_tabela, r.transportadora)) = public.normalizar_nome_transportadora(p_transportadora)
      )
      and (nullif(btrim(coalesce(p_uf_origem, '')), '') is null or upper(left(coalesce(r.uf_origem, ''), 2)) = upper(left(btrim(p_uf_origem), 2)))
      and (nullif(btrim(coalesce(p_uf_destino, '')), '') is null or upper(left(coalesce(r.uf_destino, ''), 2)) = upper(left(btrim(p_uf_destino), 2)))
      and (
        nullif(btrim(coalesce(p_regiao_origem, '')), '') is null
        or public.amd_regiao_uf(r.uf_origem) = upper(btrim(p_regiao_origem))
      )
      and (
        nullif(btrim(coalesce(p_regiao_destino, '')), '') is null
        or public.amd_regiao_uf(r.uf_destino) = upper(btrim(p_regiao_destino))
      )
  ),
  rotas_transportadora as (
    select
      transportadora_vinculada as transportadora,
      (
        public.amd_normalizar(cidade_origem) || '|' || uf_origem || '|'
        || public.amd_normalizar(cidade_destino) || '|' || uf_destino || '|'
        || canal
      ) as rota_key,
      count(*)::bigint as ctes,
      sum(valor_cte)::numeric as valor_cte_total,
      sum(valor_nf)::numeric as valor_nf_total,
      avg(nullif(valor_cte, 0))::numeric as ticket_medio
    from base
    where nullif(btrim(transportadora_vinculada), '') is not null
      and (
        nullif(btrim(coalesce(p_busca, '')), '') is null
        or public.amd_normalizar(
          transportadora_vinculada || ' ' || cidade_origem || ' ' || uf_origem || ' '
          || cidade_destino || ' ' || uf_destino || ' ' || canal
        ) like '%' || public.amd_normalizar(p_busca) || '%'
      )
    group by transportadora_vinculada, rota_key
  ),
  comparado as (
    select
      rt.*,
      min(ticket_medio) filter (where ticket_medio > 0) over (partition by rota_key) as menor_ticket_rota
    from rotas_transportadora rt
  ),
  agregado as (
    select
      transportadora,
      sum(ctes)::bigint as ctes,
      count(distinct rota_key)::bigint as rotas,
      sum(valor_cte_total)::numeric as valor_cte_total,
      sum(valor_nf_total)::numeric as valor_nf_total,
      avg(ticket_medio) filter (where ticket_medio > 0)::numeric as ticket_medio,
      case when sum(valor_nf_total) > 0 then (sum(valor_cte_total) / sum(valor_nf_total)) * 100 else 0 end::numeric as percentual_frete_nf,
      avg(case when menor_ticket_rota > 0 and ticket_medio > 0 then ((ticket_medio / menor_ticket_rota) - 1) * 100 end)::numeric as pct_medio_sobre_menor_rota,
      min(ticket_medio) filter (where ticket_medio > 0)::numeric as menor_ticket_rota,
      max(ticket_medio) filter (where ticket_medio > 0)::numeric as maior_ticket_rota
    from comparado
    group by transportadora
  )
  select
    transportadora,
    ctes,
    rotas,
    round(valor_cte_total, 2),
    round(valor_nf_total, 2),
    round(ticket_medio, 2),
    round(percentual_frete_nf, 4),
    round(pct_medio_sobre_menor_rota, 4),
    round(menor_ticket_rota, 2),
    round(maior_ticket_rota, 2)
  from agregado
  order by pct_medio_sobre_menor_rota asc nulls last, ticket_medio asc nulls last, ctes desc
  limit greatest(1, least(coalesce(p_limite, 200), 1000));
$$;

grant execute on function public.rpc_avaliacao_prazos_realizado_transportadoras(
  text, text, text, text, text, text, text, text, integer
) to anon, authenticated;

notify pgrst, 'reload schema';
