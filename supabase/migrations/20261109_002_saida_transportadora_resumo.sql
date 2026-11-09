-- Saída de transportadora: lista as transportadoras do período SEM baixar os
-- CT-es. A tela escolhe a transportadora por esta lista e só depois busca os
-- CT-es dela (antes baixava o mês inteiro de todas para montar o seletor).
--
-- Agrupa também por tomador/CNPJ do tomador para o cliente aplicar a mesma
-- política de base do Simulador do realizado (tomadores aceitos, sem EBAZAR,
-- CPS LOG e CP COMERCIAL) e chegar às mesmas contagens. A raiz do CNPJ do
-- emitente (posições 7-14 da chave do CT-e) permite unificar
-- nomes diferentes da mesma empresa.
--
-- Período: data_emissao >= p_inicio e < p_fim_exclusivo (o último dia entra
-- inteiro). p_canal segue o filtro da tela (texto contido em canal/canal_original).

create or replace function public.saida_transportadora_resumo(
  p_inicio date,
  p_fim_exclusivo date,
  p_canal text default null
)
returns table (
  transportadora text,
  raiz_cnpj text,
  tomador_servico text,
  cnpj_tomador text,
  ctes bigint,
  valor_cte numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      r.transportadora,
      r.tomador_servico,
      r.cnpj_tomador,
      regexp_replace(coalesce(r.chave_cte, ''), '\D', '', 'g') as chave_dig,
      coalesce(r.valor_cte, 0) as valor_cte
    from public.realizado_local_ctes r
    where r.data_emissao >= p_inicio
      and r.data_emissao < p_fim_exclusivo
      and nullif(trim(coalesce(r.transportadora, '')), '') is not null
      and (
        nullif(trim(coalesce(p_canal, '')), '') is null
        or r.canal_original ilike '%' || p_canal || '%'
        or r.canal ilike '%' || p_canal || '%'
      )
  )
  select
    b.transportadora,
    case
      when length(b.chave_dig) = 44 then substring(b.chave_dig from 7 for 8)
      else ''
    end as raiz_cnpj,
    b.tomador_servico,
    b.cnpj_tomador,
    count(*)::bigint as ctes,
    sum(b.valor_cte)::numeric as valor_cte
  from base b
  group by 1, 2, 3, 4
  order by 1, 2, 3, 4;
$$;

grant execute on function public.saida_transportadora_resumo(date, date, text) to anon, authenticated;

notify pgrst, 'reload schema';
