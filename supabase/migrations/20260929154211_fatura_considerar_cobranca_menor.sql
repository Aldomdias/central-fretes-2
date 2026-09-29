-- Escolha do auditor, por fatura: considerar a cobranca a menor (calculo negativo)
-- ao apurar o valor a descontar. false = so a cobranca a maior; true = maior - menor (minimo zero).
alter table public.faturas
  add column if not exists auditoria_considerar_menor boolean not null default false;
