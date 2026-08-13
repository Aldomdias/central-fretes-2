-- Demanda 4.40A: Envio de fatura para Protocolo Financeiro pela Auditoria de
-- Fretes. Evolui a tabela financeiro_protocolos (ja criada em
-- 20260613_001_plataforma_auditoria_fretes_440.sql) em vez de criar um modulo
-- financeiro paralelo, e adiciona os cadastros que faltavam (dados bancarios
-- por transportadora, centro de custo) e o rastreio de anexos/historico do
-- proprio protocolo.

alter table if exists public.financeiro_protocolos
  add column if not exists numero_fatura text,
  add column if not exists transportadora text,
  add column if not exists cnpj_transportadora text,
  add column if not exists vencimento date,
  add column if not exists responsavel_user_id text,
  add column if not exists tipo_envio text not null default 'DADOS_BANCARIOS',
  add column if not exists status_fatura_protocolo text,
  add column if not exists valor_fatura_original numeric(14,2),
  add column if not exists desconto_automatico numeric(14,2) not null default 0,
  add column if not exists desconto_manual numeric(14,2) not null default 0,
  add column if not exists desconto_manual_justificativa text,
  add column if not exists desconto_total numeric(14,2) not null default 0,
  add column if not exists valor_real_a_pagar numeric(14,2),
  add column if not exists partida text,
  add column if not exists valor_cobranca_processada numeric(14,2),
  add column if not exists valor_lancamento_manual numeric(14,2),
  add column if not exists centro_custo_codigo text,
  add column if not exists centro_custo_descricao text,
  add column if not exists dados_bancarios jsonb,
  add column if not exists dados_bancarios_id uuid,
  add column if not exists dados_bancarios_divergentes boolean not null default false,
  add column if not exists composicao_descontos jsonb not null default '[]'::jsonb,
  add column if not exists ativo boolean not null default true,
  add column if not exists protocolo_anterior_id uuid references public.financeiro_protocolos(id),
  add column if not exists criado_por_id text,
  add column if not exists criado_por_nome text;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'financeiro_protocolos' and constraint_name = 'financeiro_protocolos_status_fatura_protocolo_check'
  ) then
    alter table public.financeiro_protocolos
      add constraint financeiro_protocolos_status_fatura_protocolo_check
      check (status_fatura_protocolo is null or status_fatura_protocolo in ('LANCAMENTO_MANUAL', 'COBRANCA_PROCESSADA', 'MISTA'));
  end if;
end $$;

create table if not exists public.transportadora_dados_bancarios (
  id uuid primary key default gen_random_uuid(),
  transportadora text not null,
  cnpj text,
  favorecido text,
  banco text,
  codigo_banco text,
  agencia text,
  conta text,
  tipo_conta text,
  tipo_chave_pix text,
  chave_pix text,
  principal boolean not null default false,
  ativo boolean not null default true,
  observacao text,
  criado_por text,
  created_at timestamptz default now(),
  atualizado_por text,
  updated_at timestamptz default now()
);

create table if not exists public.financeiro_centros_custo (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  descricao text not null,
  ativo boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.financeiro_protocolo_anexos (
  id uuid primary key default gen_random_uuid(),
  protocolo_id uuid not null references public.financeiro_protocolos(id) on delete cascade,
  tipo text not null default 'LANCAMENTO_MANUAL',
  nome_arquivo text not null,
  url text,
  tamanho int,
  enviado_por_id text,
  enviado_por_nome text,
  enviado_em timestamptz default now()
);

create table if not exists public.financeiro_protocolo_historico (
  id uuid primary key default gen_random_uuid(),
  protocolo_id uuid not null references public.financeiro_protocolos(id) on delete cascade,
  acao text not null,
  descricao text,
  dados jsonb,
  usuario_id text,
  usuario_nome text,
  created_at timestamptz default now()
);

create index if not exists idx_fin_protocolos_fatura_numero on public.financeiro_protocolos(numero_fatura);
create index if not exists idx_fin_protocolos_ativo on public.financeiro_protocolos(ativo, status);
create index if not exists idx_transportadora_dados_bancarios_cnpj on public.transportadora_dados_bancarios(cnpj);
create index if not exists idx_transportadora_dados_bancarios_transp on public.transportadora_dados_bancarios(transportadora);
create index if not exists idx_fin_protocolo_anexos_protocolo on public.financeiro_protocolo_anexos(protocolo_id);
create index if not exists idx_fin_protocolo_historico_protocolo on public.financeiro_protocolo_historico(protocolo_id, created_at desc);

alter table public.transportadora_dados_bancarios enable row level security;
alter table public.financeiro_centros_custo enable row level security;
alter table public.financeiro_protocolo_anexos enable row level security;
alter table public.financeiro_protocolo_historico enable row level security;

grant select, insert, update, delete on public.transportadora_dados_bancarios to anon, authenticated;
grant select, insert, update, delete on public.financeiro_centros_custo to anon, authenticated;
grant select, insert, update, delete on public.financeiro_protocolo_anexos to anon, authenticated;
grant select, insert, update, delete on public.financeiro_protocolo_historico to anon, authenticated;

do $$
declare
  tabela text;
begin
  foreach tabela in array array[
    'transportadora_dados_bancarios',
    'financeiro_centros_custo',
    'financeiro_protocolo_anexos',
    'financeiro_protocolo_historico'
  ]
  loop
    execute format('drop policy if exists "central_fretes_access" on public.%I', tabela);
    execute format(
      'create policy "central_fretes_access" on public.%I for all to anon, authenticated using (true) with check (true)',
      tabela
    );
  end loop;
end $$;
