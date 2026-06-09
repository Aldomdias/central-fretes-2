-- 4.36.2.11 — Mapa por UF via IBGE + limites corretos na RPC analise_completa
-- Problema: uf_destino_f/regiao_destino vazios na MV (só IBGE preenchido) → mapa [].
-- Problema: LIMIT após jsonb_agg não limita linhas → payload gigante e Failed to fetch.

create or replace function public.amd_ap_uf_por_ibge(p_ibge text)
returns text
language sql
immutable
as $$
  select case left(trim(coalesce(p_ibge, '')), 2)
    when '11' then 'RO' when '12' then 'AC' when '13' then 'AM' when '14' then 'RR'
    when '15' then 'PA' when '16' then 'AP' when '17' then 'TO'
    when '21' then 'MA' when '22' then 'PI' when '23' then 'CE' when '24' then 'RN'
    when '25' then 'PB' when '26' then 'PE' when '27' then 'AL' when '28' then 'SE'
    when '29' then 'BA'
    when '31' then 'MG' when '32' then 'ES' when '33' then 'RJ' when '35' then 'SP'
    when '41' then 'PR' when '42' then 'SC' when '43' then 'RS'
    when '50' then 'MS' when '51' then 'MT' when '52' then 'GO' when '53' then 'DF'
    else ''
  end;
$$;

create or replace function public.amd_ap_uf_destino_efetivo(p_uf_destino text, p_ibge_destino text)
returns text
language sql
immutable
as $$
  select upper(left(
    coalesce(nullif(trim(coalesce(p_uf_destino, '')), ''), public.amd_ap_uf_por_ibge(p_ibge_destino)),
    2
  ));
$$;

create or replace function public.amd_ap_regiao_destino_efetivo(p_uf_destino text, p_ibge_destino text, p_regiao_destino text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(trim(coalesce(p_regiao_destino, '')), ''),
    public.amd_regiao_uf(
      coalesce(nullif(trim(coalesce(p_uf_destino, '')), ''), public.amd_ap_uf_por_ibge(p_ibge_destino))
    )
  );
$$;

grant execute on function public.amd_ap_uf_por_ibge(text) to anon, authenticated;
grant execute on function public.amd_ap_uf_destino_efetivo(text, text) to anon, authenticated;
grant execute on function public.amd_ap_regiao_destino_efetivo(text, text, text) to anon, authenticated;

-- Mapa por UF (fallback IBGE)
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
  ),
  u as (
    select
      public.amd_ap_uf_destino_efetivo(f.uf_destino, f.ibge_destino) as uf_efetiva,
      public.amd_ap_regiao_destino_efetivo(f.uf_destino, f.ibge_destino, f.regiao_destino) as regiao_efetiva,
      f.*
    from f
  )
  select
    u.uf_efetiva as uf,
    u.regiao_efetiva as regiao,
    count(distinct u.rota_key) as qtd_rotas,
    count(distinct u.transportadora_norm) as qtd_transportadoras,
    count(distinct u.transportadora_norm) filter (where u.fonte_tabela = 'OFICIAL') as qtd_transportadoras_oficiais,
    coalesce(min(u.prazo) filter (where u.prazo > 0), 0)::integer as menor_prazo,
    coalesce(min(u.prazo) filter (where u.prazo > 0 and u.fonte_tabela = 'OFICIAL'), 0)::integer as menor_prazo_oficial,
    coalesce(round(avg(u.prazo) filter (where u.prazo > 0)::numeric, 2), 0) as prazo_medio
  from u
  where u.uf_efetiva <> '' and u.regiao_efetiva <> ''
  group by u.uf_efetiva, u.regiao_efetiva
  order by u.regiao_efetiva, u.uf_efetiva;
$$;

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
      uf_destino,
      ibge_destino,
      uf_destino_f,
      regiao_destino,
      regiao_origem,
      rota_key,
      rota_label,
      canal_f,
      public.amd_ap_uf_destino_efetivo(uf_destino, ibge_destino) as uf_destino_eff,
      public.amd_ap_regiao_destino_efetivo(uf_destino, ibge_destino, regiao_destino) as regiao_destino_eff
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
      count(distinct uf_destino_eff) filter (
        where fonte_tabela = 'OFICIAL' and uf_destino_eff <> '' and regiao_destino_eff <> ''
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
        'uf', uf_destino_eff,
        'regiao', regiao_destino_eff,
        'qtd_rotas', qtd_rotas,
        'qtd_transportadoras', qtd_transportadoras,
        'qtd_transportadoras_oficiais', qtd_transportadoras_oficiais,
        'menor_prazo', menor_prazo,
        'menor_prazo_oficial', menor_prazo_oficial,
        'prazo_medio', prazo_medio
      )
      order by regiao_destino_eff, uf_destino_eff
    ), '[]'::jsonb) as payload
    from (
      select
        uf_destino_eff,
        regiao_destino_eff,
        count(distinct rota_key) as qtd_rotas,
        count(distinct transportadora_norm) as qtd_transportadoras,
        count(distinct transportadora_norm) filter (where fonte_tabela = 'OFICIAL') as qtd_transportadoras_oficiais,
        coalesce(min(prazo) filter (where prazo > 0), 0)::integer as menor_prazo,
        coalesce(min(prazo) filter (where prazo > 0 and fonte_tabela = 'OFICIAL'), 0)::integer as menor_prazo_oficial,
        coalesce(round(avg(prazo) filter (where prazo > 0)::numeric, 2), 0) as prazo_medio
      from f
      where uf_destino_eff <> '' and regiao_destino_eff <> ''
      group by uf_destino_eff, regiao_destino_eff
    ) u
  ),
  rk as (
    select
      f.rota_key,
      max(f.rota_label) as rota_label,
      max(f.canal_f) as canal,
      max(f.regiao_origem) as regiao_origem,
      max(f.regiao_destino_eff) as regiao_destino,
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
        'rota_key', sub.rota_key,
        'rota_label', sub.rota_label,
        'canal', sub.canal,
        'regiao_origem', sub.regiao_origem,
        'regiao_destino', sub.regiao_destino,
        'qtd_transportadoras', sub.qtd_transportadoras,
        'qtd_transportadoras_oficiais', sub.qtd_transportadoras_oficiais,
        'qtd_transportadoras_negociacao', sub.qtd_transportadoras_negociacao,
        'menor_prazo', sub.menor_prazo,
        'maior_prazo', sub.maior_prazo,
        'prazo_medio', sub.prazo_medio,
        'melhores_transportadoras', coalesce(sub.melhores, '')
      )
      order by sub.qtd_transportadoras_oficiais, sub.qtd_transportadoras, sub.rota_label
    ), '[]'::jsonb) as payload
    from (
      select rk.*, mel.melhores
      from rk
      left join mel on mel.rota_key = rk.rota_key
      where rk.qtd_transportadoras_oficiais <= 1
      order by rk.qtd_transportadoras_oficiais, rk.qtd_transportadoras, rk.rota_label
      limit greatest(coalesce(p_limite_rotas_criticas, 500), 0)
    ) sub
  ),
  melhores_prazos as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'rota_key', sub.rota_key,
        'rota_label', sub.rota_label,
        'canal', sub.canal,
        'regiao_origem', sub.regiao_origem,
        'regiao_destino', sub.regiao_destino,
        'qtd_transportadoras', sub.qtd_transportadoras,
        'qtd_transportadoras_oficiais', sub.qtd_transportadoras_oficiais,
        'qtd_transportadoras_negociacao', sub.qtd_transportadoras_negociacao,
        'menor_prazo', sub.menor_prazo,
        'maior_prazo', sub.maior_prazo,
        'prazo_medio', sub.prazo_medio,
        'melhores_transportadoras', coalesce(sub.melhores, '')
      )
      order by sub.menor_prazo, sub.qtd_transportadoras desc
    ), '[]'::jsonb) as payload
    from (
      select rk.*, mel.melhores
      from rk
      left join mel on mel.rota_key = rk.rota_key
      where rk.menor_prazo > 0
      order by rk.menor_prazo, rk.qtd_transportadoras desc
      limit greatest(coalesce(p_limite_melhores, 20), 0)
    ) sub
  ),
  lacunas as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'rota_key', sub.rota_key,
        'rota_label', sub.rota_label,
        'canal', sub.canal,
        'regiao_origem', sub.regiao_origem,
        'regiao_destino', sub.regiao_destino,
        'qtd_transportadoras', sub.qtd_transportadoras,
        'qtd_transportadoras_oficiais', sub.qtd_transportadoras_oficiais,
        'qtd_transportadoras_negociacao', sub.qtd_transportadoras_negociacao,
        'menor_prazo', sub.menor_prazo,
        'prazo_medio', sub.prazo_medio
      )
      order by sub.qtd_transportadoras_oficiais, sub.rota_label
    ), '[]'::jsonb) as payload
    from (
      select rk.*
      from rk
      where rk.qtd_transportadoras_oficiais <= 1
      order by rk.qtd_transportadoras_oficiais, rk.rota_label
      limit greatest(coalesce(p_limite_lacunas, 2000), 0)
    ) sub
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

notify pgrst, 'reload schema';
