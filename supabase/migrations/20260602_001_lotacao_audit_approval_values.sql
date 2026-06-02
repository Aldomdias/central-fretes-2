-- ============================================================
-- MIGRATION: Valores finais no fluxo Operacao x Auditoria Lotacao
-- Data: 2026-06-02
-- ============================================================

alter table if exists audit_pendencias
  add column if not exists valor_original numeric(14,2),
  add column if not exists valor_adicional_aprovado numeric(14,2) default 0,
  add column if not exists valor_final_autorizado numeric(14,2),
  add column if not exists aprovado_por_email text,
  add column if not exists justificativa_operacao text,
  add column if not exists resposta_auditoria text,
  add column if not exists auditado_ok_em timestamptz,
  add column if not exists devolvido_auditoria_em timestamptz,
  add column if not exists prazo_operacao_em timestamptz,
  add column if not exists prazo_auditoria_em timestamptz;

update audit_pendencias
set
  valor_original = coalesce(valor_original, valor_autorizado),
  valor_adicional_aprovado = coalesce(valor_adicional_aprovado, case when status = 'APROVADO_OPERACAO' then valor_excedente else 0 end),
  valor_final_autorizado = coalesce(
    valor_final_autorizado,
    coalesce(valor_autorizado, 0) + case when status = 'APROVADO_OPERACAO' then coalesce(valor_excedente, 0) else 0 end
  ),
  prazo_operacao_em = coalesce(prazo_operacao_em, created_at + interval '24 hours'),
  prazo_auditoria_em = coalesce(prazo_auditoria_em, aprovado_em + interval '24 hours')
where valor_original is null
   or valor_final_autorizado is null
   or prazo_operacao_em is null
   or (status = 'APROVADO_OPERACAO' and prazo_auditoria_em is null);

create index if not exists idx_audit_pendencias_dist_status
  on audit_pendencias (dist_key, status);
