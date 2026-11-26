-- Baixa de saneamento (Diagnóstico de faturas): faturas antigas em aberto que não devemos mais
-- (ex.: jan/fev/mar). Marcadas na tela, saem de em aberto, vencidas, totais e laudo e ficam só
-- no card "Baixados". Desmarcar devolve a fatura ao que era antes (o status não é alterado).

alter table public.faturas
  add column if not exists baixada_saneamento boolean not null default false,
  add column if not exists baixada_saneamento_em timestamptz,
  add column if not exists baixada_saneamento_por text,
  add column if not exists baixada_saneamento_motivo text;

notify pgrst, 'reload schema';
