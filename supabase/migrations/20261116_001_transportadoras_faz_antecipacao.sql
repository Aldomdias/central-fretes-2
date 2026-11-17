-- Transportadora que faz antecipação de faturas (ex.: WM).
--
-- Com o flag ligado, o Diagnóstico de faturas mostra, ao escolher a transportadora,
-- o card "Aptas à antecipação": faturas não pagas com mais de 7 dias da emissão
-- e menos de 10 dias para o vencimento.

alter table public.transportadoras
  add column if not exists faz_antecipacao boolean not null default false;

notify pgrst, 'reload schema';
