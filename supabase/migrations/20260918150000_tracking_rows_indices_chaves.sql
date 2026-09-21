-- Auditoria de CT-e consulta status de entrega em tracking_rows por chave do CT-e e da NF.
create index if not exists idx_tracking_rows_chave_cte on public.tracking_rows (chave_cte);
create index if not exists idx_tracking_rows_chave_nfe on public.tracking_rows (chave_nfe);
