-- Resposta da transportadora (portal da fatura) para cada CT-e sem vinculo de NF apontado pelo Robo Auditor.
--   RETIRAR      -> transportadora autorizou retirar o CT-e da fatura. O portal ja retira (fatura_cte_retiradas +
--                   fatura_detalhes) e registra a ciencia de que a cobranca sera refeita (novo boleto ou Pix/deposito).
--   COMPLEMENTAR -> CT-e complementar: nao traz NF propria; a transportadora informa a chave do CT-e original.
--                   Se o CT-e original estiver na base com a chave da NF, fica ACEITO sozinho; senao vai ao auditor.
--   OUTRO        -> outra justificativa, sempre validada pelo auditor.
-- status_validacao: APLICADO (retirada feita), ACEITO, PENDENTE, REJEITADO.
-- CT-e com justificativa ACEITA deixa de ser apontado como "sem NF" pelo robo.

create table if not exists public.fatura_cte_sem_nf_respostas (
  id uuid primary key default gen_random_uuid(),
  fatura_id text not null,
  numero_fatura text,
  transportadora text,
  chave_cte text not null,
  numero_cte text,
  valor_cte numeric(14,2),
  resposta text not null check (resposta in ('RETIRAR', 'COMPLEMENTAR', 'OUTRO')),
  chave_cte_original text,
  chave_nfe text,
  justificativa text,
  forma_cobranca text,
  ciente_nova_cobranca boolean default false,
  valor_fatura_atualizado numeric(14,2),
  respondido_por text,
  respondido_em timestamptz default now(),
  status_validacao text not null default 'PENDENTE' check (status_validacao in ('APLICADO', 'ACEITO', 'PENDENTE', 'REJEITADO')),
  validado_por text,
  validado_em timestamptz,
  observacao_validacao text
);

create unique index if not exists fatura_cte_sem_nf_respostas_uk on public.fatura_cte_sem_nf_respostas (fatura_id, chave_cte);
create index if not exists fatura_cte_sem_nf_respostas_chave_idx on public.fatura_cte_sem_nf_respostas (chave_cte);
create index if not exists fatura_cte_sem_nf_respostas_status_idx on public.fatura_cte_sem_nf_respostas (status_validacao);

alter table public.fatura_cte_sem_nf_respostas enable row level security;
grant select, insert, update, delete on public.fatura_cte_sem_nf_respostas to anon, authenticated;
drop policy if exists "central_fretes_access" on public.fatura_cte_sem_nf_respostas;
create policy "central_fretes_access" on public.fatura_cte_sem_nf_respostas for all to anon, authenticated using (true) with check (true);
