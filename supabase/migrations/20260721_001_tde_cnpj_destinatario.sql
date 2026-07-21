-- TDE por CNPJ do destinatário: valor fixo por transportadora, aplicado quando
-- o documento (CNPJ) do destinatário do CT-e está numa lista cadastrada.
-- Usado pelo Simulador Realizado e pela Auditoria CT-e.

alter table public.transportadoras add column if not exists tde numeric(14,2) not null default 0;
alter table public.transportadoras add column if not exists tde_cnpjs jsonb not null default '[]'::jsonb;

-- Documento (CNPJ) do destinatário do CT-e. Precisa ser preenchido pela
-- importação da base de CT-es (Verum) para a Auditoria conseguir casar com
-- a lista de CNPJs da transportadora.
alter table public.realizado_local_ctes add column if not exists documento_destinatario text;

create index if not exists idx_realizado_local_ctes_documento_destinatario
  on public.realizado_local_ctes (documento_destinatario);
