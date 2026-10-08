-- Portal de cotacao de lotacao: o transportador recebe um link, se identifica
-- pelo CNPJ e preenche valor LIQUIDO + pedagio por rota/tipo de veiculo. O ICMS
-- sai da matriz origem/destino e o bruto e calculado, entao todas as propostas
-- chegam na mesma base de comparacao.

create table if not exists public.lotacao_cotacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  periodo_label text,
  status text not null default 'ABERTA',       -- ABERTA | ENCERRADA
  prazo_resposta date,
  criado_por text,
  created_at timestamptz not null default now()
);

create table if not exists public.lotacao_cotacao_rotas (
  id uuid primary key default gen_random_uuid(),
  cotacao_id uuid not null references public.lotacao_cotacoes(id) on delete cascade,
  chave text not null,
  origem text not null,
  uf_origem text,
  destino text not null,
  uf_destino text,
  tipo_veiculo text not null,
  km numeric,
  viagens numeric,
  frete_medio numeric,
  target numeric,
  unique (cotacao_id, chave)
);

create table if not exists public.lotacao_cotacao_convites (
  id uuid primary key default gen_random_uuid(),
  cotacao_id uuid not null references public.lotacao_cotacoes(id) on delete cascade,
  transportadora text not null,
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  cnpj_raizes text[] not null default '{}',     -- raizes (8 digitos) aceitas na identificacao
  chaves jsonb,                                 -- null = todas as rotas da cotacao
  status text not null default 'PENDENTE',      -- PENDENTE | EM_PREENCHIMENTO | ENVIADO
  primeiro_acesso_em timestamptz,
  enviado_em timestamptz,
  respondente_nome text,
  respondente_email text,
  respondente_cnpj text,
  tentativas_cnpj integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.lotacao_cotacao_propostas (
  id uuid primary key default gen_random_uuid(),
  convite_id uuid not null references public.lotacao_cotacao_convites(id) on delete cascade,
  cotacao_id uuid not null references public.lotacao_cotacoes(id) on delete cascade,
  chave text not null,
  valor_liquido numeric,
  pedagio numeric,
  aliquota_icms numeric,        -- % usada no calculo (fica gravada: auditavel)
  icms_valor numeric,
  valor_bruto numeric,
  prazo_dias integer,
  validade date,
  observacao text,
  updated_at timestamptz not null default now(),
  unique (convite_id, chave)
);

create index if not exists idx_lotacao_cotacao_convites_cotacao on public.lotacao_cotacao_convites (cotacao_id);
create index if not exists idx_lotacao_cotacao_propostas_cotacao on public.lotacao_cotacao_propostas (cotacao_id);

alter table public.lotacao_cotacoes enable row level security;
alter table public.lotacao_cotacao_rotas enable row level security;
alter table public.lotacao_cotacao_convites enable row level security;
alter table public.lotacao_cotacao_propostas enable row level security;

-- Mesmo modelo de acesso das demais tabelas do app (o portal externo usa a
-- funcao serverless com service_role, nunca estas tabelas direto).
do $$
declare t text;
begin
  foreach t in array array['lotacao_cotacoes','lotacao_cotacao_rotas','lotacao_cotacao_convites','lotacao_cotacao_propostas']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for all using (true) with check (true)', t || '_all', t);
    execute format('grant all on public.%I to anon, authenticated', t);
  end loop;
end $$;
