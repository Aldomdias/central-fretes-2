create extension if not exists "pgcrypto";

create table if not exists public.transportadoras (
  id uuid primary key,
  nome text not null unique,
  status text default 'Ativa',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.origens (
  id uuid primary key,
  transportadora_id uuid not null references public.transportadoras(id) on delete cascade,
  cidade text not null,
  canal text default 'ATACADO',
  status text default 'Ativa',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists origens_unique_transportadora_cidade_canal
  on public.origens (transportadora_id, cidade, canal);

create table if not exists public.generalidades (
  origem_id uuid primary key references public.origens(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.rotas (
  id uuid primary key,
  origem_id uuid not null references public.origens(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.cotacoes (
  id uuid primary key,
  origem_id uuid not null references public.origens(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.taxas_especiais (
  id uuid primary key,
  origem_id uuid not null references public.origens(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.frete_importacoes (
  id uuid primary key default gen_random_uuid(),
  arquivo text not null,
  tipo text not null,
  canal text,
  inseridos int4 default 0,
  erros jsonb default '[]'::jsonb,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.transportadoras enable row level security;
alter table public.origens enable row level security;
alter table public.generalidades enable row level security;
alter table public.rotas enable row level security;
alter table public.cotacoes enable row level security;
alter table public.taxas_especiais enable row level security;
alter table public.frete_importacoes enable row level security;

drop policy if exists "transportadoras_all" on public.transportadoras;
create policy "transportadoras_all" on public.transportadoras for all to anon, authenticated using (true) with check (true);

drop policy if exists "origens_all" on public.origens;
create policy "origens_all" on public.origens for all to anon, authenticated using (true) with check (true);

drop policy if exists "generalidades_all" on public.generalidades;
create policy "generalidades_all" on public.generalidades for all to anon, authenticated using (true) with check (true);

drop policy if exists "rotas_all" on public.rotas;
create policy "rotas_all" on public.rotas for all to anon, authenticated using (true) with check (true);

drop policy if exists "cotacoes_all" on public.cotacoes;
create policy "cotacoes_all" on public.cotacoes for all to anon, authenticated using (true) with check (true);

drop policy if exists "taxas_especiais_all" on public.taxas_especiais;
create policy "taxas_especiais_all" on public.taxas_especiais for all to anon, authenticated using (true) with check (true);

drop policy if exists "frete_importacoes_all" on public.frete_importacoes;
create policy "frete_importacoes_all" on public.frete_importacoes for all to anon, authenticated using (true) with check (true);
