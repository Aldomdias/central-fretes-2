-- Adiciona opção de calcular a curva de 80% por valor de frete, além de quantidade de CT-es.
drop function if exists public.rpc_gestao_contratos_pareto(text, numeric);

create or replace function public.rpc_gestao_contratos_pareto(p_competencia text, p_percentual_alvo numeric default 80, p_criterio text default 'quantidade')
returns table (transportadora text, posicao bigint, ctes bigint, valor numeric, percentual numeric, percentual_acumulado numeric, no_pareto boolean, movimento text, status_contrato text, inicio_vigencia date, fim_vigencia date, observacoes text, sem_vinculo boolean, ctes_sem_vinculo bigint)
language sql stable security invoker set statement_timeout = '120s' as $$
with parametros as (
 select case when p_competencia ~ '^\d{4}-S[12]$' then make_date(left(p_competencia,4)::int,case when right(p_competencia,1)='1' then 1 else 7 end,1) else to_date(p_competencia||'-01','YYYY-MM-DD') end inicio,
 case when p_competencia ~ '^\d{4}-S[12]$' then interval '6 months' else interval '1 month' end duracao,
 greatest(1,least(coalesce(p_percentual_alvo,80),100)) alvo,
 case when lower(coalesce(p_criterio,'quantidade'))='valor' then 'valor' else 'quantidade' end criterio
), periodos as (select inicio,inicio+duracao fim,inicio-duracao anterior_inicio,alvo,criterio from parametros),
base as (
 select case when coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD'))>=p.inicio then p.inicio else p.anterior_inicio end periodo,
 nullif(btrim(v.nome_tabela),'') transportadora,count(*)::bigint ctes,sum(coalesce(r.valor_cte,0))::numeric valor
 from public.realizado_local_ctes r
 left join lateral (
   select resolvido.nome_tabela from (
     select tv.nome_tabela, 1 prioridade from public.transportadora_vinculos tv
     where public.normalizar_nome_transportadora(tv.nome_cte)=public.normalizar_nome_transportadora(r.transportadora)
     union all
     select t.nome, 2 prioridade from public.transportadoras t
     where public.normalizar_nome_transportadora(t.nome)=public.normalizar_nome_transportadora(r.transportadora)
     union all
     select r.transportadora, 3 prioridade from public.gestao_contratos_nomes_pendentes d
     where public.normalizar_nome_transportadora(d.nome_cte)=public.normalizar_nome_transportadora(r.transportadora) and d.incluir is true
   ) resolvido order by resolvido.prioridade limit 1
 ) v on true
 cross join periodos p
 where coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD'))>=p.anterior_inicio and coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD'))<p.fim
 and (public.normalizar_nome_transportadora(r.tomador_servico) like '%CPX%' or public.normalizar_nome_transportadora(r.tomador_servico) like '%ITR%' or public.normalizar_nome_transportadora(r.tomador_servico) like '%GP%' or public.normalizar_nome_transportadora(r.tomador_servico) like '%SPEEDMAX%')
 group by 1,2
), ranking as (
 select b.*,(case when p.criterio='valor' then b.valor else b.ctes end) metrica,
 row_number() over(partition by b.periodo order by (case when p.criterio='valor' then b.valor else b.ctes end) desc,b.transportadora) posicao,
 100*(case when p.criterio='valor' then b.valor else b.ctes end)/nullif(sum(case when p.criterio='valor' then b.valor else b.ctes end) over(partition by b.periodo),0) percentual
 from base b cross join periodos p where b.transportadora is not null
), curva as (
 select r.*,sum(percentual) over(partition by periodo order by metrica desc,transportadora rows unbounded preceding) acumulado from ranking r
), marcado as (
 select c.*,(coalesce(acumulado-percentual,0)<p.alvo) no_pareto from curva c cross join periodos p
), atual as (select m.* from marcado m cross join periodos p where m.periodo=p.inicio),
anterior as (select m.* from marcado m cross join periodos p where m.periodo=p.anterior_inicio),
nomes as (select transportadora from atual union select transportadora from anterior where no_pareto),
nao_vinculados as (select coalesce(sum(ctes),0)::bigint qtd from base cross join periodos p where base.periodo=p.inicio and transportadora is null)
select n.transportadora,coalesce(a.posicao,0),coalesce(a.ctes,0),coalesce(a.valor,0),round(coalesce(a.percentual,0),2),round(coalesce(a.acumulado,0),2),coalesce(a.no_pareto,false),
case when coalesce(a.no_pareto,false) and not coalesce(an.no_pareto,false) then 'entrou' when not coalesce(a.no_pareto,false) and coalesce(an.no_pareto,false) then 'saiu' when coalesce(a.no_pareto,false) and coalesce(an.no_pareto,false) then 'permaneceu' else 'fora' end,
coalesce(gc.status,'sem_contrato'),gc.inicio_vigencia,gc.fim_vigencia,gc.observacoes,false,nv.qtd
from nomes n left join atual a using(transportadora) left join anterior an using(transportadora) left join public.gestao_contratos_transportadoras gc using(transportadora) cross join nao_vinculados nv
order by coalesce(a.no_pareto,false) desc,coalesce(a.posicao,999999),n.transportadora;
$$;
grant execute on function public.rpc_gestao_contratos_pareto(text,numeric,text) to anon, authenticated;
