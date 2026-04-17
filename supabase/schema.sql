create extension if not exists pgcrypto;

create table if not exists public.cadastros_snapshot (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.frete_importacoes (
  id uuid primary key default gen_random_uuid(),
  arquivo text not null,
  tipo text not null,
  canal text,
  inseridos integer not null default 0,
  erros jsonb not null default '[]'::jsonb,
  meta jsonb,
  created_at timestamptz not null default now()
);

alter table public.cadastros_snapshot
  add column if not exists created_at timestamptz not null default now();
alter table public.cadastros_snapshot
  add column if not exists updated_at timestamptz not null default now();
alter table public.cadastros_snapshot
  add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.cadastros_snapshot
  add column if not exists chave text;
create unique index if not exists cadastros_snapshot_chave_idx on public.cadastros_snapshot(chave);

alter table public.frete_importacoes
  add column if not exists arquivo text;
alter table public.frete_importacoes
  add column if not exists tipo text;
alter table public.frete_importacoes
  add column if not exists canal text;
alter table public.frete_importacoes
  add column if not exists inseridos integer not null default 0;
alter table public.frete_importacoes
  add column if not exists erros jsonb not null default '[]'::jsonb;
alter table public.frete_importacoes
  add column if not exists meta jsonb;
alter table public.frete_importacoes
  add column if not exists created_at timestamptz not null default now();

drop trigger if exists set_cadastros_snapshot_updated_at on public.cadastros_snapshot;
drop function if exists public.set_updated_at_timestamp();
create function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_cadastros_snapshot_updated_at
before update on public.cadastros_snapshot
for each row
execute function public.set_updated_at_timestamp();

alter table public.cadastros_snapshot enable row level security;
alter table public.frete_importacoes enable row level security;

drop policy if exists "cadastros_snapshot_select" on public.cadastros_snapshot;
drop policy if exists "cadastros_snapshot_insert" on public.cadastros_snapshot;
drop policy if exists "cadastros_snapshot_update" on public.cadastros_snapshot;
create policy "cadastros_snapshot_select" on public.cadastros_snapshot
for select to anon, authenticated using (true);
create policy "cadastros_snapshot_insert" on public.cadastros_snapshot
for insert to anon, authenticated with check (true);
create policy "cadastros_snapshot_update" on public.cadastros_snapshot
for update to anon, authenticated using (true) with check (true);

drop policy if exists "frete_importacoes_select" on public.frete_importacoes;
drop policy if exists "frete_importacoes_insert" on public.frete_importacoes;
create policy "frete_importacoes_select" on public.frete_importacoes
for select to anon, authenticated using (true);
create policy "frete_importacoes_insert" on public.frete_importacoes
for insert to anon, authenticated with check (true);
