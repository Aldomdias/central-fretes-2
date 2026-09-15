-- Busca por Pedido no Tracking (tela Tracking > Pesquisar Tracking) fazia
-- sequential scan em tracking_rows/tracking_pedido_marketplace_map (milhoes
-- de linhas) e estourava timeout. eq() nessas colunas precisa de indice.
--
-- CONCURRENTLY nao pode rodar dentro de uma transacao: no SQL Editor do
-- Supabase, execute cada CREATE INDEX abaixo SEPARADAMENTE (um de cada vez,
-- selecionando so aquela linha e rodando), nao o arquivo inteiro de uma vez.
-- Em tabela grande, cada um pode levar alguns minutos - isso e esperado e
-- normal: CONCURRENTLY nao trava leitura/escrita da tabela enquanto constroi,
-- entao pode deixar rodando em segundo plano sem parar o app.
create index concurrently if not exists idx_tracking_rows_pedido
  on public.tracking_rows (pedido);

create index concurrently if not exists idx_tracking_rows_pedido_erp
  on public.tracking_rows (pedido_erp);

create index concurrently if not exists idx_tracking_map_pedido_erp
  on public.tracking_pedido_marketplace_map (pedido_erp);
