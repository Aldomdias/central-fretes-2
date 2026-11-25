-- Robo Identificador de Faturas: trava de reenvio configuravel na tela.
-- Quantos dias o robo espera antes de mandar outro e-mail para a mesma transportadora (padrao 3).
alter table public.robo_faturas_config
  add column if not exists dias_sem_reenvio integer not null default 3;

alter table public.robo_faturas_config
  drop constraint if exists robo_faturas_config_dias_sem_reenvio_chk;
alter table public.robo_faturas_config
  add constraint robo_faturas_config_dias_sem_reenvio_chk check (dias_sem_reenvio between 0 and 60);

notify pgrst, 'reload schema';
