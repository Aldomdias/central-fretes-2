-- Fila dos robos de lancamento (NFS-e e CT-e): cada nota/CT-e mandado para o robo, com tudo o que o
-- robo precisa (entrada) e o que ja saiu no SAP (pedido, MIRO, motivo da falha). Permite, de qualquer
-- computador, mandar de volta para o robo so o que ficou sem MIRO, sem importar as notas de novo.
-- O historico mensal (robos_lancamentos) continua igual.
create table if not exists public.robos_fila (
  id bigserial primary key,
  tipo text not null check (tipo in ('NFSE', 'CTE')),
  chave text not null,
  documento text not null,
  transportadora text,
  cnpj_transp text,
  valor numeric(14, 2),
  entrada jsonb not null,
  pedido text,
  miro text,
  motivo text,
  descartado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  constraint robos_fila_unico unique (tipo, chave)
);

create index if not exists robos_fila_tipo_miro_idx on public.robos_fila (tipo, miro);

alter table public.robos_fila enable row level security;

drop policy if exists "robos_fila select" on public.robos_fila;
create policy "robos_fila select" on public.robos_fila
  for select using (true);

drop policy if exists "robos_fila insert" on public.robos_fila;
create policy "robos_fila insert" on public.robos_fila
  for insert with check (true);

drop policy if exists "robos_fila update" on public.robos_fila;
create policy "robos_fila update" on public.robos_fila
  for update using (true) with check (true);
