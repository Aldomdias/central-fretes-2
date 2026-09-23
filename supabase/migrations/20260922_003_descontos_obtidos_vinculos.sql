-- Vínculo de nome de transportadora exclusivo da conciliação "Enviado x
-- Realizado" do Painel de Descontos Obtidos. Não reaproveita
-- transportadora_vinculos (Ferramentas > Transportadoras) porque aquele
-- cadastro liga nome de CT-e a nome de tabela de negociação — uma base que
-- não tem relação com os nomes usados no financeiro/SAP deste painel.
create table if not exists public.descontos_obtidos_vinculos (
  id uuid primary key default gen_random_uuid(),
  nome_enviado text not null,
  nome_realizado text not null,
  nome_enviado_normalizado text not null,
  nome_realizado_normalizado text not null,
  origem text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nome_enviado_normalizado)
);

create index if not exists idx_descontos_obtidos_vinculos_normalizado
  on public.descontos_obtidos_vinculos (nome_enviado_normalizado);

alter table public.descontos_obtidos_vinculos enable row level security;

grant select, insert, update, delete on public.descontos_obtidos_vinculos to anon, authenticated;

drop policy if exists "descontos_obtidos_vinculos_access" on public.descontos_obtidos_vinculos;

create policy "descontos_obtidos_vinculos_access"
  on public.descontos_obtidos_vinculos
  for all to anon, authenticated
  using (true)
  with check (true);

comment on table public.descontos_obtidos_vinculos is
  'Vínculo nome-enviado -> nome-realizado exclusivo da conciliação do Painel de Descontos Obtidos.';
