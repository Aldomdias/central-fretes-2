-- Migração: base de comparação entre rodadas de simulação
-- Objetivo: permitir que o sistema armazene o snapshot da base de CT-es da primeira
-- simulação de cada negociação, garantindo comparabilidade entre rodadas.
--
-- Executar no Supabase SQL Editor antes de fazer deploy do código.

-- 1. Coluna que guarda a base de referência (snapshot da 1ª simulação)
ALTER TABLE tabelas_negociacao
  ADD COLUMN IF NOT EXISTS base_comparacao_inicial jsonb DEFAULT NULL;

-- 2. Índice parcial para facilitar queries de negociações que já têm snapshot
CREATE INDEX IF NOT EXISTS idx_tabelas_negociacao_tem_base_comparacao
  ON tabelas_negociacao ((base_comparacao_inicial IS NOT NULL));

-- Estrutura esperada do jsonb em base_comparacao_inicial:
-- {
--   "registrada_em": "2026-05-26T12:00:00.000Z",
--   "rodada": 1,
--   "ctes_brutos": 1200,
--   "ctes_na_malha": 900,
--   "ctes_analisados": 850,
--   "frete_realizado": 115000.00,
--   "valor_nf": 1450000.00,
--   "filtros": {
--     "inicio": "2026-01-01",
--     "fim": "2026-04-30",
--     "canal": "ATACADO",
--     "origem": "ITAJAI",
--     "ufDestino": ["SP","RJ","MG"]
--   }
-- }
