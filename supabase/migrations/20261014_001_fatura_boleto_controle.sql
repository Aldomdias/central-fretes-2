-- Controle de boletos: depois que a fatura e liberada para pagamento, o auditor
-- confirma que o boleto foi colocado na pasta do financeiro. Uma linha por fatura
-- (some a pendencia). A conferencia automatica pela pasta (Ferramentas) usa
-- metodo = 'PASTA' no futuro.
create table if not exists public.fatura_boleto_controle (
  id uuid primary key default gen_random_uuid(),
  fatura_id text not null,
  numero_fatura text,
  transportadora text,
  status text not null default 'NA_PASTA',   -- NA_PASTA | DISPENSADO
  metodo text not null default 'MANUAL',      -- MANUAL | PASTA
  observacao text,
  confirmado_por text,
  confirmado_email text,
  confirmado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_fatura_boleto_controle_fatura
  on public.fatura_boleto_controle (fatura_id);

alter table public.fatura_boleto_controle enable row level security;

grant select, insert, update, delete on public.fatura_boleto_controle to anon, authenticated;

drop policy if exists "central_fretes_access" on public.fatura_boleto_controle;
create policy "central_fretes_access" on public.fatura_boleto_controle
  for all to anon, authenticated using (true) with check (true);
