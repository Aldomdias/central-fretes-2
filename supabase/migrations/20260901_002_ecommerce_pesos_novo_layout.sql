-- Novo layout do OrderSnapshotAnalytics: separa peso cubado e peso real (nota).
alter table public.ecommerce_order_snapshot
  add column if not exists peso_cubado_cotado numeric,
  add column if not exists peso_cubado_faturado numeric,
  add column if not exists diferenca_peso_cubado numeric,
  add column if not exists peso_real_cotado numeric,
  add column if not exists peso_real_faturado numeric,
  add column if not exists diferenca_peso_real numeric;

comment on column public.ecommerce_order_snapshot.peso_real_faturado is
  'Peso real faturado/peso da nota no OrderSnapshotAnalytics.';
