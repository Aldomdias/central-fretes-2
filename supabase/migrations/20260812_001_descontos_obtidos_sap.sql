-- Descontos financeiros obtidos (comprovados no SAP), importados de extratos
-- contábeis por arquivo/mês. Usado para comparar depois com o que foi
-- solicitado ao financeiro nas faturas/auditoria.
create table if not exists public.descontos_obtidos_sap (
  id uuid primary key default gen_random_uuid(),
  ano int not null,
  mes int not null,
  data_lancamento date not null,
  conta_razao text not null,
  regra_aplicada text not null check (regra_aplicada in ('desc_fin_obtidos', 'fretes_carretos')),
  transportadora_nome text not null,
  transportadora_codigo text,
  empresa text,
  centro_lucro text,
  valor numeric not null,
  lancamento_contabil text,
  texto_partida text,
  arquivo_origem text not null,
  linha_hash text not null,
  criado_em timestamptz not null default now(),
  unique (linha_hash)
);

create index if not exists idx_descontos_obtidos_sap_ano_mes
  on public.descontos_obtidos_sap (ano, mes);

create index if not exists idx_descontos_obtidos_sap_transportadora
  on public.descontos_obtidos_sap (transportadora_nome);

create index if not exists idx_descontos_obtidos_sap_arquivo
  on public.descontos_obtidos_sap (arquivo_origem);

alter table public.descontos_obtidos_sap enable row level security;

grant select, insert, update, delete on public.descontos_obtidos_sap to anon, authenticated;

drop policy if exists "descontos_obtidos_sap_public_access" on public.descontos_obtidos_sap;

create policy "descontos_obtidos_sap_public_access"
  on public.descontos_obtidos_sap
  for all to anon, authenticated
  using (true)
  with check (true);

comment on table public.descontos_obtidos_sap is
  'Descontos financeiros efetivamente concedidos, extraídos de exportações contábeis do SAP. Regra: até a mudança de padrão, conta 41301002 (Desc. Fin. Obtidos) filtrada por centro de lucro de transporte; depois, conta 32208005 (Fretes e Carretos) direto, sem filtro de centro de lucro.';
comment on column public.descontos_obtidos_sap.regra_aplicada is
  'Qual regra de filtro (conta+centro de lucro) originou a linha, para auditoria do próprio import.';
comment on column public.descontos_obtidos_sap.linha_hash is
  'Hash da linha original do SAP (evita duplicar ao reimportar arquivos com meses sobrepostos).';
