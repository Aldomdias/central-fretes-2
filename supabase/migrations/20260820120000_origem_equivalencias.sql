-- Exceções de origem por transportadora.
-- Caso real: a TAM tem tabela de frete com origem Serra/ES, mas emite os CT-e
-- como Vitória/ES. Sem isso o motor não casa a origem e o CT-e fica sem cálculo.
-- A exceção só torna a origem da tabela elegível para aquela cidade emissora —
-- a tabela usada continua sendo a de Serra, sem duplicar rotas.
-- Cadastro pela tela Ferramentas > Exceções de origem.

create table if not exists public.origem_equivalencias (
  id uuid primary key default gen_random_uuid(),
  transportadora text not null,
  transportadora_norm text not null,
  origem_tabela text not null,
  origem_tabela_norm text not null,
  origem_cte text not null,
  origem_cte_norm text not null,
  uf text not null default '',
  ibge_cte text not null default '',
  -- IBGE da origem da TABELA: permite que a busca direcionada por rota ache a
  -- tabela sem precisar carregar a transportadora inteira.
  ibge_tabela text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.origem_equivalencias
  add column if not exists ibge_tabela text not null default '';

create unique index if not exists origem_equivalencias_chave_uidx
  on public.origem_equivalencias (transportadora_norm, origem_tabela_norm, origem_cte_norm);

alter table public.origem_equivalencias enable row level security;

-- Mesmo modelo de acesso das demais tabelas do app.
drop policy if exists origem_equivalencias_all on public.origem_equivalencias;
create policy origem_equivalencias_all on public.origem_equivalencias
  for all using (true) with check (true);

grant all on public.origem_equivalencias to anon, authenticated;

-- O caso que originou a tela (TAM: tabela com origem Serra/ES, CT-e emitido
-- como Vitória/ES) NÃO vai inserido aqui de propósito: a exceção casa pelo
-- nome da TABELA de frete, e só o cadastro da base sabe qual é ele
-- ("TAM LINHAS AEREAS S/A" no CT-e pode ser outro nome na tabela). Cadastre
-- pela tela Ferramentas > Exceções de origem, escolhendo a transportadora na
-- lista — assim o nome vem certo e os IBGEs são preenchidos sozinhos.
