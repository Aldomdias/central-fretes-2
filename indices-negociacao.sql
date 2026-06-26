-- Índices para evitar timeout ao carregar a malha das negociações no Simulador.
-- Seguro e aditivo: cria índice, NÃO altera/apaga nenhuma linha. Pode rodar a
-- qualquer momento no SQL Editor do Supabase. Rodar uma vez só.
--
-- Por que: o "Atualizar negociação" lê todos os itens/taxas de uma negociação
-- filtrando por tabela_negociacao_id e ordenando por id (paginação keyset).
-- Sem um índice composto, o Postgres varre muitas linhas por página e pode
-- estourar o statement_timeout ("canceling statement due to statement timeout").
-- Com o índice abaixo, cada página vira um seek direto e fica leve.

create index if not exists idx_tni_tabela_id
  on tabelas_negociacao_itens (tabela_negociacao_id, id);

create index if not exists idx_tntd_tabela_id
  on tabelas_negociacao_taxas_destino (tabela_negociacao_id, id);
