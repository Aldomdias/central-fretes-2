-- Robo auditor: lista de transportadoras monitoradas e registro de cada fatura processada.
-- modo: SOMBRA (so mostra o que faria) | APROVACAO (auditor da o ok) | AUTOMATICO (envia sozinho).
create table if not exists public.auditor_robo_transportadoras (
  id uuid primary key default gen_random_uuid(),
  transportadora text not null,
  ativo boolean not null default true,
  modo text not null default 'SOMBRA',
  auditor_nome text,
  auditor_email text,
  emails_transportadora text,   -- destinatarios do laudo (separados por ; ou ,)
  email_aprovacao text,         -- quem recebe as faturas corretas para aprovacao
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_auditor_robo_transportadora
  on public.auditor_robo_transportadoras (lower(transportadora));

create table if not exists public.auditor_robo_execucoes (
  id uuid primary key default gen_random_uuid(),
  fatura_id text not null,
  numero_fatura text,
  transportadora text,
  modo text not null default 'SOMBRA',
  decisao text not null,        -- ENVIAR_LAUDO | ENVIAR_APROVACAO | REVISAO_AUDITOR
  motivo text,
  valor_fatura numeric,
  valor_descontar numeric,
  auditor_nome text,
  auditor_email text,
  destinatarios text,
  copia text,
  acao_executada boolean not null default false,  -- false = so simulado (sombra)
  executado_por text,
  executado_em timestamptz not null default now()
);

create unique index if not exists uq_auditor_robo_execucao_fatura
  on public.auditor_robo_execucoes (fatura_id);

alter table public.auditor_robo_transportadoras enable row level security;
alter table public.auditor_robo_execucoes enable row level security;

grant select, insert, update, delete on public.auditor_robo_transportadoras to anon, authenticated;
grant select, insert, update, delete on public.auditor_robo_execucoes to anon, authenticated;

drop policy if exists "central_fretes_access" on public.auditor_robo_transportadoras;
create policy "central_fretes_access" on public.auditor_robo_transportadoras
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "central_fretes_access" on public.auditor_robo_execucoes;
create policy "central_fretes_access" on public.auditor_robo_execucoes
  for all to anon, authenticated using (true) with check (true);
