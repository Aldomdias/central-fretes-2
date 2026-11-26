-- Portal de cotacao fracionado: volumetria pronta.
-- Gerada uma vez pelo time interno (Portal de tabelas — fracionado) e gravada aqui em partes de ate 5.000 linhas;
-- o transportador so baixa no portal (sem varrer realizado_local_ctes dia a dia).
-- base = canal|origem|faixas (serve a qualquer convite com a mesma origem, canal e faixas).
create table if not exists public.fracionado_volumetria (
  id bigserial primary key,
  base text not null,
  canal text not null,
  origem text,
  periodo_inicio date not null,
  periodo_fim date not null,
  parte int not null default 0,
  total_partes int not null default 1,
  linhas jsonb not null default '[]'::jsonb,
  notas int,
  ctes_lidos int,
  gerado_em timestamptz not null default now(),
  gerado_por text,
  unique (base, periodo_inicio, periodo_fim, parte)
);
create index if not exists idx_fracionado_volumetria_base on public.fracionado_volumetria (base, periodo_fim desc);
alter table public.fracionado_volumetria enable row level security;
drop policy if exists fracionado_volumetria_all on public.fracionado_volumetria;
create policy fracionado_volumetria_all on public.fracionado_volumetria for all using (true) with check (true);
grant all on public.fracionado_volumetria to anon, authenticated;
grant usage, select on sequence public.fracionado_volumetria_id_seq to anon, authenticated;
