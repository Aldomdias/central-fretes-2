-- 4.34C.1 - resposta da Operacao com DIST/viagem vinculada

alter table if exists public.audit_solicitacoes_informacao
  add column if not exists resposta_operacao text,
  add column if not exists justificativa_operacao text,
  add column if not exists observacao_tratamento text,
  add column if not exists dist text,
  add column if not exists dist_key text,
  add column if not exists carga_id text,
  add column if not exists respondido_por_email text;

update public.audit_solicitacoes_informacao
set resposta_operacao = resposta
where nullif(btrim(resposta_operacao), '') is null
  and nullif(btrim(resposta), '') is not null;

create index if not exists idx_audit_sol_info_dist_status
  on public.audit_solicitacoes_informacao (dist_key, status);
