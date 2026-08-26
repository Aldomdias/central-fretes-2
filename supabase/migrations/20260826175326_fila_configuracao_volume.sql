-- Torna o limite da fila calibravel: em vez de so contar quantas tarefas
-- estao PROCESSANDO, soma o tamanho (total_itens) delas contra um orcamento
-- configuravel. Assim 10 tarefas pequenas cabem juntas, mas 2 grandes ja
-- ocupam todo o espaco. Ajustavel pela tela de Ferramentas sem precisar
-- de deploy.
create table if not exists public.fila_configuracao (
  id smallint primary key default 1 check (id = 1),
  orcamento_itens integer not null default 3000 check (orcamento_itens > 0),
  limite_tarefas_globais integer not null default 2 check (limite_tarefas_globais between 1 and 20),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

insert into public.fila_configuracao (id, orcamento_itens, limite_tarefas_globais)
values (1, 3000, 2)
on conflict (id) do nothing;

alter table public.fila_configuracao enable row level security;
drop policy if exists "fila_configuracao_public_access" on public.fila_configuracao;
create policy "fila_configuracao_public_access"
  on public.fila_configuracao for all using (true) with check (true);

grant select, update on public.fila_configuracao to anon, authenticated;

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
  -- p_limite_global so sobrescreve quando explicitamente informado; caso
  -- contrario, quem manda e a configuracao calibrada em Ferramentas.
  v_limite_tarefas := greatest(1, least(coalesce(p_limite_global, v_config.limite_tarefas_globais, 2), 20));
  v_orcamento := greatest(1, coalesce(v_config.orcamento_itens, 3000));

  select * into v_registro from public.processamentos_pesados where id = p_id for update;
  if not found then raise exception 'Processamento nao encontrado.'; end if;
  if v_registro.status <> 'AGUARDANDO' then return v_registro; end if;

  -- Impede duas tarefas pesadas simultaneas do mesmo usuario.
  if exists (
    select 1 from public.processamentos_pesados
     where usuario_id = v_registro.usuario_id and status = 'PROCESSANDO' and id <> p_id
  ) then return v_registro; end if;

  select count(*), coalesce(sum(greatest(total_itens, 1)), 0)
    into v_ativos, v_soma_ativos
    from public.processamentos_pesados where status = 'PROCESSANDO';

  select id into v_primeiro
    from public.processamentos_pesados
   where status = 'AGUARDANDO'
   order by prioridade, criado_em
   limit 1;

  v_peso := greatest(v_registro.total_itens, 1);

  -- Sempre libera pelo menos uma tarefa mesmo que sozinha estoure o
  -- orcamento (senao uma tarefa gigante travaria a fila para sempre).
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
