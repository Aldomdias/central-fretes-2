alter table public.processamentos_pesados
  add column if not exists finalizado_por_id text,
  add column if not exists finalizado_por_nome text,
  add column if not exists finalizado_por_email text,
  add column if not exists motivo_cancelamento text;

create index if not exists processamentos_pesados_travados_idx
  on public.processamentos_pesados (heartbeat_em)
  where status in ('PROCESSANDO', 'AGUARDANDO');

-- O sistema ainda usa autenticacao propria em usuarios_central. A RPC valida o
-- mesmo administrador aceito pela aplicacao (GESTAO + e-mail administrativo).
create or replace function public.finalizar_tarefa_pesada_admin(
  p_id uuid,
  p_admin_id text,
  p_admin_email text,
  p_motivo text
) returns public.processamentos_pesados
language plpgsql
security invoker
set statement_timeout = '5s'
as $$
declare
  v_admin public.usuarios_central;
  v_resultado public.processamentos_pesados;
begin
  select * into v_admin
    from public.usuarios_central
   where id = p_admin_id
     and lower(email) = lower(trim(p_admin_email))
     and perfil = 'GESTAO'
     and ativo is true;
  if not found then raise exception 'Somente o administrador pode finalizar tarefas.'; end if;
  if lower(trim(p_admin_email)) <> 'aldo.dias@cantu.inc' then
    raise exception 'Administrador nao autorizado para esta operacao.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe um motivo com pelo menos 5 caracteres.';
  end if;

  perform pg_advisory_xact_lock(hashtext('central_fretes_fila_pesada'));
  update public.processamentos_pesados
     set status = 'CANCELADO',
         erro = 'Finalizada administrativamente: ' || trim(p_motivo),
         motivo_cancelamento = trim(p_motivo),
         finalizado_por_id = v_admin.id,
         finalizado_por_nome = v_admin.nome,
         finalizado_por_email = v_admin.email,
         finalizado_em = now(),
         atualizado_em = now()
   where id = p_id
     and status in ('PROCESSANDO', 'AGUARDANDO')
   returning * into v_resultado;
  if not found then raise exception 'A tarefa nao esta mais ativa.'; end if;
  return v_resultado;
end;
$$;

create or replace function public.finalizar_tarefas_pesadas_travadas_admin(
  p_admin_id text,
  p_admin_email text,
  p_motivo text,
  p_limite_minutos integer default 15
) returns setof public.processamentos_pesados
language plpgsql
security invoker
set statement_timeout = '5s'
as $$
declare
  v_admin public.usuarios_central;
  v_limite integer;
begin
  select * into v_admin
    from public.usuarios_central
   where id = p_admin_id
     and lower(email) = lower(trim(p_admin_email))
     and perfil = 'GESTAO'
     and ativo is true;
  if not found or lower(trim(p_admin_email)) <> 'aldo.dias@cantu.inc' then
    raise exception 'Somente o administrador pode finalizar tarefas travadas.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe um motivo com pelo menos 5 caracteres.';
  end if;
  v_limite := greatest(10, least(coalesce(p_limite_minutos, 15), 1440));

  perform pg_advisory_xact_lock(hashtext('central_fretes_fila_pesada'));
  return query
  update public.processamentos_pesados
     set status = 'CANCELADO',
         erro = 'Finalizada administrativamente por inatividade: ' || trim(p_motivo),
         motivo_cancelamento = trim(p_motivo),
         finalizado_por_id = v_admin.id,
         finalizado_por_nome = v_admin.nome,
         finalizado_por_email = v_admin.email,
         finalizado_em = now(),
         atualizado_em = now()
   where status in ('PROCESSANDO', 'AGUARDANDO')
     and coalesce(heartbeat_em, criado_em) < now() - make_interval(mins => v_limite)
   returning *;
end;
$$;

grant execute on function public.finalizar_tarefa_pesada_admin(uuid, text, text, text) to anon, authenticated;
grant execute on function public.finalizar_tarefas_pesadas_travadas_admin(text, text, text, integer) to anon, authenticated;
