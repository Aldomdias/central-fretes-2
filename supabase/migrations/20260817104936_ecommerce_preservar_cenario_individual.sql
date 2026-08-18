-- Preserva os resultados legados no compartimento do peso que os originou.
-- Isso permite calcular o outro peso futuramente sem substituir a primeira visao.
update public.ecommerce_order_snapshot
set sim_resultado_cotado = jsonb_strip_nulls(jsonb_build_object(
  'id', id,
  'pedido', pedido,
  'sim_status', sim_status,
  'sim_peso_base', 'cotado',
  'sim_transportadora_ideal', sim_transportadora_ideal,
  'sim_origem_ideal', sim_origem_ideal,
  'sim_origem_validada', sim_origem_validada,
  'sim_valor_ideal', sim_valor_ideal,
  'sim_prazo_ideal', sim_prazo_ideal,
  'sim_diferenca_vs_cte', sim_diferenca_vs_cte,
  'sim_diferenca_vs_tabela', sim_diferenca_vs_tabela,
  'sim_mesma_transportadora', sim_mesma_transportadora,
  'sim_candidatos', sim_candidatos
))
where sim_peso_base = 'cotado'
  and sim_resultado_cotado is null
  and sim_status <> 'pendente';

update public.ecommerce_order_snapshot
set sim_resultado_faturado = jsonb_strip_nulls(jsonb_build_object(
  'id', id,
  'pedido', pedido,
  'sim_status', sim_status,
  'sim_peso_base', 'faturado',
  'sim_transportadora_ideal', sim_transportadora_ideal,
  'sim_origem_ideal', sim_origem_ideal,
  'sim_origem_validada', sim_origem_validada,
  'sim_valor_ideal', sim_valor_ideal,
  'sim_prazo_ideal', sim_prazo_ideal,
  'sim_diferenca_vs_cte', sim_diferenca_vs_cte,
  'sim_diferenca_vs_tabela', sim_diferenca_vs_tabela,
  'sim_mesma_transportadora', sim_mesma_transportadora,
  'sim_candidatos', sim_candidatos
))
where sim_peso_base = 'faturado'
  and sim_resultado_faturado is null
  and sim_status <> 'pendente';
