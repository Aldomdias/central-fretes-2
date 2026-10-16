-- Configuracao do robo auditor editavel na tela (Automacao > Robo Auditor): liga/desliga, horarios,
-- dias da semana e limites do calculo na nuvem. Uma unica linha (id = 1).
create table if not exists public.auditor_robo_config (
  id integer primary key default 1 check (id = 1),
  ativo boolean not null default true,
  horas integer[] not null default '{6,12,19}',            -- horas cheias (0-23), horario de Brasilia
  dias_semana integer[] not null default '{0,1,2,3,4,5,6}', -- 0 = domingo ... 6 = sabado
  calcular_nuvem boolean not null default true,
  max_faturas integer not null default 60,                 -- faturas novas por rodada
  bloco_ctes integer not null default 10,                  -- CT-es por bloco de calculo
  limite_bloco_seg integer not null default 75,            -- bloco que passa disso e abandonado
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);

insert into public.auditor_robo_config (id) values (1) on conflict (id) do nothing;

alter table public.auditor_robo_config enable row level security;
grant select, insert, update, delete on public.auditor_robo_config to anon, authenticated;
drop policy if exists "central_fretes_access" on public.auditor_robo_config;
create policy "central_fretes_access" on public.auditor_robo_config
  for all to anon, authenticated using (true) with check (true);
