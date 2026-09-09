-- Paginação estável e rápida da Auditoria CT-e em competências volumosas.
create index if not exists idx_rlc_competencia_id
  on public.realizado_local_ctes (competencia, id);

create index if not exists idx_auditoria_cte_resultados_competencia_id
  on public.auditoria_cte_resultados (competencia, id);

create index if not exists idx_auditoria_cte_resultados_data_id
  on public.auditoria_cte_resultados (data_emissao, id);

create index if not exists idx_fatura_detalhes_numero_cte
  on public.fatura_detalhes (numero_cte);
