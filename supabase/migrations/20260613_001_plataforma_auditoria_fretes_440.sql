-- Demanda 4.40 - Plataforma de Auditoria de Fretes.
-- Nao altera as tabelas nem os fluxos de Auditoria Lotacao.

alter table if exists public.faturas
  add column if not exists auditor_id text,
  add column if not exists auditor_nome text,
  add column if not exists auditor_email text,
  add column if not exists valor_recuperado numeric(14,2) default 0,
  add column if not exists valor_pago numeric(14,2) default 0,
  add column if not exists ctes_auditados integer default 0,
  add column if not exists ctes_divergentes integer default 0,
  add column if not exists ctes_sem_calculo integer default 0,
  add column if not exists ctes_sem_tabela integer default 0,
  add column if not exists boleto_status text default 'PENDENTE',
  add column if not exists protocolo_financeiro_id uuid,
  add column if not exists canal_envio_financeiro text,
  add column if not exists substituida_por_id uuid references public.faturas(id);

alter table if exists public.fatura_detalhes
  add column if not exists motivo_divergencia text,
  add column if not exists doccob_id uuid,
  add column if not exists selecionado_doccob boolean default false;

create table if not exists public.auditoria_carteiras (
  id uuid primary key default gen_random_uuid(),
  transportadora text not null,
  cnpj_transportadora text,
  auditor_id text,
  auditor_nome text,
  auditor_email text,
  ativo boolean not null default true,
  atribuido_por text,
  atribuido_em timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (transportadora)
);

create table if not exists public.auditoria_fatura_historico (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  acao text not null,
  status_anterior text,
  status_novo text,
  descricao text,
  metadata jsonb default '{}'::jsonb,
  usuario_id text,
  usuario_nome text,
  usuario_email text,
  created_at timestamptz default now()
);

create table if not exists public.auditoria_doccobs (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  nome_arquivo text not null,
  formato text not null default 'XLSX',
  cte_ids jsonb not null default '[]'::jsonb,
  quantidade_ctes integer not null default 0,
  valor_total numeric(14,2) default 0,
  motivo text,
  observacao text,
  gerado_por_id text,
  gerado_por_nome text,
  created_at timestamptz default now()
);

create table if not exists public.financeiro_protocolos (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique,
  canal text not null default 'PROTOCOLO_FINANCEIRO',
  fatura_ids jsonb not null default '[]'::jsonb,
  valor numeric(14,2) not null default 0,
  lote text,
  horario_corte time,
  responsavel_id text,
  responsavel_nome text,
  observacoes text,
  status text not null default 'ENVIADO',
  enviado_em timestamptz default now(),
  concluido_em timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.financeiro_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique,
  tipo text not null,
  fatura_id uuid references public.faturas(id),
  protocolo_financeiro_id uuid references public.financeiro_protocolos(id),
  descricao text not null,
  prioridade text default 'NORMAL',
  status text not null default 'ABERTA',
  prazo_sla date,
  responsavel_id text,
  responsavel_nome text,
  aberto_por_id text,
  aberto_por_nome text,
  concluido_em timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.financeiro_solicitacao_historico (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.financeiro_solicitacoes(id) on delete cascade,
  acao text not null,
  comentario text,
  anexos jsonb default '[]'::jsonb,
  usuario_id text,
  usuario_nome text,
  created_at timestamptz default now()
);

create table if not exists public.financeiro_boletos (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  status text not null default 'PENDENTE',
  vencimento date,
  linha_digitavel text,
  arquivo_nome text,
  arquivo_url text,
  recebido_em timestamptz,
  enviado_financeiro_em timestamptz,
  pago_em timestamptz,
  observacao text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (fatura_id)
);

create table if not exists public.financeiro_pagamentos (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid references public.faturas(id),
  numero_fatura text,
  protocolo text,
  documento_compensacao text,
  valor_pago numeric(14,2),
  data_pagamento date,
  origem text default 'IMPORTACAO_RELATORIO',
  resultado text,
  diferenca numeric(14,2) default 0,
  arquivo_origem text,
  imported_by text,
  imported_at timestamptz default now()
);

create table if not exists public.financeiro_config (
  id uuid primary key default gen_random_uuid(),
  horario_corte time not null default '16:00',
  ativo boolean not null default true,
  updated_by text,
  updated_at timestamptz default now()
);

insert into public.financeiro_config (horario_corte)
select '16:00'
where not exists (select 1 from public.financeiro_config where ativo);

create index if not exists idx_auditoria_carteiras_auditor on public.auditoria_carteiras(auditor_email);
create index if not exists idx_auditoria_historico_fatura on public.auditoria_fatura_historico(fatura_id, created_at desc);
create index if not exists idx_auditoria_doccobs_fatura on public.auditoria_doccobs(fatura_id, created_at desc);
create index if not exists idx_fin_protocolos_status on public.financeiro_protocolos(status, created_at desc);
create index if not exists idx_fin_solicitacoes_sla on public.financeiro_solicitacoes(status, prazo_sla);
create index if not exists idx_fin_boletos_vencimento on public.financeiro_boletos(status, vencimento);
create index if not exists idx_fin_pagamentos_fatura on public.financeiro_pagamentos(fatura_id, data_pagamento desc);

alter table public.auditoria_carteiras enable row level security;
alter table public.auditoria_fatura_historico enable row level security;
alter table public.auditoria_doccobs enable row level security;
alter table public.financeiro_protocolos enable row level security;
alter table public.financeiro_solicitacoes enable row level security;
alter table public.financeiro_solicitacao_historico enable row level security;
alter table public.financeiro_boletos enable row level security;
alter table public.financeiro_pagamentos enable row level security;
alter table public.financeiro_config enable row level security;

-- O sistema existente usa usuarios_central e cliente Supabase com chave anon.
-- Mantemos o mesmo modelo de acesso das tabelas atuais; os perfis e permissoes
-- continuam sendo validados pela aplicacao, sem criar outra base de usuarios.
grant select, insert, update, delete on public.auditoria_carteiras to anon, authenticated;
grant select, insert, update, delete on public.auditoria_fatura_historico to anon, authenticated;
grant select, insert, update, delete on public.auditoria_doccobs to anon, authenticated;
grant select, insert, update, delete on public.financeiro_protocolos to anon, authenticated;
grant select, insert, update, delete on public.financeiro_solicitacoes to anon, authenticated;
grant select, insert, update, delete on public.financeiro_solicitacao_historico to anon, authenticated;
grant select, insert, update, delete on public.financeiro_boletos to anon, authenticated;
grant select, insert, update, delete on public.financeiro_pagamentos to anon, authenticated;
grant select, insert, update on public.financeiro_config to anon, authenticated;

do $$
declare
  tabela text;
begin
  foreach tabela in array array[
    'auditoria_carteiras',
    'auditoria_fatura_historico',
    'auditoria_doccobs',
    'financeiro_protocolos',
    'financeiro_solicitacoes',
    'financeiro_solicitacao_historico',
    'financeiro_boletos',
    'financeiro_pagamentos',
    'financeiro_config'
  ]
  loop
    execute format('drop policy if exists "central_fretes_access" on public.%I', tabela);
    execute format(
      'create policy "central_fretes_access" on public.%I for all to anon, authenticated using (true) with check (true)',
      tabela
    );
  end loop;
end $$;
