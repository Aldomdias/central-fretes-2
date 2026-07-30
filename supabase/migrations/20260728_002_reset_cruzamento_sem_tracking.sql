-- Reprocessa os pedidos que ficaram marcados errado como "sem_tracking" na primeira
-- rodada do cruzamento (que usava tracking_rows.pedido, chave errada).
update ecommerce_order_snapshot
set cruzamento_status = 'pendente'
where cruzamento_status = 'sem_tracking';
