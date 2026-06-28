-- Índices de apoio para a exportação de volumetria (Ferramentas).
-- O worker lê tracking_rows / realizado_local_ctes filtrando por data (janela diária)
-- e ordenando por id. Sem índice em data, a query estourava statement_timeout em
-- períodos grandes. Composto (data, id) cobre o filtro de período + a ordenação por id.

create index if not exists idx_tracking_rows_data_id
  on public.tracking_rows (data, id);

create index if not exists idx_tracking_rows_canal_data
  on public.tracking_rows (canal, data);

create index if not exists idx_rlc_data_emissao_id
  on public.realizado_local_ctes (data_emissao, id);
