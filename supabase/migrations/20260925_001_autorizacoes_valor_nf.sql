-- Valor da NF nas autorizacoes de transporte/suprimentos: quem decide precisa ver
-- o peso do frete sobre a nota (% atual x % com o adicional cobrado).
alter table public.transporte_autorizacoes
  add column if not exists valor_nf numeric(14,2) default 0;
