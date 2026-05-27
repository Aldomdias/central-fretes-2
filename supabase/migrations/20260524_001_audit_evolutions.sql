-- ============================================================
-- MIGRATION: Evolução Módulos Auditoria / AMDLog
-- Data: 2026-05-24
-- Aplique no SQL Editor do Supabase
-- ============================================================

-- ============================================================
-- 1. AJUSTE EM lotacao_lancamentos
--    Adicionar campos de auditoria/rastreabilidade
-- ============================================================
ALTER TABLE IF EXISTS lotacao_lancamentos
  ADD COLUMN IF NOT EXISTS audited_by_user_id  TEXT,
  ADD COLUMN IF NOT EXISTS audited_by_name     TEXT,
  ADD COLUMN IF NOT EXISTS audited_by_email    TEXT,
  ADD COLUMN IF NOT EXISTS audited_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audit_observation   TEXT,
  ADD COLUMN IF NOT EXISTS audit_status        TEXT DEFAULT 'AUDITADO_OK',
  ADD COLUMN IF NOT EXISTS audit_exceeded_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audit_allowed_amount  NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audit_entered_amount  NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS origem_tela         TEXT;

-- ============================================================
-- 2. TABELA: audit_pendencias
--    Pendências de excedente enviadas da Auditoria → Operação
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_pendencias (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lancamento_id         TEXT NOT NULL,
  dist                  TEXT,
  dist_key              TEXT,
  cte                   TEXT,
  fatura                TEXT,
  transportadora        TEXT,
  carga_id              TEXT,

  -- Valores
  valor_lancado         NUMERIC(14,2),
  valor_autorizado      NUMERIC(14,2),
  valor_excedente       NUMERIC(14,2),

  -- Status do fluxo
  status                TEXT NOT NULL DEFAULT 'EXCEDEU_AGUARDANDO_OPERACAO',
  -- Possíveis: AUDITADO_OK | EXCEDEU_AGUARDANDO_OPERACAO | APROVADO_OPERACAO |
  --            RECUSADO_OPERACAO | AGUARDANDO_INFORMACAO | INFORMACAO_RESPONDIDA |
  --            DEVOLVIDO_AUDITORIA | FINALIZADO

  -- Auditoria
  audited_by_user_id    TEXT,
  audited_by_name       TEXT,
  audited_by_email      TEXT,
  audited_at            TIMESTAMPTZ,
  observation           TEXT,

  -- Operação
  aprovado_por_user_id  TEXT,
  aprovado_por_name     TEXT,
  aprovado_em           TIMESTAMPTZ,
  motivo_recusa         TEXT,
  resposta_operacao     TEXT,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. TABELA: audit_historico_eventos
--    Timeline completa de cada pendência
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_historico_eventos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pendencia_id    UUID REFERENCES audit_pendencias(id) ON DELETE CASCADE,
  lancamento_id   TEXT,
  data_hora       TIMESTAMPTZ DEFAULT NOW(),
  user_id         TEXT,
  user_name       TEXT,
  user_email      TEXT,
  acao            TEXT NOT NULL,
  status_anterior TEXT,
  status_novo     TEXT,
  comentario      TEXT,
  origem_tela     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. TABELA: audit_solicitacoes_informacao
--    Solicitações de informação para CT-e/DIST não encontrado
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_solicitacoes_informacao (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                 TEXT NOT NULL, -- CTE | DIST | FATURA | NF | OP | OUTRO
  chave_informada      TEXT,
  numero_informado     TEXT,
  transportadora       TEXT,
  fatura               TEXT,
  descricao_problema   TEXT,
  responsavel_id       TEXT,
  responsavel_nome     TEXT,
  prioridade           TEXT DEFAULT 'NORMAL', -- BAIXA | NORMAL | ALTA | URGENTE
  prazo                DATE,
  status               TEXT DEFAULT 'AGUARDANDO_INFORMACAO',
  -- Possíveis: AGUARDANDO_INFORMACAO | RESPONDIDO | DEVOLVIDO_AUDITORIA | CANCELADO | FINALIZADO
  resposta             TEXT,
  respondido_por_id    TEXT,
  respondido_por_nome  TEXT,
  respondido_em        TIMESTAMPTZ,
  aberto_por_id        TEXT,
  aberto_por_nome      TEXT,
  aberto_por_email     TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. TABELA: audit_sla_config
--    Configurações de SLA e alertas (acesso somente gestor)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_sla_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                      TEXT NOT NULL DEFAULT 'Padrão',
  prazo_alerta_operacao_h   INT  DEFAULT 24,
  prazo_escalonamento_dias  INT  DEFAULT 2,
  emails_operacao           TEXT[] DEFAULT '{}',
  emails_gerencia           TEXT[] DEFAULT '{}',
  emails_diretoria          TEXT[] DEFAULT '{}',
  envio_email_ativo         BOOLEAN DEFAULT TRUE,
  alerta_visual_ativo       BOOLEAN DEFAULT TRUE,
  horario_verificacao       TIME DEFAULT '08:00',
  mensagem_padrao_email     TEXT DEFAULT 'Existem pendências de auditoria aguardando sua aprovação.',
  canal_modulo              TEXT DEFAULT 'LOTACAO',
  ativo                     BOOLEAN DEFAULT TRUE,
  created_by                TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Registro inicial
INSERT INTO audit_sla_config (nome, prazo_alerta_operacao_h, prazo_escalonamento_dias, canal_modulo)
SELECT 'Padrão Lotação', 24, 2, 'LOTACAO'
WHERE NOT EXISTS (SELECT 1 FROM audit_sla_config WHERE canal_modulo = 'LOTACAO');

-- ============================================================
-- 6. TABELA: faturas (cabeçalho)
-- ============================================================
CREATE TABLE IF NOT EXISTS faturas (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transportadora              TEXT,
  cnpj_transportadora         TEXT,
  data_envio                  DATE,
  data_emissao                DATE,
  data_vencimento             DATE,
  numero_fatura               TEXT,
  serie_fatura                TEXT,
  ctes_totais                 INT DEFAULT 0,
  ctes_vinculados             INT DEFAULT 0,
  valor_fatura                NUMERIC(14,2),
  valor_icms                  NUMERIC(14,2),
  valor_calculado             NUMERIC(14,2),
  diferenca                   NUMERIC(14,2),
  banco                       TEXT,
  enviado_para_pagamento      BOOLEAN DEFAULT FALSE,
  status                      TEXT DEFAULT 'PENDENTE',
  data_envio_erp              TIMESTAMPTZ,
  enviado_por                 TEXT,
  valor_enviado               NUMERIC(14,2),
  status_fatura               TEXT,
  status_pagamento            TEXT,
  data_pagamento              DATE,
  data_previsao_pagamento     DATE,
  documento_compensacao       TEXT,
  cnpj_tomador                TEXT,
  nome_tomador                TEXT,

  -- versionamento
  fatura_original_id          UUID REFERENCES faturas(id),
  versao                      INT DEFAULT 1,
  motivo_refeita              TEXT,
  refeita_por                 TEXT,
  refeita_em                  TIMESTAMPTZ,

  -- rastreabilidade
  importado_por               TEXT,
  importado_em                TIMESTAMPTZ DEFAULT NOW(),
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. TABELA: fatura_detalhes (CT-es da fatura)
-- ============================================================
CREATE TABLE IF NOT EXISTS fatura_detalhes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fatura_id               UUID REFERENCES faturas(id) ON DELETE CASCADE,
  numero_fatura           TEXT,
  serie_fatura            TEXT,
  transportadora          TEXT,
  cnpj_transportadora     TEXT,
  chave_cte               TEXT,
  numero_cte              TEXT,
  serie_cte               TEXT,
  mes_ano_emissao_cte     TEXT,
  cnpj_emissor            TEXT,
  cnpj_tomador            TEXT,
  nome_tomador            TEXT,
  valor_frete             NUMERIC(14,2),
  custo_frete             NUMERIC(14,2),
  preco_frete             NUMERIC(14,2),
  calculado_frete         NUMERIC(14,2),
  diferenca               NUMERIC(14,2),
  status_conciliacao      TEXT,
  status_processamento    TEXT,
  cte_integrado_erp       BOOLEAN DEFAULT FALSE,
  status                  TEXT DEFAULT 'PENDENTE',
  codigo_tratativa        TEXT,
  tratativa               TEXT,
  observacao              TEXT,
  usuario                 TEXT,
  data_tratativa          TIMESTAMPTZ,
  justificativa_inativacao TEXT,

  -- vínculo CT-e
  vinculo_automatico      BOOLEAN DEFAULT FALSE,
  vinculo_manual          BOOLEAN DEFAULT FALSE,
  vinculado_por           TEXT,
  vinculado_em            TIMESTAMPTZ,
  confianca_match         NUMERIC(5,2),

  -- excluído de versão
  excluido_da_versao      BOOLEAN DEFAULT FALSE,
  excluido_motivo         TEXT,

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. TABELA: tratativas (casos críticos)
-- ============================================================
CREATE TABLE IF NOT EXISTS tratativas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo             TEXT UNIQUE,
  tipo                  TEXT NOT NULL DEFAULT 'OUTRO',
  -- Possíveis: FATURA | CTE | DIST | LOTACAO | CUSTO_ADICIONAL | TRANSPORTADORA | SISTEMA | OUTRO
  transportadora        TEXT,
  cte                   TEXT,
  dist                  TEXT,
  fatura                TEXT,
  nf_op                 TEXT,
  causa_raiz            TEXT,
  descricao             TEXT,
  impacto_financeiro    NUMERIC(14,2),
  prioridade            TEXT DEFAULT 'NORMAL',
  responsavel_id        TEXT,
  responsavel_nome      TEXT,
  area_responsavel      TEXT,
  status                TEXT DEFAULT 'ABERTO',
  -- Possíveis: ABERTO | EM_ANALISE | AGUARDANDO_OPERACAO | AGUARDANDO_TRANSPORTADORA |
  --            AGUARDANDO_AUDITORIA | CORRIGIDO | CANCELADO | FINALIZADO
  prazo                 DATE,
  data_abertura         TIMESTAMPTZ DEFAULT NOW(),
  data_conclusao        TIMESTAMPTZ,
  observacoes           TEXT,
  aberto_por_id         TEXT,
  aberto_por_nome       TEXT,
  aberto_por_email      TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. TABELA: tratativa_historico
-- ============================================================
CREATE TABLE IF NOT EXISTS tratativa_historico (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tratativa_id    UUID REFERENCES tratativas(id) ON DELETE CASCADE,
  data_hora       TIMESTAMPTZ DEFAULT NOW(),
  user_id         TEXT,
  user_name       TEXT,
  acao            TEXT,
  status_anterior TEXT,
  status_novo     TEXT,
  comentario      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-protocolo para tratativas
CREATE OR REPLACE FUNCTION gerar_protocolo_tratativa()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.protocolo IS NULL OR NEW.protocolo = '' THEN
    NEW.protocolo := 'TRT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('tratativa_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS tratativa_seq START 1;

DROP TRIGGER IF EXISTS trg_protocolo_tratativa ON tratativas;
CREATE TRIGGER trg_protocolo_tratativa
  BEFORE INSERT ON tratativas
  FOR EACH ROW EXECUTE FUNCTION gerar_protocolo_tratativa();

-- ============================================================
-- 10. TABELA: simulation_reports (laudos do simulador)
-- ============================================================
CREATE TABLE IF NOT EXISTS simulation_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id   TEXT,
  carrier_id      TEXT,
  carrier_name    TEXT,
  report_type     TEXT NOT NULL DEFAULT 'EXECUTIVO',
  -- Possíveis: EXECUTIVO | TRANSPORTADOR
  report_json     JSONB,
  report_html     TEXT,
  periodo_inicio  DATE,
  periodo_fim     DATE,
  created_by      TEXT,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. ÍNDICES úteis
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_audit_pendencias_status   ON audit_pendencias(status);
CREATE INDEX IF NOT EXISTS idx_audit_pendencias_lancamento ON audit_pendencias(lancamento_id);
CREATE INDEX IF NOT EXISTS idx_audit_historico_pendencia ON audit_historico_eventos(pendencia_id);
CREATE INDEX IF NOT EXISTS idx_audit_sol_info_status     ON audit_solicitacoes_informacao(status);
CREATE INDEX IF NOT EXISTS idx_faturas_transportadora    ON faturas(transportadora);
CREATE INDEX IF NOT EXISTS idx_faturas_vencimento        ON faturas(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_fatura_detalhes_fatura    ON fatura_detalhes(fatura_id);
CREATE INDEX IF NOT EXISTS idx_fatura_detalhes_cte       ON fatura_detalhes(chave_cte);
CREATE INDEX IF NOT EXISTS idx_tratativas_status         ON tratativas(status);
CREATE INDEX IF NOT EXISTS idx_tratativas_responsavel    ON tratativas(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_simulation_reports_type   ON simulation_reports(report_type, carrier_id);

-- ============================================================
-- 12. Campo owner_user_id em transportadoras (se tabela existir)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transportadoras') THEN
    ALTER TABLE transportadoras
      ADD COLUMN IF NOT EXISTS owner_user_id    TEXT,
      ADD COLUMN IF NOT EXISTS owner_user_name  TEXT,
      ADD COLUMN IF NOT EXISTS responsavel_auditoria_id   TEXT,
      ADD COLUMN IF NOT EXISTS responsavel_auditoria_nome TEXT;
  END IF;
END $$;

-- ============================================================
-- FIM DA MIGRATION
-- ============================================================
