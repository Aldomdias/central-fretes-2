-- Baixa de entrega em massa (planilha modelo) com aprovacao da gestao, e CT-es retirados
-- de uma fatura que ficam "aguardando nova fatura".

-- 1) Baixas de entrega solicitadas pelo auditor (chave + data de entrega). So contam como
--    entregue depois que a gestao aprova (status = 'APROVADO').
create table if not exists public.entrega_baixas_manuais (
  id uuid primary key default gen_random_uuid(),
  lote_id text not null,
  fatura_id text,
  numero_fatura text,
  transportadora text,
  chave text not null,
  chave_cte text,
  numero_cte text,
  data_entrega date not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'APROVADO', 'REJEITADO')),
  solicitado_por text,
  solicitado_em timestamptz default now(),
  decidido_por text,
  decidido_em timestamptz,
  observacao text
);

create index if not exists entrega_baixas_manuais_chave_idx on public.entrega_baixas_manuais (chave, status);
create index if not exists entrega_baixas_manuais_fatura_idx on public.entrega_baixas_manuais (fatura_id);
create index if not exists entrega_baixas_manuais_lote_idx on public.entrega_baixas_manuais (lote_id);
create index if not exists entrega_baixas_manuais_pendentes_idx on public.entrega_baixas_manuais (status) where status = 'PENDENTE';

alter table public.entrega_baixas_manuais enable row level security;
grant select, insert, update, delete on public.entrega_baixas_manuais to anon, authenticated;
drop policy if exists "central_fretes_access" on public.entrega_baixas_manuais;
create policy "central_fretes_access" on public.entrega_baixas_manuais for all to anon, authenticated using (true) with check (true);

-- 2) CT-es tirados de uma fatura (sem entrega) que aguardam a transportadora emitir nova fatura.
create table if not exists public.cte_aguardando_nova_fatura (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  chave_cte text,
  numero_cte text,
  fatura_origem_id text,
  numero_fatura_origem text,
  transportadora text,
  valor_cte numeric(14,2),
  motivo text,
  criado_por text,
  criado_em timestamptz default now(),
  resolvido_em timestamptz,
  resolvido_por text,
  unique (chave, fatura_origem_id)
);

create index if not exists cte_aguardando_nova_fatura_chave_idx on public.cte_aguardando_nova_fatura (chave);
create index if not exists cte_aguardando_nova_fatura_abertos_idx on public.cte_aguardando_nova_fatura (resolvido_em) where resolvido_em is null;

alter table public.cte_aguardando_nova_fatura enable row level security;
grant select, insert, update, delete on public.cte_aguardando_nova_fatura to anon, authenticated;
drop policy if exists "central_fretes_access" on public.cte_aguardando_nova_fatura;
create policy "central_fretes_access" on public.cte_aguardando_nova_fatura for all to anon, authenticated using (true) with check (true);
