-- Canal invertido na auditoria (ex.: WM Transportes).
--
-- Algumas transportadoras atendem B2C e ATACADO, e às vezes o pedido chega com
-- o canal trocado (era B2C e veio ATACADO, ou o contrário). Com o flag ligado,
-- quando o CT-e diverge pela tabela do canal dele (ou não calcula), a Auditoria
-- recalcula pelo OUTRO canal; se o valor pago fechar dentro da tolerância, o
-- CT-e é aceito por esse cálculo (sem laudo) e fica anotado "canal invertido".

alter table public.transportadoras
  add column if not exists aceita_canal_invertido boolean not null default false;

notify pgrst, 'reload schema';
