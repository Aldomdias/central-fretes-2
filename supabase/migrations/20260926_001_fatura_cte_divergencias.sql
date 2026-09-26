-- Portal "Confirmar fatura": a transportadora ve os CT-es com cobranca acima
-- (divergencia) e responde CT-e a CT-e: concorda (com o valor do desconto) ou nao
-- concorda (com motivo). O laudo grava a lista; o portal (service_role) grava a
-- resposta; o auditor le na Auditoria.

create table if not exists public.fatura_cte_divergencias (
  id                 uuid primary key default gen_random_uuid(),
  fatura_id          text not null,
  numero_fatura      text,
  transportadora     text,
  chave              text not null,            -- chave do CT-e (44 digitos) ou numero
  numero_cte         text,
  valor_cobrado      numeric(14,2) not null default 0,
  valor_calculado    numeric(14,2) not null default 0,
  diferenca          numeric(14,2) not null default 0,   -- cobranca acima
  atualizado_em      timestamptz not null default now(),
  -- resposta da transportadora
  resposta           text,                     -- CONCORDO | NAO_CONCORDO
  valor_desconto     numeric(14,2),
  justificativa      text,
  respondido_por     text,
  respondido_em      timestamptz,
  unique (fatura_id, chave)
);

create index if not exists idx_fat_cte_div_fatura on public.fatura_cte_divergencias (fatura_id);

alter table public.fatura_cte_divergencias enable row level security;

drop policy if exists "fatura_cte_divergencias_all" on public.fatura_cte_divergencias;
create policy "fatura_cte_divergencias_all" on public.fatura_cte_divergencias for all using (true) with check (true);

grant select, insert, update, delete on public.fatura_cte_divergencias to anon, authenticated;
