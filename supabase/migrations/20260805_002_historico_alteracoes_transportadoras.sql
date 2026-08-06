-- Log de quem alterou o cadastro de transportadoras (origens, rotas, cotacoes, taxas,
-- generalidades, exclusoes e validacoes). Nao guarda diff campo a campo, so o evento:
-- quem, quando, o que (tipo + transportadora/origem/secao envolvida).
create table if not exists historico_alteracoes_transportadoras (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  transportadora_id text,
  transportadora_nome text,
  origem_id text,
  origem_cidade text,
  secao text,
  detalhe text,
  usuario_id text,
  usuario_nome text,
  usuario_email text,
  criado_em timestamptz not null default now()
);

create index if not exists hist_alt_transp_criado_em_idx on historico_alteracoes_transportadoras (criado_em desc);
create index if not exists hist_alt_transp_transportadora_id_idx on historico_alteracoes_transportadoras (transportadora_id);

alter table historico_alteracoes_transportadoras enable row level security;

drop policy if exists "hist_alt_transp_public_access" on historico_alteracoes_transportadoras;
create policy "hist_alt_transp_public_access" on historico_alteracoes_transportadoras for all using (true) with check (true);
