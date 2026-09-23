-- Ponte temporaria para os protocolos diarios em planilha. Os novos envios
-- continuam vindo diretamente de financeiro_protocolos.
create table if not exists public.financeiro_descontos_enviados_legado (
  id uuid primary key default gen_random_uuid(),
  data_envio date,
  numero_fatura text not null,
  responsavel text,
  tipo_envio text,
  transportadora text not null,
  cnpj text,
  vencimento date,
  status_fatura text,
  valor_fatura numeric(14,2) not null default 0,
  desconto_enviado numeric(14,2) not null check (desconto_enviado > 0),
  valor_real_pagar numeric(14,2) not null default 0,
  partida text,
  centro_custo_desconto text,
  observacao text,
  dados_bancarios text,
  arquivo_origem text not null,
  linha_hash text not null unique,
  importado_por text,
  importado_em timestamptz not null default now()
);

create index if not exists idx_fin_desc_legado_data on public.financeiro_descontos_enviados_legado (data_envio);
create index if not exists idx_fin_desc_legado_fatura on public.financeiro_descontos_enviados_legado (numero_fatura);
create index if not exists idx_fin_desc_legado_transportadora on public.financeiro_descontos_enviados_legado (transportadora);
create unique index if not exists uq_fin_desc_legado_origem_natural
  on public.financeiro_descontos_enviados_legado (arquivo_origem, numero_fatura, desconto_enviado);

alter table public.financeiro_descontos_enviados_legado enable row level security;
grant select, insert on public.financeiro_descontos_enviados_legado to anon, authenticated;

drop policy if exists "central_fretes_select" on public.financeiro_descontos_enviados_legado;
create policy "central_fretes_select" on public.financeiro_descontos_enviados_legado
  for select to anon, authenticated using (true);
drop policy if exists "central_fretes_insert" on public.financeiro_descontos_enviados_legado;
create policy "central_fretes_insert" on public.financeiro_descontos_enviados_legado
  for insert to anon, authenticated with check (true);
