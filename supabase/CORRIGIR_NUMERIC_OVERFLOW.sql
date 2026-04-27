-- CORRIGIR NUMERIC FIELD OVERFLOW NA IMPORTAÇÃO DE FRETES/COTAÇÕES
-- Rode no Supabase > SQL Editor.
-- Motivo: faixas como 100 a 999999999 podem estourar colunas numeric com precisão pequena.

alter table public.cotacoes
  alter column peso_min type numeric(18,4) using peso_min::numeric(18,4),
  alter column peso_max type numeric(18,4) using peso_max::numeric(18,4),
  alter column rs_kg type numeric(18,6) using rs_kg::numeric(18,6),
  alter column excesso type numeric(18,6) using excesso::numeric(18,6),
  alter column percentual type numeric(18,6) using percentual::numeric(18,6),
  alter column valor_fixo type numeric(18,6) using valor_fixo::numeric(18,6);

-- Opcional, mas recomendado para evitar estouro parecido em rotas/taxas/generalidades:
alter table public.rotas
  alter column valor_minimo_frete type numeric(18,6) using valor_minimo_frete::numeric(18,6);

alter table public.generalidades
  alter column aliquota_icms type numeric(18,6) using aliquota_icms::numeric(18,6),
  alter column ad_valorem type numeric(18,6) using ad_valorem::numeric(18,6),
  alter column ad_valorem_minimo type numeric(18,6) using ad_valorem_minimo::numeric(18,6),
  alter column pedagio type numeric(18,6) using pedagio::numeric(18,6),
  alter column gris type numeric(18,6) using gris::numeric(18,6),
  alter column gris_minimo type numeric(18,6) using gris_minimo::numeric(18,6),
  alter column tas type numeric(18,6) using tas::numeric(18,6),
  alter column ctrc type numeric(18,6) using ctrc::numeric(18,6),
  alter column frete_minimo type numeric(18,6) using frete_minimo::numeric(18,6);

alter table public.taxas_especiais
  alter column tda type numeric(18,6) using tda::numeric(18,6),
  alter column tdr type numeric(18,6) using tdr::numeric(18,6),
  alter column trt type numeric(18,6) using trt::numeric(18,6),
  alter column suframa type numeric(18,6) using suframa::numeric(18,6),
  alter column outras type numeric(18,6) using outras::numeric(18,6),
  alter column gris type numeric(18,6) using gris::numeric(18,6),
  alter column gris_minimo type numeric(18,6) using gris_minimo::numeric(18,6),
  alter column ad_val type numeric(18,6) using ad_val::numeric(18,6),
  alter column ad_val_minimo type numeric(18,6) using ad_val_minimo::numeric(18,6);

-- Conferência rápida:
select 'cotacoes' as tabela, count(*) as registros from public.cotacoes;
