-- Cache do "Confirmar por tabela": resultado da simulação CT-e a CT-e contra a
-- malha oficial, usado pra validar rotas negativas/sem histórico do saving
-- pós-aprovação. Guardado por chave (rota+faixa[+competência], ou "GERAL"
-- para a negociação inteira) num JSON, igual ao padrão de
-- saving_pos_aprovacao_detalhe — assim sobrevive a um F5 e fica visível pra
-- quem mais abrir a tela.
alter table public.tabelas_negociacao
  add column if not exists confirmacao_tabela_saving jsonb;

comment on column public.tabelas_negociacao.confirmacao_tabela_saving is
  'Cache dos resultados de "Confirmar por tabela" (simulação contra a malha oficial), por chave rota+faixa[+competência] ou GERAL para a negociação inteira.';
