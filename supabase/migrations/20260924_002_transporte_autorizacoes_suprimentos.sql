-- Modulo Suprimentos: CT-es com diferenca de tabela/taxa/erro de calculo que o
-- auditor envia pra aprovacao de Suprimentos, ja ligados a um chamado AMD na
-- Central de Solicitacoes. Reaproveita a tabela transporte_autorizacoes (mesma
-- fila/decisao/saldo somado na auditoria) com um terceiro "canal": SUPRIMENTOS.
--
-- Pre-requisito: 20260923_003_transporte_autorizacoes.sql ja aplicada.

alter table public.transporte_autorizacoes
  drop constraint if exists transporte_autorizacoes_canal_check;

alter table public.transporte_autorizacoes
  add constraint transporte_autorizacoes_canal_check
  check (canal in ('B2C', 'ATACADO', 'SUPRIMENTOS'));

alter table public.transporte_autorizacoes
  add column if not exists protocolo_amd text,
  add column if not exists tipo_ajuste text;

create index if not exists transporte_autorizacoes_protocolo_amd_idx
  on public.transporte_autorizacoes (protocolo_amd) where protocolo_amd is not null;
