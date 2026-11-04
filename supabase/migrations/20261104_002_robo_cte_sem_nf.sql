-- Robo auditor: CT-es da fatura sem a chave da NF-e DENTRO do CT-e (base de CT-es / XML; tracking nao vale).
-- Nao podem ser pagos: o laudo segue para a transportadora pedindo a retirada e um CT-e novo.
-- Lista de { chave_cte, numero_cte, valor_frete, diferenca_incluida }.
alter table public.auditor_robo_execucoes
  add column if not exists ctes_sem_nf jsonb not null default '[]'::jsonb;
