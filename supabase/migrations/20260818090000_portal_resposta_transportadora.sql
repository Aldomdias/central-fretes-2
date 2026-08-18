-- ============================================================
-- MIGRATION: Portal de resposta da transportadora (Fases 14/15)
-- Data: 2026-08-18
-- Aplique no SQL Editor do Supabase
--
-- Objetivo: permitir que a transportadora confira o laudo e
-- responda CT-e a CT-e por um link com token, SEM ter usuário
-- interno e SEM acessar dados de outras transportadoras.
--
-- IMPORTANTE: a resposta do portal NÃO altera a jornada
-- automaticamente. Ela fica registrada como "pendente de
-- validação" para o auditor conferir e aplicar.
-- ============================================================

-- ============================================================
-- 1. TABELA: auditoria_cte_portal_tokens
--    Um token por processo/laudo enviado. O token é o único
--    segredo que a transportadora recebe.
-- ============================================================
create table if not exists public.auditoria_cte_portal_tokens (
  id                  uuid primary key default gen_random_uuid(),
  token               text unique not null,
  processo_id         uuid references auditoria_cte_processos(id) on delete cascade,
  transportadora      text,
  cnpj_transportadora text,

  criado_em           timestamptz default now(),
  criado_por          text,
  -- Sem data de expiração o link vale pra sempre; o padrão é 90 dias.
  expira_em           timestamptz default (now() + interval '90 days'),
  revogado            boolean default false,

  -- Telemetria de acesso (ajuda a saber se a transportadora abriu o laudo).
  acessos             integer default 0,
  primeiro_acesso_em  timestamptz,
  ultimo_acesso_em    timestamptz,

  respondido_em       timestamptz
);

create index if not exists idx_portal_tokens_processo on auditoria_cte_portal_tokens(processo_id);

-- ============================================================
-- 2. TABELA: auditoria_cte_portal_respostas
--    Resposta da transportadora, CT-e a CT-e. Fica pendente
--    até o auditor validar (status_validacao).
-- ============================================================
create table if not exists public.auditoria_cte_portal_respostas (
  id                uuid primary key default gen_random_uuid(),
  token_id          uuid references auditoria_cte_portal_tokens(id) on delete cascade,
  processo_id       uuid references auditoria_cte_processos(id) on delete cascade,
  chave_cte         text not null,
  numero_cte        text,
  transportadora    text,

  -- Espelha RESULTADOS_RETORNO_TRANSPORTADORA do app:
  -- concordou_desconto | concordou_cancelamento | nao_concordou | em_analise
  resultado         text not null,
  justificativa     text,
  valor_proposto    numeric(14,2),

  respondido_em     timestamptz default now(),
  respondido_por    text,

  -- Fluxo de validação interna (a resposta não aplica sozinha).
  status_validacao  text not null default 'PENDENTE',
  -- PENDENTE | APLICADO | REJEITADO
  validado_em       timestamptz,
  validado_por      text,
  observacao_validacao text
);

create index if not exists idx_portal_respostas_processo on auditoria_cte_portal_respostas(processo_id);
create index if not exists idx_portal_respostas_chave on auditoria_cte_portal_respostas(chave_cte);
create index if not exists idx_portal_respostas_status on auditoria_cte_portal_respostas(status_validacao);

-- ============================================================
-- 3. RLS
--    A transportadora NUNCA fala com o Supabase direto — ela
--    passa pela função serverless, que usa service_role e
--    ignora RLS. Estas policies servem só pro app interno.
-- ============================================================
alter table auditoria_cte_portal_tokens enable row level security;
alter table auditoria_cte_portal_respostas enable row level security;

drop policy if exists "auditoria_cte_portal_tokens_all" on auditoria_cte_portal_tokens;
create policy "auditoria_cte_portal_tokens_all" on auditoria_cte_portal_tokens for all using (true) with check (true);

drop policy if exists "auditoria_cte_portal_respostas_all" on auditoria_cte_portal_respostas;
create policy "auditoria_cte_portal_respostas_all" on auditoria_cte_portal_respostas for all using (true) with check (true);

-- ============================================================
-- FIM DA MIGRATION
-- ============================================================
