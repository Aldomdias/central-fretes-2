-- Cole no SQL Editor do Supabase e clique Run.
-- Se alguma linha vier "FALTA", rode supabase/APLICAR_4362_006_a_009.sql

select 'rpc_avaliacao_prazos_transportadoras' as objeto,
  case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_avaliacao_prazos_transportadoras'
  ) then 'OK' else 'FALTA — migration 007' end as status

union all

select 'amd_ap_match_uf_origem',
  case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'amd_ap_match_uf_origem'
  ) then 'OK' else 'FALTA — migration 008' end

union all

select 'avaliacao_prazos_snapshots (tabela)',
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'avaliacao_prazos_snapshots'
  ) then 'OK' else 'FALTA — migration 009' end

union all

select 'rpc_avaliacao_prazos_analise_completa',
  case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_avaliacao_prazos_analise_completa'
  ) then 'OK' else 'FALTA — migration 010' end

union all

select 'amd_ap_uf_por_ibge (mapa IBGE)',
  case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'amd_ap_uf_por_ibge'
  ) then 'OK' else 'FALTA — migration 011 (mapa vazio / Failed to fetch)' end;
