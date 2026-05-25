-- Evolucao do modulo Tabelas em Negociacao.
-- Nao altera RLS/policies. Execute no SQL Editor/Supabase CLI antes de usar os novos campos.

alter table if exists public.tabelas_negociacao
  add column if not exists tipo_negociacao text default 'NOVA_TABELA',
  add column if not exists transportadora_base_id text,
  add column if not exists transportadora_base_nome text,
  add column if not exists tabela_base_id text,
  add column if not exists modalidade text,
  add column if not exists comparar_com_proprio_realizado boolean default false,
  add column if not exists periodo_realizado_inicio date,
  add column if not exists periodo_realizado_fim date,
  add column if not exists valor_atual_realizado numeric default 0,
  add column if not exists valor_simulado_nova_tabela numeric default 0,
  add column if not exists impacto_valor numeric default 0,
  add column if not exists impacto_percentual numeric default 0,
  add column if not exists impacto_mensal numeric default 0,
  add column if not exists impacto_anual numeric default 0,
  add column if not exists frete_percentual_nf_atual numeric default 0,
  add column if not exists frete_percentual_nf_simulado numeric default 0,
  add column if not exists qtd_registros_analisados integer default 0,
  add column if not exists qtd_registros_com_tabela integer default 0,
  add column if not exists resultado_simulacao_json jsonb default '{}'::jsonb,
  add column if not exists tipo_tabela_negociacao text,
  add column if not exists data_aprovacao timestamptz,
  add column if not exists usuario_aprovacao text,
  add column if not exists data_inicio_vigencia date,
  add column if not exists observacao_aprovacao text,
  add column if not exists tabela_anterior_id text,
  add column if not exists tabela_anterior_snapshot jsonb,
  add column if not exists nova_tabela_aprovada_snapshot jsonb,
  add column if not exists percentual_medio_impacto numeric default 0,
  add column if not exists tipo_veiculo text;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'tabelas_negociacao'
  ) then
    update public.tabelas_negociacao
       set tipo_negociacao = case
         when upper(coalesce(tipo_tabela, '')) = 'LOTACAO' then 'TABELA_LOTACAO'
         when tipo_negociacao is null or tipo_negociacao = '' then 'NOVA_TABELA'
         else tipo_negociacao
       end,
       transportadora_base_nome = case
         when coalesce(tipo_negociacao, '') = 'REAJUSTE_TABELA_EXISTENTE'
           then coalesce(nullif(transportadora_base_nome, ''), transportadora)
         else transportadora_base_nome
       end
     where tipo_negociacao is null
        or tipo_negociacao = ''
        or transportadora_base_nome is null
        or transportadora_base_nome = '';
  end if;
end $$;

alter table if exists public.tabelas_negociacao
  drop constraint if exists tabelas_negociacao_tipo_negociacao_check;

alter table if exists public.tabelas_negociacao
  add constraint tabelas_negociacao_tipo_negociacao_check
  check (tipo_negociacao in ('NOVA_TABELA', 'REAJUSTE_TABELA_EXISTENTE', 'TABELA_LOTACAO'));

create index if not exists idx_tabelas_negociacao_tipo_negociacao
  on public.tabelas_negociacao (tipo_negociacao);

create index if not exists idx_tabelas_negociacao_transportadora_base_nome
  on public.tabelas_negociacao (transportadora_base_nome);

create index if not exists idx_tabelas_negociacao_periodo_realizado
  on public.tabelas_negociacao (periodo_realizado_inicio, periodo_realizado_fim);

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'lotacao_tabelas'
  ) then
    alter table public.lotacao_tabelas
      add column if not exists tabela_negociacao_id text;

    create index if not exists idx_lotacao_tabelas_tabela_negociacao_id
      on public.lotacao_tabelas (tabela_negociacao_id);
  end if;
end $$;
