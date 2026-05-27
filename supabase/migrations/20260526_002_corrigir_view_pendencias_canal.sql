-- Corrige a view pendencias_canal_transportadora
--
-- PROBLEMA: o filtro original era coalesce(canal, '') = 'A DEFINIR'
-- Isso deixa de fora registros com canal NULL ou canal '' (string vazia),
-- que também são pendências reais. Por isso o botão "Recarregar Pendências"
-- retornava lista vazia mesmo com pendências na base.
--
-- SOLUÇÃO: usar nullif(btrim(canal), '') para normalizar antes de comparar.
-- Qualquer canal NULL, vazio ou 'A DEFINIR' agora entra na view.
--
-- Executar no Supabase SQL Editor. Não altera tabelas, só recria a view.

create or replace view public.pendencias_canal_transportadora
with (security_invoker = true) as
with base as (
  select
    'CT-e'::text as base,
    transportadora,
    public.normalizar_nome_transportadora(transportadora) as transportadora_normalizada,
    canal_original,
    data_emissao::date as data_ocorrencia,
    1::numeric as qtd_cte,
    0::numeric as qtd_tracking,
    coalesce(valor_cte, 0)::numeric as valor_cte,
    coalesce(valor_nf, 0)::numeric as valor_nf,
    coalesce(peso, 0)::numeric as peso
  from public.realizado_local_ctes
  -- inclui: NULL, '', 'A DEFINIR' — qualquer canal sem definição confiável
  where coalesce(nullif(btrim(canal), ''), 'A DEFINIR') = 'A DEFINIR'

  union all

  select
    'Tracking'::text as base,
    transportadora,
    public.normalizar_nome_transportadora(transportadora) as transportadora_normalizada,
    canal_original,
    data::date as data_ocorrencia,
    0::numeric as qtd_cte,
    1::numeric as qtd_tracking,
    coalesce(valor_cte, 0)::numeric as valor_cte,
    0::numeric as valor_nf,
    coalesce(peso, 0)::numeric as peso
  from public.tracking_rows
  where coalesce(nullif(btrim(canal), ''), 'A DEFINIR') = 'A DEFINIR'
)
select
  transportadora,
  transportadora_normalizada,
  max(canal_original) filter (where nullif(btrim(canal_original), '') is not null) as canal_original,
  'Sem tabela/vinculo cadastrado'::text as motivo,
  count(*)::bigint as quantidade_total,
  sum(qtd_cte)::bigint as quantidade_ctes,
  sum(qtd_tracking)::bigint as quantidade_tracking,
  sum(valor_cte)::numeric as valor_total_cte,
  sum(valor_nf)::numeric as valor_total_nf,
  sum(peso)::numeric as peso_total,
  min(data_ocorrencia) as primeira_ocorrencia,
  max(data_ocorrencia) as ultima_ocorrencia,
  string_agg(distinct base, ', ' order by base) as bases_afetadas
from base
where transportadora_normalizada is not null
group by transportadora, transportadora_normalizada
order by quantidade_total desc;
