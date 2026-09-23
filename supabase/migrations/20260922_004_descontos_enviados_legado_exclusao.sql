-- financeiro_descontos_enviados_legado era só select+insert (log de
-- importação imutável de propósito). Passa a permitir marcar uma linha como
-- excluída (soft delete) pra tratar duplicatas de reenvio/re-cadastro
-- identificadas na conciliação "Enviado x realizado" — nunca um delete físico.
alter table if exists public.financeiro_descontos_enviados_legado
  add column if not exists excluido boolean not null default false;

grant update on public.financeiro_descontos_enviados_legado to anon, authenticated;

drop policy if exists "central_fretes_update" on public.financeiro_descontos_enviados_legado;
create policy "central_fretes_update" on public.financeiro_descontos_enviados_legado
  for update to anon, authenticated using (true) with check (true);
