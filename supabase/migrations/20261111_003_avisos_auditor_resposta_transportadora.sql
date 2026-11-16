-- Aviso ao auditor: a transportadora respondeu pelo portal (confirmou ou
-- contestou a fatura, justificou CT-e sem NF, respondeu comprovante de entrega).
-- O evento ja fica em auditoria_fatura_historico (que e imutavel), entao a
-- "ciencia" do auditor fica numa tabela a parte, um registro por evento visto.
--
-- Pre-requisito: 20260613_001_plataforma_auditoria_fretes_440.sql ja aplicada.

create table if not exists public.auditor_avisos_ciencia (
  historico_id uuid primary key references public.auditoria_fatura_historico(id) on delete cascade,
  ciente_por text,
  ciente_em timestamptz not null default now()
);

alter table public.auditor_avisos_ciencia enable row level security;
grant select, insert, update, delete on public.auditor_avisos_ciencia to anon, authenticated;
drop policy if exists "auditor_avisos_ciencia_access" on public.auditor_avisos_ciencia;
create policy "auditor_avisos_ciencia_access"
  on public.auditor_avisos_ciencia
  for all to anon, authenticated
  using (true)
  with check (true);

-- Busca rapida das respostas do portal (o aviso olha so os ultimos dias).
create index if not exists idx_auditoria_historico_portal_transportadora
  on public.auditoria_fatura_historico (created_at desc)
  where acao in ('CONFIRMACAO_TRANSPORTADOR_PORTAL', 'CONTESTACAO_TRANSPORTADOR_PORTAL', 'JUSTIFICATIVA_CTE_SEM_NF_PORTAL', 'RESPOSTA_ENTREGA_PORTAL');

-- Respostas antigas ja foram tratadas: nao viram aviso de uma vez so.
insert into public.auditor_avisos_ciencia (historico_id, ciente_por, ciente_em)
select id, 'migracao', now()
  from public.auditoria_fatura_historico
 where acao in ('CONFIRMACAO_TRANSPORTADOR_PORTAL', 'CONTESTACAO_TRANSPORTADOR_PORTAL', 'JUSTIFICATIVA_CTE_SEM_NF_PORTAL', 'RESPOSTA_ENTREGA_PORTAL')
on conflict (historico_id) do nothing;
