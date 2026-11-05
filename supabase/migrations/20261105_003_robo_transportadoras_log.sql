-- Registro de quem alterou a configuracao de cada transportadora do Robo Auditor
-- (modo de envio, ativo, e-mails, data de inicio, inclusao e remocao).
create table if not exists public.auditor_robo_transportadoras_log (
  id uuid primary key default gen_random_uuid(),
  transportadora_id text,
  transportadora text,
  acao text not null,          -- INCLUIDA, ALTERADA, REMOVIDA
  campo text,
  valor_anterior text,
  valor_novo text,
  descricao text,
  usuario text,
  created_at timestamptz not null default now()
);

create index if not exists auditor_robo_transportadoras_log_transp_idx on public.auditor_robo_transportadoras_log (transportadora_id, created_at desc);
create index if not exists auditor_robo_transportadoras_log_data_idx on public.auditor_robo_transportadoras_log (created_at desc);

alter table public.auditor_robo_transportadoras_log enable row level security;
grant select, insert on public.auditor_robo_transportadoras_log to anon, authenticated;
drop policy if exists "central_fretes_access" on public.auditor_robo_transportadoras_log;
create policy "central_fretes_access" on public.auditor_robo_transportadoras_log for all to anon, authenticated using (true) with check (true);
