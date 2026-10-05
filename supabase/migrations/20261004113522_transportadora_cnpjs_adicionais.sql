create table if not exists public.transportadora_cnpjs (
  id uuid primary key default gen_random_uuid(),
  transportadora_id uuid not null references public.transportadoras(id) on delete cascade,
  cnpj text not null,
  cnpj_raiz text not null,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transportadora_cnpjs_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  constraint transportadora_cnpjs_raiz_check check (cnpj_raiz ~ '^[0-9]{8}$'),
  constraint transportadora_cnpjs_unico unique (cnpj),
  constraint transportadora_cnpjs_transportadora_unico unique (transportadora_id, cnpj)
);

create index if not exists idx_transportadora_cnpjs_transportadora
  on public.transportadora_cnpjs (transportadora_id) where ativo = true;
create index if not exists idx_transportadora_cnpjs_raiz
  on public.transportadora_cnpjs (cnpj_raiz) where ativo = true;

alter table public.transportadora_cnpjs enable row level security;

drop policy if exists "central_fretes_access" on public.transportadora_cnpjs;
create policy "central_fretes_access"
  on public.transportadora_cnpjs
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.transportadora_cnpjs to anon, authenticated;
