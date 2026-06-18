-- =====================================================================
-- DIAGNÓSTICO DA BASE DE CT-es (tabela: realizado_local_ctes)
-- Rode bloco a bloco no SQL Editor do Supabase.
-- =====================================================================

-- 1) PANORAMA GERAL -----------------------------------------------------
SELECT
  COUNT(*)                                    AS total_ctes,
  COUNT(DISTINCT chave_cte)                   AS chaves_distintas,
  COUNT(*) - COUNT(DISTINCT chave_cte)        AS possiveis_duplicadas,
  COUNT(DISTINCT competencia)                 AS qtd_competencias,
  COUNT(DISTINCT transportadora)              AS qtd_transportadoras,
  MIN(data_emissao)                           AS emissao_mais_antiga,
  MAX(data_emissao)                           AS emissao_mais_recente,
  SUM(COALESCE(valor_cte,0))                  AS soma_valor_cte,
  SUM(COALESCE(valor_nf,0))                   AS soma_valor_nf
FROM realizado_local_ctes;

-- 2) VOLUME POR COMPETÊNCIA (mês) --------------------------------------
SELECT
  competencia,
  COUNT(*)                       AS ctes,
  COUNT(DISTINCT transportadora) AS transportadoras,
  SUM(COALESCE(valor_cte,0))     AS valor_cte,
  SUM(COALESCE(valor_nf,0))      AS valor_nf
FROM realizado_local_ctes
GROUP BY competencia
ORDER BY competencia DESC;

-- 3) TOP TRANSPORTADORAS ----------------------------------------------
SELECT
  transportadora,
  COUNT(*)                   AS ctes,
  SUM(COALESCE(valor_cte,0)) AS valor_cte,
  MIN(data_emissao)          AS desde,
  MAX(data_emissao)          AS ate
FROM realizado_local_ctes
GROUP BY transportadora
ORDER BY valor_cte DESC
LIMIT 30;

-- 4) DISTRIBUIÇÃO POR CANAL -------------------------------------------
SELECT
  COALESCE(NULLIF(canal,''), '(sem canal)') AS canal,
  COUNT(*)                                  AS ctes,
  SUM(COALESCE(valor_cte,0))                AS valor_cte
FROM realizado_local_ctes
GROUP BY 1
ORDER BY ctes DESC;

-- 5) QUALIDADE DOS DADOS (campos vazios/zerados) ----------------------
SELECT
  COUNT(*) FILTER (WHERE chave_cte    IS NULL OR chave_cte = '')        AS sem_chave_cte,
  COUNT(*) FILTER (WHERE numero_cte   IS NULL OR numero_cte = '')       AS sem_numero_cte,
  COUNT(*) FILTER (WHERE transportadora IS NULL OR transportadora = '') AS sem_transportadora,
  COUNT(*) FILTER (WHERE data_emissao IS NULL)                          AS sem_emissao,
  COUNT(*) FILTER (WHERE valor_cte    IS NULL OR valor_cte = 0)         AS valor_cte_zerado,
  COUNT(*) FILTER (WHERE valor_nf     IS NULL OR valor_nf  = 0)         AS valor_nf_zerado,
  COUNT(*) FILTER (WHERE canal        IS NULL OR canal = '')            AS sem_canal,
  COUNT(*) FILTER (WHERE uf_origem    IS NULL OR uf_origem = '')        AS sem_uf_origem,
  COUNT(*) FILTER (WHERE uf_destino   IS NULL OR uf_destino = '')       AS sem_uf_destino,
  COUNT(*) FILTER (WHERE cidade_origem  IS NULL OR cidade_origem = '')  AS sem_cidade_origem,
  COUNT(*) FILTER (WHERE cidade_destino IS NULL OR cidade_destino = '') AS sem_cidade_destino
FROM realizado_local_ctes;

-- 6) DUPLICIDADES por chave_cte (as 50 piores) ------------------------
SELECT
  chave_cte,
  COUNT(*) AS ocorrencias
FROM realizado_local_ctes
WHERE chave_cte IS NOT NULL AND chave_cte <> ''
GROUP BY chave_cte
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 50;

-- 7) DISTRIBUIÇÃO POR SITUAÇÃO / STATUS -------------------------------
SELECT
  COALESCE(NULLIF(situacao,''), '(vazio)')           AS situacao,
  COALESCE(NULLIF(status,''), '(vazio)')             AS status,
  COALESCE(NULLIF(status_conciliacao,''), '(vazio)') AS status_conciliacao,
  COUNT(*) AS ctes
FROM realizado_local_ctes
GROUP BY 1,2,3
ORDER BY ctes DESC
LIMIT 50;

-- 8) FLUXOS UF ORIGEM -> UF DESTINO (top 30) --------------------------
SELECT
  uf_origem,
  uf_destino,
  COUNT(*)                   AS ctes,
  SUM(COALESCE(valor_cte,0)) AS valor_cte
FROM realizado_local_ctes
GROUP BY uf_origem, uf_destino
ORDER BY ctes DESC
LIMIT 30;

-- 9) (OPCIONAL) LISTAR TODAS AS COLUNAS REAIS DA TABELA ----------------
-- Use se quiser confirmar nomes/tipos das colunas existentes.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'realizado_local_ctes'
ORDER BY ordinal_position;
