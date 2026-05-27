-- ============================================================
-- MIGRATION: Permissoes das evolucoes de Auditoria e colunas
-- adicionais de rastreabilidade em lotacao_lancamentos
-- Data: 2026-05-24
-- ============================================================

alter table if exists lotacao_lancamentos
  add column if not exists audited_by_user_id text,
  add column if not exists audited_by_name text,
  add column if not exists audited_by_email text,
  add column if not exists audited_at timestamptz,
  add column if not exists audit_observation text,
  add column if not exists audit_status text default 'AUDITADO_OK',
  add column if not exists audit_exceeded_amount numeric(14,2) default 0,
  add column if not exists audit_allowed_amount numeric(14,2) default 0,
  add column if not exists audit_entered_amount numeric(14,2) default 0,
  add column if not exists origem_tela text;

alter table audit_pendencias enable row level security;
alter table audit_historico_eventos enable row level security;
alter table audit_solicitacoes_informacao enable row level security;
alter table audit_sla_config enable row level security;
alter table faturas enable row level security;
alter table fatura_detalhes enable row level security;
alter table tratativas enable row level security;
alter table tratativa_historico enable row level security;
alter table simulation_reports enable row level security;

grant select, insert, update, delete on audit_pendencias to anon, authenticated;
grant select, insert, update, delete on audit_historico_eventos to anon, authenticated;
grant select, insert, update, delete on audit_solicitacoes_informacao to anon, authenticated;
grant select, insert, update, delete on audit_sla_config to anon, authenticated;
grant select, insert, update, delete on faturas to anon, authenticated;
grant select, insert, update, delete on fatura_detalhes to anon, authenticated;
grant select, insert, update, delete on tratativas to anon, authenticated;
grant select, insert, update, delete on tratativa_historico to anon, authenticated;
grant select, insert, update, delete on simulation_reports to anon, authenticated;
grant usage, select on sequence tratativa_seq to anon, authenticated;

drop policy if exists "audit_pendencias_public_access" on audit_pendencias;
create policy "audit_pendencias_public_access" on audit_pendencias for all using (true) with check (true);

drop policy if exists "audit_historico_eventos_public_access" on audit_historico_eventos;
create policy "audit_historico_eventos_public_access" on audit_historico_eventos for all using (true) with check (true);

drop policy if exists "audit_solicitacoes_informacao_public_access" on audit_solicitacoes_informacao;
create policy "audit_solicitacoes_informacao_public_access" on audit_solicitacoes_informacao for all using (true) with check (true);

drop policy if exists "audit_sla_config_public_access" on audit_sla_config;
create policy "audit_sla_config_public_access" on audit_sla_config for all using (true) with check (true);

drop policy if exists "faturas_public_access" on faturas;
create policy "faturas_public_access" on faturas for all using (true) with check (true);

drop policy if exists "fatura_detalhes_public_access" on fatura_detalhes;
create policy "fatura_detalhes_public_access" on fatura_detalhes for all using (true) with check (true);

drop policy if exists "tratativas_public_access" on tratativas;
create policy "tratativas_public_access" on tratativas for all using (true) with check (true);

drop policy if exists "tratativa_historico_public_access" on tratativa_historico;
create policy "tratativa_historico_public_access" on tratativa_historico for all using (true) with check (true);

drop policy if exists "simulation_reports_public_access" on simulation_reports;
create policy "simulation_reports_public_access" on simulation_reports for all using (true) with check (true);
