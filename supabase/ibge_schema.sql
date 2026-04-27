create table if not exists public.ibge_municipios (
  id bigserial primary key,
  uf text not null,
  nome_municipio text not null,
  nome_municipio_sem_acento text,
  codigo_municipio_completo text not null unique,
  created_at timestamptz default now()
);

create index if not exists idx_ibge_municipios_nome on public.ibge_municipios (nome_municipio);
create index if not exists idx_ibge_municipios_nome_sem_acento on public.ibge_municipios (nome_municipio_sem_acento);
create index if not exists idx_ibge_municipios_uf on public.ibge_municipios (uf);

create table if not exists public.ibge_faixas_cep (
  id bigserial primary key,
  codigo_municipio_completo text not null references public.ibge_municipios(codigo_municipio_completo) on delete cascade,
  cep_inicial text,
  cep_final text,
  ordem_faixa integer default 1,
  created_at timestamptz default now()
);

create index if not exists idx_ibge_faixas_cep_codigo on public.ibge_faixas_cep (codigo_municipio_completo);
