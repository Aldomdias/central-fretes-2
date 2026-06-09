-- 4.36.2.7 — Performance das RPCs de Avaliação de Prazos
-- Corrige timeout em recortes amplos (ex.: ATACADO) e alinha filtros UF/região com IBGE.

create or replace function public.amd_ap_ibge_prefixo_uf(p_uf text)
returns text
language sql
immutable
as $$
  select case upper(left(coalesce(p_uf, ''), 2))
    when 'RO' then '11' when 'AC' then '12' when 'AM' then '13' when 'RR' then '14'
    when 'PA' then '15' when 'AP' then '16' when 'TO' then '17'
    when 'MA' then '21' when 'PI' then '22' when 'CE' then '23' when 'RN' then '24'
    when 'PB' then '25' when 'PE' then '26' when 'AL' then '27' when 'SE' then '28'
    when 'BA' then '29'
    when 'MG' then '31' when 'ES' then '32' when 'RJ' then '33' when 'SP' then '35'
    when 'PR' then '41' when 'SC' then '42' when 'RS' then '43'
    when 'MS' then '50' when 'MT' then '51' when 'GO' then '52' when 'DF' then '53'
    else null
  end;
$$;

create or replace function public.amd_ap_match_uf_destino(
  p_uf text,
  p_uf_destino_f text,
  p_ibge_destino text
)
returns boolean
language sql
immutable
as $$
  select case
    when nullif(trim(coalesce(p_uf, '')), '') is null then true
    else upper(left(coalesce(p_uf_destino_f, ''), 2)) = upper(trim(p_uf))
      or (
        public.amd_ap_ibge_prefixo_uf(p_uf) is not null
        and coalesce(p_ibge_destino, '') like public.amd_ap_ibge_prefixo_uf(p_uf) || '%'
      )
  end;
$$;

create or replace function public.amd_ap_match_regiao_destino(
  p_regiao text,
  p_uf_destino_f text,
  p_ibge_destino text,
  p_regiao_destino text
)
returns boolean
language sql
immutable
as $$
  select case
    when nullif(trim(coalesce(p_regiao, '')), '') is null then true
    when upper(trim(p_regiao)) = upper(trim(coalesce(p_regiao_destino, ''))) then true
    else exists (
      select 1
      from unnest(case upper(trim(p_regiao))
        when 'NORTE' then array['AC','AP','AM','PA','RO','RR','TO']
        when 'NORDESTE' then array['AL','BA','CE','MA','PB','PE','PI','RN','SE']
        when 'CENTRO-OESTE' then array['DF','GO','MT','MS']
        when 'SUDESTE' then array['ES','MG','RJ','SP']
        when 'SUL' then array['PR','RS','SC']
        else array[]::text[]
      end) as uf(uf)
      where public.amd_ap_match_uf_destino(uf.uf, p_uf_destino_f, p_ibge_destino)
    )
  end;
$$;

create or replace function public.amd_ap_filtrado(
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
  p_com_prazo text default null
)
returns setof public.mvw_avaliacao_prazos_cobertura
language sql
stable
as $$
  select mv.*
  from public.mvw_avaliacao_prazos_cobertura mv
  where (nullif(trim(coalesce(p_fonte, '')), '') is null or mv.fonte_tabela = upper(trim(p_fonte)))
    and (nullif(trim(coalesce(p_canal, '')), '') is null or mv.canal_f = upper(trim(p_canal)))
    and (nullif(trim(coalesce(p_tipo_tabela, '')), '') is null or mv.tipo_tabela_f = upper(trim(p_tipo_tabela)))
    and (nullif(trim(coalesce(p_status, '')), '') is null or mv.status_f = upper(trim(p_status)))
    and (nullif(trim(coalesce(p_transportadora, '')), '') is null or mv.transportadora_norm = public.amd_normalizar(p_transportadora))
    and (nullif(trim(coalesce(p_uf_origem, '')), '') is null or mv.uf_origem_f = upper(trim(p_uf_origem)))
    and public.amd_ap_match_uf_destino(p_uf_destino, mv.uf_destino_f, mv.ibge_destino)
    and (nullif(trim(coalesce(p_regiao_origem, '')), '') is null or mv.regiao_origem = upper(trim(p_regiao_origem)))
    and public.amd_ap_match_regiao_destino(p_regiao_destino, mv.uf_destino_f, mv.ibge_destino, mv.regiao_destino)
    and (nullif(trim(coalesce(p_modalidade, '')), '') is null or mv.modalidade_norm = public.amd_normalizar(p_modalidade))
    and (
      nullif(trim(coalesce(p_com_prazo, '')), '') is null
      or (upper(trim(p_com_prazo)) = 'COM_PRAZO' and mv.prazo > 0)
      or (upper(trim(p_com_prazo)) = 'SEM_PRAZO' and mv.prazo <= 0)
    )
    and (
      nullif(trim(coalesce(p_busca, '')), '') is null
      or mv.busca_norm like '%' || public.amd_normalizar(p_busca) || '%'
    );
$$;

create or replace function public.rpc_avaliacao_prazos_kpis(
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
  p_com_prazo text default null
)
returns table (
  registros bigint,
  oficiais bigint,
  negociacao bigint,
  transportadoras bigint,
  transportadoras_oficiais bigint,
  menor_prazo integer,
  prazo_medio numeric,
  rotas bigint,
  rotas_oficiais bigint,
  rotas_baixa_cobertura bigint,
  ufs_sem_cobertura_oficial integer
)
language sql
stable
as $$
  with f as (
    select
      fonte_tabela,
      transportadora_norm,
      prazo,
      uf_destino_f,
      regiao_destino,
      rota_key
    from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  ),
  linhas as (
    select
      count(*)::bigint as registros,
      count(*) filter (where fonte_tabela = 'OFICIAL')::bigint as oficiais,
      count(*) filter (where fonte_tabela <> 'OFICIAL')::bigint as negociacao,
      count(distinct transportadora_norm) filter (where transportadora_norm <> '')::bigint as transportadoras,
      count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL' and transportadora_norm <> '')::bigint as transportadoras_oficiais,
      coalesce(min(prazo) filter (where prazo > 0), 0)::integer as menor_prazo,
      coalesce(round(avg(prazo) filter (where prazo > 0)::numeric, 2), 0) as prazo_medio,
      count(distinct uf_destino_f) filter (
        where fonte_tabela = 'OFICIAL' and uf_destino_f <> '' and regiao_destino <> ''
      )::integer as ufs_com_oficial
    from f
  ),
  rota as (
    select
      rota_key,
      count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL') as ofi
    from f
    group by rota_key
  ),
  rotas as (
    select
      count(*)::bigint as rotas,
      count(*) filter (where ofi > 0)::bigint as rotas_oficiais,
      count(*) filter (where ofi <= 1)::bigint as rotas_baixa_cobertura
    from rota
  )
  select
    linhas.registros,
    linhas.oficiais,
    linhas.negociacao,
    linhas.transportadoras,
    linhas.transportadoras_oficiais,
    linhas.menor_prazo,
    linhas.prazo_medio,
    rotas.rotas,
    rotas.rotas_oficiais,
    rotas.rotas_baixa_cobertura,
    (27 - linhas.ufs_com_oficial)::integer as ufs_sem_cobertura_oficial
  from linhas
  cross join rotas;
$$;

create or replace function public.rpc_avaliacao_prazos_linhas(
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
  p_limite integer default 300,
  p_offset integer default 0
)
returns table (
  id text,
  tabela_negociacao_id text,
  transportadora text,
  canal text,
  tipo_tabela text,
  tipo_negociacao text,
  status text,
  tabela_nome text,
  origem_importacao text,
  modalidade text,
  cidade_origem text,
  uf_origem text,
  ibge_origem text,
  cidade_destino text,
  uf_destino text,
  ibge_destino text,
  prazo integer,
  valor_referencia numeric,
  observacao text,
  fonte_tabela text,
  fonte_label text,
  fonte_prioridade integer,
  total bigint
)
language sql
stable
as $$
  with f as (
    select *
    from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  ),
  total_linhas as (
    select count(*)::bigint as total from f
  )
  select
    f.id, f.tabela_negociacao_id, f.transportadora, f.canal, f.tipo_tabela, f.tipo_negociacao,
    f.status, f.tabela_nome, f.origem_importacao, f.modalidade, f.cidade_origem, f.uf_origem,
    f.ibge_origem, f.cidade_destino, f.uf_destino, f.ibge_destino, f.prazo, f.valor_referencia,
    f.observacao, f.fonte_tabela, f.fonte_label, f.fonte_prioridade,
    (select total from total_linhas) as total
  from f
  order by f.fonte_prioridade asc nulls last, f.transportadora asc nulls last, f.rota_label asc
  limit greatest(coalesce(p_limite, 300), 0)
  offset greatest(coalesce(p_offset, 0), 0);
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
    select canal_f, tipo_tabela_f, status_f, modalidade, uf_origem_f, transportadora
    from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  ),
  transportadoras as (
    select distinct transportadora
    from f
    where coalesce(transportadora, '') <> ''
    order by transportadora
    limit greatest(coalesce(p_limite_transportadoras, 500), 0)
  )
  select jsonb_build_object(
    'canais', coalesce((
      select jsonb_agg(distinct canal_f order by canal_f)
      from f
      where coalesce(canal_f, '') <> ''
    ), '[]'::jsonb),
    'tiposTabela', coalesce((
      select jsonb_agg(distinct tipo_tabela_f order by tipo_tabela_f)
      from f
      where coalesce(tipo_tabela_f, '') <> ''
    ), '[]'::jsonb),
    'status', coalesce((
      select jsonb_agg(distinct status_f order by status_f)
      from f
      where coalesce(status_f, '') <> ''
    ), '[]'::jsonb),
    'transportadoras', coalesce((
      select jsonb_agg(transportadora order by transportadora) from transportadoras
    ), '[]'::jsonb),
    'modalidades', coalesce((
      select jsonb_agg(distinct modalidade order by modalidade)
      from f
      where coalesce(modalidade, '') <> ''
    ), '[]'::jsonb),
    'ufsOrigem', coalesce((
      select jsonb_agg(distinct uf_origem_f order by uf_origem_f)
      from f
      where coalesce(uf_origem_f, '') <> ''
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.amd_ap_ibge_prefixo_uf(text) to anon, authenticated;
grant execute on function public.amd_ap_match_uf_destino(text, text, text) to anon, authenticated;
grant execute on function public.amd_ap_match_regiao_destino(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
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
-- 4.36.2.9 — Filtro de origem por UF/região com fallback IBGE (espelha destino)

create or replace function public.amd_ap_match_uf_origem(
  p_uf text,
  p_uf_origem_f text,
  p_ibge_origem text
)
returns boolean
language sql
immutable
as $$
  select public.amd_ap_match_uf_destino(p_uf, p_uf_origem_f, p_ibge_origem);
$$;

create or replace function public.amd_ap_match_regiao_origem(
  p_regiao text,
  p_uf_origem_f text,
  p_ibge_origem text,
  p_regiao_origem text
)
returns boolean
language sql
immutable
as $$
  select public.amd_ap_match_regiao_destino(p_regiao, p_uf_origem_f, p_ibge_origem, p_regiao_origem);
$$;

create or replace function public.amd_ap_filtrado(
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
  p_com_prazo text default null
)
returns setof public.mvw_avaliacao_prazos_cobertura
language sql
stable
as $$
  select mv.*
  from public.mvw_avaliacao_prazos_cobertura mv
  where (nullif(trim(coalesce(p_fonte, '')), '') is null or mv.fonte_tabela = upper(trim(p_fonte)))
    and (nullif(trim(coalesce(p_canal, '')), '') is null or mv.canal_f = upper(trim(p_canal)))
    and (nullif(trim(coalesce(p_tipo_tabela, '')), '') is null or mv.tipo_tabela_f = upper(trim(p_tipo_tabela)))
    and (nullif(trim(coalesce(p_status, '')), '') is null or mv.status_f = upper(trim(p_status)))
    and (nullif(trim(coalesce(p_transportadora, '')), '') is null or mv.transportadora_norm = public.amd_normalizar(p_transportadora))
    and public.amd_ap_match_uf_origem(p_uf_origem, mv.uf_origem_f, mv.ibge_origem)
    and public.amd_ap_match_regiao_origem(p_regiao_origem, mv.uf_origem_f, mv.ibge_origem, mv.regiao_origem)
    and public.amd_ap_match_uf_destino(p_uf_destino, mv.uf_destino_f, mv.ibge_destino)
    and public.amd_ap_match_regiao_destino(p_regiao_destino, mv.uf_destino_f, mv.ibge_destino, mv.regiao_destino)
    and (nullif(trim(coalesce(p_modalidade, '')), '') is null or mv.modalidade_norm = public.amd_normalizar(p_modalidade))
    and (
      nullif(trim(coalesce(p_com_prazo, '')), '') is null
      or (upper(trim(p_com_prazo)) = 'COM_PRAZO' and mv.prazo > 0)
      or (upper(trim(p_com_prazo)) = 'SEM_PRAZO' and mv.prazo <= 0)
    )
    and (
      nullif(trim(coalesce(p_busca, '')), '') is null
      or mv.busca_norm like '%' || public.amd_normalizar(p_busca) || '%'
    );
$$;

grant execute on function public.amd_ap_match_uf_origem(text, text, text) to anon, authenticated;
grant execute on function public.amd_ap_match_regiao_origem(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
-- 4.36.2 — Snapshots regionais de Avaliação de Prazos (agregados, sem linhas brutas)
-- Objetivo: equipe compartilhar visão de KPIs/mapa/lacunas sem reprocessar 200k+ linhas.

create table if not exists public.avaliacao_prazos_snapshots (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  rotulo text not null default '',
  filtros jsonb not null default '{}'::jsonb,
  kpis jsonb not null default '{}'::jsonb,
  mapa jsonb not null default '[]'::jsonb,
  melhores_prazos jsonb not null default '[]'::jsonb,
  rotas_criticas jsonb not null default '[]'::jsonb,
  lacunas jsonb not null default '{}'::jsonb,
  total_linhas integer not null default 0,
  salvo_em timestamptz not null default now(),
  salvo_por text not null default ''
);

create index if not exists idx_avaliacao_prazos_snapshots_salvo_em
  on public.avaliacao_prazos_snapshots (salvo_em desc);

alter table public.avaliacao_prazos_snapshots enable row level security;

drop policy if exists "avaliacao_prazos_snapshots_public_access" on public.avaliacao_prazos_snapshots;
create policy "avaliacao_prazos_snapshots_public_access"
  on public.avaliacao_prazos_snapshots
  for all
  using (true)
  with check (true);

comment on table public.avaliacao_prazos_snapshots is
  'Snapshots agregados da Avaliação de Prazos 4.36.2 — KPIs, mapa, lacunas. Linhas completas só via export.';
-- 4.36.2.10 — Análise regional em uma única passagem (evita 5 scans paralelos + timeout)
-- Rode após 006–009. Índice composto para recortes canal + região origem.

create index if not exists idx_mvw_ap_fonte_canal_regiao_origem
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, canal_f, regiao_origem);

create index if not exists idx_mvw_ap_fonte_canal_regiao_origem_rota
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, canal_f, regiao_origem, rota_key);

create or replace function public.rpc_avaliacao_prazos_analise_completa(
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
  p_limite_rotas_criticas integer default 500,
  p_limite_melhores integer default 20,
  p_limite_lacunas integer default 2000
)
returns jsonb
language plpgsql
stable
set statement_timeout = '180s'
as $$
declare
  v jsonb;
begin
  with f as (
    select
      fonte_tabela,
      transportadora_norm,
      transportadora,
      prazo,
      uf_destino_f,
      regiao_destino,
      regiao_origem,
      rota_key,
      rota_label,
      canal_f
    from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  ),
  linhas as (
    select
      count(*)::bigint as registros,
      count(*) filter (where fonte_tabela = 'OFICIAL')::bigint as oficiais,
      count(*) filter (where fonte_tabela <> 'OFICIAL')::bigint as negociacao,
      count(distinct transportadora_norm) filter (where transportadora_norm <> '')::bigint as transportadoras,
      count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL' and transportadora_norm <> '')::bigint as transportadoras_oficiais,
      coalesce(min(prazo) filter (where prazo > 0), 0)::integer as menor_prazo,
      coalesce(round(avg(prazo) filter (where prazo > 0)::numeric, 2), 0) as prazo_medio,
      count(distinct uf_destino_f) filter (
        where fonte_tabela = 'OFICIAL' and uf_destino_f <> '' and regiao_destino <> ''
      )::integer as ufs_com_oficial
    from f
  ),
  rota_agg as (
    select
      rota_key,
      count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL') as ofi
    from f
    group by rota_key
  ),
  rotas_kpi as (
    select
      count(*)::bigint as rotas,
      count(*) filter (where ofi > 0)::bigint as rotas_oficiais,
      count(*) filter (where ofi <= 1)::bigint as rotas_baixa_cobertura
    from rota_agg
  ),
  kpis as (
    select jsonb_build_object(
      'registros', linhas.registros,
      'oficiais', linhas.oficiais,
      'negociacao', linhas.negociacao,
      'transportadoras', linhas.transportadoras,
      'transportadoras_oficiais', linhas.transportadoras_oficiais,
      'menor_prazo', linhas.menor_prazo,
      'prazo_medio', linhas.prazo_medio,
      'rotas', rotas_kpi.rotas,
      'rotas_oficiais', rotas_kpi.rotas_oficiais,
      'rotas_baixa_cobertura', rotas_kpi.rotas_baixa_cobertura,
      'ufs_sem_cobertura_oficial', (27 - linhas.ufs_com_oficial)
    ) as payload
    from linhas
    cross join rotas_kpi
  ),
  mapa as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'uf', uf_destino_f,
        'regiao', regiao_destino,
        'qtd_rotas', qtd_rotas,
        'qtd_transportadoras', qtd_transportadoras,
        'qtd_transportadoras_oficiais', qtd_transportadoras_oficiais,
        'menor_prazo', menor_prazo,
        'menor_prazo_oficial', menor_prazo_oficial,
        'prazo_medio', prazo_medio
      )
      order by regiao_destino, uf_destino_f
    ), '[]'::jsonb) as payload
    from (
      select
        uf_destino_f,
        regiao_destino,
        count(distinct rota_key) as qtd_rotas,
        count(distinct transportadora_norm) as qtd_transportadoras,
        count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL') as qtd_transportadoras_oficiais,
        coalesce(min(prazo) filter (where prazo > 0), 0)::integer as menor_prazo,
        coalesce(min(prazo) filter (where prazo > 0 and fonte_tabela = 'OFICIAL'), 0)::integer as menor_prazo_oficial,
        coalesce(round(avg(prazo) filter (where prazo > 0)::numeric, 2), 0) as prazo_medio
      from f
      where uf_destino_f <> '' and regiao_destino <> ''
      group by uf_destino_f, regiao_destino
    ) u
  ),
  rk as (
    select
      f.rota_key,
      max(f.rota_label) as rota_label,
      max(f.canal_f) as canal,
      max(f.regiao_origem) as regiao_origem,
      max(f.regiao_destino) as regiao_destino,
      count(distinct f.transportadora_norm) as qtd_transportadoras,
      count(distinct f.transportadora_norm) filter (where f.fonte_tabela = 'OFICIAL') as qtd_transportadoras_oficiais,
      count(distinct f.transportadora_norm) filter (where f.fonte_tabela <> 'OFICIAL') as qtd_transportadoras_negociacao,
      coalesce(min(f.prazo) filter (where f.prazo > 0), 0)::integer as menor_prazo,
      coalesce(max(f.prazo) filter (where f.prazo > 0), 0)::integer as maior_prazo,
      coalesce(round(avg(f.prazo) filter (where f.prazo > 0)::numeric, 2), 0) as prazo_medio
    from f
    group by f.rota_key
  ),
  mel as (
    select f.rota_key, string_agg(distinct f.transportadora, ', ' order by f.transportadora) as melhores
    from f
    join rk on rk.rota_key = f.rota_key
    where f.prazo > 0 and f.prazo = rk.menor_prazo
    group by f.rota_key
  ),
  rotas_criticas as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'rota_key', rk.rota_key,
        'rota_label', rk.rota_label,
        'canal', rk.canal,
        'regiao_origem', rk.regiao_origem,
        'regiao_destino', rk.regiao_destino,
        'qtd_transportadoras', rk.qtd_transportadoras,
        'qtd_transportadoras_oficiais', rk.qtd_transportadoras_oficiais,
        'qtd_transportadoras_negociacao', rk.qtd_transportadoras_negociacao,
        'menor_prazo', rk.menor_prazo,
        'maior_prazo', rk.maior_prazo,
        'prazo_medio', rk.prazo_medio,
        'melhores_transportadoras', coalesce(mel.melhores, '')
      )
      order by rk.qtd_transportadoras_oficiais, rk.qtd_transportadoras, rk.rota_label
    ), '[]'::jsonb) as payload
    from rk
    left join mel on mel.rota_key = rk.rota_key
    where rk.qtd_transportadoras_oficiais <= 1
    limit greatest(coalesce(p_limite_rotas_criticas, 500), 0)
  ),
  melhores_prazos as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'rota_key', rk.rota_key,
        'rota_label', rk.rota_label,
        'canal', rk.canal,
        'regiao_origem', rk.regiao_origem,
        'regiao_destino', rk.regiao_destino,
        'qtd_transportadoras', rk.qtd_transportadoras,
        'qtd_transportadoras_oficiais', rk.qtd_transportadoras_oficiais,
        'qtd_transportadoras_negociacao', rk.qtd_transportadoras_negociacao,
        'menor_prazo', rk.menor_prazo,
        'maior_prazo', rk.maior_prazo,
        'prazo_medio', rk.prazo_medio,
        'melhores_transportadoras', coalesce(mel.melhores, '')
      )
      order by rk.menor_prazo, rk.qtd_transportadoras desc
    ), '[]'::jsonb) as payload
    from rk
    left join mel on mel.rota_key = rk.rota_key
    where rk.menor_prazo > 0
    limit greatest(coalesce(p_limite_melhores, 20), 0)
  ),
  lacunas as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'rota_key', rk.rota_key,
        'rota_label', rk.rota_label,
        'canal', rk.canal,
        'regiao_origem', rk.regiao_origem,
        'regiao_destino', rk.regiao_destino,
        'qtd_transportadoras', rk.qtd_transportadoras,
        'qtd_transportadoras_oficiais', rk.qtd_transportadoras_oficiais,
        'qtd_transportadoras_negociacao', rk.qtd_transportadoras_negociacao,
        'menor_prazo', rk.menor_prazo,
        'prazo_medio', rk.prazo_medio
      )
      order by rk.qtd_transportadoras_oficiais, rk.rota_label
    ), '[]'::jsonb) as payload
    from rk
    where rk.qtd_transportadoras_oficiais <= 1
    limit greatest(coalesce(p_limite_lacunas, 2000), 0)
  )
  select jsonb_build_object(
    'kpis', (select payload from kpis),
    'mapa', (select payload from mapa),
    'rotas_criticas', (select payload from rotas_criticas),
    'melhores_prazos', (select payload from melhores_prazos),
    'lacunas', (select payload from lacunas)
  )
  into v;

  return coalesce(v, '{}'::jsonb);
end;
$$;

grant execute on function public.rpc_avaliacao_prazos_analise_completa(
  text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,integer
) to anon, authenticated;

alter function public.rpc_avaliacao_prazos_kpis(text,text,text,text,text,text,text,text,text,text,text,text)
  set statement_timeout = '120s';
alter function public.rpc_avaliacao_prazos_uf(text,text,text,text,text,text,text,text,text,text,text,text)
  set statement_timeout = '120s';
alter function public.rpc_avaliacao_prazos_rotas(text,text,text,text,text,text,text,text,text,text,text,text,text,integer,boolean,integer,integer)
  set statement_timeout = '120s';
alter function public.rpc_avaliacao_prazos_linhas(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer)
  set statement_timeout = '120s';

notify pgrst, 'reload schema';
