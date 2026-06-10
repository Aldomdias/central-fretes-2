-- Demanda 4.37 — Gestão de Tabelas de Negociação
-- Campos de rastreabilidade e fluxo de aprovação (compatível com dados legados)

alter table if exists public.tabelas_negociacao
  add column if not exists criado_por text,
  add column if not exists criado_por_nome text,
  add column if not exists negociador_id text,
  add column if not exists negociador_nome text,
  add column if not exists aprovador_id text,
  add column if not exists aprovador_nome text,
  add column if not exists status_gestao text,
  add column if not exists status_aprovacao text,
  add column if not exists aprovado_em timestamptz,
  add column if not exists publicado_em timestamptz,
  add column if not exists enviado_aprovacao_em timestamptz,
  add column if not exists historico_gestao jsonb default '[]'::jsonb;

create index if not exists idx_tabelas_negociacao_status_gestao
  on public.tabelas_negociacao (status_gestao);

create index if not exists idx_tabelas_negociacao_negociador_id
  on public.tabelas_negociacao (negociador_id);

create index if not exists idx_tabelas_negociacao_status_aprovacao
  on public.tabelas_negociacao (status_aprovacao);

-- Migra status legado para status_gestao quando vazio
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'tabelas_negociacao'
  ) then
    update public.tabelas_negociacao
       set status_gestao = case upper(coalesce(status, ''))
         when 'EM NEGOCIAÇÃO' then 'EM_NEGOCIACAO'
         when 'EM TESTE' then 'EM_ANALISE'
         when 'APROVADA' then 'APROVADA_GESTOR'
         when 'REPROVADA' then 'RECUSADA'
         when 'PROMOVIDA PARA OFICIAL' then 'PUBLICADA_OFICIAL'
         when 'CANCELADA' then 'CANCELADA'
         else coalesce(status_gestao, 'EM_NEGOCIACAO')
       end
     where status_gestao is null or status_gestao = '';
  end if;
end $$;
