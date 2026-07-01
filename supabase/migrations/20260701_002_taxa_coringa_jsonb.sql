-- Substitui os 4 campos fixos por array JSONB, suportando N coringas por destino.
-- Migra dados existentes antes de dropar as colunas antigas.

-- 1) tabelas_negociacao_taxas_destino
ALTER TABLE tabelas_negociacao_taxas_destino
  ADD COLUMN IF NOT EXISTS taxas_extras jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE tabelas_negociacao_taxas_destino
SET taxas_extras = jsonb_build_array(jsonb_build_object(
  'nome',  COALESCE(taxa_extra_nome, ''),
  'valor', COALESCE(taxa_extra_valor, 0),
  'pct',   COALESCE(taxa_extra_pct,   0),
  'min',   COALESCE(taxa_extra_min,   0)
))
WHERE taxa_extra_nome IS NOT NULL AND taxa_extra_nome <> '';

ALTER TABLE tabelas_negociacao_taxas_destino
  DROP COLUMN IF EXISTS taxa_extra_nome,
  DROP COLUMN IF EXISTS taxa_extra_valor,
  DROP COLUMN IF EXISTS taxa_extra_pct,
  DROP COLUMN IF EXISTS taxa_extra_min;

-- 2) taxas_especiais
ALTER TABLE taxas_especiais
  ADD COLUMN IF NOT EXISTS taxas_extras jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE taxas_especiais
SET taxas_extras = jsonb_build_array(jsonb_build_object(
  'nome',  COALESCE(taxa_extra_nome, ''),
  'valor', COALESCE(taxa_extra_valor, 0),
  'pct',   COALESCE(taxa_extra_pct,   0),
  'min',   COALESCE(taxa_extra_min,   0)
))
WHERE taxa_extra_nome IS NOT NULL AND taxa_extra_nome <> '';

ALTER TABLE taxas_especiais
  DROP COLUMN IF EXISTS taxa_extra_nome,
  DROP COLUMN IF EXISTS taxa_extra_valor,
  DROP COLUMN IF EXISTS taxa_extra_pct,
  DROP COLUMN IF EXISTS taxa_extra_min;
