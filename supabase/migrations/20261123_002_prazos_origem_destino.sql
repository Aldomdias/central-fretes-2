-- Painel de prazos: nova visao Origem x UF destino por transportadora.
-- Funcao NOVA e aditiva: nao altera rpc_tracking_acompanhamento_prazos.
-- Mesma regra da aba Transportadoras: p80 do desvio (entrega - previsao do cliente) => ajuste sugerido em dias.
create or replace function public.rpc_tracking_prazos_origem_destino(
  p_dias_historico integer default 90, p_transportadora text default null
) returns jsonb language sql stable security invoker set search_path = public as $$
with base as (
  select data, data_entrega, previsao_cliente,
    coalesce(nullif(btrim(cidade_origem), ''), 'NAO INFORMADA') cidade_origem,
    coalesce(nullif(btrim(uf_origem), ''), '--') uf_origem,
    coalesce(nullif(btrim(uf_destino), ''), '--') uf_destino,
    case when data_entrega is not null and previsao_cliente is not null then data_entrega::date - previsao_cliente::date end desvio_dias,
    case when previsao_cliente is not null then previsao_cliente::date - data::date end prazo_prometido,
    case when data_entrega is not null then data_entrega::date - data::date end prazo_realizado,
    case
      when data_entrega is not null and previsao_cliente is not null and data_entrega::date <= previsao_cliente::date then 'NO_PRAZO'
      when data_entrega is not null and previsao_cliente is not null then 'ENTREGUE_ATRASO'
      when data_entrega is null and previsao_cliente is not null and previsao_cliente::date < current_date then 'ATRASADO'
      else 'OUTRO' end status_prazo
  from public.tracking_rows
  where data::date >= current_date - greatest(1, least(coalesce(p_dias_historico, 90), 730))
    and upper(left(coalesce(status_pedido, ''), 3)) not in ('CAN', 'DEV')
    and (nullif(btrim(coalesce(p_transportadora, '')), '') is null or upper(transportadora) like '%' || upper(btrim(p_transportadora)) || '%')
), agg as (
  select cidade_origem, uf_origem, uf_destino,
    count(*)::bigint total,
    count(*) filter (where data_entrega is null)::bigint em_aberto,
    count(*) filter (where status_prazo = 'ATRASADO')::bigint atrasadas,
    count(*) filter (where data_entrega is not null)::bigint entregues,
    count(*) filter (where status_prazo = 'NO_PRAZO')::bigint no_prazo,
    round(100.0 * count(*) filter (where status_prazo = 'NO_PRAZO') /
      nullif(count(*) filter (where data_entrega is not null and previsao_cliente is not null), 0), 1) aderencia_pct,
    round(avg(greatest(desvio_dias, 0)) filter (where desvio_dias is not null), 1) atraso_medio_dias,
    round(avg(prazo_prometido) filter (where prazo_prometido is not null), 1) prazo_prometido_medio,
    round(avg(prazo_realizado) filter (where prazo_realizado is not null), 1) prazo_realizado_medio,
    greatest(0, ceil(percentile_cont(0.8) within group (order by desvio_dias) filter (where desvio_dias is not null)))::integer ajuste_sugerido_dias,
    count(desvio_dias)::bigint amostra_ajuste
  from base group by cidade_origem, uf_origem, uf_destino
)
select jsonb_build_object('gerado_em', now(),
  'linhas', coalesce((select jsonb_agg(to_jsonb(a) order by a.total desc) from (select * from agg order by total desc limit 3000) a), '[]'::jsonb));
$$;
revoke all on function public.rpc_tracking_prazos_origem_destino(integer,text) from public;
grant execute on function public.rpc_tracking_prazos_origem_destino(integer,text) to anon, authenticated;
