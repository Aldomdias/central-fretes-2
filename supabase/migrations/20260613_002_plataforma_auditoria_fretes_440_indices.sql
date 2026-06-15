-- Demanda 4.40 - indices para relacionamentos da homologacao integrada.
-- Ajuste aditivo: nao altera dados, permissoes ou modulos existentes.

create index if not exists idx_faturas_substituida_por
  on public.faturas(substituida_por_id);

create index if not exists idx_fin_solicitacoes_fatura
  on public.financeiro_solicitacoes(fatura_id);

create index if not exists idx_fin_solicitacoes_protocolo_financeiro
  on public.financeiro_solicitacoes(protocolo_financeiro_id);

create index if not exists idx_fin_solicitacao_historico_solicitacao
  on public.financeiro_solicitacao_historico(solicitacao_id, created_at desc);
