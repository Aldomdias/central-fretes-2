-- Linhas do relatorio SAP que nao casaram sozinhas com uma fatura (CNPJ divergente,
-- ambiguas ou valor igual a uma fatura em aberto). O auditor vincula manualmente
-- na aba Financeiro > Pagamentos > "Vincular pagamentos do SAP".
create table if not exists public.financeiro_sap_sem_vinculo (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  numero_fatura text,
  transportadora_sap text,
  cnpj text,
  valor_pago numeric(14,2),
  documento_compensacao text,
  partida text,
  lancamento_contabil text,
  data_pagamento date,
  data_lancamento date,
  compensado boolean default false,
  lancada_financeiro boolean default false,
  motivo text,
  imported_at timestamptz default now(),
  vinculado_fatura_id uuid,
  vinculado_por text,
  vinculado_em timestamptz
);

create index if not exists financeiro_sap_sem_vinculo_numero_idx on public.financeiro_sap_sem_vinculo (numero_fatura);
create index if not exists financeiro_sap_sem_vinculo_pendentes_idx on public.financeiro_sap_sem_vinculo (vinculado_em) where vinculado_em is null;

alter table public.financeiro_sap_sem_vinculo enable row level security;
grant select, insert, update, delete on public.financeiro_sap_sem_vinculo to anon, authenticated;
drop policy if exists "central_fretes_access" on public.financeiro_sap_sem_vinculo;
create policy "central_fretes_access" on public.financeiro_sap_sem_vinculo for all to anon, authenticated using (true) with check (true);
