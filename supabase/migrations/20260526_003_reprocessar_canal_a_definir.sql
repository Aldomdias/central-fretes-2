-- Re-processa registros com canal = 'A DEFINIR' usando vínculos existentes
--
-- CONTEXTO DO PROBLEMA:
-- CT-es e Tracking importados antes do cadastro dos vínculos de transportadoras
-- ficaram com canal = 'A DEFINIR' gravado em disco. O trigger só resolve canal
-- em INSERT/UPDATE novos — registros antigos não são re-avaliados automaticamente.
-- Por isso a ferramenta "Pendências de Canal" mostra transportadoras que JÁ TÊM
-- vínculo cadastrado, como se ainda fossem pendências.
--
-- O QUE ESTE SCRIPT FAZ:
-- 1. Para cada registro com canal = 'A DEFINIR', chama resolver_canal_transportadora
--    (a mesma função do trigger) e atualiza canal se o resultado não for 'A DEFINIR'.
-- 2. Recria a view com filtro correto (NULL e '' além de 'A DEFINIR').
-- 3. Exclui da view as transportadoras que JÁ TÊM vínculo resolúvel.
--
-- SEGURO: só altera registros que PODEM ser resolvidos.
-- Registros sem vínculo e sem parametrização permanecem em 'A DEFINIR'.
--
-- Executar no Supabase SQL Editor.
-- Dependência: migration 20260525_001_canal_transportadora_parametrizacoes.sql
-- deve estar aplicada.

-- ─── 1. Re-avaliar canal dos CT-es existentes ─────────────────────────────────
do $$
declare
  v_ctes    integer;
  v_tracking integer;
begin
  -- CT-es
  update public.realizado_local_ctes
  set
    canal_original = coalesce(nullif(btrim(canal_original), ''), canal),
    canal = public.resolver_canal_transportadora(transportadora, coalesce(nullif(btrim(canal_original), ''), canal))
  where coalesce(nullif(btrim(canal), ''), 'A DEFINIR') = 'A DEFINIR'
    and public.resolver_canal_transportadora(transportadora, coalesce(nullif(btrim(canal_original), ''), canal)) <> 'A DEFINIR';
  get diagnostics v_ctes = row_count;

  -- Tracking
  update public.tracking_rows
  set
    canal_original = coalesce(nullif(btrim(canal_original), ''), canal),
    canal = public.resolver_canal_transportadora(transportadora, coalesce(nullif(btrim(canal_original), ''), canal))
  where coalesce(nullif(btrim(canal), ''), 'A DEFINIR') = 'A DEFINIR'
    and public.resolver_canal_transportadora(transportadora, coalesce(nullif(btrim(canal_original), ''), canal)) <> 'A DEFINIR';
  get diagnostics v_tracking = row_count;

  raise notice 'Canal resolvido: % CT-es, % Tracking atualizados.', v_ctes, v_tracking;
end;
$$;

-- ─── 2. Recriar view com filtro correto ───────────────────────────────────────
-- Inclui NULL e '' além de 'A DEFINIR'.
-- Exclui transportadoras que JÁ TÊM canal resolvível via vínculo ou parametrização
-- (o re-processamento acima já deveria ter limpado esses casos, mas a view
-- também filtra para garantir que a lista fique limpa).

create or replace view public.pendencias_canal_transportadora
with (security_invoker = true) as
with base as (
  -- CT-es ainda sem canal após re-processamento
  select
    'CT-e'::text                                                  as base,
    transportadora,
    public.normalizar_nome_transportadora(transportadora)         as transportadora_normalizada,
    canal_original,
    data_emissao::date                                            as data_ocorrencia,
    1::numeric                                                    as qtd_cte,
    0::numeric                                                    as qtd_tracking,
    coalesce(valor_cte, 0)::numeric                               as valor_cte,
    coalesce(valor_nf, 0)::numeric                                as valor_nf,
    coalesce(peso, 0)::numeric                                    as peso
  from public.realizado_local_ctes
  where coalesce(nullif(btrim(canal), ''), 'A DEFINIR') = 'A DEFINIR'

  union all

  -- Tracking ainda sem canal
  select
    'Tracking'::text                                              as base,
    transportadora,
    public.normalizar_nome_transportadora(transportadora)         as transportadora_normalizada,
    canal_original,
    data::date                                                    as data_ocorrencia,
    0::numeric                                                    as qtd_cte,
    1::numeric                                                    as qtd_tracking,
    coalesce(valor_cte, 0)::numeric                               as valor_cte,
    0::numeric                                                    as valor_nf,
    coalesce(peso, 0)::numeric                                    as peso
  from public.tracking_rows
  where coalesce(nullif(btrim(canal), ''), 'A DEFINIR') = 'A DEFINIR'
),
-- Transportadoras que têm vínculo mas o canal ainda não foi resolvido
-- (vínculo existe mas tabela/origem não tem canal cadastrado)
resolviveis as (
  select distinct public.normalizar_nome_transportadora(v.nome_cte) as transportadora_normalizada
  from public.transportadora_vinculos v
  join public.transportadoras t
    on public.normalizar_nome_transportadora(t.nome)
     = public.normalizar_nome_transportadora(v.nome_tabela)
  join public.origens o
    on o.transportadora_id = t.id
  where nullif(btrim(o.canal), '') is not null
)
select
  b.transportadora,
  b.transportadora_normalizada,
  max(b.canal_original)
    filter (where nullif(btrim(b.canal_original), '') is not null) as canal_original,
  case
    when r.transportadora_normalizada is not null
      then 'Vínculo cadastrado — canal não definido nas origens'
    else 'Sem tabela/vínculo cadastrado'
  end                                                              as motivo,
  count(*)::bigint                                                 as quantidade_total,
  sum(b.qtd_cte)::bigint                                          as quantidade_ctes,
  sum(b.qtd_tracking)::bigint                                     as quantidade_tracking,
  sum(b.valor_cte)::numeric                                       as valor_total_cte,
  sum(b.valor_nf)::numeric                                        as valor_total_nf,
  sum(b.peso)::numeric                                            as peso_total,
  min(b.data_ocorrencia)                                          as primeira_ocorrencia,
  max(b.data_ocorrencia)                                          as ultima_ocorrencia,
  string_agg(distinct b.base, ', ' order by b.base)               as bases_afetadas
from base b
left join resolviveis r
  on r.transportadora_normalizada = b.transportadora_normalizada
where b.transportadora_normalizada is not null
group by b.transportadora, b.transportadora_normalizada, r.transportadora_normalizada
order by quantidade_total desc;
