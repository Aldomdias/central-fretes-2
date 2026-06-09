-- 4.36.2.4 — Arquitetura por recorte para Avaliação de Prazos
-- Objetivo:
-- - Não carregar listas globais pesadas na abertura da tela.
-- - Carregar opções leves inicialmente.
-- - Carregar transportadoras/modalidades/opções detalhadas somente após recorte.
-- - Manter OFICIAL como padrão; NEGOCIACAO e REAJUSTE como complementares.

create index if not exists idx_mvw_ap_tipo_tabela
  on public.mvw_avaliacao_prazos_cobertura (tipo_tabela_f);

create index if not exists idx_mvw_ap_status
  on public.mvw_avaliacao_prazos_cobertura (status_f);

create index if not exists idx_mvw_ap_fonte_canal
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, canal_f);

create index if not exists idx_mvw_ap_fonte_regiao_origem
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, regiao_origem);

create index if not exists idx_mvw_ap_fonte_regiao_destino
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, regiao_destino);

create index if not exists idx_mvw_ap_fonte_modalidade
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, modalidade_norm);

analyze public.mvw_avaliacao_prazos_cobertura;

create or replace function public.rpc_avaliacao_prazos_opcoes_leves()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'canais', coalesce((
      select jsonb_agg(canal_f order by canal_f)
      from (
        select distinct canal_f
        from public.mvw_avaliacao_prazos_cobertura
        where coalesce(canal_f, '') <> ''
        limit 100
      ) s
    ), '[]'::jsonb),
    'tiposTabela', coalesce((
      select jsonb_agg(tipo_tabela_f order by tipo_tabela_f)
      from (
        select distinct tipo_tabela_f
        from public.mvw_avaliacao_prazos_cobertura
        where coalesce(tipo_tabela_f, '') <> ''
        limit 100
      ) s
    ), '[]'::jsonb),
    'status', coalesce((
      select jsonb_agg(status_f order by status_f)
      from (
        select distinct status_f
        from public.mvw_avaliacao_prazos_cobertura
        where coalesce(status_f, '') <> ''
        limit 100
      ) s
    ), '[]'::jsonb),
    'modalidades', coalesce((
      select jsonb_agg(modalidade order by modalidade)
      from (
        select distinct modalidade
        from public.mvw_avaliacao_prazos_cobertura
        where coalesce(modalidade, '') <> ''
        limit 200
      ) s
    ), '[]'::jsonb),
    'ufsOrigem', coalesce((
      select jsonb_agg(uf_origem_f order by uf_origem_f)
      from (
        select distinct uf_origem_f
        from public.mvw_avaliacao_prazos_cobertura
        where coalesce(uf_origem_f, '') <> ''
        limit 27
      ) s
    ), '[]'::jsonb),
    'resumoGlobal', coalesce((
      select jsonb_object_agg(fonte_tabela, qtd)
      from (
        select fonte_tabela, count(*) as qtd
        from public.mvw_avaliacao_prazos_cobertura
        group by fonte_tabela
      ) s
    ), '{}'::jsonb)
  );
$$;

create or replace function public.rpc_avaliacao_prazos_opcoes_recorte(
  p_fonte text default 'OFICIAL',
  p_busca text default null,
  p_canal text default null,
  p_tipo_tabela text default null,
  p_status text default null,
  p_transportadora text default null,
  p_uf_origem text default null,
  p_uf_destino text default null,
  p_regiao_origem text default null,
  p_regiao_destino text default null,
  p_modalidade text default null,
  p_com_prazo text default null,
  p_limite_transportadoras integer default 500
)
returns jsonb
language sql
stable
as $$
  with f as (
    select
      transportadora,
      canal_f,
      tipo_tabela_f,
      status_f,
      modalidade,
      uf_origem_f
    from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  )
  select jsonb_build_object(
    'canais', coalesce((
      select jsonb_agg(canal_f order by canal_f)
      from (select distinct canal_f from f where coalesce(canal_f, '') <> '' limit 100) s
    ), '[]'::jsonb),
    'tiposTabela', coalesce((
      select jsonb_agg(tipo_tabela_f order by tipo_tabela_f)
      from (select distinct tipo_tabela_f from f where coalesce(tipo_tabela_f, '') <> '' limit 100) s
    ), '[]'::jsonb),
    'status', coalesce((
      select jsonb_agg(status_f order by status_f)
      from (select distinct status_f from f where coalesce(status_f, '') <> '' limit 100) s
    ), '[]'::jsonb),
    'transportadoras', coalesce((
      select jsonb_agg(transportadora order by transportadora)
      from (
        select distinct transportadora
        from f
        where coalesce(transportadora, '') <> ''
        order by transportadora
        limit greatest(coalesce(p_limite_transportadoras, 500), 0)
      ) s
    ), '[]'::jsonb),
    'modalidades', coalesce((
      select jsonb_agg(modalidade order by modalidade)
      from (select distinct modalidade from f where coalesce(modalidade, '') <> '' limit 200) s
    ), '[]'::jsonb),
    'ufsOrigem', coalesce((
      select jsonb_agg(uf_origem_f order by uf_origem_f)
      from (select distinct uf_origem_f from f where coalesce(uf_origem_f, '') <> '' limit 27) s
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.rpc_avaliacao_prazos_opcoes_leves() to anon, authenticated;
grant execute on function public.rpc_avaliacao_prazos_opcoes_recorte(
  text,text,text,text,text,text,text,text,text,text,text,text,integer
) to anon, authenticated;

notify pgrst, 'reload schema';
