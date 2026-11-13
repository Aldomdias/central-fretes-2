-- Aviso ao auditor: a transportadora respondeu o laudo da Auditoria de CT-e
-- pelo portal (auditoria_cte_portal_respostas). O aviso vai para o auditor do
-- processo/laudo e some quando ele marca "Ciente" ou valida a resposta.
--
-- Pre-requisito: 20260818090000_portal_resposta_transportadora.sql ja aplicada.

alter table public.auditoria_cte_portal_respostas
  add column if not exists ciencia_auditor_em timestamptz;

-- Respostas antigas ja foram tratadas: nao viram aviso de uma vez so.
update public.auditoria_cte_portal_respostas
   set ciencia_auditor_em = coalesce(respondido_em, now())
 where ciencia_auditor_em is null;

create index if not exists idx_portal_respostas_ciencia_auditor
  on public.auditoria_cte_portal_respostas (processo_id)
  where ciencia_auditor_em is null and status_validacao = 'PENDENTE';
