-- O aplicativo usa anon/authenticated para as operações da base de Tracking.
-- A exclusão exige o marcador da operação e fica restrita à competência NF.
create policy tracking_rows_delete_competencia_app
on public.tracking_rows
for delete
to anon, authenticated
using (
  (select coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-client-info')
    ~ '^tracking-limpeza/20[0-9]{2}-(0[1-9]|1[0-2])$'
  and (
    chave_nfe like (
      '__' || replace(right((select coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-client-info'), 5), '-', '') || repeat('_', 38)
    )
    or id like (
      'nf-__' || replace(right((select coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-client-info'), 5), '-', '') || repeat('_', 38)
    )
  )
);
