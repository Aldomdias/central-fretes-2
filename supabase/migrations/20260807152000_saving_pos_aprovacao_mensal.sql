-- MantÃ©m a base histÃ³rica anterior ao corte e abre o realizado por competÃªncia mensal.
create or replace function public.saving_pos_aprovacao_fluxos_mensal(
  p_transportadoras text[], p_origem text, p_canais text[], p_data_corte date,
  p_fim_atual date, p_meses_base integer, p_limites_peso numeric[]
)
returns table (
  competencia date, rota text, faixa text, ctes_base bigint, ctes_atual bigint,
  valor_nf_base numeric, valor_nf_atual numeric, valor_cte_base numeric,
  valor_cte_atual numeric, pct_base numeric, pct_atual numeric, diff_pct numeric, saving numeric
)
language sql stable security invoker
set statement_timeout = '90s'
set search_path = public, pg_temp
as $function$
with parametros as (
  select greatest(coalesce(p_meses_base, 3), 1) as meses_base,
    coalesce(nullif(p_limites_peso, '{}'::numeric[]), array[999999999::numeric]) as limites
), atual_linhas as (
  select date_trunc('month', r.data_emissao)::date as competencia,
    coalesce(nullif(r.chave_rota_ibge, ''), concat_ws('|', upper(trim(coalesce(r.cidade_origem, ''))), upper(trim(coalesce(r.uf_origem, ''))), upper(trim(coalesce(r.cidade_destino, ''))), upper(trim(coalesce(r.uf_destino, ''))))) as rota_key,
    concat_ws(' â†’ ', concat_ws('/', nullif(trim(r.cidade_origem), ''), nullif(trim(r.uf_origem), '')), concat_ws('/', nullif(trim(r.cidade_destino), ''), nullif(trim(r.uf_destino), ''))) as rota_label,
    case when coalesce(r.peso, r.peso_declarado, r.peso_cubado, 0) <= 0 then 0::numeric else coalesce(
      (select min(limite) from unnest((select limites from parametros)) limite where limite >= coalesce(r.peso, r.peso_declarado, r.peso_cubado, 0)),
      (select max(limite) from unnest((select limites from parametros)) limite)) end as faixa_max,
    coalesce(r.valor_cte, 0)::numeric as valor_cte, coalesce(r.valor_nf, 0)::numeric as valor_nf
  from public.realizado_local_ctes r
  where r.data_emissao >= p_data_corte::timestamp
    and r.data_emissao < (coalesce(p_fim_atual, current_date) + 1)::timestamp
    and r.transportadora = any(coalesce(p_transportadoras, '{}'::text[]))
    and (coalesce(trim(p_origem), '') = '' or upper(r.cidade_origem) like upper(trim(p_origem)) || '%')
    and r.canal = any(coalesce(p_canais, '{}'::text[]))
), atual as (
  select competencia, rota_key, max(rota_label) as rota_label, faixa_max,
    count(*) as ctes, sum(valor_cte) as valor_cte, sum(valor_nf) as valor_nf
  from atual_linhas group by competencia, rota_key, faixa_max
), chaves_atuais as (
  select distinct rota_key, faixa_max from atual
), base_linhas as (
  select coalesce(nullif(r.chave_rota_ibge, ''), concat_ws('|', upper(trim(coalesce(r.cidade_origem, ''))), upper(trim(coalesce(r.uf_origem, ''))), upper(trim(coalesce(r.cidade_destino, ''))), upper(trim(coalesce(r.uf_destino, ''))))) as rota_key,
    case when coalesce(r.peso, r.peso_declarado, r.peso_cubado, 0) <= 0 then 0::numeric else coalesce(
      (select min(limite) from unnest((select limites from parametros)) limite where limite >= coalesce(r.peso, r.peso_declarado, r.peso_cubado, 0)),
      (select max(limite) from unnest((select limites from parametros)) limite)) end as faixa_max,
    coalesce(r.valor_cte, 0)::numeric as valor_cte, coalesce(r.valor_nf, 0)::numeric as valor_nf
  from public.realizado_local_ctes r
  where r.data_emissao >= (p_data_corte - make_interval(months => (select meses_base from parametros)))::timestamp
    and r.data_emissao < p_data_corte::timestamp and r.canal = any(coalesce(p_canais, '{}'::text[]))
), base as (
  select b.rota_key, b.faixa_max, count(*) as ctes, sum(b.valor_cte) as valor_cte, sum(b.valor_nf) as valor_nf
  from base_linhas b inner join chaves_atuais a on a.rota_key = b.rota_key and a.faixa_max = b.faixa_max
  group by b.rota_key, b.faixa_max
), comparado as (
  select a.competencia, a.rota_label, a.faixa_max, b.ctes as ctes_base, a.ctes as ctes_atual,
    b.valor_nf as valor_nf_base, a.valor_nf as valor_nf_atual, b.valor_cte as valor_cte_base, a.valor_cte as valor_cte_atual,
    b.valor_cte / b.valor_nf as pct_base, a.valor_cte / a.valor_nf as pct_atual
  from atual a inner join base b on b.rota_key = a.rota_key and b.faixa_max = a.faixa_max
  where a.valor_nf > 0 and b.valor_nf > 0
)
select c.competencia, c.rota_label,
  case when c.faixa_max = 0 then 'Sem faixa' when c.faixa_max >= 999999 then 'Acima de ' || coalesce((select max(l) from unnest((select limites from parametros)) l where l < 999999), 0)::text || ' kg'
    else coalesce((select max(l) from unnest((select limites from parametros)) l where l < c.faixa_max), 0)::text || ' a ' || c.faixa_max::text || ' kg' end,
  c.ctes_base, c.ctes_atual, c.valor_nf_base, c.valor_nf_atual, c.valor_cte_base, c.valor_cte_atual,
  c.pct_base, c.pct_atual, c.pct_base - c.pct_atual, (c.pct_base - c.pct_atual) * c.valor_nf_atual
from comparado c order by c.competencia, ((c.pct_base - c.pct_atual) * c.valor_nf_atual) desc;
$function$;

revoke all on function public.saving_pos_aprovacao_fluxos_mensal(text[], text, text[], date, date, integer, numeric[]) from public;
grant execute on function public.saving_pos_aprovacao_fluxos_mensal(text[], text, text[], date, date, integer, numeric[]) to anon, authenticated;
