-- Snapshot leve para listagem da Central de Negociações (sem carregar resumo_simulacao completo)
alter table if exists public.tabelas_negociacao
  add column if not exists resumo_capa jsonb;

create index if not exists idx_tabelas_negociacao_resumo_capa
  on public.tabelas_negociacao using gin (resumo_capa);

comment on column public.tabelas_negociacao.resumo_capa is
  'Recorte leve de resumo_simulacao para listagem/dashboard. Atualizado pelo front ao salvar simulações/importações.';

-- Backfill leve (rode em lotes se der timeout no MICRO):
-- update public.tabelas_negociacao
-- set resumo_capa = jsonb_build_object(
--   '_capa', true,
--   'rodada_atual', coalesce((resumo_simulacao->>'rodada_atual')::int, 1),
--   'ctesAnalisados', coalesce((resumo_simulacao->>'ctesAnalisados')::numeric, 0),
--   'aderenciaSelecionada', coalesce((resumo_simulacao->>'aderenciaSelecionada')::numeric, 0),
--   'savingSelecionadaVsRealMes', coalesce((resumo_simulacao->>'savingSelecionadaVsRealMes')::numeric, 0)
-- )
-- where resumo_capa is null
--   and resumo_simulacao is not null
--   and jsonb_typeof(resumo_simulacao) = 'object'
-- limit 50;
