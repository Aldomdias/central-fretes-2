-- Revisao de tabela ja publicada: a revisao nasce como uma negociacao NOVA
-- (aparece no pipeline como qualquer outra), ligada a negociacao publicada que
-- ela pretende substituir. A publicada continua vigente e com o saving
-- correndo enquanto a revisao e negociada.
--
-- revisao_de_id     -> na revisao, aponta pra negociacao publicada de origem
-- revisao_numero    -> ciclo da revisao (2a, 3a tabela daquela transportadora)
-- revisao_aberta_id -> na publicada, aponta pra revisao em andamento

alter table public.tabelas_negociacao
  add column if not exists revisao_de_id uuid,
  add column if not exists revisao_numero integer,
  add column if not exists revisao_aberta_id uuid;

create index if not exists tabelas_negociacao_revisao_de_id_idx
  on public.tabelas_negociacao (revisao_de_id)
  where revisao_de_id is not null;

create index if not exists tabelas_negociacao_revisao_aberta_id_idx
  on public.tabelas_negociacao (revisao_aberta_id)
  where revisao_aberta_id is not null;
