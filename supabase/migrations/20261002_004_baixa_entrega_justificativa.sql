-- Justificativa do auditor ao enviar a baixa de entrega em massa para a gestao.
-- A decisao da gestao (quem, quando, observacao) ja fica nas colunas decidido_por / decidido_em / observacao.

alter table public.entrega_baixas_manuais add column if not exists justificativa text;
