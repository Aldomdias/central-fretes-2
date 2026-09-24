-- Regra de consistencia: qualquer alteracao de um resultado de auditoria deve
-- torna-lo o resultado mais recente daquela chave. A tela da fatura usa este
-- campo para escolher entre registros historicos/competencias da mesma chave.
create or replace function public.touch_auditoria_cte_resultado_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_auditoria_cte_resultados_updated_at
  on public.auditoria_cte_resultados;

create trigger trg_auditoria_cte_resultados_updated_at
before update on public.auditoria_cte_resultados
for each row
execute function public.touch_auditoria_cte_resultado_updated_at();

