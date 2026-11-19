-- Integracao AMD Log -> Verum OMS (VLOG-3813): liberacao da fatura ao SAP pelo OMS.
-- 1) faturas.oms_invoice_id = coluna "Id" da planilha de exportacao de faturas do OMS (24 hex).
-- 2) fatura_oms_envios = um registro por lote enviado. O requestId e GRAVADO ANTES de chamar o OMS
--    (reenvio = mesmo requestId e mesmo corpo; nada e aplicado duas vezes).

alter table public.faturas add column if not exists oms_invoice_id text;
create index if not exists faturas_oms_invoice_id_idx on public.faturas (oms_invoice_id) where oms_invoice_id is not null;

create table if not exists public.fatura_oms_envios (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  oms_invoice_id text not null,
  request_id text not null unique,
  payload jsonb not null,                       -- corpo enviado (lote de 1 fatura), para reenvio identico
  approved_charge_value numeric(14,2),
  status text not null default 'enviando',      -- enviando | enviado | erro | recusado
  batch_id text,
  oms_status text,                              -- pending | processing | done | failed
  outcome text,                                 -- treated | queuedForErp | alreadyReleased | blocked
  bypassed_checks jsonb,
  blocking_checks jsonb,
  queued_for_erp_at timestamptz,
  sent_to_erp boolean not null default false,
  sent_to_erp_visto_em timestamptz,
  oms_sent_by text,
  erro jsonb,
  tentativas integer not null default 0,
  enviado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fatura_oms_envios_fatura_idx on public.fatura_oms_envios (fatura_id, created_at desc);

alter table public.fatura_oms_envios enable row level security;
-- Mesmo padrao das demais tabelas operacionais do app.
drop policy if exists "central_fretes_access" on public.fatura_oms_envios;
create policy "central_fretes_access" on public.fatura_oms_envios for all to anon, authenticated using (true) with check (true);
