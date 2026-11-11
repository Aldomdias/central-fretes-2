-- Tela Diagnostico: marcar como CANCELADA a fatura que a transportadora cancelou
-- (ex.: vencida ha meses que nao existe mais). A fatura continua na plataforma,
-- mas sai das pendencias (em aberto/vencidas). Guarda o status anterior para
-- permitir desfazer, e quem/quando/por que cancelou.

alter table if exists public.faturas
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por text,
  add column if not exists cancelamento_motivo text,
  add column if not exists status_antes_cancelamento text;
