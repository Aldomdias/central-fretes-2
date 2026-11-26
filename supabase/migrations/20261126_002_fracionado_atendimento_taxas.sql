-- Portal de cotacao fracionado: taxas por cidade alinhadas ao cadastro de tabelas (taxas especiais por destino + taxas extras mais usadas).
-- tda / trt / suframa seguem nas colunas proprias. As demais (TDA % e minimo, TDR, TRT % e minimo, coleta, entrega,
-- pedagio do destino, SEC/CAT, TRF/redespacho fluvial, seguro fluvial, TZR, adicional de frete, GRIS/ad valorem do destino)
-- ficam em taxas_destino (jsonb, chave -> valor). Lista de chaves: COLS_ATEND_FRACIONADO em api/_fracionadoExcel.mjs.
alter table public.fracionado_atendimento add column if not exists taxas_destino jsonb;
