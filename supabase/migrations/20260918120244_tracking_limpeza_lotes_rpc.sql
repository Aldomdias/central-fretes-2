create index if not exists idx_tracking_rows_nf_emissao_mes
  on public.tracking_rows ((substring(chave_nfe from 3 for 4)))
  where length(chave_nfe) = 44;
create index if not exists idx_tracking_rows_nf_id_emissao_mes
  on public.tracking_rows ((substring(id from 6 for 4)))
  where length(id) = 47 and left(id, 3) = 'nf-';

create or replace function public.contar_tracking_competencia_nf(p_competencia text)
returns bigint language plpgsql security invoker set search_path = public
as $$
declare v_mes text;
begin
  if p_competencia is null or p_competencia !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception 'Competência inválida';
  end if;
  v_mes := replace(right(p_competencia, 5), '-', '');
  return (select count(*) from public.tracking_rows
    where (length(chave_nfe) = 44 and substring(chave_nfe from 3 for 4) = v_mes)
       or (length(id) = 47 and left(id, 3) = 'nf-' and substring(id from 6 for 4) = v_mes));
end;
$$;

create or replace function public.limpar_tracking_competencia_nf_lote(p_competencia text, p_limite integer default 2000)
returns integer language plpgsql security invoker set search_path = public
as $$
declare v_mes text; v_excluidos integer;
begin
  if p_competencia is null or p_competencia !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception 'Competência inválida';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 2000 then
    raise exception 'Lote inválido';
  end if;
  if (coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-client-info')
     is distinct from ('tracking-limpeza/' || p_competencia) then
    raise exception 'Confirmação de competência ausente';
  end if;
  v_mes := replace(right(p_competencia, 5), '-', '');
  with candidatos as materialized (
    select id from public.tracking_rows
    where (length(chave_nfe) = 44 and substring(chave_nfe from 3 for 4) = v_mes)
       or (length(id) = 47 and left(id, 3) = 'nf-' and substring(id from 6 for 4) = v_mes)
    limit p_limite
  ), removidos as (
    delete from public.tracking_rows t using candidatos c where t.id = c.id returning t.id
  )
  select count(*) into v_excluidos from removidos;
  return v_excluidos;
end;
$$;
revoke all on function public.contar_tracking_competencia_nf(text) from public;
revoke all on function public.limpar_tracking_competencia_nf_lote(text, integer) from public;
grant execute on function public.contar_tracking_competencia_nf(text) to anon, authenticated;
grant execute on function public.limpar_tracking_competencia_nf_lote(text, integer) to anon, authenticated;
