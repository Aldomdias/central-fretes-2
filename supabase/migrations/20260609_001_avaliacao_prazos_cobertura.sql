create index if not exists idx_tabelas_negociacao_itens_tipo_item
  on public.tabelas_negociacao_itens ((dados_originais ->> 'tipo_item'));

create or replace view public.vw_avaliacao_prazos_cobertura
with (security_invoker = true)
as
select
  i.id,
  i.tabela_negociacao_id,
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
    nullif(i.dados_originais ->> 'metodoEnvio', '')
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
    nullif(i.ibge_origem, ''),
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
    nullif(i.ibge_destino, ''),
    nullif(i.dados_originais ->> 'ibgeDestino', '')
  ) as ibge_destino,
  coalesce(
    nullif(i.prazo, 0),
    nullif((i.dados_originais ->> 'prazoEntregaDias')::integer, 0)
  ) as prazo,
  coalesce(i.valor_lotacao, i.frete_minimo, i.taxa_aplicada, 0) as valor_referencia,
  coalesce(nullif(i.observacao, ''), nullif(t.observacao, '')) as observacao
from public.tabelas_negociacao_itens i
join public.tabelas_negociacao t
  on t.id = i.tabela_negociacao_id
left join public.ibge_municipios m
  on m.codigo_municipio_completo = coalesce(
    nullif(i.ibge_destino, ''),
    nullif(i.dados_originais ->> 'ibgeDestino', '')
  )
where i.dados_originais ->> 'tipo_item' = 'ROTA';

grant select on public.vw_avaliacao_prazos_cobertura to anon, authenticated;
