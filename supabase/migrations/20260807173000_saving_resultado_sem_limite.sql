-- A Data API limita funções tabulares a 1.000 linhas. Empacotar o detalhe em
-- um único JSON preserva todas as rota/faixas sem recalcular páginas por offset.
create or replace function public.saving_pos_aprovacao_fluxos_mensal_json(
  p_transportadoras text[], p_origem text, p_canais text[], p_data_corte date,
  p_fim_atual date, p_meses_base integer, p_limites_peso numeric[]
)
returns jsonb
language sql stable security invoker
set statement_timeout = '90s'
set search_path = public, pg_temp
as $function$
  select coalesce(
    jsonb_agg(to_jsonb(f) order by f.competencia, f.saving desc),
    '[]'::jsonb
  )
  from public.saving_pos_aprovacao_fluxos_mensal(
    p_transportadoras, p_origem, p_canais, p_data_corte,
    p_fim_atual, p_meses_base, p_limites_peso
  ) f;
$function$;

revoke all on function public.saving_pos_aprovacao_fluxos_mensal_json(text[], text, text[], date, date, integer, numeric[]) from public;
grant execute on function public.saving_pos_aprovacao_fluxos_mensal_json(text[], text, text[], date, date, integer, numeric[]) to anon, authenticated;

comment on function public.saving_pos_aprovacao_fluxos_mensal_json(text[], text, text[], date, date, integer, numeric[]) is
  'Resultado completo do saving mensal em JSON, sem o teto de 1.000 linhas do PostgREST.';
