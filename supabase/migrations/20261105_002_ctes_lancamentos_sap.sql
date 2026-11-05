-- Lancamentos de CT-e no SAP (provisao de fretes por competencia).
-- Vem do mesmo relatorio "Exportacao SAPUI5" (contas a pagar) importado em
-- Financeiro > Pagamentos: guardamos as linhas de documento de fatura de
-- fornecedor (Lancamento contabil 51...: MIRO) cuja Referencia esta no formato
-- numero-serie, que e' como o CT-e e' lancado. O casamento com o CT-e e' feito
-- na tela de provisao por CNPJ completo do emitente + numero + serie.
-- Montante negativo = lancamento da fatura; positivo = estorno (MIR4).
create table if not exists public.ctes_lancamentos_sap (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  cnpj_emitente text not null,
  numero_cte text not null,
  serie_cte text not null,
  referencia text,
  fornecedor text,
  codigo_fornecedor text,
  empresa text,
  lancamento_contabil text,
  documento_compensacao text,
  data_lancamento date,
  data_documento date,
  data_compensacao date,
  data_vencimento date,
  montante numeric(14,2),
  status_comp text,
  criado_por text,
  texto text,
  arquivo_origem text,
  imported_at timestamptz default now()
);

create index if not exists ctes_lancamentos_sap_cnpj_data_idx on public.ctes_lancamentos_sap (cnpj_emitente, data_lancamento);
create index if not exists ctes_lancamentos_sap_numero_idx on public.ctes_lancamentos_sap (numero_cte, serie_cte);

alter table public.ctes_lancamentos_sap enable row level security;
grant select, insert, update, delete on public.ctes_lancamentos_sap to anon, authenticated;
drop policy if exists "central_fretes_access" on public.ctes_lancamentos_sap;
create policy "central_fretes_access" on public.ctes_lancamentos_sap for all to anon, authenticated using (true) with check (true);
