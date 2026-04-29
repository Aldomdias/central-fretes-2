-- Base realizada de CT-e para simulação por período/origem/destino.
-- Rode este script completo no SQL Editor do Supabase antes de importar na tela Realizado CT-e.
-- Versão reforçada: cria tabela, libera permissões e cria função RPC para importação confirmada.

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

-- Necessário para upsert pelo campo chave_cte.
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

-- Função de diagnóstico para a tela confirmar se está olhando para o Supabase certo.
create or replace function public.diagnosticar_realizado_ctes()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tabela', 'realizado_ctes',
    'total', count(*),
    'ultima_importacao', max(criado_em),
    'ultima_atualizacao', max(updated_at)
  )
  from public.realizado_ctes;
$$;

grant execute on function public.diagnosticar_realizado_ctes() to anon, authenticated;

-- Função RPC usada pelo front para importar lotes e receber a quantidade efetivamente gravada.
-- Ela evita o caso de a tela ler a planilha, mas o insert direto do navegador não confirmar nada.
create or replace function public.importar_realizado_ctes(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows precisa ser um array JSON';
  end if;

  with linhas as (
    select *
    from jsonb_to_recordset(p_rows) as x(
      arquivo_origem text,
      competencia text,
      transportadora text,
      cnpj_transportadora text,
      emissao timestamptz,
      chave_cte text,
      numero_cte text,
      serie_cte text,
      valor_cte numeric,
      valor_calculado numeric,
      diferenca numeric,
      situacao text,
      status text,
      status_conciliacao text,
      status_erp text,
      uf_origem text,
      uf_destino text,
      peso_declarado numeric,
      peso_cubado numeric,
      metros_cubicos numeric,
      volume numeric,
      canais text,
      canal text,
      canal_vendas text,
      valor_nf numeric,
      percentual_frete numeric,
      cep_destino text,
      cep_origem text,
      cidade_origem text,
      cidade_destino text,
      transportadora_contratada text,
      prazo_entrega_cliente numeric,
      raw jsonb
    )
  ), gravados as (
    insert into public.realizado_ctes (
      arquivo_origem,
      competencia,
      transportadora,
      cnpj_transportadora,
      emissao,
      chave_cte,
      numero_cte,
      serie_cte,
      valor_cte,
      valor_calculado,
      diferenca,
      situacao,
      status,
      status_conciliacao,
      status_erp,
      uf_origem,
      uf_destino,
      peso_declarado,
      peso_cubado,
      metros_cubicos,
      volume,
      canais,
      canal,
      canal_vendas,
      valor_nf,
      percentual_frete,
      cep_destino,
      cep_origem,
      cidade_origem,
      cidade_destino,
      transportadora_contratada,
      prazo_entrega_cliente,
      raw
    )
    select
      arquivo_origem,
      competencia,
      transportadora,
      cnpj_transportadora,
      emissao,
      chave_cte,
      numero_cte,
      serie_cte,
      valor_cte,
      valor_calculado,
      diferenca,
      situacao,
      status,
      status_conciliacao,
      status_erp,
      uf_origem,
      uf_destino,
      peso_declarado,
      peso_cubado,
      metros_cubicos,
      volume,
      canais,
      canal,
      canal_vendas,
      valor_nf,
      percentual_frete,
      cep_destino,
      cep_origem,
      cidade_origem,
      cidade_destino,
      transportadora_contratada,
      prazo_entrega_cliente,
      coalesce(raw, '{}'::jsonb)
    from linhas
    where nullif(chave_cte, '') is not null
    on conflict (chave_cte) do update set
      arquivo_origem = excluded.arquivo_origem,
      competencia = excluded.competencia,
      transportadora = excluded.transportadora,
      cnpj_transportadora = excluded.cnpj_transportadora,
      emissao = excluded.emissao,
      numero_cte = excluded.numero_cte,
      serie_cte = excluded.serie_cte,
      valor_cte = excluded.valor_cte,
      valor_calculado = excluded.valor_calculado,
      diferenca = excluded.diferenca,
      situacao = excluded.situacao,
      status = excluded.status,
      status_conciliacao = excluded.status_conciliacao,
      status_erp = excluded.status_erp,
      uf_origem = excluded.uf_origem,
      uf_destino = excluded.uf_destino,
      peso_declarado = excluded.peso_declarado,
      peso_cubado = excluded.peso_cubado,
      metros_cubicos = excluded.metros_cubicos,
      volume = excluded.volume,
      canais = excluded.canais,
      canal = excluded.canal,
      canal_vendas = excluded.canal_vendas,
      valor_nf = excluded.valor_nf,
      percentual_frete = excluded.percentual_frete,
      cep_destino = excluded.cep_destino,
      cep_origem = excluded.cep_origem,
      cidade_origem = excluded.cidade_origem,
      cidade_destino = excluded.cidade_destino,
      transportadora_contratada = excluded.transportadora_contratada,
      prazo_entrega_cliente = excluded.prazo_entrega_cliente,
      raw = excluded.raw,
      updated_at = now()
    returning 1
  )
  select count(*) into v_count from gravados;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.importar_realizado_ctes(jsonb) to anon, authenticated;
