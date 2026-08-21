-- Quais transportadoras fazem logística reversa.
-- Ter tabela de frete para a rota não significa fazer coleta reversa: sem essa
-- marcação o Simulador Reversa ranqueia qualquer transportadora que atenda o
-- par origem/destino e mostra como "mais barata" uma opção que a operação não
-- consegue acionar. Marcação feita na própria tela Simulação > Simulador Reversa.
--
-- A tela funciona antes desta migration rodar (cai em localStorage), mas aí a
-- marcação fica só no navegador de quem marcou.

create table if not exists public.transportadoras_reversa (
  id uuid primary key default gen_random_uuid(),
  transportadora text not null,
  transportadora_norm text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists transportadoras_reversa_norm_uidx
  on public.transportadoras_reversa (transportadora_norm);

alter table public.transportadoras_reversa enable row level security;

-- Mesmo modelo de acesso das demais tabelas do app.
drop policy if exists transportadoras_reversa_all on public.transportadoras_reversa;
create policy transportadoras_reversa_all on public.transportadoras_reversa
  for all using (true) with check (true);

grant all on public.transportadoras_reversa to anon, authenticated;
