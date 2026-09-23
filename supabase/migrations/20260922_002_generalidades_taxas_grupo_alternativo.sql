-- Estende o conceito de "tabela alternativa" (grupo_tabela_alternativa, ver
-- 20260909130000_rotas_cotacoes_grupo_alternativo.sql) para Generalidades e
-- Taxas Especiais: até aqui só rotas/cotações podiam variar por tabela
-- alternativa dentro da mesma origem, mas casos reais mostraram que a
-- generalidade (ICMS, ad valorem, pedágio etc.) e as taxas especiais por
-- destino também podem mudar entre a tabela principal e uma alternativa
-- (ex.: "OTR / Fora de estrada"). Usado hoje só pelo motor de Auditoria de
-- CT-e/fatura (auditoriaCteProcessamentoService.js, via
-- filtrarOrigemPorGrupoAlternativo) — o Simulador não lê tabela alternativa.

-- taxas_especiais: mesmo padrão de rotas/cotacoes — coluna nula = tabela
-- principal, upsert continua por `id` próprio da linha, sem precisar de
-- constraint de unicidade extra.
alter table if exists public.taxas_especiais
  add column if not exists grupo_tabela_alternativa text null;

comment on column public.taxas_especiais.grupo_tabela_alternativa is
  'Mesmo rótulo de rotas.grupo_tabela_alternativa. Nulo = taxa da tabela principal da origem.';

create index if not exists idx_taxas_especiais_grupo_tabela_alternativa
  on public.taxas_especiais (origem_id, grupo_tabela_alternativa)
  where grupo_tabela_alternativa is not null;

-- generalidades: hoje tem uma linha por origem, upsertada com
-- "on conflict (origem_id)". Para caber uma linha por grupo, a coluna nova
-- usa '' (não nulo) como sentinela da tabela principal, em vez de null —
-- assim dá pra manter um "on conflict (origem_id, grupo_tabela_alternativa)"
-- funcionando de verdade: no Postgres, NULL nunca "colide" consigo mesmo em
-- um unique index, então múltiplas linhas com grupo nulo para a mesma
-- origem não seriam pegas como duplicata pelo upsert. Essa conversão
-- ''  <-> null fica só na camada de acesso a dados (freteDatabaseService.js);
-- no restante do app o valor em memória continua sendo null pra tabela
-- principal, igual rotas/cotações.
alter table if exists public.generalidades
  add column if not exists grupo_tabela_alternativa text not null default '';

comment on column public.generalidades.grupo_tabela_alternativa is
  'Mesmo rótulo de rotas.grupo_tabela_alternativa. Vazio ('''') = generalidade da tabela principal da origem.';

-- Remove qualquer constraint (UNIQUE ou PRIMARY KEY — em produção é a PK
-- `generalidades_pkey`) existente em (origem_id) sozinho, pra liberar mais de
-- uma linha por origem (uma por grupo). Precisa ser DROP CONSTRAINT (não
-- DROP INDEX): o índice por trás de uma PK/UNIQUE pertence à constraint e o
-- Postgres recusa dropar o índice diretamente enquanto ela existir.
do $$
declare
  con_name text;
begin
  select tc.constraint_name into con_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'generalidades'
    and tc.constraint_type in ('UNIQUE', 'PRIMARY KEY')
    and kcu.column_name = 'origem_id'
    and (
      select count(*) from information_schema.key_column_usage kcu2
      where kcu2.constraint_name = tc.constraint_name
        and kcu2.table_schema = tc.table_schema
    ) = 1
  limit 1;

  if con_name is not null then
    execute format('alter table public.generalidades drop constraint %I', con_name);
  end if;
end $$;

-- Sobrou algum índice único "solto" (sem constraint) em (origem_id)? Dropa
-- também — esse sim pode ser removido direto por DROP INDEX.
do $$
declare
  rec record;
begin
  for rec in
    select ic.relname as index_name
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    join pg_class tc on tc.oid = i.indrelid
    join pg_namespace n on n.oid = tc.relnamespace
    where n.nspname = 'public'
      and tc.relname = 'generalidades'
      and i.indisunique
      and i.indnatts = 1
      and not exists (
        select 1 from pg_constraint c where c.conindid = ic.oid
      )
      and (
        select a.attname
        from pg_attribute a
        where a.attrelid = tc.oid and a.attnum = i.indkey[0]
      ) = 'origem_id'
  loop
    execute format('drop index if exists public.%I', rec.index_name);
  end loop;
end $$;

create unique index if not exists idx_generalidades_origem_grupo_unique
  on public.generalidades (origem_id, grupo_tabela_alternativa);
