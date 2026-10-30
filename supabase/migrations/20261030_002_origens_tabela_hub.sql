-- Tabela HUB por origem (ex.: WM — carga sai do CD de Itajaí, a WM emite o
-- CT-e como Itupeva e cobra pela tabela de Itajaí).
--
-- hub                         : a origem é uma tabela HUB.
-- hub_cidades_emissao         : cidades (nome ou IBGE de 7 dígitos) em que a
--                               transportadora emite o CT-e dessa carga. CT-e
--                               emitido numa delas é auditado pela tabela HUB,
--                               mesmo existindo origem local cadastrada.
-- hub_vigencia_inicio         : a partir de quando a regra vale (data de
--                               emissão do CT-e). Nulo = sempre.
-- hub_custo_transferencia_pct : % sobre a NF do custo de levar a carga até o
--                               HUB. Só entra nas simulações/comparativos entre
--                               transportadoras; a Auditoria ignora.

alter table public.origens
  add column if not exists hub boolean not null default false,
  add column if not exists hub_cidades_emissao text[] not null default '{}',
  add column if not exists hub_vigencia_inicio date,
  add column if not exists hub_custo_transferencia_pct numeric not null default 0;

create index if not exists origens_hub_idx on public.origens (hub) where hub;
