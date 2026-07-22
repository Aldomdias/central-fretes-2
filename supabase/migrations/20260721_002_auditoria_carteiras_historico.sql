create table if not exists public.auditoria_carteiras_historico (
  id uuid primary key default gen_random_uuid(),
  transportadora text not null,
  auditor_nome text,
  auditor_email text,
  atribuido_por text,
  atribuido_em timestamptz not null default now()
);

create index if not exists idx_auditoria_carteiras_historico_transportadora
  on public.auditoria_carteiras_historico (transportadora, atribuido_em desc);

alter table public.auditoria_carteiras_historico enable row level security;

grant select, insert, update, delete on public.auditoria_carteiras_historico to anon, authenticated;

drop policy if exists "central_fretes_access" on public.auditoria_carteiras_historico;
create policy "central_fretes_access" on public.auditoria_carteiras_historico
  for all to anon, authenticated using (true) with check (true);
