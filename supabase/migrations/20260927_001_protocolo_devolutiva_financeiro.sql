-- Devolutiva do time do Financeiro (externo a auditoria) sobre cada protocolo
-- do lote fechado: pago (com data) ou com problema (com descricao).

alter table public.financeiro_protocolos add column if not exists status_pagamento      text not null default 'ABERTO'; -- ABERTO | PAGO | PROBLEMA
alter table public.financeiro_protocolos add column if not exists pago_em               timestamptz;
alter table public.financeiro_protocolos add column if not exists problema_descricao    text;
alter table public.financeiro_protocolos add column if not exists devolutiva_por        text;
alter table public.financeiro_protocolos add column if not exists devolutiva_em         timestamptz;
