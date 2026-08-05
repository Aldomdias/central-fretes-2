-- Espelho de supabase/migrations/20260803_002_vinculo_transportadora_saving.sql
-- Rodar manualmente no SQL editor do Supabase.
alter table public.tabelas_negociacao
  add column if not exists vinculo_transportadoras_saving text[];

comment on column public.tabelas_negociacao.vinculo_transportadoras_saving is
  'Nomes exatos de transportadora em realizado_local_ctes vinculados manualmente para o cálculo de saving pós-aprovação.';
