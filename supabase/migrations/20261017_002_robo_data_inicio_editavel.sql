-- Robo auditor: data de inicio editavel por transportadora. Vazia = padrao (um dia antes da inclusao na lista).
alter table public.auditor_robo_transportadoras
  add column if not exists data_inicio date;
