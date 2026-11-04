-- Diagnostico de espaco em disco do projeto "Central de Fretes" (Supabase).
-- Rodar no SQL Editor. Somente leitura: nada aqui apaga dados.
-- O SQL Editor mostra so o resultado da ULTIMA consulta: selecione uma consulta
-- por vez (ou abra uma aba para cada) e clique em Run.

-- 1) Tamanho total do banco (o que o disco realmente guarda de dados)
select pg_size_pretty(pg_database_size(current_database())) as tamanho_banco;

-- 2) As 25 maiores tabelas (dados + indices + TOAST, ex.: colunas jsonb "raw")
select
  n.nspname || '.' || c.relname                         as tabela,
  pg_size_pretty(pg_total_relation_size(c.oid))         as total,
  pg_size_pretty(pg_relation_size(c.oid))               as dados,
  pg_size_pretty(pg_indexes_size(c.oid))                as indices,
  pg_size_pretty(pg_total_relation_size(c.oid)
                 - pg_relation_size(c.oid)
                 - pg_indexes_size(c.oid))              as toast,
  s.n_live_tup                                          as linhas_vivas,
  s.n_dead_tup                                          as linhas_mortas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where c.relkind in ('r','m','p')
  and n.nspname not in ('pg_catalog','information_schema')
order by pg_total_relation_size(c.oid) desc
limit 25;

-- 3) Espaco por schema (storage, auth, cron, net etc. tambem ocupam disco)
select n.nspname as schema,
       pg_size_pretty(sum(pg_total_relation_size(c.oid))) as total
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','m','p')
group by n.nspname
order by sum(pg_total_relation_size(c.oid)) desc;

-- 4) Tabelas com muito "lixo" (linhas mortas apos DELETE/UPDATE/reimportacao).
--    Esse espaco so volta ao disco com VACUUM FULL (bloqueia a tabela enquanto roda).
select relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) as pct_morto,
       last_autovacuum
from pg_stat_user_tables
where n_dead_tup > 10000
order by n_dead_tup desc
limit 20;

-- 5) Tamanho do WAL (log de transacoes) - cresce em importacoes grandes
select pg_size_pretty(sum(size)) as wal_total from pg_ls_waldir();

-- 6) Slots de replicacao parados seguram WAL indefinidamente
select slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as wal_retido
from pg_replication_slots;

-- 7) Historico do pg_cron e do pg_net (costumam crescer sem limite).
--    to_regclass devolve NULL quando a extensao nao existe, sem dar erro.
select t.nome as tabela,
       coalesce(pg_size_pretty(pg_total_relation_size(to_regclass(t.nome))), 'nao existe') as total
from (values ('cron.job_run_details'), ('net._http_response')) as t(nome);
