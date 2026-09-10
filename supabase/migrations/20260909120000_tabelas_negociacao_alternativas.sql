-- Suporte a tabelas de preço "alternativas" da mesma transportadora+origem
-- (ex.: tabela principal de uso geral / pneus de passeio + tabela alternativa
-- para OTR/fora de estrada, rodas, etc). Aditivo: colunas nulas por padrão,
-- nenhum fluxo existente muda de comportamento.

alter table if exists public.tabelas_negociacao
  add column if not exists tabela_alternativa_de uuid null references public.tabelas_negociacao(id) on delete set null;

alter table if exists public.tabelas_negociacao
  add column if not exists variante_tabela text null;

comment on column public.tabelas_negociacao.tabela_alternativa_de is
  'Quando preenchido, aponta para o id da tabela "principal" (mesma transportadora+origem) da qual esta linha é uma variante alternativa. Nulo = esta linha é ela mesma uma tabela principal (comportamento padrão, sem alternativas).';

comment on column public.tabelas_negociacao.variante_tabela is
  'Rótulo livre da variante quando tabela_alternativa_de está preenchido (ex.: "OTR / Fora de estrada", "Rodas"). Texto livre reutilizável futuramente para casar com descrição de produto do CT-e. Nulo para tabelas principais.';

create index if not exists idx_tabelas_negociacao_tabela_alternativa_de
  on public.tabelas_negociacao (tabela_alternativa_de)
  where tabela_alternativa_de is not null;
