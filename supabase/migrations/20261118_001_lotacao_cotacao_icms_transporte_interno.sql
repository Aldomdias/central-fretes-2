-- Cotacao de lotacao: corrige o ICMS das rotas DENTRO do mesmo estado.
-- O portal usava a aliquota interna de MERCADORIA (ex.: SP 18%) quando a rota nao estava
-- na tela ICMS UF. Para servico de transporte intermunicipal a aliquota e outra
-- (SP/PR/RS/ES 12%; AL 20,5% desde 01/04/2026).
-- O transportador informou o VALOR LIQUIDO, que nao muda: so ICMS e bruto sao recalculados.
--   bruto = liquido / (1 - aliquota)      icms = bruto - liquido

-- 1) Conferencia antes (quantas propostas mudam, por UF):
-- select r.uf_origem, p.aliquota_icms, count(*)
--   from lotacao_cotacao_propostas p
--   join lotacao_cotacao_rotas r on r.cotacao_id = p.cotacao_id and r.chave = p.chave
--  where upper(r.uf_origem) = upper(r.uf_destino) group by 1, 2 order by 1, 2;

-- 2) Recalculo
with nova as (
  select p.id, v.aliquota
    from lotacao_cotacao_propostas p
    join lotacao_cotacao_rotas r on r.cotacao_id = p.cotacao_id and r.chave = p.chave
    join (values ('SP', 12::numeric), ('PR', 12), ('RS', 12), ('ES', 12), ('AL', 20.5)) as v(uf, aliquota)
      on v.uf = upper(r.uf_origem)
   where upper(r.uf_origem) = upper(r.uf_destino)
     and p.valor_liquido > 0
     and p.aliquota_icms is distinct from v.aliquota
)
update lotacao_cotacao_propostas p
   set aliquota_icms = n.aliquota,
       valor_bruto   = round(p.valor_liquido / (1 - n.aliquota / 100), 2),
       icms_valor    = round(p.valor_liquido / (1 - n.aliquota / 100), 2) - round(p.valor_liquido, 2),
       updated_at    = now()
  from nova n
 where n.id = p.id;

-- 3) A tela ICMS UF tem prioridade sobre a regra do codigo. Se esta consulta trouxer
--    SP->SP (ou PR/RS/ES/AL) com a aliquota antiga, corrija la tambem:
-- select e from simulador_configuracoes c, jsonb_array_elements(c.valor) e
--  where c.chave = 'matriz_icms_uf' and upper(e->>'ufOrigem') = upper(e->>'ufDestino');
