-- Re-processa canal via vínculos + corrige view
--
-- REGRA DO NEGÓCIO (confirmada pelo usuário):
--   - Tem vínculo → tem tabela → canal vem da tabela → sai das pendências
--   - Sem vínculo → 'A DEFINIR' → fica nas pendências → usuário decide manualmente
--
-- PROBLEMA ATUAL:
--   - salvarVinculos() grava em transportadora_vinculos mas NÃO atualiza os CT-es
--   - resolver_canal_transportadora já faz o join correto (vinculos→transportadoras→origens)
--   - Mas os CT-es existentes nunca foram re-avaliados com os vínculos já cadastrados
--
-- O QUE ESTE SCRIPT FAZ:
--   1. Cria RPC resolver_canal_por_vinculos_batch() — chamada após salvar vínculos
--   2. Roda o batch uma vez agora para limpar o estado atual
--   3. Recria a view com a lógica correta de motivo

-- ─── 1. RPC batch — chamada pelo frontend após salvar vínculos ────────────────
create or replace function public.resolver_canal_por_vinculos_batch(
  p_nomes_cte text[] default null   -- null = processar todos com vínculo
)
returns jsonb
language plpgsql
as $$
declare
  v_ctes     integer := 0;
  v_tracking integer := 0;
  v_canal    text;
  v_norm     text;
  v_rec      record;
begin
  -- Itera sobre transportadoras que têm vínculo e ainda estão como A DEFINIR
  for v_rec in
    select distinct
      rlc.transportadora,
      public.normalizar_nome_transportadora(rlc.transportadora) as transportadora_normalizada
    from public.realizado_local_ctes rlc
    join public.transportadora_vinculos tv
      on public.normalizar_nome_transportadora(tv.nome_cte)
       = public.normalizar_nome_transportadora(rlc.transportadora)
    where coalesce(nullif(btrim(rlc.canal), ''), 'A DEFINIR') = 'A DEFINIR'
      and (p_nomes_cte is null
           or public.normalizar_nome_transportadora(rlc.transportadora) = any(
               select public.normalizar_nome_transportadora(n) from unnest(p_nomes_cte) n
             ))

    union

    select distinct
      tr.transportadora,
      public.normalizar_nome_transportadora(tr.transportadora) as transportadora_normalizada
    from public.tracking_rows tr
    join public.transportadora_vinculos tv
      on public.normalizar_nome_transportadora(tv.nome_cte)
       = public.normalizar_nome_transportadora(tr.transportadora)
    where coalesce(nullif(btrim(tr.canal), ''), 'A DEFINIR') = 'A DEFINIR'
      and (p_nomes_cte is null
           or public.normalizar_nome_transportadora(tr.transportadora) = any(
               select public.normalizar_nome_transportadora(n) from unnest(p_nomes_cte) n
             ))
  loop
    v_canal := public.resolver_canal_transportadora(v_rec.transportadora, null);
    continue when v_canal = 'A DEFINIR' or v_canal is null;

    -- Atualiza CT-es
    update public.realizado_local_ctes
    set
      canal_original = coalesce(nullif(btrim(canal_original), ''), canal),
      canal = v_canal
    where public.normalizar_nome_transportadora(transportadora) = v_rec.transportadora_normalizada
      and coalesce(nullif(btrim(canal), ''), 'A DEFINIR') = 'A DEFINIR';
    v_ctes := v_ctes + (select count(*) from (
      select 1 from public.realizado_local_ctes
      where public.normalizar_nome_transportadora(transportadora) = v_rec.transportadora_normalizada
        and canal = v_canal
    ) x);

    -- Atualiza Tracking
    update public.tracking_rows
    set
      canal_original = coalesce(nullif(btrim(canal_original), ''), canal),
      canal = v_canal
    where public.normalizar_nome_transportadora(transportadora) = v_rec.transportadora_normalizada
      and coalesce(nullif(btrim(canal), ''), 'A DEFINIR') = 'A DEFINIR';

  end loop;

  return jsonb_build_object('ok', true, 'ctes_atualizados', v_ctes);
end;
$$;

-- ─── 2. Rodar batch uma vez agora (limpa estado atual) ───────────────────────
do $$
declare v jsonb;
begin
  select public.resolver_canal_por_vinculos_batch(null) into v;
  raise notice 'Batch executado: %', v;
end;
$$;

-- ─── 3. Recriar view com motivo correto ───────────────────────────────────────
create or replace view public.pendencias_canal_transportadora
with (security_invoker = true) as
with base as (
  select 'CT-e'::text as base, transportadora,
    public.normalizar_nome_transportadora(transportadora) as transportadora_normalizada,
    canal_original, data_emissao::date as data_ocorrencia,
    1::numeric as qtd_cte, 0::numeric as qtd_tracking,
    coalesce(valor_cte,0)::numeric as valor_cte,
    coalesce(valor_nf,0)::numeric  as valor_nf,
    coalesce(peso,0)::numeric      as peso
  from public.realizado_local_ctes
  where coalesce(nullif(btrim(canal),''),'A DEFINIR') = 'A DEFINIR'

  union all

  select 'Tracking'::text as base, transportadora,
    public.normalizar_nome_transportadora(transportadora) as transportadora_normalizada,
    canal_original, data::date as data_ocorrencia,
    0::numeric as qtd_cte, 1::numeric as qtd_tracking,
    coalesce(valor_cte,0)::numeric as valor_cte,
    0::numeric as valor_nf,
    coalesce(peso,0)::numeric as peso
  from public.tracking_rows
  where coalesce(nullif(btrim(canal),''),'A DEFINIR') = 'A DEFINIR'
),
com_vinculo as (
  select distinct public.normalizar_nome_transportadora(nome_cte) as transportadora_normalizada
  from public.transportadora_vinculos
  where nullif(btrim(nome_cte),'') is not null
)
select
  b.transportadora,
  b.transportadora_normalizada,
  max(b.canal_original) filter (where nullif(btrim(b.canal_original),'') is not null) as canal_original,
  case
    when cv.transportadora_normalizada is not null
      then 'Vinculo cadastrado — canal nao encontrado nas origens da tabela'
    else
      'Sem tabela/vinculo cadastrado'
  end                                as motivo,
  count(*)::bigint                   as quantidade_total,
  sum(b.qtd_cte)::bigint             as quantidade_ctes,
  sum(b.qtd_tracking)::bigint        as quantidade_tracking,
  sum(b.valor_cte)::numeric          as valor_total_cte,
  sum(b.valor_nf)::numeric           as valor_total_nf,
  sum(b.peso)::numeric               as peso_total,
  min(b.data_ocorrencia)             as primeira_ocorrencia,
  max(b.data_ocorrencia)             as ultima_ocorrencia,
  string_agg(distinct b.base, ', ' order by b.base) as bases_afetadas
from base b
left join com_vinculo cv on cv.transportadora_normalizada = b.transportadora_normalizada
where b.transportadora_normalizada is not null
group by b.transportadora, b.transportadora_normalizada, cv.transportadora_normalizada
order by quantidade_total desc;
