-- Snapshots da análise "Perda por Transportadora Mais Cara".
-- 1 linha por (competência, canal) — re-salvar o mesmo mês/canal ATUALIZA a linha.
-- Guarda indicadores + rankings + os 100 principais casos (NUNCA CT-e a CT-e completo).
-- Idempotente: pode rodar de novo sem erro. Rode no Supabase > SQL Editor.

create table if not exists public.perda_realizado_snapshots (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  rotulo text,
  competencia text not null,
  canal text not null default 'TODOS',
  periodo_inicio date,
  periodo_fim date,
  filtros jsonb not null default '{}'::jsonb,
  resumo jsonb not null default '{}'::jsonb,
  top_origens jsonb not null default '[]'::jsonb,
  por_transportadora jsonb not null default '[]'::jsonb,
  prazo_stats jsonb not null default '{}'::jsonb,
  total_ctes integer not null default 0,
  ctes_com_perda integer not null default 0,
  perda_total numeric(18,2) not null default 0,
  perda_media numeric(18,2) not null default 0,
  constraint perda_snap_competencia_canal_uk unique (competencia, canal)
);

-- Campos do dashboard rico (add-if-not-exists pra quem já criou a tabela na v1):
alter table public.perda_realizado_snapshots add column if not exists por_ganhadora jsonb not null default '[]'::jsonb;
alter table public.perda_realizado_snapshots add column if not exists por_destino   jsonb not null default '[]'::jsonb;
alter table public.perda_realizado_snapshots add column if not exists top_casos     jsonb not null default '[]'::jsonb;

create index if not exists idx_perda_snap_competencia on public.perda_realizado_snapshots (competencia);
create index if not exists idx_perda_snap_canal on public.perda_realizado_snapshots (canal);

grant all on public.perda_realizado_snapshots to anon, authenticated, service_role;
