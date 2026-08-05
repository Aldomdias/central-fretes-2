-- Cache do último cálculo de saving pós-aprovação (tela Negociações > Savings
-- pós-aprovação), pra sobreviver a um F5 sem precisar recalcular na hora.
-- O detalhe completo (linhas por rota+faixa, totais, janelas) fica em jsonb;
-- valor/calculado_em ficam soltos pra facilitar ordenar/filtrar por eles.
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
