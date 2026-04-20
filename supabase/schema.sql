create extension if not exists pgcrypto;

create table if not exists public.transportadoras (
  id text primary key,
  nome text not null,
  status text not null default 'Ativa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.origens (
  id text primary key,
  transportadora_id text not null references public.transportadoras(id) on delete cascade,
  cidade text not null,
  canal text not null default 'ATACADO',
  status text not null default 'Ativa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generalidades (
  origem_id text primary key references public.origens(id) on delete cascade,
  incide_icms boolean not null default false,
  aliquota_icms numeric(12,4),
  ad_valorem numeric(12,4),
  ad_valorem_minimo numeric(12,4),
  pedagio numeric(12,4),
  gris numeric(12,4),
  gris_minimo numeric(12,4),
  tas numeric(12,4),
  ctrc numeric(12,4),
  cubagem numeric(12,4),
  tipo_calculo text default 'PERCENTUAL',
  observacoes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rotas (
  id text primary key,
  origem_id text not null references public.origens(id) on delete cascade,
  nome_rota text,
  ibge_origem text,
  ibge_destino text,
  canal text,
  prazo_entrega_dias numeric(12,4),
  valor_minimo_frete numeric(14,4),
  codigo_unidade text,
  cep_inicial text,
  cep_final text,
  metodo_envio text,
  inicio_vigencia text,
  fim_vigencia text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cotacoes (
  id text primary key,
  origem_id text not null references public.origens(id) on delete cascade,
  rota text,
  peso_min numeric(14,4),
  peso_max numeric(14,4),
  rs_kg numeric(14,4),
  excesso numeric(14,4),
  percentual numeric(14,4),
  valor_fixo numeric(14,4),
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.taxas_especiais (
  id text primary key,
  origem_id text not null references public.origens(id) on delete cascade,
  ibge_destino text,
  tda numeric(14,4),
  tdr numeric(14,4),
  trt numeric(14,4),
  suframa numeric(14,4),
  outras numeric(14,4),
  gris numeric(14,4),
  gris_minimo numeric(14,4),
  ad_val numeric(14,4),
  ad_val_minimo numeric(14,4),
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cadastros_snapshot (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.frete_importacoes (
  id bigserial primary key,
  tipo text,
  canal text,
  arquivo text,
  inseridos integer default 0,
  erros jsonb default '[]'::jsonb,
  meta jsonb default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_transportadoras_updated_at on public.transportadoras;
create trigger trg_transportadoras_updated_at
before update on public.transportadoras
for each row execute function public.set_updated_at();

drop trigger if exists trg_origens_updated_at on public.origens;
create trigger trg_origens_updated_at
before update on public.origens
for each row execute function public.set_updated_at();

drop trigger if exists trg_generalidades_updated_at on public.generalidades;
create trigger trg_generalidades_updated_at
before update on public.generalidades
for each row execute function public.set_updated_at();

drop trigger if exists trg_rotas_updated_at on public.rotas;
create trigger trg_rotas_updated_at
before update on public.rotas
for each row execute function public.set_updated_at();

drop trigger if exists trg_cotacoes_updated_at on public.cotacoes;
create trigger trg_cotacoes_updated_at
before update on public.cotacoes
for each row execute function public.set_updated_at();

drop trigger if exists trg_taxas_especiais_updated_at on public.taxas_especiais;
create trigger trg_taxas_especiais_updated_at
before update on public.taxas_especiais
for each row execute function public.set_updated_at();

drop trigger if exists trg_cadastros_snapshot_updated_at on public.cadastros_snapshot;
create trigger trg_cadastros_snapshot_updated_at
before update on public.cadastros_snapshot
for each row execute function public.set_updated_at();

create index if not exists idx_origens_transportadora_id on public.origens(transportadora_id);
create index if not exists idx_rotas_origem_id on public.rotas(origem_id);
create index if not exists idx_cotacoes_origem_id on public.cotacoes(origem_id);
create index if not exists idx_taxas_especiais_origem_id on public.taxas_especiais(origem_id);

alter table public.transportadoras enable row level security;
alter table public.origens enable row level security;
alter table public.generalidades enable row level security;
alter table public.rotas enable row level security;
alter table public.cotacoes enable row level security;
alter table public.taxas_especiais enable row level security;
alter table public.cadastros_snapshot enable row level security;
alter table public.frete_importacoes enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'transportadoras',
    'origens',
    'generalidades',
    'rotas',
    'cotacoes',
    'taxas_especiais',
    'cadastros_snapshot',
    'frete_importacoes'
  ]
  loop
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert" on public.%I', t, t);
    execute format('drop policy if exists "%s_update" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete" on public.%I', t, t);

    execute format('create policy "%s_select" on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('create policy "%s_insert" on public.%I for insert to anon, authenticated with check (true)', t, t);
    execute format('create policy "%s_update" on public.%I for update to anon, authenticated using (true) with check (true)', t, t);
    execute format('create policy "%s_delete" on public.%I for delete to anon, authenticated using (true)', t, t);
  end loop;
end $$;
