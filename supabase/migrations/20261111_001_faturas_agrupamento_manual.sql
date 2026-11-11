-- Contingencia ate o protocolo financeiro funcionar dentro do AMD: a tela
-- Diagnostico marca as faturas que vao para protocolo por agrupamento manual
-- (fora do AMD). So marca e mostra em card; nao altera status nem protocolo.

alter table if exists public.faturas
  add column if not exists agrupamento_manual boolean not null default false,
  add column if not exists agrupamento_manual_em timestamptz,
  add column if not exists agrupamento_manual_por text;

create index if not exists idx_faturas_agrupamento_manual
  on public.faturas (agrupamento_manual)
  where agrupamento_manual;
