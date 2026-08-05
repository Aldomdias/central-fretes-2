-- Espelho de supabase/migrations/20260803_001_data_referencia_saving.sql
-- Rodar manualmente no SQL editor do Supabase.
alter table public.tabelas_negociacao
  add column if not exists data_referencia_saving date;

comment on column public.tabelas_negociacao.data_referencia_saving is
  'Data usada como corte (antes/depois) no cálculo de saving pós-aprovação. Se nula, usa aprovado_em.';
