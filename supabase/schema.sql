create extension if not exists pgcrypto;

create table if not exists public.cadastros_snapshot (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cadastros_snapshot_updated_at on public.cadastros_snapshot;
create trigger trg_cadastros_snapshot_updated_at
before update on public.cadastros_snapshot
for each row
execute function public.set_updated_at();

create table if not exists public.frete_importacoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  arquivo text,
  canal text,
  inseridos integer not null default 0,
  erros jsonb,
  meta jsonb,
  payload jsonb,
  criado_em timestamptz not null default now()
);

alter table public.cadastros_snapshot enable row level security;
alter table public.frete_importacoes enable row level security;

drop policy if exists cadastros_snapshot_all_anon on public.cadastros_snapshot;
create policy cadastros_snapshot_all_anon
on public.cadastros_snapshot
for all
using (true)
with check (true);

drop policy if exists frete_importacoes_all_anon on public.frete_importacoes;
create policy frete_importacoes_all_anon
on public.frete_importacoes
for all
using (true)
with check (true);
