-- Robo auditor: por transportadora, o laudo aprovado pelo auditor segue por e-mail automaticamente
-- (true) ou fica para o auditor enviar manualmente (false, padrao).
alter table public.auditor_robo_transportadoras
  add column if not exists email_automatico boolean not null default false;
