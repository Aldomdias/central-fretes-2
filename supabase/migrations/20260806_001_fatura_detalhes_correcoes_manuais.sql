-- fatura_detalhes nunca ganhou colunas para os ajustes manuais feitos na tela
-- de Auditoria (vinculo manual de NF pelo Tracking, reentrega, correcao de
-- endereco pelo rodape do CT-e, correcao de canal). O upsert em
-- salvarDetalhesFaturaSupabase tolera colunas desconhecidas removendo-as uma a
-- uma (ate 8 tentativas), mas com tantos campos novos o salvamento estourava
-- esse limite e a correcao nunca era persistida — parecia "salvar" na tela
-- (estado local otimista) mas sumia ao recarregar/recalcular.
alter table if exists public.fatura_detalhes
  add column if not exists canal text,
  add column if not exists cidade_origem text,
  add column if not exists uf_origem text,
  add column if not exists ibge_origem text,
  add column if not exists cidade_destino text,
  add column if not exists uf_destino text,
  add column if not exists ibge_destino text,
  add column if not exists valor_nf numeric(14,2),
  add column if not exists peso numeric(14,3),
  add column if not exists cubagem numeric(14,3),
  add column if not exists qtd_volumes integer,
  add column if not exists chave_nf_manual text,
  add column if not exists chave_nfe_manual text,
  add column if not exists tracking_manual_nf boolean default false,
  add column if not exists reentrega_manual boolean default false,
  add column if not exists endereco_corrigido_manual boolean default false,
  add column if not exists justificativa_correcao_endereco text,
  add column if not exists canal_corrigido_manual boolean default false,
  add column if not exists justificativa_correcao_canal text,
  add column if not exists canal_corrigido_por text,
  add column if not exists canal_corrigido_em timestamptz,
  add column if not exists detalhes_calculo jsonb;
