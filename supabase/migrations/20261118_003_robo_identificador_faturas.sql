-- Robo identificador de faturas (Automacao): cada auditor cadastra a transportadora que nao esta enviando fatura,
-- com a periodicidade (semanal/quinzenal/mensal). Pelo cron da Vercel o robo confere se saiu fatura no periodo e
-- quantos CT-es dos ultimos 30 dias estao sem fatura vinculada; se houver problema, avisa o transportador por e-mail.

create table if not exists public.robo_faturas_config (
  id integer primary key default 1 check (id = 1),
  ativo boolean not null default true,
  horas integer[] not null default '{8}',                   -- horas cheias (0-23), horario de Brasilia
  dias_semana integer[] not null default '{2}',             -- 0 = domingo ... 6 = sabado (padrao: terca)
  enviar_emails boolean not null default false,             -- false = so simula e registra (modo sombra)
  janela_cte_dias integer not null default 30,              -- ate quantos dias atras olhar CT-es sem fatura
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);
insert into public.robo_faturas_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.robo_faturas_transportadoras (
  id uuid primary key default gen_random_uuid(),
  transportadora text not null,                             -- nome do cadastro (ou o informado, se nao cadastrada)
  nao_cadastrada boolean not null default false,            -- true = nao achou na lista; aparece na fila de cadastro do admin
  periodicidade text not null default 'SEMANAL',            -- SEMANAL | QUINZENAL | MENSAL
  ativo boolean not null default true,
  emails_transportadora text,                               -- destinatarios (separados por ; ou ,); vazio = usa o do Robo Auditor
  emails_copia text,                                        -- copia extra (alem do auditor e do grupo padrao)
  auditor_nome text,
  auditor_email text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_robo_faturas_transportadora on public.robo_faturas_transportadoras (lower(transportadora));

create table if not exists public.robo_faturas_execucoes (
  id uuid primary key default gen_random_uuid(),
  executado_em timestamptz not null default now(),
  origem text,                                              -- cron | manual
  transportadora_id uuid,
  transportadora text,
  periodicidade text,
  periodo_inicio date,
  periodo_fim date,
  faturas_no_periodo integer,
  numeros_faturas text,
  ctes_sem_fatura integer,
  valor_sem_fatura numeric,
  cte_mais_antigo date,
  situacao text,                                            -- SEM_FATURA_NO_PERIODO | CONFERIR_CTES | OK | SEM_CTES | ERRO
  email_enviado boolean not null default false,
  destinatarios text,
  copia text,
  observacao text
);
create index if not exists robo_faturas_execucoes_transp_idx on public.robo_faturas_execucoes (transportadora_id, executado_em desc);

alter table public.robo_faturas_config enable row level security;
alter table public.robo_faturas_transportadoras enable row level security;
alter table public.robo_faturas_execucoes enable row level security;
grant select, insert, update, delete on public.robo_faturas_config to anon, authenticated;
grant select, insert, update, delete on public.robo_faturas_transportadoras to anon, authenticated;
grant select, insert, update, delete on public.robo_faturas_execucoes to anon, authenticated;
drop policy if exists "central_fretes_access" on public.robo_faturas_config;
create policy "central_fretes_access" on public.robo_faturas_config for all to anon, authenticated using (true) with check (true);
drop policy if exists "central_fretes_access" on public.robo_faturas_transportadoras;
create policy "central_fretes_access" on public.robo_faturas_transportadoras for all to anon, authenticated using (true) with check (true);
drop policy if exists "central_fretes_access" on public.robo_faturas_execucoes;
create policy "central_fretes_access" on public.robo_faturas_execucoes for all to anon, authenticated using (true) with check (true);
