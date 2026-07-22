-- Controle de validacao de tabelas por transportadora + origem + canal.
-- Marcado manualmente na tela Transportadoras apos conferir simulacao/auditoria.
alter table public.origens
  add column if not exists validado boolean not null default false,
  add column if not exists validado_em timestamptz,
  add column if not exists validado_por text;
