alter table if exists public.usuarios_central
add column if not exists permissoes_paginas jsonb not null default '[]'::jsonb;

update public.usuarios_central
set
  email = 'aldo.dias@cantu.inc',
  perfil = 'GESTAO',
  ativo = true,
  permissoes_paginas = '["*"]'::jsonb,
  atualizado_em = now()
where id = 'user-gestao-aldo'
   or lower(email) in ('aldomdias@gmail.com', 'aldo.dias@cantu.inc');
