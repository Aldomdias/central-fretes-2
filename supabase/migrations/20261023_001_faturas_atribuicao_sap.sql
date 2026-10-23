-- Coluna "Atribuição" do relatorio SAP (Exportação SAPUI5) gravada na fatura.
-- "Cessão" = fatura em antecipação: sai de "Aguardando boleto" e vai para o card "Em antecipação"
-- ate o pagamento (partida 200 / status PAGA).
alter table public.faturas add column if not exists atribuicao_sap text;
alter table public.faturas add column if not exists atribuicao_sap_em timestamptz;

create index if not exists faturas_atribuicao_sap_idx on public.faturas (atribuicao_sap) where atribuicao_sap is not null;
