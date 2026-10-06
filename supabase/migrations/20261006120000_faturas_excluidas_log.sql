-- Registro de faturas excluidas na Auditoria (controle da gestao).
-- Cada exclusao grava quem apagou, quando, o motivo e uma copia da fatura.
create table if not exists public.auditoria_faturas_excluidas (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid,
  numero_fatura text,
  serie_fatura text,
  transportadora text,
  cnpj_transportadora text,
  valor_fatura numeric(14,2),
  data_emissao date,
  data_vencimento date,
  status text,
  ctes_totais integer,
  motivo text,
  excluido_por text,
  excluido_por_email text,
  excluido_em timestamptz not null default now(),
  snapshot jsonb
);

create index if not exists idx_auditoria_faturas_excluidas_em
  on public.auditoria_faturas_excluidas (excluido_em desc);
create index if not exists idx_auditoria_faturas_excluidas_numero
  on public.auditoria_faturas_excluidas (numero_fatura);

alter table public.auditoria_faturas_excluidas enable row level security;

drop policy if exists "central_fretes_access" on public.auditoria_faturas_excluidas;
create policy "central_fretes_access"
  on public.auditoria_faturas_excluidas
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.auditoria_faturas_excluidas to anon, authenticated;
