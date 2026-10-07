-- Numeros que o laudo do transportador mostrou (ja com a mascara das opcoes do
-- laudo). A pagina de confirmacao (/api/portal-fatura) passa a exibir estes
-- valores em vez do calculo AMD cheio da fatura, para acompanhar o laudo.
alter table public.faturas
  add column if not exists confirmacao_laudo_calculado numeric,
  add column if not exists confirmacao_laudo_desconto numeric;
