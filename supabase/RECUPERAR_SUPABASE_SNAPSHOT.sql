-- RECUPERAR SUPABASE CASO TENHA FICADO PESADO COM SNAPSHOT/QUERY
-- Rode no Supabase > SQL Editor se o Table Editor continuar travado.

-- 1) Limpar snapshot pesado/incompleto. O sistema deste patch NÃO depende mais dele para abrir.
truncate table public.cadastros_snapshot;

-- 2) Conferir contagens principais.
select 'transportadoras' as tabela, count(*) from public.transportadoras
union all
select 'origens', count(*) from public.origens
union all
select 'rotas', count(*) from public.rotas
union all
select 'cotacoes', count(*) from public.cotacoes;

-- 3) Se ainda estiver travado, no painel Supabase vá em:
-- Database > Reports > Query Performance / Active Queries
-- e cancele queries longas relacionadas a cadastros_snapshot ou select em rotas/cotacoes.
