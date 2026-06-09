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
