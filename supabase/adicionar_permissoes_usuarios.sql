alter table if exists public.usuarios_central
add column if not exists permissoes_paginas jsonb not null default '[]'::jsonb;

update public.usuarios_central
set permissoes_paginas = '["*"]'::jsonb
where lower(email) = 'aldo.dias@cantu.inc'
  and perfil = 'GESTAO';
