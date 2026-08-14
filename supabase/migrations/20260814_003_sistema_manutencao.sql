-- Modo manutenção: bloqueia o sistema pra todos os usuários exceto o admin,
-- usado quando alguém precisa ajustar o Supabase sem que uma query pesada de
-- relatório rodando em paralelo atrapalhe.
create table if not exists sistema_manutencao (
  id smallint primary key default 1,
  ativo boolean not null default false,
  mensagem text,
  ativado_por text,
  ativado_em timestamptz,
  constraint sistema_manutencao_singleton check (id = 1)
);

insert into sistema_manutencao (id, ativo)
values (1, false)
on conflict (id) do nothing;

alter table sistema_manutencao enable row level security;

drop policy if exists "sistema_manutencao select" on sistema_manutencao;
create policy "sistema_manutencao select" on sistema_manutencao
  for select using (true);

drop policy if exists "sistema_manutencao upsert" on sistema_manutencao;
create policy "sistema_manutencao upsert" on sistema_manutencao
  for update using (true) with check (true);
