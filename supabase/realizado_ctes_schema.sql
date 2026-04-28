-- Base realizada de CT-e para simulação por período/origem/destino.
-- Rode este script no Supabase antes de usar a tela Realizado CT-e.

create extension if not exists pgcrypto;

create table if not exists realizado_ctes (
  id uuid primary key default gen_random_uuid(),
  arquivo_origem text,
  competencia text,
  transportadora text,
  cnpj_transportadora text,
  emissao timestamptz,
  chave_cte text unique,
  numero_cte text,
  serie_cte text,
  valor_cte numeric(14,2),
  valor_calculado numeric(14,2),
  diferenca numeric(14,2),
  situacao text,
  status text,
  status_conciliacao text,
  status_erp text,
  uf_origem text,
  uf_destino text,
  peso_declarado numeric(14,4),
  peso_cubado numeric(14,4),
  metros_cubicos numeric(14,4),
  volume numeric(14,4),
  canais text,
  canal text,
  canal_vendas text,
  valor_nf numeric(14,2),
  percentual_frete numeric(14,4),
  cep_destino text,
  cep_origem text,
  cidade_origem text,
  cidade_destino text,
  transportadora_contratada text,
  prazo_entrega_cliente numeric(10,2),
  raw jsonb default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_realizado_ctes_emissao on realizado_ctes (emissao);
create index if not exists idx_realizado_ctes_competencia on realizado_ctes (competencia);
create index if not exists idx_realizado_ctes_rota on realizado_ctes (canal, cidade_origem, uf_destino, cidade_destino);
create index if not exists idx_realizado_ctes_transportadora on realizado_ctes (transportadora);
create index if not exists idx_realizado_ctes_cep_destino on realizado_ctes (cep_destino);

create or replace function set_realizado_ctes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_realizado_ctes_updated_at on realizado_ctes;
create trigger trg_realizado_ctes_updated_at
before update on realizado_ctes
for each row execute function set_realizado_ctes_updated_at();
