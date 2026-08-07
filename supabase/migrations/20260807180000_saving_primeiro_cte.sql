create or replace function public.primeiro_cte_saving(
  p_transportadoras text[], p_origem text, p_canais text[],
  p_data_corte date, p_fim_atual date
)
returns date
language sql stable security invoker
set search_path = public, pg_temp
as $function$
  select min(r.data_emissao)::date
  from public.realizado_local_ctes r
  where r.data_emissao >= p_data_corte::timestamp
    and r.data_emissao < (coalesce(p_fim_atual, current_date) + 1)::timestamp
    and r.transportadora = any(coalesce(p_transportadoras, '{}'::text[]))
    and (coalesce(trim(p_origem), '') = '' or upper(r.cidade_origem) like upper(trim(p_origem)) || '%')
    and r.canal = any(coalesce(p_canais, '{}'::text[]));
$function$;

revoke all on function public.primeiro_cte_saving(text[], text, text[], date, date) from public;
grant execute on function public.primeiro_cte_saving(text[], text, text[], date, date) to anon, authenticated;
