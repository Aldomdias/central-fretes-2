-- Vínculos cidade -> código IBGE.
-- Resolve casos em que o nome da cidade no CT-e não casa com a lista oficial
-- (ex.: "BRASILIA (DF)" vs "Brasília"). Consumido pela Gestão Base CT-e ao
-- resolver IBGE e gerenciado pela tela Ferramentas.

create table if not exists public.cidade_ibge_aliases (
  id uuid primary key default gen_random_uuid(),
  cidade text not null,
  uf text,
  ibge text not null,
  cidade_norm text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um IBGE por par cidade_norm + uf. uf vazio vira string '' para o índice único.
alter table public.cidade_ibge_aliases
  alter column uf set default '';
update public.cidade_ibge_aliases set uf = '' where uf is null;

create unique index if not exists cidade_ibge_aliases_cidade_uf_uidx
  on public.cidade_ibge_aliases (cidade_norm, uf);

alter table public.cidade_ibge_aliases enable row level security;

-- Mesmo modelo de acesso das demais tabelas do app (anon completo).
drop policy if exists cidade_ibge_aliases_all on public.cidade_ibge_aliases;
create policy cidade_ibge_aliases_all on public.cidade_ibge_aliases
  for all using (true) with check (true);

grant all on public.cidade_ibge_aliases to anon, authenticated;
