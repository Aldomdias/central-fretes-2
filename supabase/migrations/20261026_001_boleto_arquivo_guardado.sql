-- Guarda o PDF do boleto ate a fatura ser paga (ou o boleto ser substituido) e mantem a
-- informacao lida do boleto mesmo depois de apagar o arquivo.
-- Pre-requisito: 20261014_001_fatura_boleto_controle.sql aplicada.

alter table public.fatura_boleto_controle
  add column if not exists boleto_arquivo_nome text,
  add column if not exists boleto_arquivo_path text,          -- null depois de apagado
  add column if not exists boleto_valor numeric,
  add column if not exists boleto_vencimento date,
  add column if not exists boleto_linha_digitavel text,
  add column if not exists boleto_apagado_em timestamptz,
  add column if not exists boleto_apagado_motivo text,        -- PAGA | SUBSTITUIDO
  add column if not exists boleto_copiado_em timestamptz,     -- quando foi copiado para a pasta de rede
  add column if not exists boleto_copiado_por text;

-- Bucket privado: abrir o PDF so por link assinado (curta duracao).
insert into storage.buckets (id, name, public)
values ('boletos-financeiro', 'boletos-financeiro', false)
on conflict (id) do nothing;

drop policy if exists "boletos_fin_select" on storage.objects;
create policy "boletos_fin_select" on storage.objects
  for select to anon, authenticated using (bucket_id = 'boletos-financeiro');

drop policy if exists "boletos_fin_insert" on storage.objects;
create policy "boletos_fin_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'boletos-financeiro');

drop policy if exists "boletos_fin_delete" on storage.objects;
create policy "boletos_fin_delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'boletos-financeiro');
