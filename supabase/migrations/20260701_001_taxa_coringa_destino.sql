-- Taxa coringa (wildcard) por destino — campos opcionais adicionados em dois lugares:
-- 1) tabelas_negociacao_taxas_destino  (negociações)
-- 2) taxas_especiais                   (transportadoras oficiais)
--
-- Lógica de cálculo (freteCalcEngine.js):
--   se taxa_extra_pct > 0  →  max(nf * pct/100, taxa_extra_min)
--   senão se taxa_extra_valor > 0  →  taxa_extra_valor
--   senão  →  0

ALTER TABLE tabelas_negociacao_taxas_destino
  ADD COLUMN IF NOT EXISTS taxa_extra_nome  text,
  ADD COLUMN IF NOT EXISTS taxa_extra_valor numeric,
  ADD COLUMN IF NOT EXISTS taxa_extra_pct   numeric,
  ADD COLUMN IF NOT EXISTS taxa_extra_min   numeric;

ALTER TABLE taxas_especiais
  ADD COLUMN IF NOT EXISTS taxa_extra_nome  text,
  ADD COLUMN IF NOT EXISTS taxa_extra_valor numeric,
  ADD COLUMN IF NOT EXISTS taxa_extra_pct   numeric,
  ADD COLUMN IF NOT EXISTS taxa_extra_min   numeric;
