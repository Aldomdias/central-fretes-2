-- O auditor aceita ou rejeita a resposta da transportadora em cada CT-e do portal
-- "Confirmar fatura". Rejeitada: a fatura volta a ficar "contestada" e a
-- transportadora responde de novo pelo mesmo link, vendo o motivo.

alter table public.fatura_cte_divergencias add column if not exists status_validacao     text not null default 'PENDENTE';  -- PENDENTE | ACEITO | REJEITADO
alter table public.fatura_cte_divergencias add column if not exists validado_por         text;
alter table public.fatura_cte_divergencias add column if not exists validado_em          timestamptz;
alter table public.fatura_cte_divergencias add column if not exists observacao_validacao text;
