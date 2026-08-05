-- Vínculo manual entre a transportadora da negociação e o(s) nome(s) exatos
-- usados em realizado_local_ctes, pra tela Negociações > Savings pós-aprovação.
-- Sem isso, o casamento por nome (ilike parcial) pode não achar a transportadora
-- quando o nome cadastrado na negociação difere do nome usado no realizado.
alter table public.tabelas_negociacao
  add column if not exists vinculo_transportadoras_saving text[];

comment on column public.tabelas_negociacao.vinculo_transportadoras_saving is
  'Nomes exatos de transportadora em realizado_local_ctes vinculados manualmente para o cálculo de saving pós-aprovação.';
