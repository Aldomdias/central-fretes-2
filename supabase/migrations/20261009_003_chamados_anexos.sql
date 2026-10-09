-- Anexos (prints, planilhas, PDFs) nos chamados. Arquivos no Storage (bucket
-- chamados-anexos); a lista {nome, tamanho, path, url} fica em chamados.anexos.
-- Pre-requisito: 20261009_002_chamados.sql aplicada.

alter table public.chamados
  add column if not exists anexos jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('chamados-anexos', 'chamados-anexos', true)
on conflict (id) do nothing;

drop policy if exists "chamados_anexos_select" on storage.objects;
create policy "chamados_anexos_select" on storage.objects
  for select to anon, authenticated using (bucket_id = 'chamados-anexos');

drop policy if exists "chamados_anexos_insert" on storage.objects;
create policy "chamados_anexos_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'chamados-anexos');
