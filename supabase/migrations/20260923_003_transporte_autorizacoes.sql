-- Autorizacoes do responsavel do transporte (modulos B2C e Atacado).
--
-- Duas vias sobre a mesma tabela:
--  1) Fila: a auditoria acha um CT-e divergente (ex.: cotacao/sem tabela) e
--     envia pro gestor do canal (origem = 'AUDITORIA', status PENDENTE);
--     ele autoriza um valor (AUTORIZADA) ou recusa (RECUSADA).
--  2) Autorizacao antecipada: o gestor lanca a chave (CT-e ou NF) + saldo
--     autorizado ANTES da auditoria (origem = 'GESTOR', ja nasce AUTORIZADA).
--
-- O motor de calculo NAO muda: o valor autorizado fica guardado aqui e a
-- camada de auditoria soma ao valor calculado so na hora de comparar com o
-- cobrado (chave CT-e ou chave NF).
create table if not exists public.transporte_autorizacoes (
  id uuid primary key default gen_random_uuid(),
  canal text not null check (canal in ('B2C', 'ATACADO')),
  origem text not null default 'AUDITORIA' check (origem in ('AUDITORIA', 'GESTOR')),
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'AUTORIZADA', 'RECUSADA')),
  chave_cte text,
  chave_nfe text,
  numero_pedido text,
  transportadora text,
  cidade_origem text,
  cidade_destino text,
  valor_cte numeric(14,2) default 0,
  valor_calculado numeric(14,2) default 0,
  valor_divergente numeric(14,2) default 0,
  valor_autorizado numeric(14,2) default 0,
  observacao_auditoria text,
  observacao_gestor text,
  enviado_por text,
  enviado_em timestamptz default now(),
  decidido_por text,
  decidido_em timestamptz,
  fatura_id uuid,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint transporte_autorizacoes_chave_ck check (chave_cte is not null or chave_nfe is not null)
);

create index if not exists transporte_autorizacoes_canal_status_idx on public.transporte_autorizacoes (canal, status) where ativo;
create index if not exists transporte_autorizacoes_chave_cte_idx on public.transporte_autorizacoes (chave_cte) where ativo and status = 'AUTORIZADA';
create index if not exists transporte_autorizacoes_chave_nfe_idx on public.transporte_autorizacoes (chave_nfe) where ativo and status = 'AUTORIZADA';

-- Mesmo padrao das demais tabelas do projeto (RLS aberta pra anon/authenticated).
alter table public.transporte_autorizacoes enable row level security;

grant select, insert, update, delete on public.transporte_autorizacoes to anon, authenticated;

drop policy if exists "transporte_autorizacoes_access" on public.transporte_autorizacoes;

create policy "transporte_autorizacoes_access"
  on public.transporte_autorizacoes
  for all to anon, authenticated
  using (true)
  with check (true);
