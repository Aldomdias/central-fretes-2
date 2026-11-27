-- Portal fracionado: atendimento por cidade (regiao/rota, prazo e taxas), por convite e canal.
-- Mesmo conteudo da aba ATENDIMENTO dos templates padrao Cantu.

create table if not exists public.fracionado_atendimento (
  id uuid primary key default gen_random_uuid(),
  convite_id uuid not null references public.fracionado_convites(id) on delete cascade,
  canal text not null,                 -- B2C | ATACADO
  ibge text not null,
  uf text not null,
  cidade text not null,
  regiao text,                         -- CAPITAL | INTERIOR 1..9 | METROPOLITANA
  prazo_dias integer,
  tda numeric,
  trt numeric,
  suframa numeric,
  outras_taxas numeric,
  updated_at timestamptz not null default now(),
  unique (convite_id, canal, ibge)
);

create index if not exists idx_fracionado_atendimento_convite on public.fracionado_atendimento (convite_id);

alter table public.fracionado_atendimento enable row level security;
drop policy if exists fracionado_atendimento_all on public.fracionado_atendimento;
create policy fracionado_atendimento_all on public.fracionado_atendimento for all using (true) with check (true);
grant all on public.fracionado_atendimento to anon, authenticated;

-- Varias origens (CDs) por convite: a tabela e o atendimento passam a ser por origem.
alter table public.fracionado_convites add column if not exists origens jsonb;       -- ["Itajaí/SC", "Serra/ES"]
alter table public.fracionado_respostas add column if not exists origem text not null default '';
alter table public.fracionado_atendimento add column if not exists origem text not null default '';

-- a chave unica passa a incluir a origem (remove a antiga, qualquer que seja o nome)
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.fracionado_respostas'::regclass and contype = 'u' loop
    execute format('alter table public.fracionado_respostas drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint where conrelid = 'public.fracionado_atendimento'::regclass and contype = 'u' loop
    execute format('alter table public.fracionado_atendimento drop constraint %I', r.conname);
  end loop;
end $$;
create unique index if not exists uq_fracionado_respostas_chave on public.fracionado_respostas (convite_id, canal, origem, uf_destino, regiao, faixa);
create unique index if not exists uq_fracionado_atendimento_chave on public.fracionado_atendimento (convite_id, canal, origem, ibge);
