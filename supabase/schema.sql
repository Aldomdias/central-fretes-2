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
  erros jsonb,
  meta jsonb,
  criado_em timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists cadastros_snapshot_set_updated_at on public.cadastros_snapshot;
create trigger cadastros_snapshot_set_updated_at
before update on public.cadastros_snapshot
for each row execute function public.set_updated_at();

alter table public.cadastros_snapshot enable row level security;
alter table public.frete_importacoes enable row level security;

drop policy if exists "cadastros_snapshot_select" on public.cadastros_snapshot;
drop policy if exists "cadastros_snapshot_insert" on public.cadastros_snapshot;
drop policy if exists "cadastros_snapshot_update" on public.cadastros_snapshot;
drop policy if exists "frete_importacoes_select" on public.frete_importacoes;
drop policy if exists "frete_importacoes_insert" on public.frete_importacoes;

create policy "cadastros_snapshot_select"
on public.cadastros_snapshot for select
to anon, authenticated
using (true);

create policy "cadastros_snapshot_insert"
on public.cadastros_snapshot for insert
to anon, authenticated
with check (true);

create policy "cadastros_snapshot_update"
on public.cadastros_snapshot for update
to anon, authenticated
using (true)
with check (true);

create policy "frete_importacoes_select"
on public.frete_importacoes for select
to anon, authenticated
using (true);

create policy "frete_importacoes_insert"
on public.frete_importacoes for insert
to anon, authenticated
with check (true);
