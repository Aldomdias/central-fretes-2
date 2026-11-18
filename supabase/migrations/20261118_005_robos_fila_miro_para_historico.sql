-- Tudo que o robo lanca (pedido + MIRO) precisa aparecer no Acompanhamento de lancamentos
-- (robos_lancamentos) e, no caso de CT-e, na base de partidas (ctes_lancamentos_sap).
-- Antes: a planilha do robo gravava a MIRO so na fila (robos_fila); o historico e a partida so
-- eram gravados quando alguem abria a tela do robo na Central. Ex.: CT-e 107006-5 (18/11/2026).
-- Agora: gatilho na propria fila. Quando a MIRO chega, grava no historico e na base de partidas.
-- Nao duplica (chaves unicas) e nao derruba a gravacao da fila se algo falhar.

create or replace function public.robos_fila_miro_para_historico()
returns trigger
language plpgsql
as $$
declare
  reg jsonb;
  doc text;
  m text[];
  cnpj text;
  num text;
  ser text;
  miro_d text;
  valor_n numeric;
begin
  if new.tipo not in ('NFSE', 'CTE') or coalesce(new.miro, '') = '' or coalesce(new.descartado, false) then
    return new;
  end if;

  begin
    reg := coalesce(new.entrada -> 'registro', '{}'::jsonb);
    doc := coalesce(nullif(reg ->> 'documento', ''), new.documento);
    valor_n := coalesce(nullif(reg ->> 'valor', '')::numeric, new.valor, 0);

    insert into public.robos_lancamentos
      (tipo, documento, cnpj_transp, transportadora, empresa, centro, centro_custo, valor,
       data_emissao, vencimento, fatura, pedido, miro, lancado_por)
    values
      (new.tipo, doc,
       coalesce(nullif(reg ->> 'cnpj_transp', ''), new.cnpj_transp),
       coalesce(nullif(reg ->> 'transportadora', ''), new.transportadora),
       nullif(reg ->> 'empresa', ''), nullif(reg ->> 'centro', ''), nullif(reg ->> 'centro_custo', ''),
       valor_n,
       case when (reg ->> 'data_emissao') ~ '^\d{4}-\d{2}-\d{2}$' then (reg ->> 'data_emissao')::date end,
       case when (reg ->> 'vencimento') ~ '^\d{4}-\d{2}-\d{2}$' then (reg ->> 'vencimento')::date end,
       nullif(reg ->> 'fatura', ''), nullif(new.pedido, ''), new.miro, new.atualizado_por)
    on conflict (tipo, miro, documento) do nothing;

    -- CT-e com MIRO: partida na base (mesmo formato de partidaDoRobo no front)
    if new.tipo = 'CTE' then
      m := regexp_match(doc, '^0*(\d+)-0*(\d+)$');
      cnpj := regexp_replace(coalesce(nullif(reg ->> 'cnpj_transp', ''), new.cnpj_transp, ''), '\D', '', 'g');
      miro_d := regexp_replace(new.miro, '\D', '', 'g');
      if m is not null and length(cnpj) = 14 and cnpj !~ '^0+$' and miro_d <> '' and valor_n > 0 then
        num := m[1];
        ser := m[2];
        insert into public.ctes_lancamentos_sap
          (chave, cnpj_emitente, numero_cte, serie_cte, referencia, fornecedor, empresa,
           lancamento_contabil, data_lancamento, montante, criado_por, texto, arquivo_origem)
        values
          (cnpj || '|' || num || '|' || ser || '|' || miro_d || '|' || (-round(valor_n * 100))::bigint::text,
           cnpj, num, ser, num || '-' || ser,
           coalesce(nullif(reg ->> 'transportadora', ''), new.transportadora),
           nullif(reg ->> 'empresa', ''), miro_d, current_date, -round(valor_n, 2),
           'ROBO CENTRAL (' || coalesce(new.atualizado_por, '') || ')',
           'Lancado pela Central (lancamento)', 'ROBO:LANCAMENTO')
        on conflict (chave) do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'robos_fila_miro_para_historico: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists robos_fila_miro_para_historico on public.robos_fila;
create trigger robos_fila_miro_para_historico
  after insert or update of miro on public.robos_fila
  for each row execute function public.robos_fila_miro_para_historico();

-- Corrige o que ja ficou so na fila (MIRO na fila sem registro no historico), do mais antigo ao mais novo:
-- o "update" abaixo dispara o gatilho de novo para cada linha pendente.
update public.robos_fila f
   set miro = f.miro
 where f.tipo in ('NFSE', 'CTE') and coalesce(f.miro, '') <> '' and coalesce(f.descartado, false) = false
   and not exists (
     select 1 from public.robos_lancamentos h
      where h.tipo = f.tipo and h.miro = f.miro
        and h.documento = coalesce(nullif(f.entrada -> 'registro' ->> 'documento', ''), f.documento)
   );
