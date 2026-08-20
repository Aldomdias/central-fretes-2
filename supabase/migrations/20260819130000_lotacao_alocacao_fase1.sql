-- Fase 1 da Lotacao Operacao nativa (sair do Excel).
-- Tudo aditivo: nenhuma coluna existente e alterada ou removida, para nao
-- quebrar o import do fluxo nem a Auditoria Lotacao que ja usam lotacao_cargas.

-- 1) Ciclo de vida da viagem + rastro de quem alocou.
alter table lotacao_cargas add column if not exists status_operacional text default 'PLANEJADA';
alter table lotacao_cargas add column if not exists origem_registro text default 'fluxo_excel';
alter table lotacao_cargas add column if not exists alocado_em timestamptz;
alter table lotacao_cargas add column if not exists alocado_por text;
alter table lotacao_cargas add column if not exists observacao_alocacao text;

-- 2) De onde saiu o valor autorizado (o que hoje so existe na cabeca de quem
--    preenche o Excel). Snapshot: reimportar a tabela nao reescreve o passado.
alter table lotacao_cargas add column if not exists valor_fonte text;          -- TABELA | COTACAO | MANUAL
alter table lotacao_cargas add column if not exists valor_tabela numeric;
alter table lotacao_cargas add column if not exists valor_target numeric;
alter table lotacao_cargas add column if not exists valor_antt numeric;
alter table lotacao_cargas add column if not exists tabela_id text;
alter table lotacao_cargas add column if not exists tabela_nome text;
alter table lotacao_cargas add column if not exists tabela_rota_id text;

-- 3) Vigencia da tabela de lotacao, para a auditoria saber qual tabela valia
--    na data da coleta.
alter table lotacao_tabelas add column if not exists vigencia_inicio date;
alter table lotacao_tabelas add column if not exists vigencia_fim date;

create index if not exists idx_lotacao_cargas_status_operacional on lotacao_cargas (status_operacional);
create index if not exists idx_lotacao_cargas_coleta_planejada on lotacao_cargas (coleta_planejada);

-- 4) Trilha de auditoria da alocacao: toda troca de transportadora, placa ou
--    valor grava quem/quando/de->para.
create table if not exists lotacao_carga_eventos (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid references lotacao_cargas(id) on delete cascade,
  dist text,
  dist_key text,
  campo text,
  valor_anterior text,
  valor_novo text,
  motivo text,
  usuario_id text,
  usuario_nome text,
  criado_em timestamptz default now()
);

create index if not exists idx_lotacao_carga_eventos_carga on lotacao_carga_eventos (carga_id);
create index if not exists idx_lotacao_carga_eventos_dist_key on lotacao_carga_eventos (dist_key);

alter table lotacao_carga_eventos enable row level security;
grant select, insert on lotacao_carga_eventos to anon, authenticated;

drop policy if exists "lotacao_carga_eventos_public_access" on lotacao_carga_eventos;
create policy "lotacao_carga_eventos_public_access" on lotacao_carga_eventos for all using (true) with check (true);
