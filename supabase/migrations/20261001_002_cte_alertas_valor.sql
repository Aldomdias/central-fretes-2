-- Alerta de CT-e de valor alto (controle de anomalias).
-- A cada importacao de CT-e, os CT-e novos com valor_cte >= limiar viram um alerta aqui,
-- sao enviados por e-mail e ficam numa tela para analise (ok / anomalia).

create table if not exists public.cte_alerta_config (
  id integer primary key default 1 check (id = 1),
  limiar numeric(14,2) not null default 10000,
  ativo boolean not null default true,
  enviar_email boolean not null default true,
  emails text not null default '',
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
insert into public.cte_alerta_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.cte_alertas_valor (
  id bigserial primary key,
  chave_cte text not null unique,
  numero_cte text,
  transportadora text,
  cnpj_transportadora text,
  competencia text,
  data_emissao date,
  valor_cte numeric(14,2) not null,
  limiar_aplicado numeric(14,2) not null,
  canal text,
  cidade_origem text,
  uf_origem text,
  cidade_destino text,
  uf_destino text,
  peso numeric,
  valor_nf numeric,
  valor_calculado_verum numeric(14,2),
  diferenca_verum numeric(14,2),
  arquivo_origem text,
  status text not null default 'novo' check (status in ('novo', 'ok', 'anomalia')),
  observacao text,
  analisado_por text,
  analisado_em timestamptz,
  email_enviado_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists cte_alertas_valor_status_idx on public.cte_alertas_valor (status, criado_em desc);
create index if not exists cte_alertas_valor_email_idx on public.cte_alertas_valor (email_enviado_em) where email_enviado_em is null;
create index if not exists cte_alertas_valor_valor_idx on public.cte_alertas_valor (valor_cte desc);

alter table public.cte_alerta_config enable row level security;
alter table public.cte_alertas_valor enable row level security;

drop policy if exists "cte_alerta_config all" on public.cte_alerta_config;
create policy "cte_alerta_config all" on public.cte_alerta_config for all using (true) with check (true);

drop policy if exists "cte_alertas_valor all" on public.cte_alertas_valor;
create policy "cte_alertas_valor all" on public.cte_alertas_valor for all using (true) with check (true);
