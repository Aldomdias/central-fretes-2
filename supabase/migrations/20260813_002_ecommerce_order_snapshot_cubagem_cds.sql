-- Auditoria E-commerce: novos campos do OrderSnapshotAnalytics (relatorio atualizado ago/2026).
alter table ecommerce_order_snapshot
  add column if not exists cubagem_cotada numeric,
  add column if not exists cds_com_saldo_venda text;
