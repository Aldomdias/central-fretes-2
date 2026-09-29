-- Replica as TAXAS ESPECIAIS da origem Balsas (B2C) da ATUAL CARGAS para todas
-- as demais origens da ATUAL CARGAS. Mexe SOMENTE em taxas_especiais
-- (nao toca em generalidades, rotas nem cotacoes).
-- ATENCAO: substitui as taxas atuais das outras origens (backup abaixo).

begin;

-- 1) Backup das taxas que serao substituidas
create table if not exists public.taxas_especiais_bkp_atual_cargas_20260929 as
select te.*
from public.taxas_especiais te
join public.origens o on o.id = te.origem_id
where o.transportadora_id = '4de220f6-81db-48b5-8935-6bec93d4b0b5'
  and te.origem_id <> 'f546199b-0a6e-4f52-8716-ae6c8e761c81';

-- 2) Apaga as taxas das outras origens da ATUAL CARGAS
delete from public.taxas_especiais te
using public.origens o
where o.id = te.origem_id
  and o.transportadora_id = '4de220f6-81db-48b5-8935-6bec93d4b0b5'
  and te.origem_id <> 'f546199b-0a6e-4f52-8716-ae6c8e761c81';

-- 3) Copia as taxas de Balsas para cada uma delas
insert into public.taxas_especiais
  (id, origem_id, ibge_destino, tda, tdr, trt, suframa, outras,
   gris, gris_minimo, ad_val, ad_val_minimo, taxas_extras, extra, payload,
   grupo_tabela_alternativa)
select gen_random_uuid(), o.id, b.ibge_destino, b.tda, b.tdr, b.trt, b.suframa, b.outras,
       b.gris, b.gris_minimo, b.ad_val, b.ad_val_minimo, b.taxas_extras, b.extra, b.payload,
       b.grupo_tabela_alternativa
from public.origens o
cross join public.taxas_especiais b
where o.transportadora_id = '4de220f6-81db-48b5-8935-6bec93d4b0b5'
  and o.id <> 'f546199b-0a6e-4f52-8716-ae6c8e761c81'
  and b.origem_id = 'f546199b-0a6e-4f52-8716-ae6c8e761c81';

-- 4) Conferencia: todas as origens devem ter a mesma contagem de Balsas (1004)
select o.cidade, o.canal, count(te.id) as taxas
from public.origens o
left join public.taxas_especiais te on te.origem_id = o.id
where o.transportadora_id = '4de220f6-81db-48b5-8935-6bec93d4b0b5'
group by o.cidade, o.canal
order by taxas, o.cidade;

commit;
