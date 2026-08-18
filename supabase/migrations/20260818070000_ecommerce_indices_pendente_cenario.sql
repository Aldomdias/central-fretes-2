-- As consultas de "pendente para esse cenario" passaram a checar
-- sim_resultado_cotado/sim_resultado_faturado IS NULL em vez do antigo campo
-- unico sim_status. Sem indice nessas colunas jsonb, isso vira sequential scan
-- na tabela inteira (100k+ linhas em producao), estourando o timeout do gateway
-- do Supabase assim que a tela carrega (diagnostico roda sozinho no mount).
-- Indice de expressao permite usar essas checagens de forma indexada.
create index if not exists idx_ecommerce_order_snapshot_sim_resultado_cotado_null
  on public.ecommerce_order_snapshot ((sim_resultado_cotado is null));

create index if not exists idx_ecommerce_order_snapshot_sim_resultado_faturado_null
  on public.ecommerce_order_snapshot ((sim_resultado_faturado is null));
