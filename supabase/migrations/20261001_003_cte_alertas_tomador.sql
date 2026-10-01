-- Tomador do CT-e no alerta (para filtrar CPX, ITR, GP PNEUS... na tela e no e-mail).
alter table public.cte_alertas_valor add column if not exists tomador_servico text;

-- Preenche os alertas que ja existem a partir da base oficial.
update public.cte_alertas_valor a
set tomador_servico = r.tomador_servico
from public.realizado_local_ctes r
where r.chave_cte = a.chave_cte
  and a.tomador_servico is null
  and r.tomador_servico is not null;
