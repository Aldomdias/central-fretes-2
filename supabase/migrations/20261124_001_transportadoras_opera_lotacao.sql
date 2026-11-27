-- Flag "opera lotação" no cadastro da transportadora (ex.: Rodotista).
--
-- Transportadora marcada é tratada como lotação na Auditoria CT-e mesmo sem tabela de lotação vigente:
-- o CT-e dela (inclusive B2C/ATACADO) é conferido pela tabela de lotação, pela DIST da TransGP ou pela
-- viagem do fluxo de lotação (mesmo número de CT-e).

alter table public.transportadoras
  add column if not exists opera_lotacao boolean not null default false;

notify pgrst, 'reload schema';
