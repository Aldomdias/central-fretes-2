-- Historico de lancamentos dos robos de automacao (NFS-e e CT-e): uma linha por documento
-- lancado no SAP (com MIRO). Alimenta o acompanhamento mensal (quantas notas por mes).
create table if not exists public.robos_lancamentos (
  id bigserial primary key,
  tipo text not null check (tipo in ('NFSE', 'CTE')),
  documento text not null,
  cnpj_transp text,
  transportadora text,
  empresa text,
  centro text,
  centro_custo text,
  valor numeric(14, 2),
  data_emissao date,
  vencimento date,
  fatura text,
  pedido text,
  miro text not null,
  lancado_em timestamptz not null default now(),
  lancado_por text,
  constraint robos_lancamentos_unico unique (tipo, miro, documento)
);

create index if not exists robos_lancamentos_lancado_em_idx on public.robos_lancamentos (lancado_em desc);
create index if not exists robos_lancamentos_tipo_lancado_idx on public.robos_lancamentos (tipo, lancado_em desc);

alter table public.robos_lancamentos enable row level security;

drop policy if exists "robos_lancamentos select" on public.robos_lancamentos;
create policy "robos_lancamentos select" on public.robos_lancamentos
  for select using (true);

drop policy if exists "robos_lancamentos insert" on public.robos_lancamentos;
create policy "robos_lancamentos insert" on public.robos_lancamentos
  for insert with check (true);
