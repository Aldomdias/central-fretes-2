-- Painel Black (cargas YVEC por origem x transportadora)
-- O robo roda no PC (C:\robo_black), le a ZEWM003 do SAP e publica aqui a cada rodada.
-- robo_black_snapshot: sempre 1 linha (id = 'atual') com tudo que a tela precisa.
-- robo_black_rodadas : historico das rodadas (para a tela avisar se o robo parou).

create table if not exists public.robo_black_snapshot (
  id text primary key default 'atual',
  dia date not null,
  gerado_em timestamptz not null default now(),
  payload jsonb not null,
  resumo jsonb,
  executado_por text,
  updated_at timestamptz not null default now()
);

create table if not exists public.robo_black_rodadas (
  id uuid primary key default gen_random_uuid(),
  dia date,
  status text not null,               -- SUCESSO | ERRO
  remessas_novas integer default 0,
  carregadas integer default 0,
  saldo_pneus integer default 0,
  alertas integer default 0,
  erro text,
  executado_por text,
  created_at timestamptz not null default now()
);

create index if not exists idx_robo_black_rodadas_data on public.robo_black_rodadas(created_at desc);

alter table public.robo_black_snapshot enable row level security;
alter table public.robo_black_rodadas enable row level security;

grant select, insert, update on public.robo_black_snapshot to anon, authenticated;
grant select, insert on public.robo_black_rodadas to anon, authenticated;

drop policy if exists "central_fretes_access" on public.robo_black_snapshot;
create policy "central_fretes_access" on public.robo_black_snapshot for all to anon, authenticated using (true) with check (true);
drop policy if exists "central_fretes_access" on public.robo_black_rodadas;
create policy "central_fretes_access" on public.robo_black_rodadas for all to anon, authenticated using (true) with check (true);
