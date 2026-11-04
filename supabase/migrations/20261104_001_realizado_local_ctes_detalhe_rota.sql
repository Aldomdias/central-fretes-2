-- Detalhe por rota/transportadora na tela "CT-e - Origem x Destino"
-- (transferencias entre filiais). Colunas opcionais: a tela e a importacao
-- funcionam mesmo antes desta migration rodar (fazem fallback).
alter table public.realizado_local_ctes add column if not exists codigo_transportadora text;
alter table public.realizado_local_ctes add column if not exists cnpj_tomador text;
alter table public.realizado_local_ctes add column if not exists material text;
alter table public.realizado_local_ctes add column if not exists unidade_medida text;

notify pgrst, 'reload schema';
