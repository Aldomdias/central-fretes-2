-- Cadastro das empresas/tomadores presentes em Filiais.ods.
-- As 465 filiais ficam cobertas pelas 6 raízes, sem depender do sufixo /0001.

create table if not exists public.empresas_cnpj_raizes (
  cnpj_raiz text primary key,
  codigo text not null,
  nome text not null,
  aliases text[] not null default '{}',
  quantidade_filiais integer not null default 0,
  origem text,
  updated_at timestamptz not null default now(),
  constraint empresas_cnpj_raizes_formato_check check (cnpj_raiz ~ '^[0-9]{8}$')
);

insert into public.empresas_cnpj_raizes
  (cnpj_raiz, codigo, nome, aliases, quantidade_filiais, origem)
values
  ('08265644', 'GRIP', 'GRIP', array['GRIP'], 3, 'Filiais.ods'),
  ('08888040', 'CP', 'CP Comercial', array['CP'], 33, 'Filiais.ods'),
  ('10158356', 'CPX', 'CPX / GP', array['CPX', 'GP/CPX'], 217, 'Filiais.ods'),
  ('15426874', 'ITR', 'ITR', array['ITR'], 52, 'Filiais.ods'),
  ('43362585', 'AFB', 'AFB', array['AFB'], 5, 'Filiais.ods'),
  ('46378127', 'GP', 'GP Pneus', array['GP', 'GP PNEUS'], 155, 'Filiais.ods')
on conflict (cnpj_raiz) do update set
  codigo = excluded.codigo,
  nome = excluded.nome,
  aliases = excluded.aliases,
  quantidade_filiais = excluded.quantidade_filiais,
  origem = excluded.origem,
  updated_at = now();

create index if not exists idx_faturas_cnpj_tomador_raiz
  on public.faturas ((left(regexp_replace(coalesce(cnpj_tomador, ''), '\D', '', 'g'), 8)))
  where nullif(cnpj_tomador, '') is not null;

create index if not exists idx_fatura_detalhes_cnpj_tomador_raiz
  on public.fatura_detalhes ((left(regexp_replace(coalesce(cnpj_tomador, ''), '\D', '', 'g'), 8)))
  where nullif(cnpj_tomador, '') is not null;

comment on table public.empresas_cnpj_raizes is
  'Empresas e unidades internas vinculadas pelo CNPJ raiz, independentemente da filial.';

alter table public.empresas_cnpj_raizes enable row level security;

drop policy if exists empresas_cnpj_raizes_leitura on public.empresas_cnpj_raizes;
create policy empresas_cnpj_raizes_leitura
  on public.empresas_cnpj_raizes
  for select
  to anon, authenticated
  using (true);

grant select on public.empresas_cnpj_raizes to anon, authenticated;
