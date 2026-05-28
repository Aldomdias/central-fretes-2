-- PROMPT 4.18
-- Resumos mensais dos CT-es realizados.
-- Idempotente: pode ser executado novamente sem recriar dados existentes.

create extension if not exists pgcrypto;

create table if not exists public.realizado_ctes_resumos_mensais (
  id uuid primary key default gen_random_uuid(),
  competencia text,
  periodo_inicio date,
  periodo_fim date,
  total_ctes bigint not null default 0,
  total_transportadoras integer not null default 0,
  total_origens integer not null default 0,
  total_destinos integer not null default 0,
  valor_total_cte numeric(20,6) not null default 0,
  valor_total_nf numeric(20,6) not null default 0,
  peso_total numeric(20,6) not null default 0,
  cubagem_total numeric(20,6) not null default 0,
  volumes_totais numeric(20,6) not null default 0,
  frete_sobre_nf numeric(14,6) not null default 0,
  resumo_transportadora jsonb not null default '[]'::jsonb,
  resumo_origem jsonb not null default '[]'::jsonb,
  resumo_uf_destino jsonb not null default '[]'::jsonb,
  resumo_canal jsonb not null default '[]'::jsonb,
  filtros jsonb not null default '{}'::jsonb,
  usuario_responsavel text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.realizado_ctes_resumos_mensais add column if not exists competencia text;
alter table public.realizado_ctes_resumos_mensais add column if not exists periodo_inicio date;
alter table public.realizado_ctes_resumos_mensais add column if not exists periodo_fim date;
alter table public.realizado_ctes_resumos_mensais add column if not exists total_ctes bigint not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists total_transportadoras integer not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists total_origens integer not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists total_destinos integer not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists valor_total_cte numeric(20,6) not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists valor_total_nf numeric(20,6) not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists peso_total numeric(20,6) not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists cubagem_total numeric(20,6) not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists volumes_totais numeric(20,6) not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists frete_sobre_nf numeric(14,6) not null default 0;
alter table public.realizado_ctes_resumos_mensais add column if not exists resumo_transportadora jsonb not null default '[]'::jsonb;
alter table public.realizado_ctes_resumos_mensais add column if not exists resumo_origem jsonb not null default '[]'::jsonb;
alter table public.realizado_ctes_resumos_mensais add column if not exists resumo_uf_destino jsonb not null default '[]'::jsonb;
alter table public.realizado_ctes_resumos_mensais add column if not exists resumo_canal jsonb not null default '[]'::jsonb;
alter table public.realizado_ctes_resumos_mensais add column if not exists filtros jsonb not null default '{}'::jsonb;
alter table public.realizado_ctes_resumos_mensais add column if not exists usuario_responsavel text;
alter table public.realizado_ctes_resumos_mensais add column if not exists criado_em timestamptz not null default now();
alter table public.realizado_ctes_resumos_mensais add column if not exists atualizado_em timestamptz not null default now();

create index if not exists idx_realizado_ctes_resumos_mensais_competencia
  on public.realizado_ctes_resumos_mensais (competencia);

create index if not exists idx_realizado_ctes_resumos_mensais_periodo
  on public.realizado_ctes_resumos_mensais (periodo_inicio, periodo_fim);

create index if not exists idx_realizado_ctes_resumos_mensais_criado
  on public.realizado_ctes_resumos_mensais (criado_em desc);

create or replace function public.set_realizado_ctes_resumos_mensais_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists trg_realizado_ctes_resumos_mensais_updated_at on public.realizado_ctes_resumos_mensais;
create trigger trg_realizado_ctes_resumos_mensais_updated_at
before update on public.realizado_ctes_resumos_mensais
for each row execute function public.set_realizado_ctes_resumos_mensais_updated_at();

alter table public.realizado_ctes_resumos_mensais disable row level security;

grant select, insert, update, delete on public.realizado_ctes_resumos_mensais to anon, authenticated;
