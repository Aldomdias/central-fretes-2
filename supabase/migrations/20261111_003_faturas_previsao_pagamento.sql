-- Previsao de pagamento combinada para a fatura (ex.: vencida liberada que vai para protocolo com
-- pagamento alinhado para o dia 12). Marcada na tela Diagnostico e repassada a transportadora.
-- data_previsao_pagamento ja existia na criacao da tabela, mas nunca foi usada: garante as colunas.

alter table if exists public.faturas
  add column if not exists data_previsao_pagamento date,
  add column if not exists previsao_pagamento_em timestamptz,
  add column if not exists previsao_pagamento_por text;

create index if not exists idx_faturas_data_previsao_pagamento
  on public.faturas (data_previsao_pagamento)
  where data_previsao_pagamento is not null;
