-- Portal de cotacao fracionado: kg garantia (R$/kg) na modalidade PERCENTUAL.
-- Frete = maior entre (% x valor NF), minimo (R$) e (peso x R$/kg). Opcional: em branco = nao usa.
alter table public.fracionado_respostas add column if not exists frete_kg numeric;
comment on column public.fracionado_respostas.frete_kg is 'Kg garantia R$/kg (modalidade PERCENTUAL, opcional)';
