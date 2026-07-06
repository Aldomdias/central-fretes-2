-- Vinculo entre Central de Solicitacoes AMD e negociacoes de tabela.
-- Rode no SQL Editor do Supabase antes de exigir o campo no fluxo.

alter table if exists public.tabelas_negociacao
  add column if not exists numero_amd text,
  add column if not exists solicitacao_amd_id text;

create index if not exists idx_tabelas_negociacao_numero_amd
  on public.tabelas_negociacao (numero_amd);

