-- Autorizacoes Lotacao: excedente de CT-e de lotacao (passou do saldo da DIST no
-- fluxo de cargas) vai para a mesma fila de autorizacao do B2C/Atacado, com um
-- quarto "canal": LOTACAO. A Operacao Lotacao autoriza; o valor autorizado soma ao
-- calculado do CT-e na fatura (carregarSaldosAutorizadosPorChave), liberando o custo.
--
-- Pre-requisito: 20260924_002_transporte_autorizacoes_suprimentos.sql ja aplicada.

alter table public.transporte_autorizacoes
  drop constraint if exists transporte_autorizacoes_canal_check;

alter table public.transporte_autorizacoes
  add constraint transporte_autorizacoes_canal_check
  check (canal in ('B2C', 'ATACADO', 'SUPRIMENTOS', 'LOTACAO'));
