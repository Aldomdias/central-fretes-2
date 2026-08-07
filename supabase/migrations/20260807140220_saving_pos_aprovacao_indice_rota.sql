create index if not exists idx_realizado_local_saving_rota_canal_data
  on public.realizado_local_ctes (chave_rota_ibge, canal, data_emissao);
