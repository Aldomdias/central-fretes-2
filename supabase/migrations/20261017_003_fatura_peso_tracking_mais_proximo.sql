-- Fatura: ao recalcular, usar o peso do Tracking quando o resultado ficar mais proximo do valor cobrado
-- (cada CT-e e calculado com o peso do CT-e e com o do Tracking).
alter table public.faturas
  add column if not exists peso_tracking_mais_proximo boolean not null default false;
