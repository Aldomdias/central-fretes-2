-- Preserva o cálculo original da Verum (vem na importação -> realizado_local_ctes)
-- na tabela de resultados da auditoria, sem ser sobrescrito pelo recálculo da ferramenta.
-- O recálculo continua em valor_calculado; a Verum fica em valor_calculado_verum.

alter table if exists public.auditoria_cte_resultados
  add column if not exists valor_calculado_verum numeric(14,2),
  add column if not exists diferenca_verum numeric(14,2);

notify pgrst, 'reload schema';
