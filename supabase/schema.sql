create extension if not exists pgcrypto;

create table if not exists transportadoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  status text not null default 'Ativa',
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists transportadoras_nome_idx on transportadoras (lower(nome));

create table if not exists origens (
  id uuid primary key default gen_random_uuid(),
  transportadora_id uuid not null references transportadoras(id) on delete cascade,
  cidade text not null,
  canal text not null default 'ATACADO',
  status text not null default 'Ativa',
  codigo_unidade text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists origens_transportadora_idx on origens (transportadora_id);
create index if not exists origens_cidade_idx on origens (cidade);

create table if not exists generalidades (
  id uuid primary key default gen_random_uuid(),
  origem_id uuid not null unique references origens(id) on delete cascade,
  incide_icms boolean not null default false,
  aliquota_icms numeric(12,4) not null default 0,
  ad_valorem numeric(12,4) not null default 0,
  ad_valorem_minimo numeric(12,4) not null default 0,
  pedagio numeric(12,4) not null default 0,
  gris numeric(12,4) not null default 0,
  gris_minimo numeric(12,4) not null default 0,
  tas numeric(12,4) not null default 0,
  ctrc numeric(12,4) not null default 0,
  cubagem numeric(12,4) not null default 300,
  tipo_calculo text not null default 'PERCENTUAL',
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rotas (
  id uuid primary key default gen_random_uuid(),
  origem_id uuid not null references origens(id) on delete cascade,
  nome_rota text not null,
  cotacao text not null,
  canal text,
  ibge_origem text,
  ibge_destino text not null,
  uf_destino text,
  cidade_destino text,
  prazo_entrega_dias integer,
  valor_minimo_frete numeric(12,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rotas_origem_idx on rotas (origem_id);
create index if not exists rotas_ibge_idx on rotas (ibge_destino);
create index if not exists rotas_cotacao_idx on rotas (cotacao);

create table if not exists cotacoes (
  id uuid primary key default gen_random_uuid(),
  origem_id uuid not null references origens(id) on delete cascade,
  rota text not null,
  peso_min numeric(12,4) not null default 0,
  peso_max numeric(12,4),
  peso_limite numeric(12,4),
  percentual numeric(12,4) not null default 0,
  rs_kg numeric(12,4) not null default 0,
  valor_fixo numeric(12,4) not null default 0,
  excesso numeric(12,4) not null default 0,
  frete_minimo numeric(12,4) not null default 0,
  tipo_calculo text,
  regra_calculo text,
  inicio_vigencia date,
  fim_vigencia date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cotacoes_origem_idx on cotacoes (origem_id);
create index if not exists cotacoes_rota_idx on cotacoes (rota);

create table if not exists taxas_especiais (
  id uuid primary key default gen_random_uuid(),
  origem_id uuid not null references origens(id) on delete cascade,
  ibge_destino text not null,
  ad_val numeric(12,4) not null default 0,
  ad_val_minimo numeric(12,4) not null default 0,
  gris numeric(12,4) not null default 0,
  gris_minimo numeric(12,4) not null default 0,
  tda numeric(12,4) not null default 0,
  tdr numeric(12,4) not null default 0,
  trt numeric(12,4) not null default 0,
  suframa numeric(12,4) not null default 0,
  outras numeric(12,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists taxas_especiais_origem_idx on taxas_especiais (origem_id);
create index if not exists taxas_especiais_ibge_idx on taxas_especiais (ibge_destino);

create table if not exists importacoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  origem_nome text,
  transportadora_nome text,
  status text not null default 'processado',
  linhas_lidas integer not null default 0,
  linhas_importadas integer not null default 0,
  linhas_com_erro integer not null default 0,
  observacoes text,
  created_at timestamptz not null default now()
);

create table if not exists arquivos_importados (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid references importacoes(id) on delete set null,
  nome_arquivo text not null,
  tipo_arquivo text,
  tamanho_bytes bigint,
  origem_nome text,
  transportadora_nome text,
  created_at timestamptz not null default now()
);

create table if not exists realizado_cargas (
  id uuid primary key default gen_random_uuid(),
  competencia date,
  data_embarque date,
  filial text,
  pedido text,
  nota_fiscal text,
  transportadora text,
  origem text,
  destino_cidade text,
  destino_uf text,
  ibge_destino text,
  peso_kg numeric(12,4) not null default 0,
  cubagem numeric(12,4) not null default 0,
  valor_nf numeric(12,4) not null default 0,
  custo_real numeric(12,4) not null default 0,
  prazo_real_dias integer,
  canal text,
  created_at timestamptz not null default now()
);

create index if not exists realizado_competencia_idx on realizado_cargas (competencia);
create index if not exists realizado_ibge_idx on realizado_cargas (ibge_destino);
create index if not exists realizado_transportadora_idx on realizado_cargas (transportadora);

create table if not exists simulacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  periodo_inicio date,
  periodo_fim date,
  tabela_referencia text,
  total_cargas integer not null default 0,
  custo_real_total numeric(14,2) not null default 0,
  custo_simulado_total numeric(14,2) not null default 0,
  saving_total numeric(14,2) not null default 0,
  aderencia_percentual numeric(12,4) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists simulacao_itens (
  id uuid primary key default gen_random_uuid(),
  simulacao_id uuid not null references simulacoes(id) on delete cascade,
  realizado_carga_id uuid references realizado_cargas(id) on delete set null,
  transportadora_simulada text,
  origem_simulada text,
  rota_simulada text,
  cotacao_simulada text,
  custo_real numeric(12,4) not null default 0,
  custo_simulado numeric(12,4) not null default 0,
  saving numeric(12,4) not null default 0,
  aderente boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists simulacao_itens_simulacao_idx on simulacao_itens (simulacao_id);
