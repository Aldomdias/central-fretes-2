-- Estoque por produto (importado periodicamente), usado para filtrar quais
-- produtos do catálogo têm disponibilidade na hora de simular.
create table if not exists public.estoque_catalogo (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  estoque_principal numeric(14,2) not null default 0,
  estoque_similar numeric(14,2) not null default 0,
  estoque_total numeric(14,2) not null default 0,
  reservado numeric(14,2) not null default 0,
  disponivel numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.estoque_catalogo drop constraint if exists estoque_catalogo_codigo_key;
alter table public.estoque_catalogo add constraint estoque_catalogo_codigo_key unique (codigo);

alter table public.estoque_catalogo enable row level security;

drop policy if exists estoque_catalogo_select on public.estoque_catalogo;
create policy estoque_catalogo_select on public.estoque_catalogo for select using (true);

drop policy if exists estoque_catalogo_insert on public.estoque_catalogo;
create policy estoque_catalogo_insert on public.estoque_catalogo for insert with check (true);

drop policy if exists estoque_catalogo_update on public.estoque_catalogo;
create policy estoque_catalogo_update on public.estoque_catalogo for update using (true) with check (true);

drop policy if exists estoque_catalogo_delete on public.estoque_catalogo;
create policy estoque_catalogo_delete on public.estoque_catalogo for delete using (true);
