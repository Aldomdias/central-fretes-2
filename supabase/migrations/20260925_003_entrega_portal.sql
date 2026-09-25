-- Portal de comprovantes de entrega: a transportadora abre o link do laudo, ve os
-- CT-es sem entrega comprovada e responde (justificativa + comprovantes).
-- A resposta fica PENDENTE ate o auditor validar; so a resposta aprovada como
-- ENTREGUE passa a contar como entregue na liberacao da fatura.
--
-- Os arquivos ficam em bucket PRIVADO (sem policies): so a funcao serverless
-- (service_role) grava e gera links temporarios. Limite 4 MB e tipos permitidos
-- (PDF, imagem, Excel) ficam no proprio bucket.

create table if not exists public.entrega_pendencias (
  id             uuid primary key default gen_random_uuid(),
  fatura_id      text not null,
  numero_fatura  text,
  transportadora text,
  chave          text not null,            -- chave do CT-e (44 digitos) ou numero
  numero_cte     text,
  entrega_status text,                     -- NAO_ENTREGUE | SEM_TRACKING
  atualizado_em  timestamptz not null default now(),
  unique (fatura_id, chave)
);

create table if not exists public.entrega_respostas (
  id                   uuid primary key default gen_random_uuid(),
  fatura_id            text not null,
  chave                text not null,
  numero_cte           text,
  resposta             text not null,      -- ENTREGUE | NAO_ENTREGUE | EM_ANALISE
  justificativa        text,
  anexos               jsonb not null default '[]'::jsonb,  -- [{nome, tamanho, path}]
  respondido_por       text,
  respondido_em        timestamptz not null default now(),
  status_validacao     text not null default 'PENDENTE',    -- PENDENTE | APROVADO | REJEITADO
  validado_por         text,
  validado_em          timestamptz,
  observacao_validacao text
);

create index if not exists idx_entrega_pend_fatura on public.entrega_pendencias (fatura_id);
create index if not exists idx_entrega_resp_fatura on public.entrega_respostas (fatura_id);
create index if not exists idx_entrega_resp_chave on public.entrega_respostas (chave);

alter table public.entrega_pendencias enable row level security;
alter table public.entrega_respostas enable row level security;

drop policy if exists "entrega_pendencias_all" on public.entrega_pendencias;
create policy "entrega_pendencias_all" on public.entrega_pendencias for all using (true) with check (true);

drop policy if exists "entrega_respostas_all" on public.entrega_respostas;
create policy "entrega_respostas_all" on public.entrega_respostas for all using (true) with check (true);

grant select, insert, update, delete on public.entrega_pendencias to anon, authenticated;
grant select, insert, update, delete on public.entrega_respostas to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'entrega-comprovantes', 'entrega-comprovantes', false, 4194304,
  array[
    'application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
