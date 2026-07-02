-- Cubagem final auditavel a partir do Tracking:
-- cubagem_final = cubagem_unitaria / quantidade_itens * total_unidades
-- quando quantidade_itens > 1. A cubagem original continua preservada.

alter table public.tracking_rows
  add column if not exists quantidade_itens numeric,
  add column if not exists total_unidades numeric,
  add column if not exists cubagem_final numeric;

alter table public.realizado_local_ctes
  add column if not exists quantidade_itens numeric,
  add column if not exists total_unidades numeric,
  add column if not exists cubagem_final numeric;

update public.tracking_rows
set cubagem_final = case
  when coalesce(quantidade_itens, 0) > 1
    and coalesce(total_unidades, qtd_volumes, 0) > 0
    and coalesce(cubagem_unitaria, peso_cubado, 0) > 0
    then (coalesce(cubagem_unitaria, peso_cubado, 0) / quantidade_itens) * coalesce(total_unidades, qtd_volumes, 0)
  when coalesce(cubagem_final, 0) > 0 then cubagem_final
  when coalesce(cubagem_total, 0) > 0 then cubagem_total
  when coalesce(cubagem_unitaria, 0) > 0 then cubagem_unitaria
  else null
end
where cubagem_final is null
   or cubagem_final = 0;

create index if not exists idx_tracking_rows_cubagem_final
  on public.tracking_rows (cubagem_final)
  where cubagem_final is not null;

