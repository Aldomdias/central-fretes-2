-- Importação de CT-e (realizado_local_ctes) passou a estourar
-- "canceling statement due to statement timeout" ao gravar lotes, porque a base
-- cresceu (~736k linhas com jan–abr/2026) e o statement_timeout padrão do
-- Supabase (curto) corta a gravação.
--
-- Aumenta o tempo limite por statement para os papéis usados pela aplicação,
-- dando folga para os upserts em lote da importação. O cliente já fatia o lote
-- e tem retry; este ajuste evita o corte na origem.
--
-- Observação: ALTER ROLE só passa a valer em novas conexões. O PgBouncer/pool
-- do Supabase renova as conexões; se necessário, reinicie o projeto para
-- garantir que o pool releia o parâmetro.

alter role authenticated set statement_timeout = '120s';
alter role anon set statement_timeout = '120s';

-- Recarrega a config para os papéis (best-effort).
do $$
begin
  perform pg_reload_conf();
exception when others then
  null;
end $$;
