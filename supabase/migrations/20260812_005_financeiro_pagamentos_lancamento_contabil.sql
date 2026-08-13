-- "Lançto.compensação" (numeracao 200...) e' a partida de pagamento real e
-- ja e' gravada em partida/documento_compensacao. "Lançamento contábil"
-- (numeracao 190...) e' so o lancamento original da fatura no SAP - guardamos
-- como referencia complementar, sem confundir com a partida de pagamento.
alter table if exists public.financeiro_pagamentos
  add column if not exists lancamento_contabil text;

create index if not exists idx_fin_pagamentos_lancamento_contabil on public.financeiro_pagamentos(lancamento_contabil);
