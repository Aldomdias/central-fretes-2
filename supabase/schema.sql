create extension if not exists pgcrypto;

create table if not exists public.cadastros_snapshot (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger cadastros_snapshot_touch_updated_at
before update on public.cadastros_snapshot
for each row execute function public.touch_updated_at();

create table if not exists public.frete_importacoes (
  id uuid primary key default gen_random_uuid(),
  arquivo text not null,
  tipo text not null,
  canal text,
  inseridos integer not null default 0,
  erros jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

alter table public.cadastros_snapshot enable row level security;
alter table public.frete_importacoes enable row level security;

do $$ begin
  create policy "allow all cadastros snapshot" on public.cadastros_snapshot
    for all using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "allow all frete importacoes" on public.frete_importacoes
    for all using (true) with check (true);
exception when duplicate_object then null; end $$;
