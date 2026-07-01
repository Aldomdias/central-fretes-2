-- Demanda 4.40 - trilha de auditoria imutavel.
-- Os historicos passam a ser insert-only: ninguem (anon/authenticated) pode
-- alterar ou apagar eventos ja registrados. O front (auditoriaFretesService)
-- ja grava esses historicos com insert puro.
--
-- IMPORTANTE: aplicar somente depois que o deploy com o commit desta migration
-- estiver no ar. Builds antigos usavam upsert nesses historicos e o upsert
-- (insert ... on conflict do update) exige privilegio de UPDATE mesmo quando
-- nao ha conflito - falharia com permission denied.

revoke update, delete on public.auditoria_fatura_historico from anon, authenticated;
revoke update, delete on public.financeiro_solicitacao_historico from anon, authenticated;
