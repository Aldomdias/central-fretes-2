-- Tabelas de referencia dentro da cotacao de lotacao (TransGP = transportadora da
-- casa / target, e ANTT 5 e 6 eixos). Ficam como "convites" sem link, so para guardar os valores.
alter table public.lotacao_cotacao_convites
  add column if not exists tipo text not null default 'TRANSPORTADOR';  -- TRANSPORTADOR | REF_CASA | REF_ANTT (5 eixos) | REF_ANTT_6 (6 eixos)

-- Eixos do veiculo da proposta do transportador (5 ou 6): define qual ANTT e usada na comparacao.
alter table public.lotacao_cotacao_convites
  add column if not exists eixos integer not null default 5;
