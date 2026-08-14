-- Staging da resimulacao por origem: cada linha e um candidato (transportadora+CD)
-- calculado pra um pedido, numa carga de malha de UMA origem so. Acumula aqui enquanto
-- processa origem por origem (cargas pequenas, rapidas, resistentes a timeout); o
-- fechamento (fase 2) le tudo que foi acumulado por pedido e escolhe o vencedor.
create table if not exists ecommerce_sim_candidatos_origem (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references ecommerce_order_snapshot(id) on delete cascade,
  origem_cidade text not null,
  canal text,
  candidato jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sim_cand_origem_pedido on ecommerce_sim_candidatos_origem (pedido_id);
create index if not exists idx_sim_cand_origem_cidade on ecommerce_sim_candidatos_origem (origem_cidade);

alter table ecommerce_sim_candidatos_origem enable row level security;

drop policy if exists ecommerce_sim_candidatos_origem_select on ecommerce_sim_candidatos_origem;
create policy ecommerce_sim_candidatos_origem_select on ecommerce_sim_candidatos_origem for select using (true);

drop policy if exists ecommerce_sim_candidatos_origem_insert on ecommerce_sim_candidatos_origem;
create policy ecommerce_sim_candidatos_origem_insert on ecommerce_sim_candidatos_origem for insert with check (true);

drop policy if exists ecommerce_sim_candidatos_origem_delete on ecommerce_sim_candidatos_origem;
create policy ecommerce_sim_candidatos_origem_delete on ecommerce_sim_candidatos_origem for delete using (true);

-- Progresso: quais origens ja foram processadas pra qual "assinatura" de recorte
-- (filtros + opcoes). Permite pular origens ja feitas se a resimulacao for retomada.
create table if not exists ecommerce_sim_origem_progresso (
  id uuid primary key default gen_random_uuid(),
  assinatura text not null,
  origem_cidade text not null,
  concluido_em timestamptz not null default now(),
  unique (assinatura, origem_cidade)
);

alter table ecommerce_sim_origem_progresso enable row level security;

drop policy if exists ecommerce_sim_origem_progresso_select on ecommerce_sim_origem_progresso;
create policy ecommerce_sim_origem_progresso_select on ecommerce_sim_origem_progresso for select using (true);

drop policy if exists ecommerce_sim_origem_progresso_insert on ecommerce_sim_origem_progresso;
create policy ecommerce_sim_origem_progresso_insert on ecommerce_sim_origem_progresso for insert with check (true);

drop policy if exists ecommerce_sim_origem_progresso_delete on ecommerce_sim_origem_progresso;
create policy ecommerce_sim_origem_progresso_delete on ecommerce_sim_origem_progresso for delete using (true);
