-- Guarda as melhores opcoes simuladas (nao so a vencedora) com detalhe do
-- calculo de cada uma, pra o usuario poder conferir manualmente o resultado.
alter table ecommerce_order_snapshot
  add column if not exists sim_candidatos jsonb;
