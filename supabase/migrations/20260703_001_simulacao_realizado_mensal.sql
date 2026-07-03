create table if not exists public.simulacao_realizado_mensal (
  id uuid primary key default gen_random_uuid(),
  nome text,
  competencia text,
  transportadora text,
  canal text,
  origem text,
  periodo_inicio date,
  periodo_fim date,
  filtros jsonb not null default '{}'::jsonb,
  resumo jsonb not null default '{}'::jsonb,
  resultado jsonb not null default '{}'::jsonb,
  ctes_analisados integer not null default 0,
  ctes_simulados integer not null default 0,
  frete_realizado numeric not null default 0,
  frete_simulado numeric not null default 0,
  saving numeric not null default 0,
  status text not null default 'CONCLUIDA',
  total_parcelas integer not null default 1,
  parcelas_concluidas integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_simulacao_realizado_mensal_competencia
  on public.simulacao_realizado_mensal (competencia, updated_at desc);

create index if not exists idx_simulacao_realizado_mensal_transportadora
  on public.simulacao_realizado_mensal (transportadora, updated_at desc);

grant select, insert, update, delete on public.simulacao_realizado_mensal to anon, authenticated;
