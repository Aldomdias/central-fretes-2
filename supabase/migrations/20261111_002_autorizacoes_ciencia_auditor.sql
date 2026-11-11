-- Aviso ao auditor: quando Suprimentos ou o transporte (B2C/Atacado/Lotacao)
-- decide um CT-e que o auditor enviou, o auditor recebe um aviso no sistema ate
-- marcar "Ciente". `ciencia_auditor_em` nulo = decisao ainda nao vista.
--
-- Pre-requisito: 20260923_003_transporte_autorizacoes.sql ja aplicada.

alter table public.transporte_autorizacoes
  add column if not exists ciencia_auditor_em timestamptz;

-- Decisoes antigas ja foram tratadas: nao viram aviso de uma vez so.
update public.transporte_autorizacoes
   set ciencia_auditor_em = coalesce(decidido_em, now())
 where ciencia_auditor_em is null
   and status in ('AUTORIZADA', 'RECUSADA');

create index if not exists transporte_autorizacoes_ciencia_auditor_idx
  on public.transporte_autorizacoes (enviado_por)
  where ativo and ciencia_auditor_em is null and status in ('AUTORIZADA', 'RECUSADA');
