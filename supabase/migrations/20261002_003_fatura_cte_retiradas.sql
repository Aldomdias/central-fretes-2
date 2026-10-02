-- Registro de CT-es retirados (inativados) de uma fatura, com motivo e justificativa.
-- Guarda uma copia completa da linha em `snapshot` para permitir restaurar.

create table if not exists public.fatura_cte_retiradas (
  id uuid primary key default gen_random_uuid(),
  fatura_id text not null,
  numero_fatura text,
  transportadora text,
  chave text,
  chave_cte text,
  numero_cte text,
  valor_cte numeric(14,2),
  motivo text not null,
  justificativa text not null,
  snapshot jsonb,
  retirado_por text,
  retirado_em timestamptz default now(),
  restaurado_em timestamptz,
  restaurado_por text
);

create index if not exists fatura_cte_retiradas_fatura_idx on public.fatura_cte_retiradas (fatura_id);
create index if not exists fatura_cte_retiradas_chave_idx on public.fatura_cte_retiradas (chave);

alter table public.fatura_cte_retiradas enable row level security;
grant select, insert, update, delete on public.fatura_cte_retiradas to anon, authenticated;
drop policy if exists "central_fretes_access" on public.fatura_cte_retiradas;
create policy "central_fretes_access" on public.fatura_cte_retiradas for all to anon, authenticated using (true) with check (true);
