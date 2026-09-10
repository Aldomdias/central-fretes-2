-- Suporte a "tabela alternativa" na estrutura OFICIAL de rotas/cotações
-- (a que a tela Transportadoras edita e a Auditoria de CT-e realmente lê,
-- via carregarBaseCompletaDb/carregarBaseTransportadorasDb em
-- freteDatabaseService.js). Uma origem pode ter um conjunto "principal" de
-- rotas/cotações (comportamento atual, coluna nula) e um ou mais conjuntos
-- "alternativos" com rótulo livre (ex.: "OTR / Fora de estrada", "Rodas"),
-- reaproveitando a mesma estrutura de faixas de peso mas com valores
-- diferentes. Aditivo: coluna nula por padrão, nenhum fluxo existente muda
-- de comportamento sem cadastro explícito de alternativa.
--
-- Não confundir com tabela_alternativa_de/variante_tabela criadas em
-- 20260909120000_tabelas_negociacao_alternativas.sql — aquelas vivem em
-- `tabelas_negociacao` (módulo de Negociação/Simulador manual, não usado
-- pela Auditoria de CT-e real). Esta aqui vive em `rotas`/`cotacoes`
-- (estrutura oficial lida pela Auditoria).

alter table if exists public.rotas
  add column if not exists grupo_tabela_alternativa text null;

alter table if exists public.cotacoes
  add column if not exists grupo_tabela_alternativa text null;

comment on column public.rotas.grupo_tabela_alternativa is
  'Rótulo livre do conjunto de tabela alternativa ao qual esta rota pertence, dentro da mesma origem (ex.: "OTR / Fora de estrada", "Rodas"). Nulo = rota faz parte da tabela principal da origem (comportamento padrão, sem alternativas).';

comment on column public.cotacoes.grupo_tabela_alternativa is
  'Rótulo livre do conjunto de tabela alternativa ao qual esta cotação pertence, dentro da mesma origem (mesmo rótulo usado em rotas.grupo_tabela_alternativa). Nulo = cotação faz parte da tabela principal da origem (comportamento padrão, sem alternativas).';

create index if not exists idx_rotas_grupo_tabela_alternativa
  on public.rotas (origem_id, grupo_tabela_alternativa)
  where grupo_tabela_alternativa is not null;

create index if not exists idx_cotacoes_grupo_tabela_alternativa
  on public.cotacoes (origem_id, grupo_tabela_alternativa)
  where grupo_tabela_alternativa is not null;
