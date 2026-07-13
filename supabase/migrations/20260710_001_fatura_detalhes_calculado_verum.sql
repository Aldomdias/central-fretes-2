-- Preserva o valor "Calculado Frete" que já vem no arquivo Verum importado,
-- separado do valor calculado pelo motor AMD (calculado_frete). Antes, a
-- reauditoria sobrescrevia calculado_frete com o AMD e perdia o Verum original.
alter table if exists public.fatura_detalhes
  add column if not exists calculado_frete_verum numeric,
  add column if not exists diferenca_verum numeric;
