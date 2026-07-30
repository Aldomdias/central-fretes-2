-- Reprocessa o canal de TODOS os registros (nao so os "A DEFINIR") usando
-- public.resolver_canal_transportadora, que prioriza a parametrizacao manual
-- (canal_transportadora_parametrizacoes) sobre o vinculo/tabela de origem.
-- Uso: depois de corrigir manualmente uma transportadora que hoje aparece com
-- canal errado (ex.: veio B2C/ATACADO por vinculo mas deveria ser
-- INTERCOMPANY), rode esta funcao pra reaplicar a regra em todo o historico.
create or replace function public.recalcular_canal_transportadora()
returns jsonb
language plpgsql
as $$
declare
  v_ctes integer := 0;
  v_tracking integer := 0;
begin
  update public.realizado_local_ctes
     set canal = public.resolver_canal_transportadora(transportadora, coalesce(nullif(canal_original, ''), canal));
  get diagnostics v_ctes = row_count;

  update public.tracking_rows
     set canal = public.resolver_canal_transportadora(transportadora, coalesce(nullif(canal_original, ''), canal));
  get diagnostics v_tracking = row_count;

  return jsonb_build_object('ok', true, 'ctes_atualizados', v_ctes, 'tracking_atualizados', v_tracking);
end;
$$;
