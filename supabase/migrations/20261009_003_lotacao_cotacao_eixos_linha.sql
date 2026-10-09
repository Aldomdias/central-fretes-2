-- Eixos (5 ou 6) por linha da proposta: o transportador define para a tabela inteira
-- e pode ajustar linha a linha. A ANTT usada na comparacao segue o eixo de cada linha.
alter table public.lotacao_cotacao_propostas
  add column if not exists eixos integer not null default 5;
