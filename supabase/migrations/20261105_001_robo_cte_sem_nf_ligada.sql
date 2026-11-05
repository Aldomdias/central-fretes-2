-- Robo auditor: regra "CT-e sem vinculo de NF" LIGADA (CT-e sem NF nao pode ser pago).
-- Confere so CT-e emitido a partir de 01/10/2026 (AAMM da chave >= 2610; antes a base nao tinha a chave da NF).
-- Vale so para as faturas que entraram no sistema a partir de checar_cte_sem_nf_desde (momento em que foi ligada):
-- o que ja estava na fila nao muda. Protecao no robo: se metade ou mais dos CT-es da fatura aparecem sem a NF na
-- base, a fatura vai para o auditor (provavel base importada sem a aba "Notas Fiscais") em vez de mandar laudo.
alter table public.auditor_robo_config
  add column if not exists checar_cte_sem_nf boolean not null default true,
  add column if not exists checar_cte_sem_nf_desde timestamptz;

alter table public.auditor_robo_config alter column checar_cte_sem_nf set default true;

update public.auditor_robo_config
set checar_cte_sem_nf = true,
    checar_cte_sem_nf_desde = coalesce(checar_cte_sem_nf_desde, now()),
    atualizado_em = now()
where id = 1;
