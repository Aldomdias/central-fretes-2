-- RODAR NO SUPABASE (SQL Editor), de uma vez. Pode rodar mais de uma vez sem problema.

-- Robo auditor: ENVIO DIRETO do laudo por transportadora (sem a aprovacao do auditor).
-- envio_direto = true: o laudo calculado pelo robo ja nasce aprovado ("Robo (envio direto)") e sai por e-mail
-- para a transportadora, com o auditor e o grupo de faturas (fatura@cantustore.com.br) sempre em copia.
-- Vale SO para faturas que entraram no sistema a partir de envio_direto_desde (momento em que foi ligado);
-- o que ja estava na fila continua esperando o OK do auditor.
alter table public.auditor_robo_transportadoras
  add column if not exists envio_direto boolean not null default false,
  add column if not exists envio_direto_desde timestamptz;

-- Tira o e-mail de teste (aldomdias@gmail.com) das listas de destinatarios do robo.
update public.auditor_robo_transportadoras
set emails_transportadora = nullif(array_to_string(array(
      select trim(e) from unnest(regexp_split_to_array(coalesce(emails_transportadora, ''), '[;,\s]+')) as e
      where trim(e) <> '' and lower(trim(e)) <> 'aldomdias@gmail.com'), '; '), ''),
    email_aprovacao = nullif(array_to_string(array(
      select trim(e) from unnest(regexp_split_to_array(coalesce(email_aprovacao, ''), '[;,\s]+')) as e
      where trim(e) <> '' and lower(trim(e)) <> 'aldomdias@gmail.com'), '; '), ''),
    updated_at = now()
where coalesce(emails_transportadora, '') ilike '%aldomdias@gmail.com%'
   or coalesce(email_aprovacao, '') ilike '%aldomdias@gmail.com%';

-- Robo auditor: CT-es da fatura sem a chave da NF-e DENTRO do CT-e (base de CT-es / XML; tracking nao vale).
-- Nao podem ser pagos: o laudo segue para a transportadora pedindo a retirada e um CT-e novo.
-- Lista de { chave_cte, numero_cte, valor_frete, diferenca_incluida }.
alter table public.auditor_robo_execucoes
  add column if not exists ctes_sem_nf jsonb not null default '[]'::jsonb;
