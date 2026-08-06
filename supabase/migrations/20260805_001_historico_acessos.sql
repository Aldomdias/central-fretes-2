-- Historico de acessos: registra cada troca de tela por usuario logado, para a gestao
-- acompanhar quem entrou no sistema e por onde navegou (nao e so presenca em tempo real).
create table if not exists historico_acessos (
  id uuid primary key default gen_random_uuid(),
  usuario_id text,
  usuario_nome text,
  usuario_email text,
  pagina text,
  pagina_label text,
  criado_em timestamptz not null default now()
);

create index if not exists historico_acessos_criado_em_idx on historico_acessos (criado_em desc);
create index if not exists historico_acessos_usuario_id_idx on historico_acessos (usuario_id);

alter table historico_acessos enable row level security;

drop policy if exists "historico_acessos_public_access" on historico_acessos;
create policy "historico_acessos_public_access" on historico_acessos for all using (true) with check (true);
