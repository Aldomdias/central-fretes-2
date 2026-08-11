-- CNPJ da transportadora e sua raiz (8 primeiros dígitos) passam a ser a chave
-- comum para vincular cadastro, negociações/tabelas e CT-es, independentemente
-- do estabelecimento/filial que emitiu o documento.

alter table public.transportadoras
  add column if not exists cnpj text,
  add column if not exists cnpj_raiz text;

alter table public.tabelas_negociacao
  add column if not exists cnpj_transportadora text,
  add column if not exists cnpj_raiz_transportadora text;

update public.transportadoras
set
  cnpj = nullif(left(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), 14), ''),
  cnpj_raiz = nullif(left(regexp_replace(coalesce(cnpj_raiz, cnpj, ''), '\D', '', 'g'), 8), '');

update public.tabelas_negociacao
set
  cnpj_transportadora = nullif(left(regexp_replace(coalesce(cnpj_transportadora, ''), '\D', '', 'g'), 14), ''),
  cnpj_raiz_transportadora = nullif(left(regexp_replace(coalesce(cnpj_raiz_transportadora, cnpj_transportadora, ''), '\D', '', 'g'), 8), '');

alter table public.transportadoras
  drop constraint if exists transportadoras_cnpj_formato_check,
  drop constraint if exists transportadoras_cnpj_raiz_formato_check;

alter table public.transportadoras
  add constraint transportadoras_cnpj_formato_check check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  add constraint transportadoras_cnpj_raiz_formato_check check (cnpj_raiz is null or cnpj_raiz ~ '^[0-9]{8}$');

alter table public.tabelas_negociacao
  drop constraint if exists tabelas_negociacao_cnpj_formato_check,
  drop constraint if exists tabelas_negociacao_cnpj_raiz_formato_check;

alter table public.tabelas_negociacao
  add constraint tabelas_negociacao_cnpj_formato_check check (cnpj_transportadora is null or cnpj_transportadora ~ '^[0-9]{14}$'),
  add constraint tabelas_negociacao_cnpj_raiz_formato_check check (cnpj_raiz_transportadora is null or cnpj_raiz_transportadora ~ '^[0-9]{8}$');

create index if not exists idx_transportadoras_cnpj_raiz
  on public.transportadoras (cnpj_raiz)
  where cnpj_raiz is not null;

create index if not exists idx_tabelas_negociacao_cnpj_raiz
  on public.tabelas_negociacao (cnpj_raiz_transportadora)
  where cnpj_raiz_transportadora is not null;

create index if not exists idx_realizado_ctes_cnpj_transportadora_raiz
  on public.realizado_ctes ((left(regexp_replace(coalesce(cnpj_transportadora, ''), '\D', '', 'g'), 8)))
  where nullif(cnpj_transportadora, '') is not null;

create index if not exists idx_auditoria_cte_resultados_cnpj_transportadora_raiz
  on public.auditoria_cte_resultados ((left(regexp_replace(coalesce(cnpj_transportadora, ''), '\D', '', 'g'), 8)))
  where nullif(cnpj_transportadora, '') is not null;

comment on column public.transportadoras.cnpj_raiz is
  'Raiz de 8 dígitos usada para vincular a transportadora a CT-es e tabelas de qualquer filial.';

comment on column public.tabelas_negociacao.cnpj_raiz_transportadora is
  'Raiz de 8 dígitos obrigatória no fluxo de aprovação/publicação da tabela.';
