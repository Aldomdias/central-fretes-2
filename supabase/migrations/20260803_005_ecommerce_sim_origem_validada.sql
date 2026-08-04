-- Marca se a origem/tabela usada no cenario ideal ja passou pela validacao
-- manual (mesmo selo "Validado" da tela de Transportadoras), pra dar mais
-- confianca no numero mostrado na auditoria.
alter table ecommerce_order_snapshot
  add column if not exists sim_origem_validada boolean;
