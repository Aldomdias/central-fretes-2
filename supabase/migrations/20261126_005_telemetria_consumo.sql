-- Telemetria de consumo do sistema (modulo "Consumo do Sistema", somente gestao).
-- Cada navegador logado mede o proprio consumo e grava aqui:
--   * telemetria_sessoes  : 1 linha por aba aberta (tempo online, ativo x ocioso, aparelho, pico de RAM)
--   * telemetria_uso      : blocos de ~5 min por sessao+tela (requisicoes, MB baixados/enviados,
--                           tempo de rede, CPU travada, RAM, erros, detalhe por tabela do banco)
--   * telemetria_processos: cada processo pesado medido (auditoria, simulacao, importacao...)
-- A tela le tudo agregado pela funcao telemetria_painel (nao puxa linhas cruas).
-- Retencao: telemetria_limpar_antigos() apaga o que passou de 90 dias.

create table if not exists public.telemetria_sessoes (
  id uuid primary key,
  usuario_id text not null,
  usuario_nome text,
  usuario_email text,
  perfil text,
  iniciado_em timestamptz not null default now(),
  ultimo_sinal_em timestamptz not null default now(),
  encerrado_em timestamptz,
  segundos_ativo integer not null default 0,
  segundos_ocioso integer not null default 0,
  segundos_oculto integer not null default 0,
  pagina_atual text,
  pico_heap_mb numeric(10,1),
  limite_heap_mb numeric(10,1),
  memoria_aparelho_gb numeric(5,1),
  nucleos_cpu smallint,
  navegador text,
  versao_app text
);

create index if not exists telemetria_sessoes_inicio_idx on public.telemetria_sessoes (iniciado_em desc);
create index if not exists telemetria_sessoes_usuario_idx on public.telemetria_sessoes (usuario_id, iniciado_em desc);
create index if not exists telemetria_sessoes_sinal_idx on public.telemetria_sessoes (ultimo_sinal_em desc);

create table if not exists public.telemetria_uso (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null,
  usuario_id text not null,
  usuario_nome text,
  pagina text not null default '',
  pagina_label text,
  inicio_em timestamptz not null,
  fim_em timestamptz not null default now(),
  segundos_ativo integer not null default 0,
  requisicoes integer not null default 0,
  leituras integer not null default 0,
  escritas integer not null default 0,
  bytes_recebidos bigint not null default 0,
  bytes_enviados bigint not null default 0,
  ms_rede bigint not null default 0,
  ms_cpu_travada bigint not null default 0,
  tarefas_longas integer not null default 0,
  heap_mb_max numeric(10,1),
  heap_mb_medio numeric(10,1),
  erros integer not null default 0,
  timeouts integer not null default 0,
  -- {"tabela": {"n":req, "b":bytes recebidos, "s":bytes enviados, "ms":tempo, "w":escritas, "e":erros, "t":timeouts}}
  tabelas jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists telemetria_uso_inicio_idx on public.telemetria_uso (inicio_em desc);
create index if not exists telemetria_uso_usuario_idx on public.telemetria_uso (usuario_id, inicio_em desc);
create index if not exists telemetria_uso_pagina_idx on public.telemetria_uso (pagina, inicio_em desc);

create table if not exists public.telemetria_processos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid,
  usuario_id text not null,
  usuario_nome text,
  pagina text,
  tipo text not null,
  titulo text,
  status text not null default 'CONCLUIDO',
  iniciado_em timestamptz not null,
  finalizado_em timestamptz not null default now(),
  duracao_ms bigint not null default 0,
  itens integer not null default 0,
  requisicoes integer not null default 0,
  bytes_recebidos bigint not null default 0,
  bytes_enviados bigint not null default 0,
  ms_rede bigint not null default 0,
  ms_cpu_travada bigint not null default 0,
  heap_mb_inicio numeric(10,1),
  heap_mb_fim numeric(10,1),
  heap_mb_pico numeric(10,1),
  erro text,
  metadados jsonb not null default '{}'::jsonb
);

create index if not exists telemetria_processos_inicio_idx on public.telemetria_processos (iniciado_em desc);
create index if not exists telemetria_processos_usuario_idx on public.telemetria_processos (usuario_id, iniciado_em desc);
create index if not exists telemetria_processos_tipo_idx on public.telemetria_processos (tipo, iniciado_em desc);

-- Mesmo modelo das tabelas de presenca/historico (autenticacao propria do app).
alter table public.telemetria_sessoes enable row level security;
alter table public.telemetria_uso enable row level security;
alter table public.telemetria_processos enable row level security;

drop policy if exists "telemetria_sessoes_public_access" on public.telemetria_sessoes;
create policy "telemetria_sessoes_public_access" on public.telemetria_sessoes for all using (true) with check (true);
drop policy if exists "telemetria_uso_public_access" on public.telemetria_uso;
create policy "telemetria_uso_public_access" on public.telemetria_uso for all using (true) with check (true);
drop policy if exists "telemetria_processos_public_access" on public.telemetria_processos;
create policy "telemetria_processos_public_access" on public.telemetria_processos for all using (true) with check (true);

grant select, insert, update on public.telemetria_sessoes to anon, authenticated;
grant select, insert on public.telemetria_uso to anon, authenticated;
grant select, insert on public.telemetria_processos to anon, authenticated;

-- Painel agregado: tudo que a tela precisa numa chamada so.
create or replace function public.telemetria_painel(
  p_desde timestamptz,
  p_ate timestamptz default now(),
  p_usuario text default null
) returns jsonb
language sql
stable
security invoker
set statement_timeout = '25s'
as $$
with uso as (
  select * from public.telemetria_uso
   where inicio_em >= p_desde and inicio_em < p_ate
     and (p_usuario is null or usuario_id = p_usuario)
),
ses as (
  select * from public.telemetria_sessoes
   where ultimo_sinal_em >= p_desde and iniciado_em < p_ate
     and (p_usuario is null or usuario_id = p_usuario)
),
pro as (
  select * from public.telemetria_processos
   where iniciado_em >= p_desde and iniciado_em < p_ate
     and (p_usuario is null or usuario_id = p_usuario)
),
tab as (
  select u.usuario_id, u.usuario_nome, u.pagina, t.key as tabela,
         coalesce((t.value->>'n')::bigint, 0) as n,
         coalesce((t.value->>'b')::bigint, 0) as b,
         coalesce((t.value->>'s')::bigint, 0) as s,
         coalesce((t.value->>'ms')::bigint, 0) as ms,
         coalesce((t.value->>'w')::bigint, 0) as w,
         coalesce((t.value->>'e')::bigint, 0) as e,
         coalesce((t.value->>'t')::bigint, 0) as t
    from uso u, jsonb_each(u.tabelas) t
),
por_usuario_uso as (
  select usuario_id, max(usuario_nome) as usuario_nome,
         sum(requisicoes) as requisicoes, sum(escritas) as escritas,
         sum(bytes_recebidos) as bytes_recebidos, sum(bytes_enviados) as bytes_enviados,
         sum(ms_rede) as ms_rede, sum(ms_cpu_travada) as ms_cpu_travada,
         max(heap_mb_max) as heap_mb_max, sum(erros) as erros, sum(timeouts) as timeouts
    from uso group by usuario_id
),
por_usuario_ses as (
  select usuario_id, max(usuario_nome) as usuario_nome, max(usuario_email) as usuario_email,
         max(perfil) as perfil, count(*) as sessoes,
         sum(extract(epoch from (least(coalesce(encerrado_em, ultimo_sinal_em), ultimo_sinal_em) - iniciado_em)))::bigint as segundos_online,
         sum(segundos_ativo)::bigint as segundos_ativo, sum(segundos_ocioso)::bigint as segundos_ocioso,
         sum(segundos_oculto)::bigint as segundos_oculto,
         max(ultimo_sinal_em) as ultimo_sinal_em, max(pico_heap_mb) as pico_heap_mb,
         max(memoria_aparelho_gb) as memoria_aparelho_gb
    from ses group by usuario_id
),
por_usuario_pro as (
  select usuario_id, count(*) as processos, sum(itens) as itens_processos, sum(duracao_ms) as ms_processos
    from pro group by usuario_id
),
pagina_top as (
  select distinct on (usuario_id) usuario_id, coalesce(max_label, pagina) as pagina_top
    from (
      select usuario_id, pagina, max(pagina_label) as max_label,
             sum(bytes_recebidos) + sum(ms_cpu_travada) * 1000 as peso
        from uso group by usuario_id, pagina
    ) x
   order by usuario_id, peso desc
)
select jsonb_build_object(
  'gerado_em', now(),
  'totais', (
    select jsonb_build_object(
      'usuarios', (select count(distinct usuario_id) from ses),
      'sessoes', (select count(*) from ses),
      'segundos_online', (select coalesce(sum(segundos_online), 0) from por_usuario_ses),
      'segundos_ativo', (select coalesce(sum(segundos_ativo), 0) from ses),
      'requisicoes', coalesce(sum(requisicoes), 0),
      'bytes_recebidos', coalesce(sum(bytes_recebidos), 0),
      'bytes_enviados', coalesce(sum(bytes_enviados), 0),
      'ms_rede', coalesce(sum(ms_rede), 0),
      'ms_cpu_travada', coalesce(sum(ms_cpu_travada), 0),
      'heap_mb_max', max(heap_mb_max),
      'erros', coalesce(sum(erros), 0),
      'timeouts', coalesce(sum(timeouts), 0),
      'processos', (select count(*) from pro)
    ) from uso
  ),
  'usuarios', coalesce((
    select jsonb_agg(row_to_json(x) order by x.bytes_recebidos desc nulls last, x.segundos_online desc nulls last)
      from (
        select coalesce(s.usuario_id, u.usuario_id) as usuario_id,
               coalesce(s.usuario_nome, u.usuario_nome) as usuario_nome,
               s.usuario_email, s.perfil, coalesce(s.sessoes, 0) as sessoes,
               coalesce(s.segundos_online, 0) as segundos_online,
               coalesce(s.segundos_ativo, 0) as segundos_ativo,
               coalesce(s.segundos_ocioso, 0) as segundos_ocioso,
               coalesce(s.segundos_oculto, 0) as segundos_oculto,
               s.ultimo_sinal_em, greatest(s.pico_heap_mb, u.heap_mb_max) as heap_mb_max,
               s.memoria_aparelho_gb,
               coalesce(u.requisicoes, 0) as requisicoes, coalesce(u.escritas, 0) as escritas,
               coalesce(u.bytes_recebidos, 0) as bytes_recebidos, coalesce(u.bytes_enviados, 0) as bytes_enviados,
               coalesce(u.ms_rede, 0) as ms_rede, coalesce(u.ms_cpu_travada, 0) as ms_cpu_travada,
               coalesce(u.erros, 0) as erros, coalesce(u.timeouts, 0) as timeouts,
               coalesce(p.processos, 0) as processos, coalesce(p.itens_processos, 0) as itens_processos,
               coalesce(p.ms_processos, 0) as ms_processos,
               pt.pagina_top
          from por_usuario_ses s
          full join por_usuario_uso u on u.usuario_id = s.usuario_id
          left join por_usuario_pro p on p.usuario_id = coalesce(s.usuario_id, u.usuario_id)
          left join pagina_top pt on pt.usuario_id = coalesce(s.usuario_id, u.usuario_id)
      ) x
  ), '[]'::jsonb),
  'paginas', coalesce((
    select jsonb_agg(row_to_json(x) order by x.bytes_recebidos desc)
      from (
        select pagina, max(pagina_label) as pagina_label, count(distinct usuario_id) as usuarios,
               sum(segundos_ativo) as segundos_ativo, sum(requisicoes) as requisicoes,
               sum(escritas) as escritas,
               sum(bytes_recebidos) as bytes_recebidos, sum(bytes_enviados) as bytes_enviados,
               sum(ms_rede) as ms_rede, sum(ms_cpu_travada) as ms_cpu_travada,
               max(heap_mb_max) as heap_mb_max, round(avg(heap_mb_medio), 1) as heap_mb_medio,
               sum(erros) as erros, sum(timeouts) as timeouts
          from uso group by pagina
      ) x
  ), '[]'::jsonb),
  'tabelas', coalesce((
    select jsonb_agg(row_to_json(x) order by x.bytes_recebidos desc)
      from (
        select tabela, sum(n) as requisicoes, sum(w) as escritas, sum(b) as bytes_recebidos,
               sum(s) as bytes_enviados, sum(ms) as ms_rede, sum(e) as erros, sum(t) as timeouts,
               count(distinct usuario_id) as usuarios,
               (select t2.usuario_nome from tab t2 where t2.tabela = tab.tabela
                  group by t2.usuario_nome order by sum(t2.b) desc limit 1) as usuario_top,
               (select t3.pagina from tab t3 where t3.tabela = tab.tabela
                  group by t3.pagina order by sum(t3.b) desc limit 1) as pagina_top
          from tab group by tabela
         order by sum(b) desc
         limit 60
      ) x
  ), '[]'::jsonb),
  'processos_tipo', coalesce((
    select jsonb_agg(row_to_json(x) order by x.ms_total desc)
      from (
        select tipo, count(*) as execucoes, count(distinct usuario_id) as usuarios,
               sum(itens) as itens, sum(duracao_ms) as ms_total, round(avg(duracao_ms)) as ms_medio,
               max(duracao_ms) as ms_max, sum(bytes_recebidos) as bytes_recebidos,
               sum(ms_cpu_travada) as ms_cpu_travada, max(heap_mb_pico) as heap_mb_pico,
               max(itens) as itens_max,
               count(*) filter (where status <> 'CONCLUIDO') as falhas
          from pro group by tipo
      ) x
  ), '[]'::jsonb),
  'processos', coalesce((
    select jsonb_agg(row_to_json(x) order by x.duracao_ms desc)
      from (
        select id, usuario_id, usuario_nome, pagina, tipo, titulo, status, iniciado_em, finalizado_em,
               duracao_ms, itens, requisicoes, bytes_recebidos, bytes_enviados, ms_rede, ms_cpu_travada,
               heap_mb_inicio, heap_mb_fim, heap_mb_pico, erro, metadados
          from pro order by duracao_ms desc limit 200
      ) x
  ), '[]'::jsonb),
  'online_agora', coalesce((
    select jsonb_agg(row_to_json(x) order by x.iniciado_em)
      from (
        select id, usuario_id, usuario_nome, perfil, pagina_atual, iniciado_em, ultimo_sinal_em,
               segundos_ativo, segundos_ocioso, pico_heap_mb, memoria_aparelho_gb, navegador
          from public.telemetria_sessoes
         where encerrado_em is null and ultimo_sinal_em > now() - interval '3 minutes'
      ) x
  ), '[]'::jsonb),
  'por_hora', coalesce((
    select jsonb_agg(row_to_json(x) order by x.hora)
      from (
        select date_trunc('hour', inicio_em) as hora, count(distinct usuario_id) as usuarios,
               sum(requisicoes) as requisicoes, sum(bytes_recebidos) as bytes_recebidos,
               sum(ms_cpu_travada) as ms_cpu_travada, sum(segundos_ativo) as segundos_ativo
          from uso group by 1
      ) x
  ), '[]'::jsonb)
);
$$;

grant execute on function public.telemetria_painel(timestamptz, timestamptz, text) to anon, authenticated;

-- Armazenamento: tamanho de cada tabela do banco e dos buckets de arquivos.
create or replace function public.telemetria_armazenamento()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
set statement_timeout = '20s'
as $$
select jsonb_build_object(
  'banco_total_bytes', pg_database_size(current_database()),
  'tabelas', coalesce((
    select jsonb_agg(row_to_json(x) order by x.total_bytes desc)
      from (
        select c.relname as tabela,
               pg_total_relation_size(c.oid) as total_bytes,
               pg_relation_size(c.oid) as dados_bytes,
               pg_indexes_size(c.oid) as indices_bytes,
               greatest(c.reltuples, 0)::bigint as linhas_estimadas
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
         order by pg_total_relation_size(c.oid) desc
         limit 80
      ) x
  ), '[]'::jsonb),
  'buckets', coalesce((
    select jsonb_agg(row_to_json(x) order by x.bytes desc)
      from (
        select bucket_id as bucket, count(*) as arquivos,
               coalesce(sum((metadata->>'size')::bigint), 0) as bytes
          from storage.objects group by bucket_id
      ) x
  ), '[]'::jsonb)
);
$$;

grant execute on function public.telemetria_armazenamento() to anon, authenticated;

create or replace function public.telemetria_limpar_antigos(p_dias integer default 90)
returns integer
language plpgsql
security invoker
as $$
declare
  v_total integer := 0;
  v_n integer;
  v_corte timestamptz := now() - make_interval(days => greatest(coalesce(p_dias, 90), 30));
begin
  delete from public.telemetria_uso where inicio_em < v_corte;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from public.telemetria_processos where iniciado_em < v_corte;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from public.telemetria_sessoes where ultimo_sinal_em < v_corte;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  return v_total;
end;
$$;

grant execute on function public.telemetria_limpar_antigos(integer) to anon, authenticated;
grant delete on public.telemetria_uso, public.telemetria_processos, public.telemetria_sessoes to anon, authenticated;
