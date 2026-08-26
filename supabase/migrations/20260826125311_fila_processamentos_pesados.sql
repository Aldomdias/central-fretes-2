-- Fila compartilhada para trabalhos pesados executados pelos navegadores.
-- O projeto usa autenticacao propria (usuarios.id em texto), portanto as
-- policies seguem o modelo legado das tabelas de presenca/historico.
create table if not exists public.processamentos_pesados (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('AUDITORIA_CTE', 'SIMULACAO_SUPRIMENTOS', 'OUTRO')),
  titulo text not null,
  usuario_id text not null,
  usuario_nome text,
  usuario_email text,
  status text not null default 'AGUARDANDO'
    check (status in ('AGUARDANDO', 'PROCESSANDO', 'CONCLUIDO', 'ERRO', 'CANCELADO', 'INTERROMPIDO')),
  prioridade smallint not null default 100,
  total_itens integer not null default 0 check (total_itens >= 0),
  itens_processados integer not null default 0 check (itens_processados >= 0),
  tamanho_lote integer not null default 200 check (tamanho_lote between 1 and 1000),
  lote_atual integer not null default 0 check (lote_atual >= 0),
  total_lotes integer not null default 0 check (total_lotes >= 0),
  etapa text,
  metadados jsonb not null default '{}'::jsonb,
  erro text,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  heartbeat_em timestamptz,
  finalizado_em timestamptz,
  atualizado_em timestamptz not null default now()
);

create index if not exists processamentos_pesados_fila_idx
  on public.processamentos_pesados (prioridade, criado_em)
  where status = 'AGUARDANDO';
create index if not exists processamentos_pesados_ativos_idx
  on public.processamentos_pesados (heartbeat_em)
  where status = 'PROCESSANDO';
create index if not exists processamentos_pesados_usuario_idx
  on public.processamentos_pesados (usuario_id, criado_em desc);
create index if not exists processamentos_pesados_criado_idx
  on public.processamentos_pesados (criado_em desc);

alter table public.processamentos_pesados enable row level security;
drop policy if exists "processamentos_pesados_public_access" on public.processamentos_pesados;
create policy "processamentos_pesados_public_access"
  on public.processamentos_pesados for all using (true) with check (true);

-- A trava transacional torna a promocao para PROCESSANDO atomica entre usuarios.
create or replace function public.tentar_iniciar_processamento_pesado(
  p_id uuid,
  p_limite_global integer default 2
) returns public.processamentos_pesados
language plpgsql
security invoker
set statement_timeout = '5s'
as $$
declare
  v_registro public.processamentos_pesados;
  v_ativos integer;
  v_primeiro uuid;
begin
  perform pg_advisory_xact_lock(hashtext('central_fretes_fila_pesada'));

  update public.processamentos_pesados
     set status = 'INTERROMPIDO',
         erro = coalesce(erro, 'Processamento sem sinal por mais de 2 minutos.'),
         finalizado_em = now(), atualizado_em = now()
   where status = 'PROCESSANDO'
     and heartbeat_em < now() - interval '2 minutes';

  select * into v_registro from public.processamentos_pesados where id = p_id for update;
  if not found then raise exception 'Processamento nao encontrado.'; end if;
  if v_registro.status <> 'AGUARDANDO' then return v_registro; end if;

  -- Impede duas tarefas pesadas simultaneas do mesmo usuario.
  if exists (
    select 1 from public.processamentos_pesados
     where usuario_id = v_registro.usuario_id and status = 'PROCESSANDO' and id <> p_id
  ) then return v_registro; end if;

  select count(*) into v_ativos
    from public.processamentos_pesados where status = 'PROCESSANDO';
  select id into v_primeiro
    from public.processamentos_pesados
   where status = 'AGUARDANDO'
   order by prioridade, criado_em
   limit 1;

  if v_ativos < greatest(1, least(coalesce(p_limite_global, 2), 5)) and v_primeiro = p_id then
    update public.processamentos_pesados
       set status = 'PROCESSANDO', iniciado_em = coalesce(iniciado_em, now()),
           heartbeat_em = now(), atualizado_em = now()
     where id = p_id returning * into v_registro;
  end if;
  return v_registro;
end;
$$;

grant select, insert, update on public.processamentos_pesados to anon, authenticated;
grant execute on function public.tentar_iniciar_processamento_pesado(uuid, integer) to anon, authenticated;
