-- 4.36.2 — Avaliação de Prazos e Cobertura: materialized view + RPCs server-side
-- Objetivo: eliminar o "canceling statement due to statement timeout" causado por
-- carregar ~531 mil linhas no navegador e agregar tudo no cliente.
--
-- Estratégia:
--   1) Materializar a base (mvw_avaliacao_prazos_cobertura) com colunas auxiliares
--      já normalizadas no banco, e indexá-la.
--   2) Expor agregações e detalhe via RPCs filtradas (fonte padrão = OFICIAL).
--   3) Manter a view vw_avaliacao_prazos_cobertura como alias da MV, para não
--      quebrar consumidores existentes nem o SQL de validação.
--
-- Regra de negócio preservada:
--   - OFICIAL é a fonte principal/padrão.
--   - NEGOCIACAO e REAJUSTE são complementares e nunca contam como cobertura oficial.
--
-- Observação importante: a materialized view NÃO honra RLS por chamador
-- (diferente da view com security_invoker). Ela é populada pelo dono do objeto.
-- Para esta ferramenta interna de tabelas de frete isso é aceitável; documentado no laudo.

-- ---------------------------------------------------------------------------
-- 0. Extensão para índice de busca textual (trigram)
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Funções auxiliares imutáveis (espelham a normalização do frontend)
-- ---------------------------------------------------------------------------

-- amd_normalizar: equivale ao normalizar() do avaliacaoPrazosService.js
--   upper -> remove acentos -> troca não [A-Z0-9] por espaço único -> trim
create or replace function public.amd_normalizar(p_val text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    translate(
      upper(coalesce(p_val, '')),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'AAAAAEEEEIIIIOOOOOUUUUCN'
    ),
    '[^A-Z0-9]+', ' ', 'g'
  ));
$$;

-- amd_regiao_uf: equivale ao obterRegiaoPorUf() do frontend
create or replace function public.amd_regiao_uf(p_uf text)
returns text
language sql
immutable
as $$
  select case upper(left(coalesce(p_uf, ''), 2))
    when 'AC' then 'NORTE' when 'AP' then 'NORTE' when 'AM' then 'NORTE'
    when 'PA' then 'NORTE' when 'RO' then 'NORTE' when 'RR' then 'NORTE' when 'TO' then 'NORTE'
    when 'AL' then 'NORDESTE' when 'BA' then 'NORDESTE' when 'CE' then 'NORDESTE'
    when 'MA' then 'NORDESTE' when 'PB' then 'NORDESTE' when 'PE' then 'NORDESTE'
    when 'PI' then 'NORDESTE' when 'RN' then 'NORDESTE' when 'SE' then 'NORDESTE'
    when 'DF' then 'CENTRO-OESTE' when 'GO' then 'CENTRO-OESTE'
    when 'MT' then 'CENTRO-OESTE' when 'MS' then 'CENTRO-OESTE'
    when 'ES' then 'SUDESTE' when 'MG' then 'SUDESTE' when 'RJ' then 'SUDESTE' when 'SP' then 'SUDESTE'
    when 'PR' then 'SUL' when 'RS' then 'SUL' when 'SC' then 'SUL'
    else ''
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Materialized view com colunas de display + colunas auxiliares de filtro
-- ---------------------------------------------------------------------------
-- A view comum vw_avaliacao_prazos_cobertura depende destas tabelas; recriamos
-- depois apontando para a MV. Removemos a view antiga primeiro.
drop view if exists public.vw_avaliacao_prazos_cobertura;
drop materialized view if exists public.mvw_avaliacao_prazos_cobertura;

create materialized view public.mvw_avaliacao_prazos_cobertura as
with bruto as (
  -- ===================== BASE OFICIAL (transportadoras/tabelas cadastradas) =====================
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
    coalesce(nullif(r.metodo_envio, ''), nullif(r.extra ->> 'metodoEnvio', ''), nullif(r.codigo_unidade, ''), 'N/I') as modalidade,
    coalesce(nullif(mo.nome_municipio, ''), nullif(r.extra ->> 'cidadeOrigem', ''), nullif(o.cidade, '')) as cidade_origem,
    coalesce(nullif(mo.sigla_uf, ''), nullif(r.extra ->> 'ufOrigem', '')) as uf_origem,
    nullif(r.ibge_origem::text, '') as ibge_origem,
    coalesce(nullif(md.nome_municipio, ''), nullif(r.extra ->> 'cidadeDestino', ''), nullif(r.nome_rota, '')) as cidade_destino,
    coalesce(nullif(md.sigla_uf, ''), nullif(r.extra ->> 'ufDestino', '')) as uf_destino,
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
  join public.origens o on o.id = r.origem_id
  join public.transportadoras tr on tr.id = o.transportadora_id
  left join public.ibge_municipios md on md.codigo_municipio_completo::text = nullif(r.ibge_destino::text, '')
  left join public.ibge_municipios mo on mo.codigo_municipio_completo::text = nullif(r.ibge_origem::text, '')
  where nullif(tr.nome, '') is not null
    and (
      nullif(r.ibge_destino::text, '') is not null
      or nullif(r.nome_rota, '') is not null
      or nullif(r.extra ->> 'cidadeDestino', '') is not null
    )

  union all

  -- ===================== BASE NEGOCIAÇÃO / REAJUSTE (complementares) =====================
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
    coalesce(nullif(t.modalidade, ''), nullif(i.tipo_veiculo, ''), nullif(i.dados_originais ->> 'metodoEnvio', ''), 'N/I') as modalidade,
    coalesce(nullif(i.cidade_origem, ''), nullif(i.dados_originais ->> 'cidadeOrigem', ''), nullif(t.origem, '')) as cidade_origem,
    coalesce(nullif(i.uf_origem, ''), nullif(i.dados_originais ->> 'ufOrigem', ''), nullif(t.uf_origem, '')) as uf_origem,
    coalesce(nullif(i.ibge_origem::text, ''), nullif(i.dados_originais ->> 'ibgeOrigem', '')) as ibge_origem,
    coalesce(nullif(i.cidade_destino, ''), nullif(m.nome_municipio, ''), nullif(i.dados_originais ->> 'cidadeDestino', '')) as cidade_destino,
    coalesce(nullif(i.uf_destino, ''), nullif(m.sigla_uf, ''), nullif(i.dados_originais ->> 'ufDestino', '')) as uf_destino,
    coalesce(nullif(i.ibge_destino::text, ''), nullif(i.dados_originais ->> 'ibgeDestino', '')) as ibge_destino,
    coalesce(
      public.amd_parse_numeric(i.prazo::text)::integer,
      public.amd_parse_numeric(i.dados_originais ->> 'prazoEntregaDias')::integer,
      public.amd_parse_numeric(i.dados_originais ->> 'prazo')::integer,
      0
    ) as prazo,
    coalesce(i.valor_lotacao, i.frete_minimo, i.taxa_aplicada, 0) as valor_referencia,
    coalesce(nullif(i.observacao, ''), nullif(t.observacao, '')) as observacao,
    case when upper(coalesce(t.tipo_negociacao, '')) like '%REAJUST%' then 'REAJUSTE' else 'NEGOCIACAO' end as fonte_tabela,
    case when upper(coalesce(t.tipo_negociacao, '')) like '%REAJUST%' then 'Reajuste em negociação' else 'Em negociação' end as fonte_label,
    case when upper(coalesce(t.tipo_negociacao, '')) like '%REAJUST%' then 3 else 2 end as fonte_prioridade
  from public.tabelas_negociacao_itens i
  join public.tabelas_negociacao t on t.id = i.tabela_negociacao_id
  left join public.ibge_municipios m on m.codigo_municipio_completo::text = coalesce(nullif(i.ibge_destino::text, ''), nullif(i.dados_originais ->> 'ibgeDestino', ''))
  where i.dados_originais ->> 'tipo_item' = 'ROTA'
),
enriquecido as (
  select
    b.*,
    -- chave de unicidade estável para REFRESH ... CONCURRENTLY
    (b.fonte_tabela || '|' || b.id) as mv_key,
    -- auxiliares de filtro (espelham normalização do frontend)
    upper(coalesce(b.canal, 'N/I')) as canal_f,
    upper(coalesce(b.tipo_tabela, '')) as tipo_tabela_f,
    upper(coalesce(b.status, '')) as status_f,
    upper(left(coalesce(b.uf_origem, ''), 2)) as uf_origem_f,
    upper(left(coalesce(b.uf_destino, ''), 2)) as uf_destino_f,
    public.amd_regiao_uf(b.uf_origem) as regiao_origem,
    public.amd_regiao_uf(b.uf_destino) as regiao_destino,
    public.amd_normalizar(b.transportadora) as transportadora_norm,
    public.amd_normalizar(b.modalidade) as modalidade_norm,
    -- rótulo de rota (espelha rotaLabel do frontend)
    (coalesce(nullif(b.cidade_origem, ''), 'Origem N/I')
      || case when coalesce(b.uf_origem, '') <> '' then '/' || upper(left(b.uf_origem, 2)) else '' end
      || ' → '
      || coalesce(nullif(b.cidade_destino, ''), 'Destino N/I')
      || case when coalesce(b.uf_destino, '') <> '' then '/' || upper(left(b.uf_destino, 2)) else '' end
    ) as rota_label,
    -- chave de rota (espelha rotaKey do frontend: normCidadeO|UFo|normCidadeD|UFd|canal)
    (public.amd_normalizar(b.cidade_origem) || '|'
      || upper(left(coalesce(b.uf_origem, ''), 2)) || '|'
      || public.amd_normalizar(b.cidade_destino) || '|'
      || upper(left(coalesce(b.uf_destino, ''), 2)) || '|'
      || upper(coalesce(b.canal, 'N/I'))
    ) as rota_key,
    -- texto de busca normalizado (espelha alvo da busca geral do frontend)
    public.amd_normalizar(concat_ws(' ',
      b.fonte_label, b.fonte_tabela, b.transportadora, b.canal, b.tipo_tabela,
      b.tipo_negociacao, b.modalidade, b.status, b.cidade_origem, b.uf_origem,
      b.cidade_destino, b.uf_destino, b.tabela_nome, b.observacao
    )) as busca_norm
  from bruto b
  where nullif(b.transportadora, '') is not null
    and (
      nullif(b.cidade_destino, '') is not null
      or nullif(b.uf_destino, '') is not null
      or nullif(b.cidade_origem, '') is not null
      or nullif(b.uf_origem, '') is not null
    )
)
select * from enriquecido;

-- ---------------------------------------------------------------------------
-- 3. Índices da materialized view
-- ---------------------------------------------------------------------------
-- Único e obrigatório para REFRESH MATERIALIZED VIEW CONCURRENTLY
create unique index if not exists uidx_mvw_ap_mv_key
  on public.mvw_avaliacao_prazos_cobertura (mv_key);

create index if not exists idx_mvw_ap_fonte
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela);
create index if not exists idx_mvw_ap_fonte_ufdest
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, uf_destino_f);
create index if not exists idx_mvw_ap_fonte_uforig
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, uf_origem_f);
create index if not exists idx_mvw_ap_canal
  on public.mvw_avaliacao_prazos_cobertura (canal_f);
create index if not exists idx_mvw_ap_transportadora
  on public.mvw_avaliacao_prazos_cobertura (transportadora_norm);
create index if not exists idx_mvw_ap_modalidade
  on public.mvw_avaliacao_prazos_cobertura (modalidade_norm);
create index if not exists idx_mvw_ap_rota
  on public.mvw_avaliacao_prazos_cobertura (rota_key);
create index if not exists idx_mvw_ap_regiao_dest
  on public.mvw_avaliacao_prazos_cobertura (regiao_destino);
create index if not exists idx_mvw_ap_busca_trgm
  on public.mvw_avaliacao_prazos_cobertura using gin (busca_norm gin_trgm_ops);

grant select on public.mvw_avaliacao_prazos_cobertura to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. View de compatibilidade (mantém o nome usado por outros consumidores)
-- ---------------------------------------------------------------------------
create view public.vw_avaliacao_prazos_cobertura as
select
  id, tabela_negociacao_id, transportadora, canal, tipo_tabela, tipo_negociacao,
  status, tabela_nome, origem_importacao, modalidade, cidade_origem, uf_origem,
  ibge_origem, cidade_destino, uf_destino, ibge_destino, prazo, valor_referencia,
  observacao, fonte_tabela, fonte_label, fonte_prioridade
from public.mvw_avaliacao_prazos_cobertura;

grant select on public.vw_avaliacao_prazos_cobertura to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Função base de filtro (reaproveitada pelas RPCs)
-- ---------------------------------------------------------------------------
-- Trata string vazia como "sem filtro". p_fonte default OFICIAL; '' = todas as fontes.
create or replace function public.amd_ap_filtrado(
  p_fonte text default 'OFICIAL',
  p_busca text default null,
  p_canal text default null,
  p_tipo_tabela text default null,
  p_status text default null,
  p_transportadora text default null,
  p_uf_origem text default null,
  p_uf_destino text default null,
  p_regiao_origem text default null,
  p_regiao_destino text default null,
  p_modalidade text default null,
  p_com_prazo text default null
)
returns setof public.mvw_avaliacao_prazos_cobertura
language sql
stable
as $$
  select *
  from public.mvw_avaliacao_prazos_cobertura mv
  where (nullif(trim(coalesce(p_fonte, '')), '') is null or mv.fonte_tabela = upper(trim(p_fonte)))
    and (nullif(trim(coalesce(p_canal, '')), '') is null or mv.canal_f = upper(trim(p_canal)))
    and (nullif(trim(coalesce(p_tipo_tabela, '')), '') is null or mv.tipo_tabela_f = upper(trim(p_tipo_tabela)))
    and (nullif(trim(coalesce(p_status, '')), '') is null or mv.status_f = upper(trim(p_status)))
    and (nullif(trim(coalesce(p_transportadora, '')), '') is null or mv.transportadora_norm = public.amd_normalizar(p_transportadora))
    and (nullif(trim(coalesce(p_uf_origem, '')), '') is null or mv.uf_origem_f = upper(trim(p_uf_origem)))
    and (nullif(trim(coalesce(p_uf_destino, '')), '') is null or mv.uf_destino_f = upper(trim(p_uf_destino)))
    and (nullif(trim(coalesce(p_regiao_origem, '')), '') is null or mv.regiao_origem = upper(trim(p_regiao_origem)))
    and (nullif(trim(coalesce(p_regiao_destino, '')), '') is null or mv.regiao_destino = upper(trim(p_regiao_destino)))
    and (nullif(trim(coalesce(p_modalidade, '')), '') is null or mv.modalidade_norm = public.amd_normalizar(p_modalidade))
    and (
      nullif(trim(coalesce(p_com_prazo, '')), '') is null
      or (upper(trim(p_com_prazo)) = 'COM_PRAZO' and mv.prazo > 0)
      or (upper(trim(p_com_prazo)) = 'SEM_PRAZO' and mv.prazo <= 0)
    )
    and (
      nullif(trim(coalesce(p_busca, '')), '') is null
      or mv.busca_norm like '%' || public.amd_normalizar(p_busca) || '%'
    );
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC: indicadores agregados (KPIs do topo)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_avaliacao_prazos_kpis(
  p_fonte text default 'OFICIAL',
  p_busca text default null,
  p_canal text default null,
  p_tipo_tabela text default null,
  p_status text default null,
  p_transportadora text default null,
  p_uf_origem text default null,
  p_uf_destino text default null,
  p_regiao_origem text default null,
  p_regiao_destino text default null,
  p_modalidade text default null,
  p_com_prazo text default null
)
returns table (
  registros bigint,
  oficiais bigint,
  negociacao bigint,
  transportadoras bigint,
  transportadoras_oficiais bigint,
  menor_prazo integer,
  prazo_medio numeric,
  rotas bigint,
  rotas_oficiais bigint,
  rotas_baixa_cobertura bigint,
  ufs_sem_cobertura_oficial integer
)
language sql
stable
as $$
  with f as (
    select * from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  ),
  rota as (
    select
      rota_key,
      count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL') as ofi
    from f
    group by rota_key
  ),
  uf_ofi as (
    select count(distinct uf_destino_f) as qtd
    from f
    where fonte_tabela = 'OFICIAL' and regiao_destino <> '' and uf_destino_f <> ''
  )
  select
    (select count(*) from f),
    (select count(*) from f where fonte_tabela = 'OFICIAL'),
    (select count(*) from f where fonte_tabela <> 'OFICIAL'),
    (select count(distinct transportadora_norm) from f where transportadora_norm <> ''),
    (select count(distinct transportadora_norm) from f where fonte_tabela = 'OFICIAL' and transportadora_norm <> ''),
    (select coalesce(min(prazo), 0)::integer from f where prazo > 0),
    (select coalesce(round(avg(prazo)::numeric, 2), 0) from f where prazo > 0),
    (select count(*) from rota),
    (select count(*) from rota where ofi > 0),
    (select count(*) from rota where ofi <= 1),
    (27 - (select qtd from uf_ofi))::integer;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: cobertura por UF destino (mapa)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_avaliacao_prazos_uf(
  p_fonte text default 'OFICIAL',
  p_busca text default null,
  p_canal text default null,
  p_tipo_tabela text default null,
  p_status text default null,
  p_transportadora text default null,
  p_uf_origem text default null,
  p_uf_destino text default null,
  p_regiao_origem text default null,
  p_regiao_destino text default null,
  p_modalidade text default null,
  p_com_prazo text default null
)
returns table (
  uf text,
  regiao text,
  qtd_rotas bigint,
  qtd_transportadoras bigint,
  qtd_transportadoras_oficiais bigint,
  menor_prazo integer,
  menor_prazo_oficial integer,
  prazo_medio numeric
)
language sql
stable
as $$
  with f as (
    select * from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  )
  select
    uf_destino_f as uf,
    regiao_destino as regiao,
    count(distinct rota_key) as qtd_rotas,
    count(distinct transportadora_norm) as qtd_transportadoras,
    count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL') as qtd_transportadoras_oficiais,
    coalesce(min(prazo) filter (where prazo > 0), 0)::integer as menor_prazo,
    coalesce(min(prazo) filter (where prazo > 0 and fonte_tabela = 'OFICIAL'), 0)::integer as menor_prazo_oficial,
    coalesce(round(avg(prazo) filter (where prazo > 0)::numeric, 2), 0) as prazo_medio
  from f
  where uf_destino_f <> '' and regiao_destino <> ''
  group by uf_destino_f, regiao_destino
  order by regiao_destino, uf_destino_f;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC: rotas consolidadas (dashboard + aba Rotas)
--    p_ordem: 'COBERTURA' (oficiais asc) | 'PRAZO' (menor prazo asc)
--    p_max_oficiais: filtra rotas com até N transportadoras oficiais (rotas críticas)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_avaliacao_prazos_rotas(
  p_fonte text default 'OFICIAL',
  p_busca text default null,
  p_canal text default null,
  p_tipo_tabela text default null,
  p_status text default null,
  p_transportadora text default null,
  p_uf_origem text default null,
  p_uf_destino text default null,
  p_regiao_origem text default null,
  p_regiao_destino text default null,
  p_modalidade text default null,
  p_com_prazo text default null,
  p_ordem text default 'COBERTURA',
  p_max_oficiais integer default null,
  p_somente_com_prazo boolean default false,
  p_limite integer default 500,
  p_offset integer default 0
)
returns table (
  rota_key text,
  rota_label text,
  canal text,
  regiao_origem text,
  regiao_destino text,
  qtd_transportadoras bigint,
  qtd_transportadoras_oficiais bigint,
  qtd_transportadoras_negociacao bigint,
  menor_prazo integer,
  maior_prazo integer,
  prazo_medio numeric,
  melhores_transportadoras text,
  total bigint
)
language sql
stable
as $$
  with f as (
    select * from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  ),
  rk as (
    select
      f.rota_key,
      max(f.rota_label) as rota_label,
      max(f.canal_f) as canal,
      max(f.regiao_origem) as regiao_origem,
      max(f.regiao_destino) as regiao_destino,
      count(distinct f.transportadora_norm) as qtd_transportadoras,
      count(distinct f.transportadora_norm) filter (where f.fonte_tabela = 'OFICIAL') as qtd_transportadoras_oficiais,
      count(distinct f.transportadora_norm) filter (where f.fonte_tabela <> 'OFICIAL') as qtd_transportadoras_negociacao,
      coalesce(min(f.prazo) filter (where f.prazo > 0), 0)::integer as menor_prazo,
      coalesce(max(f.prazo) filter (where f.prazo > 0), 0)::integer as maior_prazo,
      coalesce(round(avg(f.prazo) filter (where f.prazo > 0)::numeric, 2), 0) as prazo_medio
    from f
    group by f.rota_key
  ),
  mel as (
    select f.rota_key, string_agg(distinct f.transportadora, ', ') as melhores
    from f
    join rk on rk.rota_key = f.rota_key
    where f.prazo > 0 and f.prazo = rk.menor_prazo
    group by f.rota_key
  ),
  filtrado as (
    select rk.*, coalesce(mel.melhores, '') as melhores_transportadoras
    from rk
    left join mel on mel.rota_key = rk.rota_key
    where (p_max_oficiais is null or rk.qtd_transportadoras_oficiais <= p_max_oficiais)
      and (p_somente_com_prazo is not true or rk.menor_prazo > 0)
  )
  select
    rota_key, rota_label, canal, regiao_origem, regiao_destino,
    qtd_transportadoras, qtd_transportadoras_oficiais, qtd_transportadoras_negociacao,
    menor_prazo, maior_prazo, prazo_medio, melhores_transportadoras,
    count(*) over() as total
  from filtrado
  order by
    case when upper(coalesce(p_ordem, 'COBERTURA')) = 'PRAZO' then menor_prazo end asc nulls last,
    case when upper(coalesce(p_ordem, 'COBERTURA')) = 'PRAZO' then qtd_transportadoras end desc,
    case when upper(coalesce(p_ordem, 'COBERTURA')) = 'COBERTURA' then qtd_transportadoras_oficiais end asc,
    case when upper(coalesce(p_ordem, 'COBERTURA')) = 'COBERTURA' then qtd_transportadoras end asc,
    rota_label asc
  limit greatest(coalesce(p_limite, 500), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------
-- 9. RPC: linhas detalhadas paginadas (aba Relatório / export)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_avaliacao_prazos_linhas(
  p_fonte text default 'OFICIAL',
  p_busca text default null,
  p_canal text default null,
  p_tipo_tabela text default null,
  p_status text default null,
  p_transportadora text default null,
  p_uf_origem text default null,
  p_uf_destino text default null,
  p_regiao_origem text default null,
  p_regiao_destino text default null,
  p_modalidade text default null,
  p_com_prazo text default null,
  p_limite integer default 300,
  p_offset integer default 0
)
returns table (
  id text,
  tabela_negociacao_id text,
  transportadora text,
  canal text,
  tipo_tabela text,
  tipo_negociacao text,
  status text,
  tabela_nome text,
  origem_importacao text,
  modalidade text,
  cidade_origem text,
  uf_origem text,
  ibge_origem text,
  cidade_destino text,
  uf_destino text,
  ibge_destino text,
  prazo integer,
  valor_referencia numeric,
  observacao text,
  fonte_tabela text,
  fonte_label text,
  fonte_prioridade integer,
  total bigint
)
language sql
stable
as $$
  with f as (
    select * from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  )
  select
    id, tabela_negociacao_id, transportadora, canal, tipo_tabela, tipo_negociacao,
    status, tabela_nome, origem_importacao, modalidade, cidade_origem, uf_origem,
    ibge_origem, cidade_destino, uf_destino, ibge_destino, prazo, valor_referencia,
    observacao, fonte_tabela, fonte_label, fonte_prioridade,
    count(*) over() as total
  from f
  order by fonte_prioridade asc nulls last, transportadora asc nulls last, rota_label asc
  limit greatest(coalesce(p_limite, 300), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------
-- 10. RPC: opções de filtro + resumo global por fonte (carregado uma vez)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_avaliacao_prazos_opcoes()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'canais', coalesce((select jsonb_agg(distinct canal_f order by canal_f) from public.mvw_avaliacao_prazos_cobertura where coalesce(canal_f, '') <> ''), '[]'::jsonb),
    'tiposTabela', coalesce((select jsonb_agg(distinct tipo_tabela_f order by tipo_tabela_f) from public.mvw_avaliacao_prazos_cobertura where coalesce(tipo_tabela_f, '') <> ''), '[]'::jsonb),
    'status', coalesce((select jsonb_agg(distinct status_f order by status_f) from public.mvw_avaliacao_prazos_cobertura where coalesce(status_f, '') <> ''), '[]'::jsonb),
    'transportadoras', coalesce((select jsonb_agg(distinct transportadora order by transportadora) from public.mvw_avaliacao_prazos_cobertura where coalesce(transportadora, '') <> ''), '[]'::jsonb),
    'modalidades', coalesce((select jsonb_agg(distinct modalidade order by modalidade) from public.mvw_avaliacao_prazos_cobertura where coalesce(modalidade, '') <> ''), '[]'::jsonb),
    'ufsOrigem', coalesce((select jsonb_agg(distinct uf_origem_f order by uf_origem_f) from public.mvw_avaliacao_prazos_cobertura where coalesce(uf_origem_f, '') <> ''), '[]'::jsonb),
    'resumoGlobal', coalesce((select jsonb_object_agg(fonte_tabela, qtd) from (select fonte_tabela, count(*) as qtd from public.mvw_avaliacao_prazos_cobertura group by fonte_tabela) s), '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 11. RPC: refresh da materialized view (botão "Atualizar base")
-- ---------------------------------------------------------------------------
create or replace function public.rpc_avaliacao_prazos_refresh()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.mvw_avaliacao_prazos_cobertura;
  return now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Permissões de execução
-- ---------------------------------------------------------------------------
grant execute on function public.amd_normalizar(text) to anon, authenticated;
grant execute on function public.amd_regiao_uf(text) to anon, authenticated;
grant execute on function public.amd_ap_filtrado(text,text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.rpc_avaliacao_prazos_kpis(text,text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.rpc_avaliacao_prazos_uf(text,text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.rpc_avaliacao_prazos_rotas(text,text,text,text,text,text,text,text,text,text,text,text,text,integer,boolean,integer,integer) to anon, authenticated;
grant execute on function public.rpc_avaliacao_prazos_linhas(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer) to anon, authenticated;
grant execute on function public.rpc_avaliacao_prazos_opcoes() to anon, authenticated;
grant execute on function public.rpc_avaliacao_prazos_refresh() to authenticated;

-- Primeira carga da materialized view
refresh materialized view public.mvw_avaliacao_prazos_cobertura;
