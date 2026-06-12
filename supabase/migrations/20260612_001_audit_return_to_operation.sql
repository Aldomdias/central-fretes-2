-- 4.34A.5.6 - Auditoria devolve pendencia para complemento da Operacao

alter table if exists public.audit_pendencias
  add column if not exists complemento_auditoria text,
  add column if not exists complemento_solicitado_em timestamptz,
  add column if not exists complemento_solicitado_por_id text,
  add column if not exists complemento_solicitado_por_nome text,
  add column if not exists complemento_solicitado_por_email text;

alter table if exists public.audit_solicitacoes_informacao
  add column if not exists complemento_auditoria text,
  add column if not exists complemento_solicitado_em timestamptz,
  add column if not exists complemento_solicitado_por_id text,
  add column if not exists complemento_solicitado_por_nome text,
  add column if not exists complemento_solicitado_por_email text;

alter table if exists public.audit_historico_eventos
  add column if not exists solicitacao_info_id uuid
    references public.audit_solicitacoes_informacao(id) on delete cascade;

create index if not exists idx_audit_historico_solicitacao_info
  on public.audit_historico_eventos (solicitacao_info_id, data_hora);

create index if not exists idx_audit_pendencias_complemento
  on public.audit_pendencias (status, complemento_solicitado_em);

create index if not exists idx_audit_sol_info_complemento
  on public.audit_solicitacoes_informacao (status, complemento_solicitado_em);
