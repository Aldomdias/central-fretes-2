-- Modalidade "tabela propria" do portal de frete fracionado: o transportador anexa a tabela
-- dele (Excel/PDF/etc.) e escreve as generalidades, que a Suprimentos avalia se entram no escopo.
-- Anexos ficam em tabela (base64, ate ~3 MB por arquivo) para nao depender de bucket de storage.
-- O campo fracionado_convites.modalidade passa a aceitar tambem 'PROPRIA' (sem constraint, nada a alterar).

create table if not exists public.fracionado_anexos (
  id uuid primary key default gen_random_uuid(),
  convite_id uuid not null references public.fracionado_convites(id) on delete cascade,
  canal text not null,
  nome text not null,
  tipo text,
  tamanho integer not null default 0,
  conteudo text not null,           -- arquivo em base64
  created_at timestamptz not null default now()
);

create index if not exists idx_fracionado_anexos_convite on public.fracionado_anexos (convite_id);

alter table public.fracionado_anexos enable row level security;
drop policy if exists fracionado_anexos_all on public.fracionado_anexos;
create policy fracionado_anexos_all on public.fracionado_anexos for all using (true) with check (true);
grant all on public.fracionado_anexos to anon, authenticated;
