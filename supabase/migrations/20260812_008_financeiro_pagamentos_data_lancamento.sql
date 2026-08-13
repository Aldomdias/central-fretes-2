-- Data do lancamento contabil em si (existe mesmo antes de compensar),
-- usada pra saber ha quanto tempo uma fatura "lancada no financeiro" esta
-- parada aguardando pagamento.
alter table if exists public.financeiro_pagamentos
  add column if not exists data_lancamento date;
