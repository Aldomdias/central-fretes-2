-- Base persistente da Auditoria CT-e.
-- Guarda o resultado detalhado do recálculo mensal e o resumo por competência.

create table if not exists public.auditoria_cte_resultados (
  id uuid primary key default gen_random_uuid(),
  competencia text not null,
  data_emissao date,
  chave_cte text,
  numero_cte text,
  transportadora text,
  cnpj_transportadora text,
  tomador_servico text,
  cidade_origem text,
  uf_origem text,
  ibge_origem text,
  cidade_destino text,
  uf_destino text,
  ibge_destino text,
  canal text,
  peso numeric(14,3) default 0,
  peso_declarado numeric(14,3) default 0,
  peso_cubado numeric(14,3) default 0,
  cubagem numeric(14,4) default 0,
  qtd_volumes numeric(14,2) default 0,
  valor_nf numeric(14,2) default 0,
  valor_cte numeric(14,2) default 0,
  valor_calculado numeric(14,2) default 0,
  valor_calculado_verum numeric(14,2),
  diferenca numeric(14,2) default 0,
  diferenca_verum numeric(14,2),
  diferenca_abs numeric(14,2) default 0,
  percentual_diferenca numeric(14,4) default 0,
  status_calculo text,
  motivo_sem_calculo text,
  transportadora_tabela text,
  tipo_calculo text,
  detalhes_calculo jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.auditoria_cte_resumo_mensal (
  competencia text primary key,
  total_ctes integer not null default 0,
  calculados integer not null default 0,
  sem_calculo integer not null default 0,
  assertivos integer not null default 0,
  divergentes integer not null default 0,
  valor_total_cte numeric(14,2) default 0,
  valor_total_calculado numeric(14,2) default 0,
  valor_total_divergencia numeric(14,2) default 0,
  valor_excessivo numeric(14,2) default 0,
  valor_insuficiente numeric(14,2) default 0,
  taxa_calculo numeric(8,4) default 0,
  taxa_assertividade numeric(8,4) default 0,
  taxa_divergencia numeric(8,4) default 0,
  processado_em timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_auditoria_cte_resultados_competencia
  on public.auditoria_cte_resultados (competencia);

create index if not exists idx_auditoria_cte_resultados_transportadora
  on public.auditoria_cte_resultados (transportadora);

create index if not exists idx_auditoria_cte_resultados_chave_cte
  on public.auditoria_cte_resultados (chave_cte);

create index if not exists idx_auditoria_cte_resultados_emissao
  on public.auditoria_cte_resultados (data_emissao);

alter table public.auditoria_cte_resultados enable row level security;
alter table public.auditoria_cte_resumo_mensal enable row level security;

grant select, insert, update, delete on public.auditoria_cte_resultados to anon, authenticated;
grant select, insert, update, delete on public.auditoria_cte_resumo_mensal to anon, authenticated;

drop policy if exists "auditoria_cte_resultados_public_access" on public.auditoria_cte_resultados;
create policy "auditoria_cte_resultados_public_access"
  on public.auditoria_cte_resultados
  for all to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "auditoria_cte_resumo_mensal_public_access" on public.auditoria_cte_resumo_mensal;
create policy "auditoria_cte_resumo_mensal_public_access"
  on public.auditoria_cte_resumo_mensal
  for all to anon, authenticated
  using (true)
  with check (true);

notify pgrst, 'reload schema';
