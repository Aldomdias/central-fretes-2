-- 4.36.2.10 — Análise regional em uma única passagem (evita 5 scans paralelos + timeout)
-- Rode após 006–009. Índice composto para recortes canal + região origem.

create index if not exists idx_mvw_ap_fonte_canal_regiao_origem
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, canal_f, regiao_origem);

create index if not exists idx_mvw_ap_fonte_canal_regiao_origem_rota
  on public.mvw_avaliacao_prazos_cobertura (fonte_tabela, canal_f, regiao_origem, rota_key);

create or replace function public.rpc_avaliacao_prazos_analise_completa(
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
  p_limite_rotas_criticas integer default 500,
  p_limite_melhores integer default 20,
  p_limite_lacunas integer default 2000
)
returns jsonb
language plpgsql
stable
set statement_timeout = '180s'
as $$
declare
  v jsonb;
begin
  with f as (
    select
      fonte_tabela,
      transportadora_norm,
      transportadora,
      prazo,
      uf_destino_f,
      regiao_destino,
      regiao_origem,
      rota_key,
      rota_label,
      canal_f
    from public.amd_ap_filtrado(
      p_fonte, p_busca, p_canal, p_tipo_tabela, p_status, p_transportadora,
      p_uf_origem, p_uf_destino, p_regiao_origem, p_regiao_destino, p_modalidade, p_com_prazo
    )
  ),
  linhas as (
    select
      count(*)::bigint as registros,
      count(*) filter (where fonte_tabela = 'OFICIAL')::bigint as oficiais,
      count(*) filter (where fonte_tabela <> 'OFICIAL')::bigint as negociacao,
      count(distinct transportadora_norm) filter (where transportadora_norm <> '')::bigint as transportadoras,
      count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL' and transportadora_norm <> '')::bigint as transportadoras_oficiais,
      coalesce(min(prazo) filter (where prazo > 0), 0)::integer as menor_prazo,
      coalesce(round(avg(prazo) filter (where prazo > 0)::numeric, 2), 0) as prazo_medio,
      count(distinct uf_destino_f) filter (
        where fonte_tabela = 'OFICIAL' and uf_destino_f <> '' and regiao_destino <> ''
      )::integer as ufs_com_oficial
    from f
  ),
  rota_agg as (
    select
      rota_key,
      count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL') as ofi
    from f
    group by rota_key
  ),
  rotas_kpi as (
    select
      count(*)::bigint as rotas,
      count(*) filter (where ofi > 0)::bigint as rotas_oficiais,
      count(*) filter (where ofi <= 1)::bigint as rotas_baixa_cobertura
    from rota_agg
  ),
  kpis as (
    select jsonb_build_object(
      'registros', linhas.registros,
      'oficiais', linhas.oficiais,
      'negociacao', linhas.negociacao,
      'transportadoras', linhas.transportadoras,
      'transportadoras_oficiais', linhas.transportadoras_oficiais,
      'menor_prazo', linhas.menor_prazo,
      'prazo_medio', linhas.prazo_medio,
      'rotas', rotas_kpi.rotas,
      'rotas_oficiais', rotas_kpi.rotas_oficiais,
      'rotas_baixa_cobertura', rotas_kpi.rotas_baixa_cobertura,
      'ufs_sem_cobertura_oficial', (27 - linhas.ufs_com_oficial)
    ) as payload
    from linhas
    cross join rotas_kpi
  ),
  mapa as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'uf', uf_destino_f,
        'regiao', regiao_destino,
        'qtd_rotas', qtd_rotas,
        'qtd_transportadoras', qtd_transportadoras,
        'qtd_transportadoras_oficiais', qtd_transportadoras_oficiais,
        'menor_prazo', menor_prazo,
        'menor_prazo_oficial', menor_prazo_oficial,
        'prazo_medio', prazo_medio
      )
      order by regiao_destino, uf_destino_f
    ), '[]'::jsonb) as payload
    from (
      select
        uf_destino_f,
        regiao_destino,
        count(distinct rota_key) as qtd_rotas,
        count(distinct transportadora_norm) as qtd_transportadoras,
        count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL') as qtd_transportadoras_oficiais,
        coalesce(min(prazo) filter (where prazo > 0), 0)::integer as menor_prazo,
        coalesce(min(prazo) filter (where prazo > 0 and fonte_tabela = 'OFICIAL'), 0)::integer as menor_prazo_oficial,
        coalesce(round(avg(prazo) filter (where prazo > 0)::numeric, 2), 0) as prazo_medio
      from f
      where uf_destino_f <> '' and regiao_destino <> ''
      group by uf_destino_f, regiao_destino
    ) u
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
    select f.rota_key, string_agg(distinct f.transportadora, ', ' order by f.transportadora) as melhores
    from f
    join rk on rk.rota_key = f.rota_key
    where f.prazo > 0 and f.prazo = rk.menor_prazo
    group by f.rota_key
  ),
  rotas_criticas as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'rota_key', rk.rota_key,
        'rota_label', rk.rota_label,
        'canal', rk.canal,
        'regiao_origem', rk.regiao_origem,
        'regiao_destino', rk.regiao_destino,
        'qtd_transportadoras', rk.qtd_transportadoras,
        'qtd_transportadoras_oficiais', rk.qtd_transportadoras_oficiais,
        'qtd_transportadoras_negociacao', rk.qtd_transportadoras_negociacao,
        'menor_prazo', rk.menor_prazo,
        'maior_prazo', rk.maior_prazo,
        'prazo_medio', rk.prazo_medio,
        'melhores_transportadoras', coalesce(mel.melhores, '')
      )
      order by rk.qtd_transportadoras_oficiais, rk.qtd_transportadoras, rk.rota_label
    ), '[]'::jsonb) as payload
    from rk
    left join mel on mel.rota_key = rk.rota_key
    where rk.qtd_transportadoras_oficiais <= 1
    limit greatest(coalesce(p_limite_rotas_criticas, 500), 0)
  ),
  melhores_prazos as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'rota_key', rk.rota_key,
        'rota_label', rk.rota_label,
        'canal', rk.canal,
        'regiao_origem', rk.regiao_origem,
        'regiao_destino', rk.regiao_destino,
        'qtd_transportadoras', rk.qtd_transportadoras,
        'qtd_transportadoras_oficiais', rk.qtd_transportadoras_oficiais,
        'qtd_transportadoras_negociacao', rk.qtd_transportadoras_negociacao,
        'menor_prazo', rk.menor_prazo,
        'maior_prazo', rk.maior_prazo,
        'prazo_medio', rk.prazo_medio,
        'melhores_transportadoras', coalesce(mel.melhores, '')
      )
      order by rk.menor_prazo, rk.qtd_transportadoras desc
    ), '[]'::jsonb) as payload
    from rk
    left join mel on mel.rota_key = rk.rota_key
    where rk.menor_prazo > 0
    limit greatest(coalesce(p_limite_melhores, 20), 0)
  ),
  lacunas as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'rota_key', rk.rota_key,
        'rota_label', rk.rota_label,
        'canal', rk.canal,
        'regiao_origem', rk.regiao_origem,
        'regiao_destino', rk.regiao_destino,
        'qtd_transportadoras', rk.qtd_transportadoras,
        'qtd_transportadoras_oficiais', rk.qtd_transportadoras_oficiais,
        'qtd_transportadoras_negociacao', rk.qtd_transportadoras_negociacao,
        'menor_prazo', rk.menor_prazo,
        'prazo_medio', rk.prazo_medio
      )
      order by rk.qtd_transportadoras_oficiais, rk.rota_label
    ), '[]'::jsonb) as payload
    from rk
    where rk.qtd_transportadoras_oficiais <= 1
    limit greatest(coalesce(p_limite_lacunas, 2000), 0)
  )
  select jsonb_build_object(
    'kpis', (select payload from kpis),
    'mapa', (select payload from mapa),
    'rotas_criticas', (select payload from rotas_criticas),
    'melhores_prazos', (select payload from melhores_prazos),
    'lacunas', (select payload from lacunas)
  )
  into v;

  return coalesce(v, '{}'::jsonb);
end;
$$;

grant execute on function public.rpc_avaliacao_prazos_analise_completa(
  text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,integer
) to anon, authenticated;

alter function public.rpc_avaliacao_prazos_kpis(text,text,text,text,text,text,text,text,text,text,text,text)
  set statement_timeout = '120s';
alter function public.rpc_avaliacao_prazos_uf(text,text,text,text,text,text,text,text,text,text,text,text)
  set statement_timeout = '120s';
alter function public.rpc_avaliacao_prazos_rotas(text,text,text,text,text,text,text,text,text,text,text,text,text,integer,boolean,integer,integer)
  set statement_timeout = '120s';
alter function public.rpc_avaliacao_prazos_linhas(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer)
  set statement_timeout = '120s';

notify pgrst, 'reload schema';
