-- 4.36.2 — Corrige fonte da Avaliação de Prazos e Cobertura
-- Fonte principal: transportadoras/tabelas oficiais cadastradas.
-- Fonte complementar: tabelas em negociação/reajuste, identificadas separadamente.
-- Esta versão mantém a carga via view, para não voltar ao carregamento pesado no navegador.

-- Colunas opcionais usadas pela view. O IF NOT EXISTS evita quebra em bases que ainda não tinham esses campos.
alter table public.transportadoras add column if not exists status text;
alter table public.origens add column if not exists cidade text;
alter table public.origens add column if not exists canal text;
alter table public.origens add column if not exists status text;
alter table public.rotas add column if not exists nome_rota text;
alter table public.rotas add column if not exists ibge_origem text;
alter table public.rotas add column if not exists ibge_destino text;
alter table public.rotas add column if not exists canal text;
alter table public.rotas add column if not exists metodo_envio text;
alter table public.rotas add column if not exists codigo_unidade text;
alter table public.rotas add column if not exists prazo_entrega_dias integer;
alter table public.rotas add column if not exists valor_minimo_frete numeric;
alter table public.rotas add column if not exists extra jsonb default '{}'::jsonb;

create or replace function public.amd_parse_numeric(p_val text)
returns numeric
language sql
immutable
as $$
  with bruto as (
    select regexp_replace(coalesce(p_val, ''), '[^0-9,.-]', '', 'g') as valor
  ), normalizado as (
    select case
      when valor = '' then null
      when valor like '%,%' and valor like '%.%' then replace(replace(valor, '.', ''), ',', '.')
      when valor like '%,%' then replace(valor, ',', '.')
      else valor
    end as valor
    from bruto
  )
  select case
    when valor ~ '^-?[0-9]+(\.[0-9]+)?$' then valor::numeric
    else null
  end
  from normalizado;
$$;

create index if not exists idx_rotas_origem_id
  on public.rotas (origem_id);

create index if not exists idx_rotas_ibge_destino
  on public.rotas (ibge_destino);

create index if not exists idx_rotas_ibge_origem
  on public.rotas (ibge_origem);

create index if not exists idx_origens_transportadora_id
  on public.origens (transportadora_id);

create index if not exists idx_tabelas_negociacao_itens_tipo_item
  on public.tabelas_negociacao_itens ((dados_originais ->> 'tipo_item'));

create index if not exists idx_tabelas_negociacao_itens_tabela_id
  on public.tabelas_negociacao_itens (tabela_negociacao_id);

drop view if exists public.vw_avaliacao_prazos_cobertura;

create view public.vw_avaliacao_prazos_cobertura
with (security_invoker = true)
as
with base_oficial as (
  select
    r.id::text as id,
    null::text as tabela_negociacao_id,
    tr.nome::text as transportadora,
    coalesce(nullif(r.canal, ''), nullif(o.canal, ''), 'N/I') as canal,
    'OFICIAL'::text as tipo_tabela,
    'OFICIAL'::text as tipo_negociacao,
    coalesce(nullif(o.status, ''), nullif(tr.status, ''), 'Ativa') as status,
    concat('Cadastro oficial - ', tr.nome) as tabela_nome,
    'TRANSPORTADORAS_CADASTRADAS'::text as origem_importacao,
    coalesce(
      nullif(r.metodo_envio, ''),
      nullif(r.extra ->> 'metodoEnvio', ''),
      nullif(r.codigo_unidade, ''),
      'N/I'
    ) as modalidade,
    coalesce(
      nullif(mo.nome_municipio, ''),
      nullif(r.extra ->> 'cidadeOrigem', ''),
      nullif(o.cidade, '')
    ) as cidade_origem,
    coalesce(
      nullif(mo.sigla_uf, ''),
      nullif(r.extra ->> 'ufOrigem', '')
    ) as uf_origem,
    nullif(r.ibge_origem::text, '') as ibge_origem,
    coalesce(
      nullif(md.nome_municipio, ''),
      nullif(r.extra ->> 'cidadeDestino', ''),
      nullif(r.nome_rota, '')
    ) as cidade_destino,
    coalesce(
      nullif(md.sigla_uf, ''),
      nullif(r.extra ->> 'ufDestino', '')
    ) as uf_destino,
    nullif(r.ibge_destino::text, '') as ibge_destino,
    coalesce(
      public.amd_parse_numeric(r.prazo_entrega_dias::text)::integer,
      public.amd_parse_numeric(r.extra ->> 'prazoEntregaDias')::integer,
      public.amd_parse_numeric(r.extra ->> 'prazo')::integer,
      0
    ) as prazo,
    coalesce(public.amd_parse_numeric(r.valor_minimo_frete::text), 0) as valor_referencia,
    nullif(r.extra ->> 'observacao', '') as observacao,
    'OFICIAL'::text as fonte_tabela,
    'Oficial / cadastrada'::text as fonte_label,
    1::integer as fonte_prioridade
  from public.rotas r
  join public.origens o
    on o.id = r.origem_id
  join public.transportadoras tr
    on tr.id = o.transportadora_id
  left join public.ibge_municipios md
    on md.codigo_municipio_completo::text = nullif(r.ibge_destino::text, '')
  left join public.ibge_municipios mo
    on mo.codigo_municipio_completo::text = nullif(r.ibge_origem::text, '')
  where nullif(tr.nome, '') is not null
    and (
      nullif(r.ibge_destino::text, '') is not null
      or nullif(r.nome_rota, '') is not null
      or nullif(r.extra ->> 'cidadeDestino', '') is not null
    )
),
base_negociacao as (
  select
    i.id::text as id,
    i.tabela_negociacao_id::text as tabela_negociacao_id,
    coalesce(nullif(i.transportadora, ''), nullif(t.transportadora, '')) as transportadora,
    coalesce(nullif(i.canal, ''), nullif(t.canal, ''), 'N/I') as canal,
    coalesce(nullif(i.tipo_tabela, ''), nullif(t.tipo_tabela, ''), 'N/I') as tipo_tabela,
    t.tipo_negociacao,
    t.status,
    t.descricao as tabela_nome,
    t.origem_importacao,
    coalesce(
      nullif(t.modalidade, ''),
      nullif(i.tipo_veiculo, ''),
      nullif(i.dados_originais ->> 'metodoEnvio', ''),
      'N/I'
    ) as modalidade,
    coalesce(
      nullif(i.cidade_origem, ''),
      nullif(i.dados_originais ->> 'cidadeOrigem', ''),
      nullif(t.origem, '')
    ) as cidade_origem,
    coalesce(
      nullif(i.uf_origem, ''),
      nullif(i.dados_originais ->> 'ufOrigem', ''),
      nullif(t.uf_origem, '')
    ) as uf_origem,
    coalesce(
      nullif(i.ibge_origem::text, ''),
      nullif(i.dados_originais ->> 'ibgeOrigem', '')
    ) as ibge_origem,
    coalesce(
      nullif(i.cidade_destino, ''),
      nullif(m.nome_municipio, ''),
      nullif(i.dados_originais ->> 'cidadeDestino', '')
    ) as cidade_destino,
    coalesce(
      nullif(i.uf_destino, ''),
      nullif(m.sigla_uf, ''),
      nullif(i.dados_originais ->> 'ufDestino', '')
    ) as uf_destino,
    coalesce(
      nullif(i.ibge_destino::text, ''),
      nullif(i.dados_originais ->> 'ibgeDestino', '')
    ) as ibge_destino,
    coalesce(
      public.amd_parse_numeric(i.prazo::text)::integer,
      public.amd_parse_numeric(i.dados_originais ->> 'prazoEntregaDias')::integer,
      public.amd_parse_numeric(i.dados_originais ->> 'prazo')::integer,
      0
    ) as prazo,
    coalesce(i.valor_lotacao, i.frete_minimo, i.taxa_aplicada, 0) as valor_referencia,
    coalesce(nullif(i.observacao, ''), nullif(t.observacao, '')) as observacao,
    case
      when upper(coalesce(t.tipo_negociacao, '')) like '%REAJUST%'
        then 'REAJUSTE'
      else 'NEGOCIACAO'
    end as fonte_tabela,
    case
      when upper(coalesce(t.tipo_negociacao, '')) like '%REAJUST%'
        then 'Reajuste em negociação'
      else 'Em negociação'
    end as fonte_label,
    case
      when upper(coalesce(t.tipo_negociacao, '')) like '%REAJUST%'
        then 3
      else 2
    end as fonte_prioridade
  from public.tabelas_negociacao_itens i
  join public.tabelas_negociacao t
    on t.id = i.tabela_negociacao_id
  left join public.ibge_municipios m
    on m.codigo_municipio_completo::text = coalesce(
      nullif(i.ibge_destino::text, ''),
      nullif(i.dados_originais ->> 'ibgeDestino', '')
    )
  where i.dados_originais ->> 'tipo_item' = 'ROTA'
)
select * from base_oficial
union all
select * from base_negociacao;

grant select on public.vw_avaliacao_prazos_cobertura to anon, authenticated;
