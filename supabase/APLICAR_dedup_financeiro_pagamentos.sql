-- Remove linhas duplicadas de financeiro_pagamentos (uma por importacao).
-- Chave do lancamento: fatura + lancamento contabil + valor.
-- Fica a linha "melhor": compensada > lancada no financeiro > partida lancada,
-- depois a que tem data de pagamento/lancamento, depois a mais recente.
with ranqueadas as (
  select id,
         row_number() over (
           partition by fatura_id, coalesce(trim(lancamento_contabil), ''), round(coalesce(valor_pago, 0) * 100)
           order by
             case resultado when 'PAGO' then 3 when 'DIVERGENTE' then 3 when 'LANCADA_FINANCEIRO' then 2 when 'PARTIDA_LANCADA' then 1 else 0 end desc,
             (data_pagamento is not null) desc,
             (data_lancamento is not null) desc,
             (partida is not null) desc,
             imported_at desc nulls last,
             id
         ) as rn
  from public.financeiro_pagamentos
  where fatura_id is not null
)
delete from public.financeiro_pagamentos p
using ranqueadas r
where p.id = r.id and r.rn > 1;
