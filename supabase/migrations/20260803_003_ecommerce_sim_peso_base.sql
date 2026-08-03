-- Registra qual peso foi usado na resimulacao (cotado ou faturado), pra
-- distinguir cenarios quando o mesmo pedido e resimulado com bases diferentes.
alter table ecommerce_order_snapshot
  add column if not exists sim_peso_base text; -- cotado | faturado
