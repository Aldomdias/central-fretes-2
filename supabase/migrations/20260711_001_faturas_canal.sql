-- Canal (ATACADO/B2C/etc) detectado a partir dos CT-es vinculados à fatura.
-- Preenchido pela ação "Detectar canais" (não vem no arquivo Verum).
alter table if exists public.faturas
  add column if not exists canal text;
