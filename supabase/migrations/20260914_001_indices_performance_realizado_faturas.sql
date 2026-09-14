-- Diagnostico via Supabase Advisors (14/09/2026): realizado_local_ctes com
-- ~24k linhas fazia seq scan lendo 429M linhas acumuladas; faturas (~16,6k
-- linhas) lia 53,6M. Faltavam indices nas colunas mais filtradas pelo
-- Simulador, tela de CT-es, GestaoBaseCte e reajustes.

create index if not exists idx_realizado_local_ctes_data_emissao
  on public.realizado_local_ctes (data_emissao);

create index if not exists idx_realizado_local_ctes_uf_origem
  on public.realizado_local_ctes (uf_origem);

create index if not exists idx_realizado_local_ctes_uf_destino
  on public.realizado_local_ctes (uf_destino);

create index if not exists idx_realizado_local_ctes_canal
  on public.realizado_local_ctes (canal);

create index if not exists idx_realizado_local_ctes_transportadora
  on public.realizado_local_ctes (transportadora);

create index if not exists idx_faturas_status
  on public.faturas (status);
