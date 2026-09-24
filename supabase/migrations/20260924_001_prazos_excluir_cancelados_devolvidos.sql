-- Painel de prazos: pedidos cancelados (CAN) e devolvidos (DEV) saem da conta.
-- O status vem do relatório de Tracking ("Status Pedido"). Antes só existia dentro do
-- jsonb raw; ler raw em ~500 mil linhas estoura o tempo, então vira coluna própria.
-- ORDEM: aplicar este arquivo ANTES de subir o próximo Tracking com o código novo
-- (o envio passa a gravar status_pedido).

alter table public.tracking_rows add column if not exists status_pedido text;

-- Backfill por mês (rodar cada UPDATE separado se o editor reclamar de tempo).
update public.tracking_rows set status_pedido = raw->>'Status Pedido'
  where status_pedido is null and raw is not null and data::date >= date '2026-05-01' and data::date < date '2026-06-01';
update public.tracking_rows set status_pedido = raw->>'Status Pedido'
  where status_pedido is null and raw is not null and data::date >= date '2026-06-01' and data::date < date '2026-07-01';
update public.tracking_rows set status_pedido = raw->>'Status Pedido'
  where status_pedido is null and raw is not null and data::date >= date '2026-07-01' and data::date < date '2026-08-01';
update public.tracking_rows set status_pedido = raw->>'Status Pedido'
  where status_pedido is null and raw is not null and data::date >= date '2026-08-01' and data::date < date '2026-09-01';
update public.tracking_rows set status_pedido = raw->>'Status Pedido'
  where status_pedido is null and raw is not null and data::date >= date '2026-09-01' and data::date < date '2026-10-01';

create or replace function public.rpc_tracking_acompanhamento_prazos(
  p_dias_historico integer default 90, p_transportadora text default null,
  p_status text default null, p_limite integer default 200
) returns jsonb language sql stable security invoker set search_path = public as $$
with base as (
  select id, data, nota_fiscal, pedido, canal, transportadora, cidade_origem, uf_origem, cidade_destino, uf_destino,
    previsao_cliente, previsao_transportadora, data_entrega,
    case when data_entrega is not null and previsao_cliente is not null then data_entrega::date - previsao_cliente::date end desvio_dias,
    case
      when data_entrega is not null and previsao_cliente is not null and data_entrega::date <= previsao_cliente::date then 'NO_PRAZO'
      when data_entrega is not null and previsao_cliente is not null then 'ENTREGUE_ATRASO'
      when data_entrega is null and previsao_cliente is not null and previsao_cliente::date < current_date then 'ATRASADO'
      when data_entrega is null and previsao_cliente::date = current_date then 'VENCE_HOJE'
      when data_entrega is null and previsao_cliente::date <= current_date + 3 then 'PROXIMO'
      when data_entrega is null then 'EM_TRANSITO' else 'SEM_PREVISAO' end status_prazo
  from public.tracking_rows
  where data::date >= current_date - greatest(1, least(coalesce(p_dias_historico, 90), 730))
    and upper(left(coalesce(status_pedido, ''), 3)) not in ('CAN', 'DEV')
    and (nullif(btrim(coalesce(p_transportadora, '')), '') is null or upper(transportadora) like '%' || upper(btrim(p_transportadora)) || '%')
), filtrada as (
  select * from base where nullif(btrim(coalesce(p_status, '')), '') is null or status_prazo = p_status
), resumo as (
  select count(*)::bigint total, count(*) filter (where data_entrega is null)::bigint em_aberto,
    count(*) filter (where status_prazo = 'ATRASADO')::bigint atrasadas,
    count(*) filter (where status_prazo in ('VENCE_HOJE','PROXIMO'))::bigint proximas,
    count(*) filter (where data_entrega is not null)::bigint entregues,
    count(*) filter (where status_prazo = 'NO_PRAZO')::bigint no_prazo from base
), por_transportadora as (
  select coalesce(nullif(btrim(transportadora), ''), 'NAO IDENTIFICADA') transportadora,
    count(*)::bigint total, count(*) filter (where data_entrega is null)::bigint em_aberto,
    count(*) filter (where status_prazo = 'ATRASADO')::bigint atrasadas,
    count(*) filter (where data_entrega is not null)::bigint entregues,
    count(*) filter (where status_prazo = 'NO_PRAZO')::bigint no_prazo,
    round(100.0 * count(*) filter (where status_prazo = 'NO_PRAZO') / nullif(count(*) filter (where data_entrega is not null and previsao_cliente is not null), 0), 1) aderencia_pct,
    round(avg(greatest(desvio_dias, 0)) filter (where data_entrega is not null and previsao_cliente is not null), 1) atraso_medio_dias,
    greatest(0, ceil(percentile_cont(0.8) within group (order by desvio_dias) filter (where data_entrega is not null and previsao_cliente is not null)))::integer ajuste_sugerido_dias,
    count(desvio_dias)::bigint amostra_ajuste
  from base group by coalesce(nullif(btrim(transportadora), ''), 'NAO IDENTIFICADA')
  order by atrasadas desc, aderencia_pct nulls first, total desc
), por_rota as (
  select coalesce(nullif(btrim(cidade_origem), ''), 'NAO INFORMADA') cidade_origem,
    coalesce(nullif(btrim(uf_origem), ''), '--') uf_origem,
    coalesce(nullif(btrim(cidade_destino), ''), 'NAO INFORMADA') cidade_destino,
    coalesce(nullif(btrim(uf_destino), ''), '--') uf_destino,
    count(*)::bigint total, count(*) filter (where data_entrega is null)::bigint em_aberto,
    count(*) filter (where status_prazo = 'ATRASADO')::bigint atrasadas,
    count(*) filter (where data_entrega is not null)::bigint entregues,
    round(100.0 * count(*) filter (where status_prazo = 'NO_PRAZO') /
      nullif(count(*) filter (where data_entrega is not null and previsao_cliente is not null), 0), 1) aderencia_pct,
    round(avg(greatest(desvio_dias, 0)) filter (where data_entrega is not null and previsao_cliente is not null), 1) atraso_medio_dias
  from base group by cidade_origem, uf_origem, cidade_destino, uf_destino
  having count(*) >= 3
  order by atrasadas desc, aderencia_pct nulls first, total desc limit 50
), tendencia as (
  select date_trunc('week', coalesce(data_entrega::date, data::date))::date semana,
    count(*)::bigint total, count(*) filter (where data_entrega is not null)::bigint entregues,
    count(*) filter (where status_prazo = 'NO_PRAZO')::bigint no_prazo,
    count(*) filter (where status_prazo in ('ATRASADO','ENTREGUE_ATRASO'))::bigint com_atraso,
    round(100.0 * count(*) filter (where status_prazo = 'NO_PRAZO') /
      nullif(count(*) filter (where data_entrega is not null and previsao_cliente is not null), 0), 1) aderencia_pct
  from base group by date_trunc('week', coalesce(data_entrega::date, data::date))::date order by semana
), qualidade as (
  select count(*) filter (where previsao_cliente is null)::bigint sem_previsao_cliente,
    count(*) filter (where previsao_transportadora is null)::bigint sem_previsao_transportadora,
    count(*) filter (where nullif(btrim(coalesce(transportadora,'')), '') is null)::bigint sem_transportadora,
    count(*) filter (where nullif(btrim(coalesce(cidade_destino,'')), '') is null or nullif(btrim(coalesce(uf_destino,'')), '') is null)::bigint sem_destino
  from base
), fila as (
  select * from filtrada order by case status_prazo when 'ATRASADO' then 1 when 'VENCE_HOJE' then 2 when 'PROXIMO' then 3 when 'EM_TRANSITO' then 4 else 5 end,
    previsao_cliente nulls last, data desc limit greatest(1, least(coalesce(p_limite, 200), 500))
)
select jsonb_build_object('gerado_em', now(), 'resumo', coalesce((select to_jsonb(r) from resumo r), '{}'::jsonb),
  'transportadoras', coalesce((select jsonb_agg(to_jsonb(t)) from por_transportadora t), '[]'::jsonb),
  'rotas', coalesce((select jsonb_agg(to_jsonb(r)) from por_rota r), '[]'::jsonb),
  'tendencia', coalesce((select jsonb_agg(to_jsonb(t)) from tendencia t), '[]'::jsonb),
  'qualidade', coalesce((select to_jsonb(q) from qualidade q), '{}'::jsonb),
  'entregas', coalesce((select jsonb_agg(to_jsonb(f)) from fila f), '[]'::jsonb));
$$;
revoke all on function public.rpc_tracking_acompanhamento_prazos(integer,text,text,integer) from public;
grant execute on function public.rpc_tracking_acompanhamento_prazos(integer,text,text,integer) to anon, authenticated;
