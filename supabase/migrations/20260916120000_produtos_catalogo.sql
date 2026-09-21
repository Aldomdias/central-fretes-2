-- Catálogo de produtos (peso e cubagem padrão) para uso na simulação por produto.
create table if not exists public.produtos_catalogo (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  nome text not null,
  peso_kg numeric(12,3) not null default 0,
  cubagem_m3 numeric(12,6) not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.produtos_catalogo drop constraint if exists produtos_catalogo_codigo_key;
alter table public.produtos_catalogo add constraint produtos_catalogo_codigo_key unique (codigo);
create index if not exists produtos_catalogo_nome_idx on public.produtos_catalogo using gin (to_tsvector('simple', nome));

alter table public.produtos_catalogo enable row level security;

drop policy if exists produtos_catalogo_select on public.produtos_catalogo;
create policy produtos_catalogo_select on public.produtos_catalogo for select using (true);

drop policy if exists produtos_catalogo_insert on public.produtos_catalogo;
create policy produtos_catalogo_insert on public.produtos_catalogo for insert with check (true);

drop policy if exists produtos_catalogo_update on public.produtos_catalogo;
create policy produtos_catalogo_update on public.produtos_catalogo for update using (true) with check (true);

drop policy if exists produtos_catalogo_delete on public.produtos_catalogo;
create policy produtos_catalogo_delete on public.produtos_catalogo for delete using (true);
