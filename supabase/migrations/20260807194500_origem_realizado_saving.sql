alter table public.tabelas_negociacao
  add column if not exists origem_realizado_saving text;

comment on column public.tabelas_negociacao.origem_realizado_saving is
  'Nome da origem correspondente no realizado usado no saving, quando diferente da origem da negociação.';
