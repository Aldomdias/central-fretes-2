-- Importacao do relatorio SAP de contas a pagar (financeiro_pagamentos):
-- lancamentos ainda nao compensados chegam como "partida lancada" e
-- precisam desse numero pra o auditor saber que ja ha uma partida em
-- andamento, mesmo antes do pagamento ser efetivado.
alter table if exists public.financeiro_pagamentos
  add column if not exists partida text;

create index if not exists idx_fin_pagamentos_partida on public.financeiro_pagamentos(partida);
