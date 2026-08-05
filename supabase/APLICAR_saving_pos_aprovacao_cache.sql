-- Espelho de supabase/migrations/20260803_003_saving_pos_aprovacao_cache.sql
-- Rodar manualmente no SQL editor do Supabase.
alter table public.tabelas_negociacao
  add column if not exists saving_pos_aprovacao_valor numeric,
  add column if not exists saving_pos_aprovacao_calculado_em timestamptz,
  add column if not exists saving_pos_aprovacao_detalhe jsonb;

comment on column public.tabelas_negociacao.saving_pos_aprovacao_valor is
  'Saving total (R$) do último cálculo de saving pós-aprovação.';
comment on column public.tabelas_negociacao.saving_pos_aprovacao_calculado_em is
  'Data/hora do último cálculo de saving pós-aprovação.';
comment on column public.tabelas_negociacao.saving_pos_aprovacao_detalhe is
  'Detalhe completo (linhas por rota+faixa, totais, janelas) do último cálculo de saving pós-aprovação.';
