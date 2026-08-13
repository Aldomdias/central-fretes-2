-- A fatura ja tem data_pagamento; falta o numero da partida (documento de
-- compensacao real, "Lançto.compensação" no SAP) pra o auditor ver na propria
-- tela da fatura, sem precisar abrir a aba Pagamentos.
alter table if exists public.faturas
  add column if not exists partida text;
