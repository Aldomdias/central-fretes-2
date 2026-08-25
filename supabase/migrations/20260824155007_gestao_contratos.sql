create table if not exists public.gestao_contratos_transportadoras (
  transportadora text primary key,
  status text not null default 'sem_contrato' check (status in ('sem_contrato','em_providencia','vigente','vencido','dispensado')),
  inicio_vigencia date, fim_vigencia date, observacoes text, atualizado_por text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
comment on table public.gestao_contratos_transportadoras is 'Controle contratual pelo nome canonico da transportadora (nome da tabela).';
alter table public.gestao_contratos_transportadoras enable row level security;
drop policy if exists gestao_contratos_all on public.gestao_contratos_transportadoras;
create policy gestao_contratos_all on public.gestao_contratos_transportadoras for all to anon, authenticated using (true) with check (true);
grant select, insert, update on public.gestao_contratos_transportadoras to anon, authenticated;

create table if not exists public.gestao_contratos_nomes_pendentes (
  nome_cte text primary key, incluir boolean, atualizado_por text, updated_at timestamptz not null default now()
);
alter table public.gestao_contratos_nomes_pendentes enable row level security;
drop policy if exists gestao_contratos_pendentes_all on public.gestao_contratos_nomes_pendentes;
create policy gestao_contratos_pendentes_all on public.gestao_contratos_nomes_pendentes for all to anon, authenticated using (true) with check (true);
grant select, insert, update on public.gestao_contratos_nomes_pendentes to anon, authenticated;

create or replace function public.rpc_gestao_contratos_pareto(p_competencia text, p_percentual_alvo numeric default 80)
returns table (transportadora text, posicao bigint, ctes bigint, percentual numeric, percentual_acumulado numeric, no_pareto boolean, movimento text, status_contrato text, inicio_vigencia date, fim_vigencia date, observacoes text, sem_vinculo boolean, ctes_sem_vinculo bigint)
language sql stable security invoker set statement_timeout = '120s' as $$
with parametros as (
 select case when p_competencia ~ '^\d{4}-S[12]$' then make_date(left(p_competencia,4)::int,case when right(p_competencia,1)='1' then 1 else 7 end,1) else to_date(p_competencia||'-01','YYYY-MM-DD') end inicio,
 case when p_competencia ~ '^\d{4}-S[12]$' then interval '6 months' else interval '1 month' end duracao,
 greatest(1,least(coalesce(p_percentual_alvo,80),100)) alvo
), periodos as (select inicio,inicio+duracao fim,inicio-duracao anterior_inicio,alvo from parametros),
base as (
 select case when coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD'))>=p.inicio then p.inicio else p.anterior_inicio end periodo,
 nullif(btrim(v.nome_tabela),'') transportadora,count(*)::bigint ctes
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
 select b.*,row_number() over(partition by periodo order by ctes desc,transportadora) posicao,
 100*ctes/nullif(sum(ctes) over(partition by periodo),0) percentual from base b where transportadora is not null
), curva as (
 select r.*,sum(percentual) over(partition by periodo order by ctes desc,transportadora rows unbounded preceding) acumulado from ranking r
), marcado as (
 select c.*,(coalesce(acumulado-percentual,0)<p.alvo) no_pareto from curva c cross join periodos p
), atual as (select m.* from marcado m cross join periodos p where m.periodo=p.inicio),
anterior as (select m.* from marcado m cross join periodos p where m.periodo=p.anterior_inicio),
nomes as (select transportadora from atual union select transportadora from anterior where no_pareto),
nao_vinculados as (select coalesce(sum(ctes),0)::bigint qtd from base cross join periodos p where base.periodo=p.inicio and transportadora is null)
select n.transportadora,coalesce(a.posicao,0),coalesce(a.ctes,0),round(coalesce(a.percentual,0),2),round(coalesce(a.acumulado,0),2),coalesce(a.no_pareto,false),
case when coalesce(a.no_pareto,false) and not coalesce(an.no_pareto,false) then 'entrou' when not coalesce(a.no_pareto,false) and coalesce(an.no_pareto,false) then 'saiu' when coalesce(a.no_pareto,false) and coalesce(an.no_pareto,false) then 'permaneceu' else 'fora' end,
coalesce(gc.status,'sem_contrato'),gc.inicio_vigencia,gc.fim_vigencia,gc.observacoes,false,nv.qtd
from nomes n left join atual a using(transportadora) left join anterior an using(transportadora) left join public.gestao_contratos_transportadoras gc using(transportadora) cross join nao_vinculados nv
order by coalesce(a.no_pareto,false) desc,coalesce(a.posicao,999999),n.transportadora;
$$;
grant execute on function public.rpc_gestao_contratos_pareto(text,numeric) to anon, authenticated;

drop function if exists public.rpc_gestao_contratos_sem_vinculo(text);
create function public.rpc_gestao_contratos_sem_vinculo(p_competencia text)
returns table (nome_cte text, ctes bigint, canais text[], percentual_total numeric, incluir boolean)
language sql stable security invoker set statement_timeout = '120s' as $$
with base as (
  select r.transportadora nome_cte, r.canal from public.realizado_local_ctes r
  where ((p_competencia ~ '^\d{4}-S[12]$' and extract(year from coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD')))=left(p_competencia,4)::int and (case when extract(month from coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD')))<=6 then '1' else '2' end)=right(p_competencia,1)) or to_char(coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD')),'YYYY-MM')=p_competencia)
    and (public.normalizar_nome_transportadora(r.tomador_servico) like '%CPX%' or public.normalizar_nome_transportadora(r.tomador_servico) like '%ITR%' or public.normalizar_nome_transportadora(r.tomador_servico) like '%GP%' or public.normalizar_nome_transportadora(r.tomador_servico) like '%SPEEDMAX%')
    and nullif(btrim(r.transportadora),'') is not null
    and not exists (select 1 from public.transportadora_vinculos tv where public.normalizar_nome_transportadora(tv.nome_cte)=public.normalizar_nome_transportadora(r.transportadora))
    and not exists (select 1 from public.transportadoras t where public.normalizar_nome_transportadora(t.nome)=public.normalizar_nome_transportadora(r.transportadora))
), total as (
  select count(*)::numeric qtd from public.realizado_local_ctes r
  where ((p_competencia ~ '^\d{4}-S[12]$' and extract(year from coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD')))=left(p_competencia,4)::int and (case when extract(month from coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD')))<=6 then '1' else '2' end)=right(p_competencia,1)) or to_char(coalesce(r.data_emissao::date,to_date(r.competencia||'-01','YYYY-MM-DD')),'YYYY-MM')=p_competencia)
    and (public.normalizar_nome_transportadora(r.tomador_servico) like '%CPX%' or public.normalizar_nome_transportadora(r.tomador_servico) like '%ITR%' or public.normalizar_nome_transportadora(r.tomador_servico) like '%GP%' or public.normalizar_nome_transportadora(r.tomador_servico) like '%SPEEDMAX%')
)
select b.nome_cte,count(*)::bigint,array_agg(distinct coalesce(nullif(btrim(b.canal),''),'N/I') order by coalesce(nullif(btrim(b.canal),''),'N/I')),
 round(100*count(*)/nullif(t.qtd,0),2),d.incluir
from base b cross join total t left join public.gestao_contratos_nomes_pendentes d on public.normalizar_nome_transportadora(d.nome_cte)=public.normalizar_nome_transportadora(b.nome_cte)
group by b.nome_cte,t.qtd,d.incluir order by count(*) desc,b.nome_cte;
$$;
grant execute on function public.rpc_gestao_contratos_sem_vinculo(text) to anon, authenticated;
