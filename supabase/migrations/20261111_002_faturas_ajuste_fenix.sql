-- Controle do pedido de estorno da compensacao Fenix (1501163056) ao financeiro, antes do protocolo.
-- A tela Diagnostico marca a fatura como "enviada para ajustar Fenix" (ENVIADO) e, quando o
-- financeiro devolve, como "retorno recebido" (RETORNADO). Com o estorno ja no relatorio SAP
-- reimportado a fatura passa sozinha para "retorno recebido". So marca e mostra em card.

alter table if exists public.faturas
  add column if not exists fenix_ajuste_status text,
  add column if not exists fenix_enviado_em timestamptz,
  add column if not exists fenix_enviado_por text,
  add column if not exists fenix_retorno_em timestamptz,
  add column if not exists fenix_retorno_por text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'faturas_fenix_ajuste_status_check') then
    alter table public.faturas
      add constraint faturas_fenix_ajuste_status_check
      check (fenix_ajuste_status is null or fenix_ajuste_status in ('ENVIADO', 'RETORNADO'));
  end if;
end $$;

create index if not exists idx_faturas_fenix_ajuste_status
  on public.faturas (fenix_ajuste_status)
  where fenix_ajuste_status is not null;
