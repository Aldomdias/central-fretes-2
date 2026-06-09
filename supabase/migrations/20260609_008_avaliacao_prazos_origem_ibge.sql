-- 4.36.2.9 — Filtro de origem por UF/região com fallback IBGE (espelha destino)

create or replace function public.amd_ap_match_uf_origem(
  p_uf text,
  p_uf_origem_f text,
  p_ibge_origem text
)
returns boolean
language sql
immutable
as $$
  select public.amd_ap_match_uf_destino(p_uf, p_uf_origem_f, p_ibge_origem);
$$;

create or replace function public.amd_ap_match_regiao_origem(
  p_regiao text,
  p_uf_origem_f text,
  p_ibge_origem text,
  p_regiao_origem text
)
returns boolean
language sql
immutable
as $$
  select public.amd_ap_match_regiao_destino(p_regiao, p_uf_origem_f, p_ibge_origem, p_regiao_origem);
$$;

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
  select mv.*
  from public.mvw_avaliacao_prazos_cobertura mv
  where (nullif(trim(coalesce(p_fonte, '')), '') is null or mv.fonte_tabela = upper(trim(p_fonte)))
    and (nullif(trim(coalesce(p_canal, '')), '') is null or mv.canal_f = upper(trim(p_canal)))
    and (nullif(trim(coalesce(p_tipo_tabela, '')), '') is null or mv.tipo_tabela_f = upper(trim(p_tipo_tabela)))
    and (nullif(trim(coalesce(p_status, '')), '') is null or mv.status_f = upper(trim(p_status)))
    and (nullif(trim(coalesce(p_transportadora, '')), '') is null or mv.transportadora_norm = public.amd_normalizar(p_transportadora))
    and public.amd_ap_match_uf_origem(p_uf_origem, mv.uf_origem_f, mv.ibge_origem)
    and public.amd_ap_match_regiao_origem(p_regiao_origem, mv.uf_origem_f, mv.ibge_origem, mv.regiao_origem)
    and public.amd_ap_match_uf_destino(p_uf_destino, mv.uf_destino_f, mv.ibge_destino)
    and public.amd_ap_match_regiao_destino(p_regiao_destino, mv.uf_destino_f, mv.ibge_destino, mv.regiao_destino)
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

grant execute on function public.amd_ap_match_uf_origem(text, text, text) to anon, authenticated;
grant execute on function public.amd_ap_match_regiao_origem(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
