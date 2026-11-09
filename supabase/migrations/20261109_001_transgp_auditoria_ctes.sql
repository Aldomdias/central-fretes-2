-- Auditoria de fretes do painel da TransGP (API painel-transgp.vercel.app/api/v1/auditoria/fretes).
-- Sincronizada pelo endpoint /api/transgp-auditoria (cron de hora em hora): uma linha por CT-e da DIST,
-- com a situacao que a TransGP deu a DIST. A Auditoria usa a linha pela chave do CT-e:
-- AUTORIZADO_AUTOMATICO / AUTORIZADO_AUDITORIA (liberado_pagamento) => CT-e auditado pelo valor cobrado;
-- REPROVADO => nao pagar; DIVERGENTE => calcula pelo frete contratado da DIST (diferenca vira divergencia).
create table if not exists public.transgp_auditoria_ctes (
  chave_cte text primary key,               -- 44 digitos (ou "DIST|numero" quando a API nao trouxer a chave)
  numero_cte text,
  serie text,
  valor_cte numeric(16,2),
  dist text not null,
  operacao text,
  transportadora text,
  origem text,
  destinos text,
  coleta_planejada timestamptz,
  status_carga text,
  frete_contratado numeric(16,2),
  pedagio numeric(16,2),
  total_contratado numeric(16,2),
  qtd_ctes integer,
  cte_total numeric(16,2),
  diferenca_total numeric(16,2),
  situacao text,
  liberado_pagamento boolean not null default false,
  liberado_em timestamptz,
  decisao_auditoria jsonb,
  payload jsonb,
  sincronizado_em timestamptz not null default now()
);
create index if not exists transgp_auditoria_ctes_dist_idx on public.transgp_auditoria_ctes (dist);
create index if not exists transgp_auditoria_ctes_numero_idx on public.transgp_auditoria_ctes (numero_cte);

-- Historico das sincronizacoes (para ver na tela se o cron esta rodando).
create table if not exists public.transgp_auditoria_sync_log (
  id bigint generated always as identity primary key,
  iniciado_em timestamptz not null default now(),
  periodo_de date,
  periodo_ate date,
  dists integer default 0,
  ctes integer default 0,
  ok boolean,
  erro text
);

alter table public.transgp_auditoria_ctes enable row level security;
alter table public.transgp_auditoria_sync_log enable row level security;
grant select on public.transgp_auditoria_ctes to anon, authenticated;
grant select on public.transgp_auditoria_sync_log to anon, authenticated;
drop policy if exists "central_fretes_leitura" on public.transgp_auditoria_ctes;
create policy "central_fretes_leitura" on public.transgp_auditoria_ctes for select to anon, authenticated using (true);
drop policy if exists "central_fretes_leitura" on public.transgp_auditoria_sync_log;
create policy "central_fretes_leitura" on public.transgp_auditoria_sync_log for select to anon, authenticated using (true);

notify pgrst, 'reload schema';
