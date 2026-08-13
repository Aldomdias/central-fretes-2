-- Marca na propria fatura quando ela ja foi lancada/reclassificada no
-- financeiro (documento SAP "190...", nao e' pagamento ainda, so' indica que
-- ja saiu da auditoria e entrou no fluxo financeiro). A data do lancamento
-- (existe mesmo antes de compensar) mostra ha quanto tempo esta parada la.
alter table if exists public.faturas
  add column if not exists lancamento_financeiro text,
  add column if not exists lancamento_financeiro_em date;
