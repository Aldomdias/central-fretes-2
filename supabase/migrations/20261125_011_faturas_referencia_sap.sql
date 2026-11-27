-- Referencia manual da fatura no SAP: quando a "Referência" lancada no SAP ficou diferente do numero
-- da fatura (ex.: fatura 1225 lancada como 12225), o auditor informa aqui o numero usado no SAP e a
-- conciliacao do relatorio de pagamentos (e o vinculo manual) passam a casar por ele tambem.
alter table public.faturas add column if not exists referencia_sap text;
alter table public.faturas add column if not exists referencia_sap_por text;
alter table public.faturas add column if not exists referencia_sap_em timestamptz;

create index if not exists faturas_referencia_sap_idx on public.faturas (upper(referencia_sap)) where referencia_sap is not null;
