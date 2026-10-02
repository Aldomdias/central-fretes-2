-- Demandas/anotacoes pessoais do auditor (painel "Meu painel" da Auditoria de Fretes).
create table if not exists public.auditoria_demandas (
  id uuid primary key default gen_random_uuid(),
  auditor_nome text,
  auditor_email text,
  fatura_id text,
  numero_fatura text,
  transportadora text,
  titulo text not null,
  observacao text,
  prazo date,
  status text not null default 'ABERTA',
  criado_por text,
  created_at timestamptz not null default now(),
  concluida_em timestamptz
);

create index if not exists idx_auditoria_demandas_auditor
  on public.auditoria_demandas (auditor_email, status, prazo);
create index if not exists idx_auditoria_demandas_fatura
  on public.auditoria_demandas (fatura_id);

alter table public.auditoria_demandas enable row level security;

grant select, insert, update, delete on public.auditoria_demandas to anon, authenticated;

drop policy if exists "central_fretes_access" on public.auditoria_demandas;
create policy "central_fretes_access" on public.auditoria_demandas
  for all to anon, authenticated using (true) with check (true);
