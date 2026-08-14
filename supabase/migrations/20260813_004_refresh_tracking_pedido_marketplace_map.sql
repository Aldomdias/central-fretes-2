-- Reprocessa tracking_pedido_marketplace_map com o estado atual de tracking_rows.
-- A carga original (20260728_001) foi um snapshot unico - nada no app atualiza essa
-- tabela automaticamente quando tracking/CT-e sao reimportados, entao ela fica
-- desatualizada e o cruzamento da Auditoria E-commerce comeca a falhar (sem_tracking)
-- pra pedidos/CT-es novos. Rodar de novo sempre que a base de tracking for atualizada.
insert into tracking_pedido_marketplace_map (pedido_marketplace, chave_cte, pedido_erp)
select distinct on (pedido_marketplace) pedido_marketplace, chave_cte, pedido_erp
from (
  select
    raw ->> 'Pedido Marketplace' as pedido_marketplace,
    chave_cte,
    pedido as pedido_erp,
    updated_at
  from tracking_rows
  where coalesce(raw ->> 'Pedido Marketplace', '') <> ''
) t
order by pedido_marketplace, (chave_cte is not null and chave_cte <> '') desc, updated_at desc nulls last
on conflict (pedido_marketplace) do update
  set chave_cte = excluded.chave_cte,
      pedido_erp = excluded.pedido_erp,
      updated_at = now();
