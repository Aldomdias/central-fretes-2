-- A importacao de CT-es ja le "Nota Fiscal"/"NF Numero"/"Chave NF" da
-- planilha (ver src/utils/realizadoCtes.js), mas a tabela final nunca teve
-- coluna pra guardar isso - o dado era descartado na promocao da tabela
-- temporaria (realizado_ctes_import_tmp) pra cá. Necessario pro DOCCOB EDI
-- (registro 354/CNF) conseguir preencher numero da NF e o CNPJ do emissor
-- (extraido da chave da NF) sem digitacao manual.

alter table public.realizado_local_ctes
  add column if not exists nota_fiscal text,
  add column if not exists chave_nfe text,
  add column if not exists documento_remetente text;

comment on column public.realizado_local_ctes.nota_fiscal is 'Numero da nota fiscal vinculada ao CT-e (da planilha de importacao, aba Registros ou Notas Fiscais).';
comment on column public.realizado_local_ctes.chave_nfe is 'Chave de acesso da NF-e (44 digitos) vinculada ao CT-e, quando informada na importacao.';
comment on column public.realizado_local_ctes.documento_remetente is 'CNPJ de quem emitiu a nota fiscal (Remetente) - usado como CGC emissor no DOCCOB EDI.';

create index if not exists idx_realizado_local_ctes_chave_nfe
  on public.realizado_local_ctes (chave_nfe)
  where chave_nfe is not null;
