-- Contestacao da fatura pelo transportador direto no portal (link do laudo):
-- alem de "OK, confirmo", ele pode recusar informando observacao e evidencias
-- (links para provas/comprovantes). Novo valor em confirmacao_transportador_status: CONTESTADO.
alter table public.faturas
  add column if not exists confirmacao_transportador_observacao text,
  add column if not exists confirmacao_transportador_evidencias text;
