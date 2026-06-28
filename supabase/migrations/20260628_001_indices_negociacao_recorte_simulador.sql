create index if not exists idx_tni_tabela_ibge_id
  on public.tabelas_negociacao_itens (tabela_negociacao_id, ibge_destino, id);

create index if not exists idx_tni_tabela_uf_id
  on public.tabelas_negociacao_itens (tabela_negociacao_id, uf_destino, id);

create index if not exists idx_tntd_tabela_ibge_id
  on public.tabelas_negociacao_taxas_destino (tabela_negociacao_id, ibge_destino, id);

create index if not exists idx_tntd_tabela_uf_id
  on public.tabelas_negociacao_taxas_destino (tabela_negociacao_id, uf_destino, id);
