-- Troca em massa: onde o auditor e Paulo Ricardo ou Abraao -> Caroline de Quadro Waldhelm.
-- Roda uma vez. Idempotente (depois de rodar, nao ha mais linhas de Paulo/Abraao para trocar).
do $$
declare
  novo_nome  constant text := 'Caroline de Quadro Waldhelm';
  novo_email constant text := 'caroline.waldhelm@cantu.inc';
  t text;
  qtd bigint;
  cond text := $c$(lower(coalesce(auditor_nome,'')) like 'paulo ricardo%'
                or lower(coalesce(auditor_nome,'')) like 'abraao%'
                or lower(coalesce(auditor_nome,'')) like 'abraão%'
                or lower(coalesce(auditor_email,'')) in ('p.santos@cantu.inc','abraao.ferreira@cantu.inc'))$c$;
begin
  foreach t in array array['auditoria_carteiras','faturas','auditoria_demandas','auditor_robo_transportadoras','auditor_robo_execucoes'] loop
    if to_regclass('public.' || t) is null then
      raise notice '% nao existe, ignorada', t;
      continue;
    end if;
    execute format(
      'update public.%I set auditor_nome = %L, auditor_email = %L%s where %s',
      t, novo_nome, novo_email,
      case when exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='auditor_id')
           then ', auditor_id = null' else '' end,
      cond);
    get diagnostics qtd = row_count;
    raise notice '%: % linhas trocadas', t, qtd;
  end loop;

  -- Jornada/processos de CT-e usam outro nome de coluna (so nome + id).
  foreach t in array array['auditoria_cte_processos','auditoria_cte_jornada'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='auditor_nome') then
      execute format('update public.%I set auditor_nome = %L, auditor_id = null where lower(coalesce(auditor_nome,'''')) like ''paulo ricardo%%'' or lower(coalesce(auditor_nome,'''')) like ''abraao%%''', t, novo_nome);
      get diagnostics qtd = row_count;
      raise notice '%: % linhas trocadas', t, qtd;
    end if;
  end loop;
end $$;
