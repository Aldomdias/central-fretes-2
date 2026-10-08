-- CSRG: cria a tabela alternativa "TRANSFERENCIA" em TODAS as origens da
-- transportadora, com todas as rotas que a tabela principal ja tem, mas com
-- cotacao unica de 0,8% sobre o valor da NF (negociacao de transferencia entre
-- unidades). Usada pela Auditoria quando remetente e destinatario do CT-e sao
-- da mesma empresa (mesma raiz de CNPJ). Idempotente: apaga e recria o grupo.

do $$
declare
  v_grupo text := 'TRANSFERENCIA';
  v_percentual numeric := 0.8;
  v_origens uuid[];
begin
  select array_agg(o.id) into v_origens
  from public.origens o
  join public.transportadoras t on t.id = o.transportadora_id
  where t.nome ilike 'CSRG%';

  if v_origens is null then
    raise exception 'Transportadora CSRG nao encontrada';
  end if;

  -- limpa execucao anterior
  delete from public.rotas where origem_id = any(v_origens) and grupo_tabela_alternativa = v_grupo;
  delete from public.cotacoes where origem_id = any(v_origens) and grupo_tabela_alternativa = v_grupo;
  delete from public.generalidades where origem_id = any(v_origens) and grupo_tabela_alternativa = v_grupo;

  -- rotas: copia todas as da tabela principal
  insert into public.rotas (
    id, origem_id, payload, nome_rota, ibge_origem, ibge_destino, canal,
    prazo_entrega_dias, valor_minimo_frete, codigo_unidade, cep_inicial, cep_final,
    metodo_envio, inicio_vigencia, fim_vigencia, extra, grupo_tabela_alternativa
  )
  select
    gen_random_uuid(), r.origem_id, r.payload, r.nome_rota, r.ibge_origem, r.ibge_destino, r.canal,
    r.prazo_entrega_dias, 0, r.codigo_unidade, r.cep_inicial, r.cep_final,
    r.metodo_envio, r.inicio_vigencia, r.fim_vigencia, r.extra, v_grupo
  from public.rotas r
  where r.origem_id = any(v_origens)
    and r.grupo_tabela_alternativa is null;

  -- cotacoes: uma por nome de cotacao usado na origem, faixa unica, 0,8% da NF
  insert into public.cotacoes (
    id, origem_id, payload, rota, peso_min, peso_max, rs_kg, excesso, percentual,
    valor_fixo, extra, grupo_tabela_alternativa
  )
  select distinct on (c.origem_id, c.rota)
    gen_random_uuid(), c.origem_id, c.payload, c.rota, 0, 99999999, 0, 0, v_percentual, 0,
    coalesce(c.extra, '{}'::jsonb)
      || jsonb_build_object('tipoCalculo', 'PERCENTUAL', 'regraCalculo', 'Maior valor', 'freteMinimo', '0'),
    v_grupo
  from public.cotacoes c
  where c.origem_id = any(v_origens)
    and c.grupo_tabela_alternativa is null
  order by c.origem_id, c.rota, c.peso_min;

  -- generalidades da alternativa: tudo zerado, calculo percentual (sem ICMS/taxas)
  insert into public.generalidades (
    origem_id, payload, incide_icms, aliquota_icms, ad_valorem, ad_valorem_minimo,
    pedagio, gris, gris_minimo, tas, ctrc, cubagem, tipo_calculo, observacoes,
    frete_minimo, regra_calculo, taxa_emergencial, grupo_tabela_alternativa
  )
  select
    o, '{}'::jsonb, false, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'PERCENTUAL',
    'Transferencia entre unidades: 0,8% sobre a NF', 0, '', 0, v_grupo
  from unnest(v_origens) as o;
end $$;
