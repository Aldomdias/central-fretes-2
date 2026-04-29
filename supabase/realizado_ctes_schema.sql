-- Base realizada de CT-e para simulação por período/origem/destino.
-- Rode este script no SQL Editor do Supabase antes de importar na tela Realizado CT-e.
-- Esta versão também corrige permissão/RLS para o front conseguir gravar e ler a tabela.

create extension if not exists pgcrypto;

create table if not exists public.realizado_ctes (
  id uuid primary key default gen_random_uuid()
);

alter table public.realizado_ctes add column if not exists arquivo_origem text;
alter table public.realizado_ctes add column if not exists competencia text;
alter table public.realizado_ctes add column if not exists transportadora text;
alter table public.realizado_ctes add column if not exists cnpj_transportadora text;
alter table public.realizado_ctes add column if not exists emissao timestamptz;
alter table public.realizado_ctes add column if not exists chave_cte text;
alter table public.realizado_ctes add column if not exists numero_cte text;
alter table public.realizado_ctes add column if not exists serie_cte text;
alter table public.realizado_ctes add column if not exists valor_cte numeric(14,2);
alter table public.realizado_ctes add column if not exists valor_calculado numeric(14,2);
alter table public.realizado_ctes add column if not exists diferenca numeric(14,2);
alter table public.realizado_ctes add column if not exists situacao text;
alter table public.realizado_ctes add column if not exists status text;
alter table public.realizado_ctes add column if not exists status_conciliacao text;
alter table public.realizado_ctes add column if not exists status_erp text;
alter table public.realizado_ctes add column if not exists uf_origem text;
alter table public.realizado_ctes add column if not exists uf_destino text;
alter table public.realizado_ctes add column if not exists peso_declarado numeric(14,4);
alter table public.realizado_ctes add column if not exists peso_cubado numeric(14,4);
alter table public.realizado_ctes add column if not exists metros_cubicos numeric(14,4);
alter table public.realizado_ctes add column if not exists volume numeric(14,4);
alter table public.realizado_ctes add column if not exists canais text;
alter table public.realizado_ctes add column if not exists canal text;
alter table public.realizado_ctes add column if not exists canal_vendas text;
alter table public.realizado_ctes add column if not exists valor_nf numeric(14,2);
alter table public.realizado_ctes add column if not exists percentual_frete numeric(14,4);
alter table public.realizado_ctes add column if not exists cep_destino text;
alter table public.realizado_ctes add column if not exists cep_origem text;
alter table public.realizado_ctes add column if not exists cidade_origem text;
alter table public.realizado_ctes add column if not exists cidade_destino text;
alter table public.realizado_ctes add column if not exists transportadora_contratada text;
alter table public.realizado_ctes add column if not exists prazo_entrega_cliente numeric(10,2);
alter table public.realizado_ctes add column if not exists raw jsonb default '{}'::jsonb;
alter table public.realizado_ctes add column if not exists criado_em timestamptz not null default now();
alter table public.realizado_ctes add column if not exists updated_at timestamptz not null default now();

-- Necessário para o upsert pelo campo chave_cte.
create unique index if not exists ux_realizado_ctes_chave_cte on public.realizado_ctes (chave_cte);

create index if not exists idx_realizado_ctes_emissao on public.realizado_ctes (emissao);
create index if not exists idx_realizado_ctes_competencia on public.realizado_ctes (competencia);
create index if not exists idx_realizado_ctes_rota on public.realizado_ctes (canal, cidade_origem, uf_destino, cidade_destino);
create index if not exists idx_realizado_ctes_transportadora on public.realizado_ctes (transportadora);
create index if not exists idx_realizado_ctes_cep_destino on public.realizado_ctes (cep_destino);

create or replace function public.set_realizado_ctes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_realizado_ctes_updated_at on public.realizado_ctes;
create trigger trg_realizado_ctes_updated_at
before update on public.realizado_ctes
for each row execute function public.set_realizado_ctes_updated_at();

-- O app usa a chave anon do Supabase no navegador. Para esse sistema interno funcionar,
-- a tabela precisa aceitar select/insert/update/delete pelo front.
alter table public.realizado_ctes disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.realizado_ctes to anon, authenticated;
