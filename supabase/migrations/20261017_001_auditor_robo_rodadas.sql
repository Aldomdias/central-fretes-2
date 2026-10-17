-- Historico das execucoes do robo auditor: uma linha por chamada (cron, manual, encadeada ou navegador).
-- Chamadas encadeadas da mesma rodada compartilham cadeia_id (ex.: a rodada das 19h e suas continuacoes).
create table if not exists public.auditor_robo_rodadas (
  id uuid primary key default gen_random_uuid(),
  cadeia_id text not null,
  origem text not null,                 -- cron | manual | encadeada | navegador
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  duracao_ms integer,
  calcular_nuvem boolean,
  novas_encontradas integer not null default 0,
  analisadas integer not null default 0,
  reavaliadas integer not null default 0,
  enviadas_gestao integer not null default 0,
  laudos integer not null default 0,
  revisar integer not null default 0,
  restantes integer not null default 0,
  estourou_tempo boolean not null default false,
  erros jsonb not null default '[]'::jsonb,
  faturas jsonb not null default '[]'::jsonb, -- [{numero, transportadora, decisao, enviada, motivo}]
  executado_por text,
  created_at timestamptz not null default now()
);

create index if not exists idx_auditor_robo_rodadas_inicio on public.auditor_robo_rodadas (iniciado_em desc);
create index if not exists idx_auditor_robo_rodadas_cadeia on public.auditor_robo_rodadas (cadeia_id);

alter table public.auditor_robo_rodadas enable row level security;
grant select, insert, update, delete on public.auditor_robo_rodadas to anon, authenticated;
drop policy if exists "central_fretes_access" on public.auditor_robo_rodadas;
create policy "central_fretes_access" on public.auditor_robo_rodadas
  for all to anon, authenticated using (true) with check (true);
