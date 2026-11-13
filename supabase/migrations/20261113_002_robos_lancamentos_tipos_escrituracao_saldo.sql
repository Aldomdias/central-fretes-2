-- Acompanhamento de lancamentos: os robos Escrituracao (Reprocessar CT-e) e Correcao de saldo
-- passam a gravar no historico (robos_lancamentos) os CT-e que ganharam MIRO, com tipo proprio
-- para filtrar e contar por mes. Antes a tabela so aceitava NFSE e CTE.
alter table public.robos_lancamentos drop constraint if exists robos_lancamentos_tipo_check;
alter table public.robos_lancamentos
  add constraint robos_lancamentos_tipo_check check (tipo in ('NFSE', 'CTE', 'ESCRITURACAO', 'SALDO'));
