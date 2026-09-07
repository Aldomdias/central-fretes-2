-- Faixa de CEP opcional por item de negociação. Algumas importações (Verum)
-- trazem várias linhas para o mesmo IBGE de destino que na verdade são faixas
-- de CEP diferentes dentro da mesma cidade/região, com preços distintos. Sem
-- essa coluna essas linhas pareciam duplicadas e o simulador só enxergava a
-- primeira. Colunas nullable: quando vazias, o motor continua casando só por
-- ibge_destino (comportamento atual, 100% dos itens existentes).
alter table public.tabelas_negociacao_itens
  add column if not exists cep_inicial text,
  add column if not exists cep_final text;

comment on column public.tabelas_negociacao_itens.cep_inicial is
  'Início da faixa de CEP do destino, quando a importação distingue por CEP em vez de/além do IBGE. Nulo = casa só por ibge_destino.';
comment on column public.tabelas_negociacao_itens.cep_final is
  'Fim da faixa de CEP do destino. Sempre preenchido junto com cep_inicial.';
