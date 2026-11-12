-- Transferencia entre unidades: contingencia manual do auditor.
-- O automatico identifica a transferencia pelo CNPJ (remetente e destinatario
-- empresas do grupo -> tabela alternativa TRANSFERENCIA da transportadora).
-- Quando o CNPJ do destinatario nao esta disponivel, o auditor marca o CT-e na
-- fatura e o Recalcular / robo auditor passam a usar a tabela TRANSFERENCIA.
alter table if exists public.fatura_detalhes
  add column if not exists transferencia_manual boolean default false;
