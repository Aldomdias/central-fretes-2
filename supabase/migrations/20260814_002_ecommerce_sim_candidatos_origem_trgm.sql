-- A busca "quais pedidos tem o codigo X em cds_com_saldo_venda" usa ILIKE '%codigo%'
-- (aplicarFiltrosEcommerce, filtro cdCodigos) - sem indice, isso forca varredura
-- completa da tabela ecommerce_order_snapshot a cada chamada (uma por pagina, por
-- origem, e de novo em cada retry), o que estava causando timeout em origens que
-- precisam de mais de uma pagina. pg_trgm com indice GIN deixa ILIKE com wildcard
-- nas duas pontas usar indice de verdade.
create extension if not exists pg_trgm;

create index if not exists idx_ecommerce_order_snapshot_cds_saldo_trgm
  on ecommerce_order_snapshot using gin (cds_com_saldo_venda gin_trgm_ops);

-- A resimulacao por origem consulta rotas filtrando origem_id + ibge_destino juntos
-- (so a malha da origem processada, so pros destinos da pagina de pedidos atual). Hoje
-- so existem indices separados pra cada coluna (idx_rotas_origem_id, idx_rotas_ibge_destino),
-- entao o Postgres precisa combinar os dois (BitmapAnd) ou escolher um so e filtrar o
-- resto na mao - instavel, gerando timeouts intermitentes (viu 2min numa consulta e 27s
-- numa parecida). Um indice composto cobre esse filtro diretamente.
create index if not exists idx_rotas_origem_destino
  on rotas (origem_id, ibge_destino);
