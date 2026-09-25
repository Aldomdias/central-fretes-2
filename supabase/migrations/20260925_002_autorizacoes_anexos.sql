-- Anexos do envio para Suprimentos (tabela, lista de TDE, documento de apoio).
-- Os arquivos ficam no Storage (bucket autorizacoes-anexos) e a lista
-- {nome, tamanho, path, url} fica em transporte_autorizacoes.anexos.
--
-- Pre-requisito: 20260924_002_transporte_autorizacoes_suprimentos.sql aplicada.

alter table public.transporte_autorizacoes
  add column if not exists anexos jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('autorizacoes-anexos', 'autorizacoes-anexos', true)
on conflict (id) do nothing;

drop policy if exists "autorizacoes_anexos_select" on storage.objects;
create policy "autorizacoes_anexos_select" on storage.objects
  for select to anon, authenticated using (bucket_id = 'autorizacoes-anexos');

drop policy if exists "autorizacoes_anexos_insert" on storage.objects;
create policy "autorizacoes_anexos_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'autorizacoes-anexos');
