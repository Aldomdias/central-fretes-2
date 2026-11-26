-- Detalhe de cada rodada do robo de boletos por pasta (scripts/robo-boletos-pasta.mjs): listas de guardados,
-- para revisar, sem fatura e avisos de desconto, mostradas no card Automacao > Robo de boletos.
alter table public.boleto_pasta_leituras add column if not exists detalhe jsonb;

create index if not exists idx_boleto_pasta_leituras_origem on public.boleto_pasta_leituras(origem, created_at desc);
