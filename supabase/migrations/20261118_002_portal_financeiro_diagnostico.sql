-- Portal Financeiro: evidencias distintas de encaminhamento, programacao, pagamento e estorno.
-- Migration preparada e testada localmente; nao aplicar no projeto hospedado antes da publicacao.

alter table if exists public.faturas
  add column if not exists encaminhado_financeiro_em timestamptz,
  add column if not exists encaminhado_financeiro_por text,
  add column if not exists encaminhamento_tipo text,
  add column if not exists encaminhamento_evidencia jsonb,
  add column if not exists programacao_confirmada boolean not null default false,
  add column if not exists programacao_confirmada_em timestamptz,
  add column if not exists pagamento_confirmado boolean not null default false,
  add column if not exists pagamento_confirmado_em timestamptz,
  add column if not exists pagamento_campos_vinculo jsonb,
  add column if not exists sap_estorno_status text,
  add column if not exists sap_lancamento_original text,
  add column if not exists sap_documento_estorno text,
  add column if not exists sap_data_estorno date,
  add column if not exists sap_motivo_estorno text,
  add column if not exists sap_relancamento text;

create table if not exists public.financeiro_previsao_historico (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  data_anterior date,
  data_nova date,
  origem text not null,
  confirmada boolean not null default false,
  usuario_nome text,
  created_at timestamptz not null default now()
);

create table if not exists public.financeiro_encaminhamentos (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  tipo text not null check (tipo in ('BOLETO_NA_PASTA', 'DADOS_BANCARIOS')),
  responsavel text not null,
  evidencia jsonb,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sap_estornos_fatura (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  lancamento_original text not null,
  documento_estorno text not null,
  data_estorno date,
  motivo text,
  relancamento text,
  movimentos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (fatura_id, documento_estorno)
);

create table if not exists public.boleto_arquivo_versoes (
  id uuid primary key default gen_random_uuid(),
  fatura_id text,
  hash_conteudo text not null,
  nome_arquivo text not null,
  arquivo_path text,
  valor numeric(14,2),
  vencimento date,
  linha_digitavel text,
  origem_leitura text,
  status_vinculo text not null,
  campos_comparados jsonb not null default '{}'::jsonb,
  candidatos jsonb not null default '[]'::jsonb,
  confirmado_manualmente boolean not null default false,
  confirmado_por text,
  created_at timestamptz not null default now(),
  unique (fatura_id, hash_conteudo)
);

create table if not exists public.boleto_pasta_leituras (
  id uuid primary key default gen_random_uuid(),
  origem text not null,
  status text not null,
  total_arquivos integer not null default 0,
  novos integer not null default 0,
  repetidos integer not null default 0,
  erro text,
  executado_por text,
  created_at timestamptz not null default now()
);

create index if not exists idx_fin_previsao_hist_fatura on public.financeiro_previsao_historico(fatura_id, created_at desc);
create index if not exists idx_fin_encaminhamentos_fatura on public.financeiro_encaminhamentos(fatura_id, created_at desc);
create index if not exists idx_sap_estornos_fatura on public.sap_estornos_fatura(fatura_id, created_at desc);
create index if not exists idx_boleto_versoes_fatura on public.boleto_arquivo_versoes(fatura_id, created_at desc);
create index if not exists idx_boleto_pasta_leituras_data on public.boleto_pasta_leituras(created_at desc);

alter table public.financeiro_previsao_historico enable row level security;
alter table public.financeiro_encaminhamentos enable row level security;
alter table public.sap_estornos_fatura enable row level security;
alter table public.boleto_arquivo_versoes enable row level security;
alter table public.boleto_pasta_leituras enable row level security;

grant select, insert, update on public.financeiro_previsao_historico to anon, authenticated;
grant select, insert, update on public.financeiro_encaminhamentos to anon, authenticated;
grant select, insert, update on public.sap_estornos_fatura to anon, authenticated;
grant select, insert, update on public.boleto_arquivo_versoes to anon, authenticated;
grant select, insert, update on public.boleto_pasta_leituras to anon, authenticated;

do $$
declare tabela text;
begin
  foreach tabela in array array['financeiro_previsao_historico', 'financeiro_encaminhamentos', 'sap_estornos_fatura', 'boleto_arquivo_versoes', 'boleto_pasta_leituras'] loop
    execute format('drop policy if exists "central_fretes_access" on public.%I', tabela);
    execute format('create policy "central_fretes_access" on public.%I for all to anon, authenticated using (true) with check (true)', tabela);
  end loop;
end $$;

