-- Portal de tabelas de frete fracionado para o transportador.
-- A Suprimentos gera um link (com validade) escolhendo o canal (B2C / ATACADO / AMBOS)
-- e a modalidade (PERCENTUAL ou FAIXA_PESO). O transportador se identifica pelo CNPJ,
-- preenche no portal (ou baixa/importa o modelo Excel) e envia. Controle de recebimento
-- = status do convite (PENDENTE -> EM_PREENCHIMENTO -> ENVIADO) + historico de envios.

create table if not exists public.fracionado_convites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  transportadora text not null,
  campanha text,                                   -- rotulo livre (ex.: "Reajuste 2027")
  origem text,                                     -- CD/origem a que a tabela se refere (opcional)
  canal text not null default 'AMBOS',             -- B2C | ATACADO | AMBOS
  modalidade text not null default 'PERCENTUAL',   -- PERCENTUAL | FAIXA_PESO
  faixas jsonb,                                    -- {"B2C":"0-2, 2-5, 100+","ATACADO":"..."} (so FAIXA_PESO)
  cnpj_raizes text[] not null default '{}',        -- raizes (8 digitos) aceitas; vazio = qualquer CNPJ valido
  status text not null default 'PENDENTE',         -- PENDENTE | EM_PREENCHIMENTO | ENVIADO | CANCELADO
  expira_em timestamptz,
  primeiro_acesso_em timestamptz,
  ultimo_acesso_em timestamptz,
  enviado_em timestamptz,
  qtd_envios integer not null default 0,
  respondente_nome text,
  respondente_email text,
  respondente_cnpj text,
  dados_gerais jsonb not null default '{}'::jsonb, -- por canal: prazo, GRIS, ad valorem, pedagio, TAS, TDA, vigencia
  criado_por text,
  created_at timestamptz not null default now()
);

create table if not exists public.fracionado_respostas (
  id uuid primary key default gen_random_uuid(),
  convite_id uuid not null references public.fracionado_convites(id) on delete cascade,
  canal text not null,                 -- B2C | ATACADO
  uf_destino text not null,
  regiao text not null,                -- CAPITAL | INTERIOR 1..9 | METROPOLITANA
  faixa text not null default '',      -- '' no percentual; ex.: "0 a 2 kg" / "Acima de 100 kg"
  peso_inicial numeric,
  peso_final numeric,                  -- null = faixa aberta (excedente R$/kg)
  frete_valor numeric,                 -- R$ da faixa (ou R$/kg quando faixa aberta)
  frete_percentual numeric,            -- % sobre o valor da NF (percentual)
  frete_minimo numeric,                -- R$ minimo (percentual)
  updated_at timestamptz not null default now(),
  unique (convite_id, canal, uf_destino, regiao, faixa)
);

create table if not exists public.fracionado_envios (
  id uuid primary key default gen_random_uuid(),
  convite_id uuid not null references public.fracionado_convites(id) on delete cascade,
  enviado_em timestamptz not null default now(),
  respondente_nome text,
  respondente_email text,
  respondente_cnpj text,
  qtd_linhas integer not null default 0,
  origem_envio text not null default 'PORTAL'
);

create index if not exists idx_fracionado_convites_status on public.fracionado_convites (status);
create index if not exists idx_fracionado_respostas_convite on public.fracionado_respostas (convite_id);
create index if not exists idx_fracionado_envios_convite on public.fracionado_envios (convite_id);

alter table public.fracionado_convites enable row level security;
alter table public.fracionado_respostas enable row level security;
alter table public.fracionado_envios enable row level security;

-- Mesmo modelo de acesso das demais tabelas do app (o portal externo usa a
-- funcao serverless com service_role, nunca estas tabelas direto).
do $$
declare t text;
begin
  foreach t in array array['fracionado_convites','fracionado_respostas','fracionado_envios']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for all using (true) with check (true)', t || '_all', t);
    execute format('grant all on public.%I to anon, authenticated', t);
  end loop;
end $$;
