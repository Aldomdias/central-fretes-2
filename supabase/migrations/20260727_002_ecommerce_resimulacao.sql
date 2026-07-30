-- Auditoria E-commerce (Fase 2): resultado da resimulacao do cenario ideal
-- (melhor CD + transportadora da malha B2C, ignorando campanha/tributario).
alter table ecommerce_order_snapshot
  add column if not exists sim_status text default 'pendente', -- pendente | ok | sem_ibge_destino | sem_malha | sem_cotacao_peso
  add column if not exists sim_transportadora_ideal text,
  add column if not exists sim_origem_ideal text,
  add column if not exists sim_valor_ideal numeric,
  add column if not exists sim_prazo_ideal numeric,
  add column if not exists sim_diferenca_vs_cte numeric,
  add column if not exists sim_diferenca_vs_tabela numeric,
  add column if not exists sim_mesma_transportadora boolean,
  add column if not exists sim_resimulado_em timestamptz;

create index if not exists idx_ecommerce_order_snapshot_sim_status on ecommerce_order_snapshot (sim_status);
