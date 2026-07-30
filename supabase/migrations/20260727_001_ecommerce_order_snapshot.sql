-- Auditoria E-commerce: base de pedidos (OrderSnapshotAnalytics) + cruzamento com Tracking/CT-e.
create table if not exists ecommerce_order_snapshot (
  id uuid primary key default gen_random_uuid(),
  pedido text not null,
  canal text,
  loja text,
  modelo_negocio text,
  uf text,
  cidade text,
  data_criacao timestamptz,
  data_pagamento timestamptz,
  data_cancelamento timestamptz,
  atividade_pos_cancelamento boolean,
  faturado_pos_cancelamento boolean,
  transportado_pos_cancelamento boolean,
  entregue_pos_cancelamento boolean,
  prazo_entrega timestamptz,
  prazo_dias_corridos numeric,
  status_entrega text,
  data_entrega timestamptz,
  entregue_fora_prazo boolean,
  status_devolucao text,
  data_devolucao timestamptz,
  valor_devolvido numeric,
  tempo_embarque numeric,
  tempo_faturamento numeric,
  valor_pedido numeric,
  frete_cobrado numeric,
  frete_devido numeric,
  frete_tabela numeric,
  desconto_campanha_frete numeric,
  adicional_tributario_frete numeric,
  custo_frete_transportadora numeric,
  status_conciliacao_frete text,
  diferenca_tabela_cte numeric,
  percentual_geral_frete numeric,
  frete_a_cobrar_marketplace numeric,
  valor_faturado numeric,
  peso_cotado numeric,
  peso_faturado numeric,
  diferenca_peso numeric,
  tem_cte boolean,
  tem_cte_complementar boolean,
  logistica_marketplace boolean,
  pedido_retira boolean,
  possui_campanha_frete boolean,
  contingencia_aplicada boolean,
  status_faturamento text,
  itens_faturados_errados boolean,
  valor_faturado_errado boolean,
  nota_fiscal_duplicada boolean,
  divergencia_origem boolean,
  divergencia_transportadora boolean,
  anuncio_nao_integrado boolean,
  desconto_anuncio_valor numeric,
  desconto_anuncio_percentual numeric,
  valor_adicional_markup numeric,
  valor_frete_embutido_anuncio numeric,
  desconto_acima_limite boolean,
  desvio_liberado boolean,
  liberado_por text,
  data_liberacao timestamptz,
  -- Resultado do cruzamento (Fase 1): Pedido -> tracking_rows.pedido -> chave_cte -> realizado_local_ctes.
  chave_cte text,
  cte_encontrado boolean default false,
  cte_transportadora text,
  cte_numero text,
  cte_valor numeric,
  cte_data_emissao timestamptz,
  cte_uf_origem text,
  cte_uf_destino text,
  cte_cidade_origem text,
  cte_cidade_destino text,
  cte_peso numeric,
  cte_cubagem numeric,
  cruzamento_status text default 'pendente', -- pendente | sem_tracking | sem_cte | ok
  cruzado_em timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pedido)
);

create index if not exists idx_ecommerce_order_snapshot_pedido on ecommerce_order_snapshot (pedido);
create index if not exists idx_ecommerce_order_snapshot_chave_cte on ecommerce_order_snapshot (chave_cte);
create index if not exists idx_ecommerce_order_snapshot_cruzamento_status on ecommerce_order_snapshot (cruzamento_status);
create index if not exists idx_ecommerce_order_snapshot_data_criacao on ecommerce_order_snapshot (data_criacao);

alter table ecommerce_order_snapshot enable row level security;

drop policy if exists ecommerce_order_snapshot_select on ecommerce_order_snapshot;
create policy ecommerce_order_snapshot_select on ecommerce_order_snapshot for select using (true);

drop policy if exists ecommerce_order_snapshot_insert on ecommerce_order_snapshot;
create policy ecommerce_order_snapshot_insert on ecommerce_order_snapshot for insert with check (true);

drop policy if exists ecommerce_order_snapshot_update on ecommerce_order_snapshot;
create policy ecommerce_order_snapshot_update on ecommerce_order_snapshot for update using (true) with check (true);

drop policy if exists ecommerce_order_snapshot_delete on ecommerce_order_snapshot;
create policy ecommerce_order_snapshot_delete on ecommerce_order_snapshot for delete using (true);
