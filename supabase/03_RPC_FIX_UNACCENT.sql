-- ============================================================
-- PATCH 3: Correção de acento na busca por cidade (origem)
-- Problema: "Itajai" não casava com "Itajaí" no banco
-- Rode no SQL Editor do Supabase
-- ============================================================

-- 1. Habilita extensão unaccent (já disponível no Supabase, sem custo)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Recria a RPC com normalização de acento nas comparações de cidade
CREATE OR REPLACE FUNCTION public.buscar_base_simulacao(
  p_origem       text    DEFAULT '',
  p_canal        text    DEFAULT '',
  p_destinos     text[]  DEFAULT '{}',
  p_uf_destino   text    DEFAULT '',
  p_transportadora text  DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origem_norm     text;
  v_canal_cats      text[];
  v_origens         jsonb;
  v_origem_ids      uuid[];
  v_destinos_ibge   text[];
  v_rotas           jsonb;
  v_origens_com_rota uuid[];
  v_transp_ids      uuid[];
  v_generalidades   jsonb;
  v_cotacoes        jsonb;
  v_taxas           jsonb;
  v_transportadoras jsonb;
BEGIN
  -- Normaliza canal → categorias compatíveis
  v_canal_cats := CASE
    WHEN lower(p_canal) IN ('atacado','b2b','cantu','cantu pneus') THEN ARRAY['ATACADO','B2B','CANTU','CANTU PNEUS']
    WHEN lower(p_canal) IN ('b2c','via varejo','mercado livre','mercador livre','b2w',
                             'magazine luiza','carrefour','gpa','colombo','amazon','inter',
                             'anymarket','bradesco shop','itaú shop','shopee','livelo',
                             'marketplace/e-commerce','marketplace') THEN
      ARRAY['B2C','Via Varejo','Mercado Livre','Mercador Livre','B2W','Magazine Luiza',
            'Carrefour','GPA','Colombo','Amazon','Inter','AnyMarket','Bradesco Shop',
            'Itaú Shop','Shopee','Livelo','Marketplace/E-commerce']
    WHEN p_canal = '' OR p_canal IS NULL THEN ARRAY[]::text[]
    ELSE ARRAY[p_canal]
  END;

  -- Normaliza origem: remove acento, lowercase
  -- unaccent('Itajaí') = 'Itajai', lower = 'itajai'
  v_origem_norm := lower(unaccent(trim(p_origem)));

  -- 1. Busca origens filtradas (com unaccent nas comparações)
  SELECT jsonb_agg(o)
  INTO v_origens
  FROM public.origens o
  JOIN public.transportadoras t ON t.id = o.transportadora_id
  WHERE
    (
      v_origem_norm = ''
      OR lower(unaccent(o.cidade)) LIKE v_origem_norm || '%'
      OR lower(unaccent(o.cidade)) LIKE '%' || v_origem_norm || '%'
    )
    AND (array_length(v_canal_cats, 1) IS NULL OR o.canal = ANY(v_canal_cats) OR o.canal IS NULL)
    AND (
      p_transportadora = ''
      OR lower(unaccent(t.nome)) LIKE lower(unaccent(p_transportadora))
      OR lower(unaccent(t.nome)) LIKE '%' || lower(unaccent(p_transportadora)) || '%'
    );

  IF v_origens IS NULL THEN
    RETURN jsonb_build_object('transportadoras', '[]'::jsonb, 'origens', '[]'::jsonb,
                              'rotas', '[]'::jsonb, 'cotacoes', '[]'::jsonb,
                              'taxas', '[]'::jsonb, 'generalidades', '[]'::jsonb);
  END IF;

  SELECT array_agg((o->>'id')::uuid)
  INTO v_origem_ids
  FROM jsonb_array_elements(v_origens) o;

  IF v_origem_ids IS NULL OR array_length(v_origem_ids, 1) = 0 THEN
    RETURN jsonb_build_object('transportadoras', '[]'::jsonb, 'origens', '[]'::jsonb,
                              'rotas', '[]'::jsonb, 'cotacoes', '[]'::jsonb,
                              'taxas', '[]'::jsonb, 'generalidades', '[]'::jsonb);
  END IF;

  -- Normaliza destinos (apenas dígitos)
  SELECT array_agg(regexp_replace(d, '\D', '', 'g'))
  INTO v_destinos_ibge
  FROM unnest(p_destinos) d
  WHERE regexp_replace(d, '\D', '', 'g') <> '';

  -- 2. Busca rotas
  SELECT jsonb_agg(r)
  INTO v_rotas
  FROM public.rotas r
  WHERE r.origem_id = ANY(v_origem_ids)
    AND (
      (v_destinos_ibge IS NULL OR array_length(v_destinos_ibge, 1) = 0)
      OR r.ibge_destino = ANY(v_destinos_ibge)
      OR (p_uf_destino <> '' AND left(r.ibge_destino, 2) = (
        SELECT prefix FROM (VALUES
          ('RO','11'),('AC','12'),('AM','13'),('RR','14'),('PA','15'),('AP','16'),('TO','17'),
          ('MA','21'),('PI','22'),('CE','23'),('RN','24'),('PB','25'),('PE','26'),('AL','27'),('SE','28'),('BA','29'),
          ('MG','31'),('ES','32'),('RJ','33'),('SP','35'),
          ('PR','41'),('SC','42'),('RS','43'),
          ('MS','50'),('MT','51'),('GO','52'),('DF','53')
        ) AS m(uf, prefix)
        WHERE uf = upper(p_uf_destino)
      ))
    );

  IF v_rotas IS NULL OR jsonb_array_length(v_rotas) = 0 THEN
    RETURN jsonb_build_object('transportadoras', '[]'::jsonb, 'origens', v_origens,
                              'rotas', '[]'::jsonb, 'cotacoes', '[]'::jsonb,
                              'taxas', '[]'::jsonb, 'generalidades', '[]'::jsonb);
  END IF;

  SELECT array_agg(DISTINCT (r->>'origem_id')::uuid)
  INTO v_origens_com_rota
  FROM jsonb_array_elements(v_rotas) r;

  SELECT array_agg(DISTINCT (o->>'transportadora_id')::uuid)
  INTO v_transp_ids
  FROM jsonb_array_elements(v_origens) o
  WHERE (o->>'id')::uuid = ANY(v_origens_com_rota);

  -- 3. Busca dados complementares
  SELECT jsonb_agg(t) INTO v_transportadoras
  FROM public.transportadoras t WHERE t.id = ANY(v_transp_ids);

  SELECT jsonb_agg(g) INTO v_generalidades
  FROM public.generalidades g WHERE g.origem_id = ANY(v_origens_com_rota);

  SELECT jsonb_agg(c) INTO v_cotacoes
  FROM public.cotacoes c WHERE c.origem_id = ANY(v_origens_com_rota);

  SELECT jsonb_agg(tx) INTO v_taxas
  FROM public.taxas_especiais tx
  WHERE tx.origem_id = ANY(v_origens_com_rota)
    AND (v_destinos_ibge IS NULL OR array_length(v_destinos_ibge, 1) = 0
         OR tx.ibge_destino = ANY(v_destinos_ibge));

  RETURN jsonb_build_object(
    'transportadoras', COALESCE(v_transportadoras, '[]'::jsonb),
    'origens',         v_origens,
    'rotas',           v_rotas,
    'cotacoes',        COALESCE(v_cotacoes, '[]'::jsonb),
    'taxas',           COALESCE(v_taxas, '[]'::jsonb),
    'generalidades',   COALESCE(v_generalidades, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_base_simulacao(text, text, text[], text, text) TO anon, authenticated;

-- Teste rápido — deve retornar dados:
-- SELECT public.buscar_base_simulacao('Itajai', 'ATACADO', '{}', '', '');
-- SELECT public.buscar_base_simulacao('Itajaí', 'ATACADO', '{}', '', '');
-- Ambos devem retornar o mesmo resultado agora.
