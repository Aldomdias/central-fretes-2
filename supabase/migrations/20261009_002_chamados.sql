-- Chamados abertos pelos usuarios (problema ou melhoria) direto de qualquer tela.

create table if not exists public.chamados (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  tipo text not null default 'PROBLEMA',        -- PROBLEMA | MELHORIA
  modulo text not null,
  titulo text not null,
  descricao text not null,
  urgencia text not null default 'MEDIA',       -- BAIXA | MEDIA | ALTA | CRITICA
  status text not null default 'ABERTO',        -- ABERTO | EM_ANALISE | EM_ANDAMENTO | RESOLVIDO | CANCELADO
  pagina_origem text,
  usuario_id text,
  usuario_nome text,
  usuario_email text,
  resposta text,
  resolvido_por text,
  resolvido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chamados_status_idx on public.chamados (status, created_at desc);
create index if not exists chamados_usuario_idx on public.chamados (usuario_id, created_at desc);

alter table public.chamados enable row level security;
drop policy if exists "chamados_public_access" on public.chamados;
create policy "chamados_public_access" on public.chamados for all using (true) with check (true);
