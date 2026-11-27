-- Fornecedores das operacoes de compras (pneus etc.).
--
-- Nas compras o expedidor/remetente do CT-e e sempre o CNPJ do fornecedor. O Diagnostico de faturas usa
-- esta lista para mostrar o card "Compras: CT-e de fornecedor" (fatura com pelo menos um CT-e cujo
-- remetente esta aqui). Fornecedor novo cadastrado na tela entra no mesmo ciclo, sem deploy.

create table if not exists public.fornecedores_compras (
  id uuid primary key default gen_random_uuid(),
  codigo text,
  nome text not null,
  cnpj text not null,
  ativo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  criado_por text
);

create unique index if not exists fornecedores_compras_cnpj_uidx on public.fornecedores_compras (cnpj);

alter table public.fornecedores_compras enable row level security;

-- Mesmo modelo de acesso das demais tabelas do app.
drop policy if exists fornecedores_compras_all on public.fornecedores_compras;
create policy fornecedores_compras_all on public.fornecedores_compras
  for all using (true) with check (true);

grant all on public.fornecedores_compras to anon, authenticated;

-- Relacao inicial (24/11/2026).
insert into public.fornecedores_compras (codigo, nome, cnpj, ativo) values
  ('18741', 'BRIDGESTONE', '57497539000115', true),
  ('21307', 'CONTINENTAL', '02036483000452', true),
  ('21309', 'CONTINENTAL', '02036483000614', true),
  ('29059', 'MAGGION', '61077079000143', true),
  ('32701', 'GOODYEAR', '60500246001630', true),
  ('34405', 'PIRELLI', '24502351000240', true),
  ('35124', 'PROMETEON', '22301988000404', false),
  ('35125', 'PROMETEON', '22301988000595', false),
  ('35127', 'PROMETEON', '22301988000838', false),
  ('36140', 'RINALDI', '87556601000163', true),
  ('37823', 'MICHELIN', '50567288000663', true),
  ('37824', 'MICHELIN', '50567288002526', true),
  ('38989', 'IRA/TORTUGA', '00934658000170', true),
  ('113470', 'ROBUST/SPEEDMAX', '30677239000161', true),
  ('113664', 'PROMETEON', '22301988000323', false),
  ('162327', 'GOODYEAR', '60500246001479', true),
  ('257974', 'KENDA (MOTOCICLO)', '01407607000153', false),
  ('267151', 'VIPAL', '07857217000161', false),
  ('898969', 'DUNCAN', '21205126000253', false),
  ('1355394', 'BORILLI', '08363469000105', true),
  ('1405693', 'TECHNIC', '02859316000169', false),
  ('34407', 'PIRELLI', '24502351000592', true),
  ('2404729', 'JAPURA PNEUS', '04214987000793', true),
  ('3480755', 'JAPURA PNEUS', '04214987002303', true),
  ('3529494', 'BRIDGESTONE', '57497539000700', true),
  ('3530465', 'MAUER GO', '51239993000190', true),
  ('3888353', 'JAPURA PNEUS', '04214987002494', true)
on conflict (cnpj) do nothing;

notify pgrst, 'reload schema';
