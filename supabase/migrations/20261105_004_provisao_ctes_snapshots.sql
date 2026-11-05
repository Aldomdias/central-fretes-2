-- Historico de provisoes de CT-e por competencia (Financeiro > Pagamentos).
-- Cada "Salvar provisao" grava um snapshot: o resumo (cards, por transportadora,
-- por empresa/centro de custo e o resumo do tracking) no cabecalho e, em linhas
-- separadas, os CT-es que entraram na provisao e as NFs do tracking sem CT-e.
-- Assim a provisao do mes fica congelada como foi fechada, sem recalcular.
create table if not exists public.provisao_ctes_snapshots (
  id uuid primary key default gen_random_uuid(),
  competencia text not null,             -- AAAA-MM (emissao)
  descricao text,
  resumo jsonb not null default '{}'::jsonb,
  tracking_resumo jsonb,
  centros_custo jsonb,                   -- empresa -> centro de custo usado
  qtd_provisao integer default 0,
  valor_provisao numeric(16,2) default 0,
  qtd_nf_sem_cte integer default 0,
  valor_estimado_nf_sem_cte numeric(16,2) default 0,
  criado_por text,
  criado_em timestamptz not null default now()
);
create index if not exists provisao_ctes_snapshots_comp_idx on public.provisao_ctes_snapshots (competencia, criado_em desc);

create table if not exists public.provisao_ctes_snapshot_itens (
  id bigint generated always as identity primary key,
  snapshot_id uuid not null references public.provisao_ctes_snapshots(id) on delete cascade,
  tipo text not null,                    -- CTE (provisao) | NF_SEM_CTE | CTE_FORA_BASE
  dados jsonb not null
);
create index if not exists provisao_ctes_snapshot_itens_snap_idx on public.provisao_ctes_snapshot_itens (snapshot_id, tipo, id);

alter table public.provisao_ctes_snapshots enable row level security;
alter table public.provisao_ctes_snapshot_itens enable row level security;
grant select, insert, update, delete on public.provisao_ctes_snapshots to anon, authenticated;
grant select, insert, update, delete on public.provisao_ctes_snapshot_itens to anon, authenticated;
drop policy if exists "central_fretes_access" on public.provisao_ctes_snapshots;
create policy "central_fretes_access" on public.provisao_ctes_snapshots for all to anon, authenticated using (true) with check (true);
drop policy if exists "central_fretes_access" on public.provisao_ctes_snapshot_itens;
create policy "central_fretes_access" on public.provisao_ctes_snapshot_itens for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
