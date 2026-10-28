-- Lancamento contabil (FI) e pagamento de cada documento do historico dos robos, trazidos do relatorio
-- do SAP HANA (partidas do fornecedor: Referencia + CNPJ). O numero da MIRO continua em "miro".
alter table public.robos_lancamentos add column if not exists lancamento_contabil text;
alter table public.robos_lancamentos add column if not exists compensacao text;
alter table public.robos_lancamentos add column if not exists data_compensacao date;
alter table public.robos_lancamentos add column if not exists vencimento_liquido date;
alter table public.robos_lancamentos add column if not exists situacao_pagamento text;
alter table public.robos_lancamentos add column if not exists contabil_atualizado_em timestamptz;

drop policy if exists "robos_lancamentos update" on public.robos_lancamentos;
create policy "robos_lancamentos update" on public.robos_lancamentos
  for update using (true) with check (true);
