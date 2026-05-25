-- ============================================================
-- MIGRATION: Tabelas base de lotacao usadas pela Auditoria
-- Data: 2026-05-24
-- Motivo: o banco possuia lotacao_cargas/rotas/tabelas, mas nao
-- possuia lotacao_lancamentos e lotacao_solicitacoes.
-- ============================================================

create table if not exists lotacao_tabelas (
  id text primary key,
  tipo text,
  nome text,
  nome_normalizado text,
  tipo_nome_key text unique,
  modelo text,
  file_name text,
  total_linhas integer default 0,
  rotas_unicas integer default 0,
  origens integer default 0,
  destinos integer default 0,
  abas_importadas jsonb default '[]'::jsonb,
  abas_ignoradas jsonb default '[]'::jsonb,
  fontes_valor jsonb default '{}'::jsonb,
  resumo_fontes_valor text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists lotacao_rotas (
  id text primary key,
  tabela_id text references lotacao_tabelas(id) on delete cascade,
  chave text,
  sheet_name text,
  excel_row integer,
  transportadora text,
  origem text,
  uf_origem text,
  destino text,
  uf_destino text,
  tipo_veiculo text,
  km numeric,
  prazo text,
  icms numeric,
  pedagio numeric,
  target numeric,
  frete_antt_oficial numeric,
  frete_antt numeric,
  diferenca_antt numeric,
  valor numeric,
  valor_fonte text,
  raw jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists lotacao_cargas (
  id uuid primary key default gen_random_uuid(),
  dist text,
  referencia text,
  operacao text,
  origem text,
  uf_origem text,
  destino text,
  uf_destino text,
  status text,
  transportadora text,
  placa_cavalo text,
  placa_carreta text,
  tipo_veiculo text,
  eixos text,
  cubagem numeric,
  coleta_planejada timestamptz,
  coleta_realizada timestamptz,
  emissao_nf timestamptz,
  frete_cantu numeric,
  frete_transp numeric,
  valor_comparacao numeric,
  pedagio numeric,
  seguro text,
  cte text,
  liberado boolean default false,
  descarga boolean default false,
  finalizado boolean default false,
  ocorrencia text,
  arquivo_origem text,
  importado_em timestamptz default now()
);

create table if not exists lotacao_lancamentos (
  id text primary key,
  carga_id text,
  dist text,
  dist_key text,
  cte text,
  cte_key text,
  fatura text,
  valor_lancado numeric default 0,
  valor_autorizado_carga numeric,
  total_autorizado_no_momento numeric,
  total_anterior numeric,
  saldo_anterior numeric,
  excedente numeric default 0,
  status text default 'OK',
  observacao text,
  criado_em timestamptz default now()
);

create table if not exists lotacao_solicitacoes (
  id text primary key,
  tipo text default 'EXCEDENTE_AUDITORIA',
  origem_solicitacao text,
  carga_id text,
  dist text,
  dist_key text,
  cte text,
  fatura text,
  transportadora text,
  origem text,
  destino text,
  tipo_veiculo text,
  valor_autorizado_carga numeric,
  total_anterior numeric,
  saldo_anterior numeric,
  valor_lancado numeric,
  excedente numeric,
  valor_adicional numeric,
  tipo_custo text,
  status text default 'PENDENTE',
  observacao text,
  resposta text,
  criado_em timestamptz default now(),
  atualizado_em timestamptz
);

create index if not exists idx_lotacao_cargas_dist on lotacao_cargas (dist);
create index if not exists idx_lotacao_cargas_cte on lotacao_cargas (cte);
create index if not exists idx_lotacao_lancamentos_dist_key on lotacao_lancamentos (dist_key);
create index if not exists idx_lotacao_solicitacoes_status on lotacao_solicitacoes (status);
create index if not exists idx_lotacao_solicitacoes_dist_key on lotacao_solicitacoes (dist_key);

alter table lotacao_tabelas enable row level security;
alter table lotacao_rotas enable row level security;
alter table lotacao_cargas enable row level security;
alter table lotacao_lancamentos enable row level security;
alter table lotacao_solicitacoes enable row level security;

grant select, insert, update, delete on lotacao_tabelas to anon, authenticated;
grant select, insert, update, delete on lotacao_rotas to anon, authenticated;
grant select, insert, update, delete on lotacao_cargas to anon, authenticated;
grant select, insert, update, delete on lotacao_lancamentos to anon, authenticated;
grant select, insert, update, delete on lotacao_solicitacoes to anon, authenticated;

drop policy if exists "lotacao_tabelas_public_access" on lotacao_tabelas;
create policy "lotacao_tabelas_public_access" on lotacao_tabelas for all using (true) with check (true);

drop policy if exists "lotacao_rotas_public_access" on lotacao_rotas;
create policy "lotacao_rotas_public_access" on lotacao_rotas for all using (true) with check (true);

drop policy if exists "lotacao_cargas_public_access" on lotacao_cargas;
create policy "lotacao_cargas_public_access" on lotacao_cargas for all using (true) with check (true);

drop policy if exists "lotacao_lancamentos_public_access" on lotacao_lancamentos;
create policy "lotacao_lancamentos_public_access" on lotacao_lancamentos for all using (true) with check (true);

drop policy if exists "lotacao_solicitacoes_public_access" on lotacao_solicitacoes;
create policy "lotacao_solicitacoes_public_access" on lotacao_solicitacoes for all using (true) with check (true);
