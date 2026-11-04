-- Robo auditor: liga/desliga a regra "CT-e sem vinculo de NF". Vem DESLIGADA: hoje a base de CT-es
-- (realizado_local_ctes.chave_nfe) quase nao tem a chave da NF; ligada assim, o robo pediria a retirada de
-- quase todos os CT-es. Ligar so depois de a base ter a chave (importacao com a coluna/XML dos CT-es).
alter table public.auditor_robo_config
  add column if not exists checar_cte_sem_nf boolean not null default false;
