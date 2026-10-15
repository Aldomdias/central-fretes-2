-- Robo auditor: aprovacao do laudo pelo auditor e reavaliacao dos casos em revisao.
alter table public.auditor_robo_execucoes
  add column if not exists aprovado_auditor_por text,
  add column if not exists aprovado_auditor_em timestamptz,
  add column if not exists reavaliado_em timestamptz,
  add column if not exists tentativas integer not null default 1;

create index if not exists idx_auditor_robo_execucoes_fila
  on public.auditor_robo_execucoes (decisao, acao_executada, executado_em);
