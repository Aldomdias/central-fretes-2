-- Tarefas que ainda nao sabem o proprio tamanho (total_itens = 0, ex: "Buscar
-- CT-es" antes da consulta terminar) contavam como peso 1 no orcamento —
-- praticamente de graca, deixando empilhar mais tarefas do que o orcamento
-- realmente suporta. Passam a contar como o tamanho padrao de lote (200) ate
-- saberem o tamanho real.
create or replace function public.tentar_iniciar_processamento_pesado(
  p_id uuid,
  p_limite_global integer default null
) returns public.processamentos_pesados
language plpgsql
security invoker
set statement_timeout = '5s'
as $$
declare
  v_registro public.processamentos_pesados;
  v_config public.fila_configuracao;
  v_limite_tarefas integer;
  v_orcamento integer;
  v_ativos integer;
  v_soma_ativos numeric;
  v_peso numeric;
  v_primeiro uuid;
begin
  perform pg_advisory_xact_lock(hashtext('central_fretes_fila_pesada'));

  update public.processamentos_pesados
     set status = 'INTERROMPIDO',
         erro = coalesce(erro, 'Processamento sem sinal por mais de 2 minutos.'),
         finalizado_em = now(), atualizado_em = now()
   where status = 'PROCESSANDO'
     and heartbeat_em < now() - interval '2 minutes';

  select * into v_config from public.fila_configuracao where id = 1;
  v_limite_tarefas := greatest(1, least(coalesce(p_limite_global, v_config.limite_tarefas_globais, 2), 20));
  v_orcamento := greatest(1, coalesce(v_config.orcamento_itens, 3000));

  select * into v_registro from public.processamentos_pesados where id = p_id for update;
  if not found then raise exception 'Processamento nao encontrado.'; end if;
  if v_registro.status <> 'AGUARDANDO' then return v_registro; end if;

  if exists (
    select 1 from public.processamentos_pesados
     where usuario_id = v_registro.usuario_id and status = 'PROCESSANDO' and id <> p_id
  ) then return v_registro; end if;

  select count(*), coalesce(sum(greatest(total_itens, tamanho_lote, 200)), 0)
    into v_ativos, v_soma_ativos
    from public.processamentos_pesados where status = 'PROCESSANDO';

  select id into v_primeiro
    from public.processamentos_pesados
   where status = 'AGUARDANDO'
   order by prioridade, criado_em
   limit 1;

  v_peso := greatest(v_registro.total_itens, v_registro.tamanho_lote, 200);

  if v_primeiro = p_id
     and v_ativos < v_limite_tarefas
     and (v_ativos = 0 or v_soma_ativos + v_peso <= v_orcamento) then
    update public.processamentos_pesados
       set status = 'PROCESSANDO', iniciado_em = coalesce(iniciado_em, now()),
           heartbeat_em = now(), atualizado_em = now()
     where id = p_id returning * into v_registro;
  end if;
  return v_registro;
end;
$$;
