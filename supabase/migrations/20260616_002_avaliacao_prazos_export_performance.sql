-- 4.36.2.8 — Performance da exportação de linhas (Avaliação de Prazos)
--
-- Problema observado: exportar o recorte completo via rpc_avaliacao_prazos_linhas
-- ficava lento e a paginação por OFFSET piorava conforme a base crescia (~318k
-- linhas). Duas causas:
--   1) Toda chamada recalculava count(*) sobre TODO o conjunto filtrado, mesmo
--      quando a página não precisava do total (só a primeira página precisa).
--   2) O ORDER BY (fonte_prioridade, transportadora, rota_label) não tinha
--      índice correspondente, então o Postgres ordenava o conjunto filtrado
--      inteiro a cada chamada antes de aplicar LIMIT/OFFSET.
--
-- Esta migration:
--   a) Cria um índice que casa exatamente com esse ORDER BY, permitindo Index
--      Scan com paragem antecipada em vez de Sort completo.
--   b) Adiciona p_contar à RPC de linhas para pular o count(*) nas páginas
--      seguintes à primeira.

-- ---------------------------------------------------------------------------
-- 1. Índice casando com a ordenação usada na exportação/listagem de linhas
-- ---------------------------------------------------------------------------
create index if not exists idx_mvw_ap_ordem_exportacao
  on public.mvw_avaliacao_prazos_cobertura (fonte_prioridade, transportadora, rota_label);

-- ---------------------------------------------------------------------------
-- 2. RPC de linhas paginadas com contagem opcional
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
  p_offset integer default 0,
  p_contar boolean default true
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
    select *
    from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  )
  select
    f.id, f.tabela_negociacao_id, f.transportadora, f.canal, f.tipo_tabela, f.tipo_negociacao,
    f.status, f.tabela_nome, f.origem_importacao, f.modalidade, f.cidade_origem, f.uf_origem,
    f.ibge_origem, f.cidade_destino, f.uf_destino, f.ibge_destino, f.prazo, f.valor_referencia,
    f.observacao, f.fonte_tabela, f.fonte_label, f.fonte_prioridade,
    case when p_contar then (select count(*) from f) else null::bigint end as total
  from f
  order by f.fonte_prioridade asc nulls last, f.transportadora asc nulls last, f.rota_label asc
  limit greatest(coalesce(p_limite, 300), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.rpc_avaliacao_prazos_linhas(
  text, text, text, text, text, text, text, text, text, text, text, text, integer, integer, boolean
) to anon, authenticated;
