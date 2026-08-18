-- ============================================================
-- MIGRATION: Fundação da Jornada do CT-e (Etapa 1)
-- Data: 2026-08-17
-- Aplique no SQL Editor do Supabase
--
-- Objetivo: dar ao CT-e um estado de vida (jornada) próprio,
-- separado do resultado de cálculo (auditoria_cte_resultados.status_calculo).
-- Reaproveita audit_historico_eventos (timeline) e tratativas
-- (resposta/tratativa) em vez de duplicar tabelas.
-- ============================================================

-- ============================================================
-- 1. TABELA: auditoria_cte_processos
--    Processo/lote de auditoria (laudo). Fase 6/7.
-- ============================================================
create table if not exists public.auditoria_cte_processos (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text unique,
  competencia           text,
  transportadora        text,
  cnpj_transportadora   text,
  auditor_id            text,
  auditor_nome          text,

  qtd_ctes              integer default 0,
  valor_total_cobrado    numeric(14,2) default 0,
  valor_total_calculado  numeric(14,2) default 0,
  valor_total_divergente numeric(14,2) default 0,

  laudo_gerado_em       timestamptz,
  laudo_gerado_por      text,
  observacao            text,

  -- Fase 7: gerar laudo != enviar
  enviado               boolean default false,
  enviado_em            timestamptz,
  enviado_por           text,

  status                text default 'GERADO',
  -- Possíveis: GERADO | ENVIADO | AGUARDANDO_RETORNO | RETORNO_RECEBIDO | ENCERRADO

  ultima_cobranca_em    timestamptz,
  retorno_transportadora_em timestamptz,
  encerrado_em          timestamptz,

  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create sequence if not exists auditoria_cte_processo_seq start 1;

create or replace function fn_gerar_codigo_processo_cte()
returns trigger as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'AUD-CTE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('auditoria_cte_processo_seq')::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_codigo_processo_cte on auditoria_cte_processos;
create trigger trg_codigo_processo_cte
  before insert on auditoria_cte_processos
  for each row execute function fn_gerar_codigo_processo_cte();

-- ============================================================
-- 2. TABELA: auditoria_cte_processo_ctes
--    Join processo <-> chave_cte (N:N — um CT-e pode reaparecer
--    em cobranças/laudos diferentes ao longo do tempo).
-- ============================================================
create table if not exists public.auditoria_cte_processo_ctes (
  id            uuid primary key default gen_random_uuid(),
  processo_id   uuid references auditoria_cte_processos(id) on delete cascade,
  chave_cte     text not null,
  numero_cte    text,
  valor_cte     numeric(14,2),
  valor_calculado numeric(14,2),
  diferenca     numeric(14,2),
  created_at    timestamptz default now()
);

-- ============================================================
-- 3. TABELA: auditoria_cte_jornada
--    Estado atual de vida de cada CT-e (1 linha por chave_cte).
--    Fase 1 (status_operacional) + Fase 2 (status_financeiro) +
--    Fase 3 (valores identificado/recuperado) + Fase 4 (cancel/reemissão).
-- ============================================================
create table if not exists public.auditoria_cte_jornada (
  id                     uuid primary key default gen_random_uuid(),
  chave_cte              text unique not null,
  numero_cte             text,
  competencia            text,
  transportadora         text,
  cnpj_transportadora    text,

  -- Fase 1: status operacional
  status_operacional     text not null default 'NAO_AUDITADO',
  -- NAO_AUDITADO | AUDITADO_OK | DIVERGENTE | AGUARDANDO_ENVIO_TRANSPORTADORA |
  -- AGUARDANDO_RETORNO_TRANSPORTADORA | EM_TRATATIVA | ACORDO_FECHADO |
  -- CANCELAMENTO_SOLICITADO | CANCELADO | REEMITIDO |
  -- AGUARDANDO_FATURA | FATURADO | CONCILIADO_FATURA | ENCERRADO

  -- Fase 2: status financeiro (independente do operacional)
  status_financeiro      text not null default 'SEM_IMPACTO',
  -- SEM_IMPACTO | DIVERGENCIA_IDENTIFICADA | DESCONTO_SOLICITADO | DESCONTO_ACEITO |
  -- DESCONTO_PENDENTE_APLICACAO | DESCONTO_APLICADO_FATURA | RECUPERADO_CANCELAMENTO |
  -- COBRANCA_A_MENOR | ENCERRADO_SEM_RECUPERACAO | PAGO | CONCILIADO

  -- Fase 3: valores
  valor_cobrado          numeric(14,2) default 0,
  valor_correto           numeric(14,2) default 0,
  valor_divergencia_identificada numeric(14,2) default 0,
  valor_acordado          numeric(14,2) default 0,
  valor_recuperado        numeric(14,2) default 0,
  origem_recuperacao      text,
  -- CANCELAMENTO_CTE | DESCONTO_FATURA | REEMISSAO | OUTRO

  -- Fase 4: cancelamento/reemissão
  chave_cte_original      text,
  chave_cte_substituto     text,
  motivo_cancelamento_reemissao text,

  -- Fase 5: acordo de desconto para próxima fatura
  desconto_acordado_em    timestamptz,
  desconto_acordado_por   text,

  -- Fase 6: vínculo com processo/lote mais recente
  processo_id             uuid references auditoria_cte_processos(id),

  -- Fase 9: responsabilidade
  auditor_responsavel_id   text,
  auditor_responsavel_nome text,

  -- Fase 10: SLA/envelhecimento
  aguardando_desde        timestamptz,

  -- Fase 18/19: fatura/pagamento
  fatura_id               uuid references faturas(id),
  fatura_numero            text,

  observacao               text,
  created_at               timestamptz default now(),
  updated_at                timestamptz default now()
);

-- ============================================================
-- 4. Reaproveitar audit_historico_eventos (Fase 8 — timeline)
--    Adiciona colunas nullable para permitir eventos de jornada
--    de CT-e sem duplicar a tabela de histórico existente.
-- ============================================================
alter table if exists audit_historico_eventos
  add column if not exists chave_cte  text,
  add column if not exists processo_id uuid references auditoria_cte_processos(id),
  add column if not exists jornada_id  uuid references auditoria_cte_jornada(id);

-- ============================================================
-- 5. Trigger: manter updated_at e aguardando_desde coerentes
-- ============================================================
create or replace function fn_jornada_cte_touch()
returns trigger as $$
begin
  new.updated_at := now();
  if new.status_operacional is distinct from old.status_operacional
     and new.status_operacional in ('AGUARDANDO_ENVIO_TRANSPORTADORA', 'AGUARDANDO_RETORNO_TRANSPORTADORA', 'AGUARDANDO_FATURA') then
    new.aguardando_desde := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_jornada_cte_touch on auditoria_cte_jornada;
create trigger trg_jornada_cte_touch
  before update on auditoria_cte_jornada
  for each row execute function fn_jornada_cte_touch();

-- ============================================================
-- 6. Índices
-- ============================================================
create index if not exists idx_jornada_cte_status_op    on auditoria_cte_jornada(status_operacional);
create index if not exists idx_jornada_cte_status_fin    on auditoria_cte_jornada(status_financeiro);
create index if not exists idx_jornada_cte_transportadora on auditoria_cte_jornada(transportadora);
create index if not exists idx_jornada_cte_processo       on auditoria_cte_jornada(processo_id);
create index if not exists idx_jornada_cte_competencia    on auditoria_cte_jornada(competencia);
create index if not exists idx_processo_ctes_processo     on auditoria_cte_processo_ctes(processo_id);
create index if not exists idx_processo_ctes_chave        on auditoria_cte_processo_ctes(chave_cte);
create index if not exists idx_processos_status           on auditoria_cte_processos(status);
create index if not exists idx_audit_hist_chave_cte        on audit_historico_eventos(chave_cte);

-- ============================================================
-- 7. RLS (segue o mesmo padrão aberto anon/authenticated já
--    usado em auditoria_cte_resultados)
-- ============================================================
alter table auditoria_cte_jornada enable row level security;
alter table auditoria_cte_processos enable row level security;
alter table auditoria_cte_processo_ctes enable row level security;

drop policy if exists "auditoria_cte_jornada_all" on auditoria_cte_jornada;
create policy "auditoria_cte_jornada_all" on auditoria_cte_jornada for all using (true) with check (true);

drop policy if exists "auditoria_cte_processos_all" on auditoria_cte_processos;
create policy "auditoria_cte_processos_all" on auditoria_cte_processos for all using (true) with check (true);

drop policy if exists "auditoria_cte_processo_ctes_all" on auditoria_cte_processo_ctes;
create policy "auditoria_cte_processo_ctes_all" on auditoria_cte_processo_ctes for all using (true) with check (true);

-- ============================================================
-- FIM DA MIGRATION
-- ============================================================
