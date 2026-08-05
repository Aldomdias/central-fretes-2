-- Data de referência editável pelo aprovador para o cálculo de saving pós-aprovação
-- (tela Negociações > Savings pós-aprovação). Por padrão usa aprovado_em, mas o gestor
-- pode ajustar quando a negociação já valia antes da aprovação formal no sistema.
alter table public.tabelas_negociacao
  add column if not exists data_referencia_saving date;

comment on column public.tabelas_negociacao.data_referencia_saving is
  'Data usada como corte (antes/depois) no cálculo de saving pós-aprovação. Se nula, usa aprovado_em.';
