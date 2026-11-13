-- Registro central das importacoes (Faturas Verum, relatorio SAP de pagamentos e
-- partidas, DOCCOB, XML de CT-e, contabil HANA, Tracking). Alimenta o painel
-- "Central de importacoes" do Dashboard: ultima carga de cada tipo, quem fez,
-- arquivos e resumo. So informativo: nenhuma regra de negocio depende dele.

create table if not exists public.importacoes_registro (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  status text not null default 'OK',
  arquivos text,
  qtd_arquivos integer,
  linhas integer,
  resumo text,
  usuario text,
  criado_em timestamptz not null default now()
);

create index if not exists importacoes_registro_tipo_criado_idx
  on public.importacoes_registro (tipo, criado_em desc);

alter table public.importacoes_registro enable row level security;
grant select, insert on public.importacoes_registro to anon, authenticated;
drop policy if exists "central_fretes_access" on public.importacoes_registro;
create policy "central_fretes_access" on public.importacoes_registro
  for all to anon, authenticated using (true) with check (true);
