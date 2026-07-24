-- Remove linhas 100% idênticas em lotacao_cargas (mesma DIST + mesmo valor
-- comparação + mesmo frete Cantu + mesmo frete transportadora + mesmo
-- pedágio), mantendo sempre a linha mais recente (importado_em) de cada
-- grupo. Causa: reimportações do mesmo arquivo inserem linhas repetidas em
-- vez de atualizar/ignorar, inflando totais e escondendo DISTs em buscas
-- com limite de resultados.

-- 1) Rode isto primeiro para conferir quantas linhas seriam removidas:
select count(*) as duplicatas_a_remover
from (
  select id,
         row_number() over (
           partition by
             dist,
             round(coalesce(valor_comparacao, 0)::numeric, 2),
             round(coalesce(frete_cantu, 0)::numeric, 2),
             round(coalesce(frete_transp, 0)::numeric, 2),
             round(coalesce(pedagio, 0)::numeric, 2)
           order by importado_em desc nulls last, id desc
         ) as rn
  from lotacao_cargas
) t
where rn > 1;

-- 2) Depois de conferir, rode isto para efetivamente apagar:
delete from lotacao_cargas
where id in (
  select id
  from (
    select id,
           row_number() over (
             partition by
               dist,
               round(coalesce(valor_comparacao, 0)::numeric, 2),
               round(coalesce(frete_cantu, 0)::numeric, 2),
               round(coalesce(frete_transp, 0)::numeric, 2),
               round(coalesce(pedagio, 0)::numeric, 2)
             order by importado_em desc nulls last, id desc
           ) as rn
    from lotacao_cargas
  ) t
  where rn > 1
);

-- 3) Confira o total final:
select count(*) as total_apos_limpeza from lotacao_cargas;
