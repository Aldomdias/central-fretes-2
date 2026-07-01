-- Adiciona taxa_emergencial na tabela de generalidades (Transportadoras)
ALTER TABLE generalidades
  ADD COLUMN IF NOT EXISTS taxa_emergencial numeric;
