-- CNPJ raiz passa a ser a chave principal. O transportadora_id manual fica
-- preservado somente quando nao existe uma correspondencia unica por raiz.

alter table public.faturas
  add column if not exists cnpj_raiz_transportadora text,
  add column if not exists transportadora_id uuid references public.transportadoras(id);

alter table public.fatura_detalhes
  add column if not exists cnpj_raiz_transportadora text,
  add column if not exists transportadora_id uuid references public.transportadoras(id);

alter table public.realizado_ctes
  add column if not exists cnpj_raiz_transportadora text,
  add column if not exists transportadora_id uuid references public.transportadoras(id);

alter table public.auditoria_cte_resultados
  add column if not exists cnpj_raiz_transportadora text,
  add column if not exists transportadora_id uuid references public.transportadoras(id);

alter table public.tabelas_negociacao
  add column if not exists transportadora_id uuid references public.transportadoras(id);

create or replace function public.resolver_transportadora_por_cnpj_raiz()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  new.cnpj_raiz_transportadora := nullif(left(regexp_replace(coalesce(new.cnpj_transportadora, ''), '\D', '', 'g'), 8), '');

  if new.cnpj_raiz_transportadora is not null then
    select array_agg(candidato.id)
      into v_ids
      from (
        select t.id
        from public.transportadoras t
        where t.cnpj_raiz = new.cnpj_raiz_transportadora
        limit 2
      ) candidato;

    if cardinality(v_ids) = 1 then
      new.transportadora_id := v_ids[1];
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_faturas_resolver_transportadora_cnpj on public.faturas;
create trigger trg_faturas_resolver_transportadora_cnpj before insert or update of cnpj_transportadora on public.faturas for each row execute function public.resolver_transportadora_por_cnpj_raiz();

drop trigger if exists trg_fatura_detalhes_resolver_transportadora_cnpj on public.fatura_detalhes;
create trigger trg_fatura_detalhes_resolver_transportadora_cnpj before insert or update of cnpj_transportadora on public.fatura_detalhes for each row execute function public.resolver_transportadora_por_cnpj_raiz();

drop trigger if exists trg_realizado_ctes_resolver_transportadora_cnpj on public.realizado_ctes;
create trigger trg_realizado_ctes_resolver_transportadora_cnpj before insert or update of cnpj_transportadora on public.realizado_ctes for each row execute function public.resolver_transportadora_por_cnpj_raiz();

drop trigger if exists trg_auditoria_cte_resolver_transportadora_cnpj on public.auditoria_cte_resultados;
create trigger trg_auditoria_cte_resolver_transportadora_cnpj before insert or update of cnpj_transportadora on public.auditoria_cte_resultados for each row execute function public.resolver_transportadora_por_cnpj_raiz();

drop trigger if exists trg_tabelas_negociacao_resolver_transportadora_cnpj on public.tabelas_negociacao;
create trigger trg_tabelas_negociacao_resolver_transportadora_cnpj before insert or update of cnpj_transportadora on public.tabelas_negociacao for each row execute function public.resolver_transportadora_por_cnpj_raiz();

create index if not exists idx_faturas_transportadora_id on public.faturas (transportadora_id);
create index if not exists idx_faturas_cnpj_raiz_transportadora on public.faturas (cnpj_raiz_transportadora);
create index if not exists idx_fatura_detalhes_transportadora_id on public.fatura_detalhes (transportadora_id);
create index if not exists idx_realizado_ctes_transportadora_id on public.realizado_ctes (transportadora_id);
create index if not exists idx_auditoria_cte_transportadora_id on public.auditoria_cte_resultados (transportadora_id);
create index if not exists idx_tabelas_negociacao_transportadora_id on public.tabelas_negociacao (transportadora_id);

-- Backfill imediato nas bases menores. A base massiva de CT-es sera preenchida
-- naturalmente em novas importacoes/atualizacoes para evitar lock prolongado.
update public.faturas set cnpj_transportadora = cnpj_transportadora where nullif(cnpj_transportadora, '') is not null;
update public.fatura_detalhes set cnpj_transportadora = cnpj_transportadora where nullif(cnpj_transportadora, '') is not null;
update public.auditoria_cte_resultados set cnpj_transportadora = cnpj_transportadora where nullif(cnpj_transportadora, '') is not null;
update public.tabelas_negociacao set cnpj_transportadora = cnpj_transportadora where nullif(cnpj_transportadora, '') is not null;
