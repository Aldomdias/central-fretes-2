-- Controle do envio de faturas para antecipação (Diagnóstico, transportadoras com antecipação).
--
-- O usuário marca as faturas que enviou para antecipação; elas saem de "Aptas" e ficam em
-- "Enviadas para antecipação" até o SAP trazer a atribuição "Cessão" (aí vão para "Já antecipadas").

alter table public.faturas
  add column if not exists antecipacao_enviada boolean not null default false,
  add column if not exists antecipacao_enviada_em timestamptz,
  add column if not exists antecipacao_enviada_por text;

notify pgrst, 'reload schema';
