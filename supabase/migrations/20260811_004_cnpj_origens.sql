-- Cada origem representa uma filial e precisa guardar seu CNPJ completo.

alter table public.origens
  add column if not exists cnpj text,
  add column if not exists cnpj_raiz text;

update public.origens
set
  cnpj = nullif(left(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), 14), ''),
  cnpj_raiz = nullif(left(regexp_replace(coalesce(cnpj_raiz, cnpj, ''), '\D', '', 'g'), 8), '');

alter table public.origens
  drop constraint if exists origens_cnpj_formato_check,
  drop constraint if exists origens_cnpj_raiz_formato_check;

alter table public.origens
  add constraint origens_cnpj_formato_check check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  add constraint origens_cnpj_raiz_formato_check check (cnpj_raiz is null or cnpj_raiz ~ '^[0-9]{8}$');

create index if not exists idx_origens_cnpj_raiz
  on public.origens (cnpj_raiz)
  where cnpj_raiz is not null;

comment on column public.origens.cnpj is
  'CNPJ completo obrigatorio no aplicativo para novas origens/filiais.';
