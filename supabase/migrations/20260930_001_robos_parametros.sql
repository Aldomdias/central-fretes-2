-- Parametros compartilhados dos robos de automacao (modulo Automacao).
-- Hoje guarda as tabelas do robo de lancamento de NFS-e/CT-e (chave 'lancamento'):
--   { "filiais": [{cnpj, emp, centro}], "escritorios": [{conc, titulo}] }
-- Antes vinham do Parametros.xlsx via Power Query; agora sao importadas uma vez na tela
-- e ficam aqui para toda a equipe (sem cada um importar no seu navegador).
create table if not exists public.robos_parametros (
  chave text primary key,
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

alter table public.robos_parametros enable row level security;

drop policy if exists "robos_parametros select" on public.robos_parametros;
create policy "robos_parametros select" on public.robos_parametros
  for select using (true);

drop policy if exists "robos_parametros insert" on public.robos_parametros;
create policy "robos_parametros insert" on public.robos_parametros
  for insert with check (true);

drop policy if exists "robos_parametros update" on public.robos_parametros;
create policy "robos_parametros update" on public.robos_parametros
  for update using (true) with check (true);
