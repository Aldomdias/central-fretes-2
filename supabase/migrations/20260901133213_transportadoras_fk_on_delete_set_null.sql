-- Cadastros de transportadora podem ser removidos sem apagar documentos
-- historicos. Os registros dependentes preservam seus demais campos e perdem
-- apenas o UUID do cadastro excluido.
do $$
declare
  v_tabela text;
  v_constraint text;
begin
  foreach v_tabela in array array[
    'faturas',
    'fatura_detalhes',
    'realizado_ctes',
    'auditoria_cte_resultados',
    'tabelas_negociacao'
  ] loop
    select c.conname
      into v_constraint
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public'
       and rel.relname = v_tabela
       and c.contype = 'f'
       and c.confrelid = 'public.transportadoras'::regclass
     limit 1;

    if v_constraint is not null then
      execute format('alter table public.%I drop constraint %I', v_tabela, v_constraint);
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (transportadora_id) references public.transportadoras(id) on delete set null',
      v_tabela,
      v_tabela || '_transportadora_id_fkey'
    );
    v_constraint := null;
  end loop;
end
$$;
