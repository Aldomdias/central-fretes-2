-- Link da cotacao de lotacao passa a expirar (padrao 5 dias, definido ao gerar)
-- e o CNPJ deixa de ser pre-cadastrado: o transportador informa no portal.
alter table public.lotacao_cotacao_convites
  add column if not exists expira_em timestamptz;
