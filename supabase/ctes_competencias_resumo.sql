create table if not exists public.ctes_competencias_resumo (
  id uuid primary key default gen_random_uuid(),
  competencia text not null,
  nome_competencia text,
  data_inicio date,
  data_fim date,
  total_ctes bigint not null default 0,
  valor_total_cte numeric(14, 2) not null default 0,
  valor_total_nf numeric(14, 2) not null default 0,
  percentual_frete_nf numeric(10, 4) not null default 0,
  peso_total numeric(14, 3) not null default 0,
  peso_medio_cte numeric(14, 3) not null default 0,
  volumes_total numeric(14, 3) not null default 0,
  volumes_dia numeric(14, 3) not null default 0,
  cargas_dia numeric(14, 3) not null default 0,
  ticket_medio_cte numeric(14, 2) not null default 0,
  total_transportadoras integer not null default 0,
  total_rotas integer not null default 0,
  total_com_calculo bigint not null default 0,
  total_sem_calculo bigint not null default 0,
  filtros_hash text not null,
  filtros_json jsonb not null default '{}'::jsonb,
  resumo_transportadoras_json jsonb not null default '[]'::jsonb,
  resumo_regioes_json jsonb not null default '[]'::jsonb,
  resumo_ufs_destino_json jsonb not null default '[]'::jsonb,
  resumo_ufs_origem_json jsonb not null default '[]'::jsonb,
  resumo_origens_json jsonb not null default '[]'::jsonb,
  resumo_destinos_json jsonb not null default '[]'::jsonb,
  resumo_rotas_json jsonb not null default '[]'::jsonb,
  resumo_canais_json jsonb not null default '[]'::jsonb,
  observacao text,
  usuario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competencia, filtros_hash)
);

create index if not exists idx_ctes_competencias_resumo_competencia
  on public.ctes_competencias_resumo (competencia);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.ctes_competencias_resumo to anon, authenticated;

alter table public.ctes_competencias_resumo enable row level security;

drop policy if exists "ctes_competencias_resumo_select" on public.ctes_competencias_resumo;
create policy "ctes_competencias_resumo_select"
  on public.ctes_competencias_resumo
  for select
  to anon, authenticated
  using (true);

drop policy if exists "ctes_competencias_resumo_insert" on public.ctes_competencias_resumo;
create policy "ctes_competencias_resumo_insert"
  on public.ctes_competencias_resumo
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "ctes_competencias_resumo_update" on public.ctes_competencias_resumo;
create policy "ctes_competencias_resumo_update"
  on public.ctes_competencias_resumo
  for update
  to anon, authenticated
  using (true)
  with check (true);
