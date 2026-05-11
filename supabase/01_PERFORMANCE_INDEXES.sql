-- ============================================================
-- PERFORMANCE: Índices faltantes nas tabelas principais
-- Rode este script UMA VEZ no SQL Editor do Supabase
-- Tempo estimado: 2-10 min dependendo do volume (não bloqueia leitura)
-- ============================================================

-- origens
-- Usado em: carregarTransportadoraCompletaDb, buscarOrigensFiltradasDb
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_origens_transportadora_id
  ON public.origens (transportadora_id);

-- Usado em: buscarOrigensFiltradasDb (ILIKE cidade)
-- text_pattern_ops habilita LIKE/ILIKE com índice (somente prefixo; mas ajuda bastante)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_origens_cidade_lower
  ON public.origens (lower(cidade) text_pattern_ops);

-- Usado em: filtros canal
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_origens_canal
  ON public.origens (canal);

-- Composto: transportadora + canal (busca mais comum no simulador)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_origens_transportadora_canal
  ON public.origens (transportadora_id, canal);

-- ============================================================
-- rotas
-- ============================================================

-- Usado em: fetchRowsByOrigemIds, fetchRotasByOrigemIds (mais chamado do sistema)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rotas_origem_id
  ON public.rotas (origem_id);

-- Usado em: fetchRotasByIbgePairs (simulação por par IBGE)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rotas_ibge_par
  ON public.rotas (ibge_origem, ibge_destino);

-- Usado em: fetchRotasByOrigemIds com filtro IBGE destino
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rotas_origem_ibge_destino
  ON public.rotas (origem_id, ibge_destino);

-- ============================================================
-- cotacoes
-- ============================================================

-- Usado em: fetchRowsByOrigemIds (mais chamado do sistema)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cotacoes_origem_id
  ON public.cotacoes (origem_id);

-- Usado em: fetchCotacoesByOrigemIdsAndRotas (filtro origem + nome rota)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cotacoes_origem_rota
  ON public.cotacoes (origem_id, rota);

-- ============================================================
-- taxas_especiais
-- ============================================================

-- Usado em: fetchRowsByOrigemIds
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_taxas_origem_id
  ON public.taxas_especiais (origem_id);

-- Usado em: fetchTaxasByOrigemIdsAndDestinos
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_taxas_origem_ibge
  ON public.taxas_especiais (origem_id, ibge_destino);

-- ============================================================
-- generalidades
-- ============================================================

-- Usado em: fetchRowsByOrigemIds
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generalidades_origem_id
  ON public.generalidades (origem_id);

-- ============================================================
-- transportadoras
-- ============================================================

-- Usado em: busca por nome (ILIKE)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transportadoras_nome_lower
  ON public.transportadoras (lower(nome) text_pattern_ops);

-- ============================================================
-- realizado_ctes (índice composto para simulação do realizado)
-- ============================================================

-- Filtros mais comuns na tela Realizado CT-e
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_realizado_ctes_filtros_simulacao
  ON public.realizado_ctes (transportadora, canal, cidade_origem, uf_destino);

-- ============================================================
-- Verificar índices criados
-- ============================================================
-- Rode após o script para conferir:
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename IN ('origens','rotas','cotacoes','taxas_especiais','generalidades','transportadoras','realizado_ctes')
-- ORDER BY tablename, indexname;
