-- Restaura o ADV (ad_val / ad_val_minimo) e GRIS por destino das origens da
-- ATUAL CARGAS que foram sobrescritas pela replicacao das taxas de Balsas
-- (Balsas nao tem ADV por destino). Usa o backup criado pelo script
-- APLICAR_replicar_taxas_balsas_atual_cargas.sql. Balsas nao e alterada.
-- Casa por (origem_id, ibge_destino); so preenche onde o backup tinha valor.

begin;

-- Conferencia ANTES: quantas linhas de cada origem tem ADV preenchido
select o.cidade, o.canal,
       count(*) filter (where te.ad_val is not null) as com_adv_antes
from public.origens o
join public.taxas_especiais te on te.origem_id = o.id
where o.transportadora_id = '4de220f6-81db-48b5-8935-6bec93d4b0b5'
group by o.cidade, o.canal
order by o.cidade, o.canal;

update public.taxas_especiais te
set ad_val        = coalesce(bk.ad_val, te.ad_val),
    ad_val_minimo = coalesce(bk.ad_val_minimo, te.ad_val_minimo),
    gris          = coalesce(bk.gris, te.gris),
    gris_minimo   = coalesce(bk.gris_minimo, te.gris_minimo)
from (
  select distinct on (origem_id, ibge_destino)
         origem_id, ibge_destino, ad_val, ad_val_minimo, gris, gris_minimo
  from public.taxas_especiais_bkp_atual_cargas_20260929
  order by origem_id, ibge_destino, ad_val desc nulls last
) bk
where bk.origem_id = te.origem_id
  and bk.ibge_destino = te.ibge_destino
  and te.origem_id <> 'f546199b-0a6e-4f52-8716-ae6c8e761c81';

-- Conferencia DEPOIS
select o.cidade, o.canal,
       count(*) filter (where te.ad_val is not null) as com_adv_depois,
       count(*) as total
from public.origens o
join public.taxas_especiais te on te.origem_id = o.id
where o.transportadora_id = '4de220f6-81db-48b5-8935-6bec93d4b0b5'
group by o.cidade, o.canal
order by o.cidade, o.canal;

commit;
