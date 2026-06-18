-- =====================================================================
-- POR QUE O MÊS 2026-02 NÃO CALCULOU NADA?
-- Tabela de resultados: auditoria_cte_resultados
-- =====================================================================

-- 1) DISTRIBUIÇÃO DOS STATUS DE CÁLCULO NO MÊS 2026-02
-- (SEM_TABELA, SEM_ORIGEM, SEM_ROTA, SEM_FAIXA, ERRO_CALCULO, CALCULADO)
SELECT
  status_calculo,
  motivo_sem_calculo,
  COUNT(*) AS ctes
FROM auditoria_cte_resultados
WHERE competencia = '2026-02'
GROUP BY status_calculo, motivo_sem_calculo
ORDER BY ctes DESC;

-- 2) COMPARAÇÃO ENTRE OS MESES (pra ver o que muda no 02)
SELECT
  competencia,
  status_calculo,
  COUNT(*) AS ctes
FROM auditoria_cte_resultados
WHERE competencia IN ('2026-01','2026-02','2026-03')
GROUP BY competencia, status_calculo
ORDER BY competencia, ctes DESC;

-- 3) AMOSTRA DE 20 CT-es DO MÊS 02 (ver transportadora, IBGE, canal, datas)
SELECT
  chave_cte, data_emissao, transportadora, canal,
  cidade_origem, uf_origem, ibge_origem,
  cidade_destino, uf_destino, ibge_destino,
  peso, valor_cte, valor_calculado, status_calculo, motivo_sem_calculo
FROM auditoria_cte_resultados
WHERE competencia = '2026-02'
LIMIT 20;

-- 4) CONFERIR A BASE DE ORIGEM (realizado_local_ctes) DO MÊS 02
-- Será que os CT-es de 02 têm IBGE/transportadora preenchidos como nos outros meses?
SELECT
  competencia,
  COUNT(*)                                                             AS ctes,
  COUNT(*) FILTER (WHERE transportadora IS NULL OR transportadora='')  AS sem_transportadora,
  COUNT(*) FILTER (WHERE canal IS NULL OR canal='')                    AS sem_canal,
  COUNT(*) FILTER (WHERE data_emissao IS NULL)                         AS sem_data_emissao,
  MIN(data_emissao)                                                    AS data_min,
  MAX(data_emissao)                                                    AS data_max
FROM realizado_local_ctes
WHERE competencia IN ('2026-01','2026-02','2026-03')
GROUP BY competencia
ORDER BY competencia;

-- 5) CONFERIR SE A COMPETÊNCIA BATE COM A DATA_EMISSAO NO MÊS 02
-- (o recálculo busca por data_emissao entre 2026-02-01 e 2026-02-28;
--  se a data_emissao estiver fora desse intervalo, ele cai no fallback por competencia)
SELECT
  to_char(data_emissao, 'YYYY-MM') AS mes_da_data_emissao,
  COUNT(*) AS ctes
FROM realizado_local_ctes
WHERE competencia = '2026-02'
GROUP BY 1
ORDER BY 1;
