create table if not exists frete_snapshots (
  id bigserial primary key,
  nome text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists icms_parametros (
  id bigserial primary key,
  uf_origem text,
  uf_destino text,
  aliquota numeric(10,2) not null,
  regra text,
  created_at timestamptz not null default now()
);
