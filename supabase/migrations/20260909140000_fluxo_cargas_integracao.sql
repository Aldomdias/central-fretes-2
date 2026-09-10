-- Integração via API do fluxo de cargas (Cantu/Hubylog assumido pela Central Fretes).
-- Cada processo é identificado pela combinação tipo+numero_id e evolui por PUTs
-- parciais ao longo das 10 fases descritas no mapeamento (geração, cotação,
-- caminhão, chegada origem, operação/doca, faturamento, liberação, chegada
-- filial, descarga, comprovante). GET consulta o estado atual do processo.

create table if not exists fluxo_cargas_processos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  numero_id text not null,

  -- Fase 1 - Geração de carga
  solicitante text,
  origem text,
  cod_filial text,
  categoria text,
  cubagem numeric,
  data_coleta_solicitada text,
  peso_total numeric,
  valor_total_aproximado numeric,
  destinos jsonb,

  -- Fase 2 - Cotação
  subcontratacao text,
  previsao_coleta text,
  transportadora text,
  bp text,
  frete_cantu text,
  frete_transportadora text,

  -- Fase 3 - Caminhão
  nome_motorista text,
  telefone_motorista text,
  placa_cavalo text,
  placa_carreta text,
  placa_carreta_extra text,
  tipo_veiculo text,

  -- Fase 4 - Chegada na origem
  chegada_fornecedor text,

  -- Fase 5 - Operação / doca
  inicio_operacao text,
  fim_operacao text,
  doca text,
  porcentagem_separacao numeric,

  -- Fase 6 - Anexo de faturamento
  numeracao_lacre text,
  data_anexo_faturamento text,
  info_faturamento jsonb,

  -- Fase 7 - Liberação do caminhão
  info_liberacao jsonb,

  -- Fase 8 - Chegada na filial
  chegada_caminhao_filial text,

  -- Fase 9 - Descarga no destino
  descarga_filial text,

  -- Fase 10 - Comprovante de entrega
  anexo_comprovante jsonb,

  -- Campos extras observados no teste da integradora, sem mapeamento oficial
  -- ainda: preservados para não perder dado até o schema ser confirmado.
  extra jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tipo, numero_id)
);

create index if not exists idx_fluxo_cargas_processos_numero_id
  on fluxo_cargas_processos (numero_id);
