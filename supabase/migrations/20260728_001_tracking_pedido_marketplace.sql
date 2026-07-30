-- O numero de Pedido gravado em tracking_rows.pedido e o pedido ERP interno, nao o
-- numero do pedido do marketplace. O numero do marketplace fica dentro de raw->>'Pedido Marketplace'.
--
-- Em vez de alterar tracking_rows (tabela grande - um generated column forcaria reescrever
-- todas as linhas e pode faltar espaco em disco), criamos uma tabela pequena separada so
-- com o mapeamento pedido_marketplace -> chave_cte. So le tracking_rows, nao reescreve ela.
create table if not exists tracking_pedido_marketplace_map (
  pedido_marketplace text primary key,
  chave_cte text,
  pedido_erp text,
  updated_at timestamptz not null default now()
);

-- Um mesmo pedido do marketplace pode ter mais de uma linha em tracking_rows (varias NFs/CT-es
-- pro mesmo pedido). Dedupe priorizando quem tem chave_cte preenchida, depois o mais recente.
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

alter table tracking_pedido_marketplace_map enable row level security;

drop policy if exists tracking_pedido_marketplace_map_select on tracking_pedido_marketplace_map;
create policy tracking_pedido_marketplace_map_select on tracking_pedido_marketplace_map for select using (true);
