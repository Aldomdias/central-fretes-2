-- Auditoria TransGP: a API passou a mandar veiculo, placas, frete Cantu, coleta realizada, cubagem,
-- liberada/descarregada, ocorrencia, entregas e alertas por DIST, e o valor sem ICMS dos CT-es.
-- dados_dist guarda a DIST inteira (menos a lista de CT-es) para a tela Auditoria TransGP (API).
-- A sincronizacao funciona sem esta migration (so nao grava as duas colunas).
alter table public.transgp_auditoria_ctes add column if not exists dados_dist jsonb;
alter table public.transgp_auditoria_ctes add column if not exists cte_total_sem_icms numeric(16,2);

notify pgrst, 'reload schema';
