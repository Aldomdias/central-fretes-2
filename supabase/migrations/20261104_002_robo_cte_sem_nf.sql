-- Robo auditor: CT-es da fatura sem vinculo com a nota fiscal (sem a chave da NF na fatura, no realizado e no
-- tracking). Nao podem ser pagos: o laudo segue para a transportadora pedindo a retirada deles da fatura.
-- Lista de { chave_cte, numero_cte, valor_frete, diferenca_incluida }.
alter table public.auditor_robo_execucoes
  add column if not exists ctes_sem_nf jsonb not null default '[]'::jsonb;
