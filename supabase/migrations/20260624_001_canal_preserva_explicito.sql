-- Ajusta o trigger de canal para RESPEITAR um canal explicitamente definido
-- (import com cascata Escritório de venda -> Canais, ou backfill), e só
-- auto-resolver pela transportadora quando o canal vier vazio ou 'A DEFINIR'.
--
-- Antes: new.canal := resolver_canal_transportadora(...) SEMPRE (sobrescrevia
-- qualquer valor). Isso impedia classificar canal por CT-e (uma transportadora
-- como a ATUAL faz B2C e ATACADO conforme a carga).

create or replace function public.aplicar_canal_transportadora_row()
returns trigger
language plpgsql
as $$
begin
  if new.canal_original is null or btrim(new.canal_original) = '' then
    new.canal_original := new.canal;
  end if;

  -- Só resolve pela transportadora quando não há canal definido ou está pendente.
  if new.canal is null
     or btrim(new.canal) = ''
     or upper(btrim(new.canal)) = 'A DEFINIR' then
    new.canal := public.resolver_canal_transportadora(new.transportadora, new.canal_original);
  end if;

  return new;
end;
$$;

-- Os triggers já existentes (trg_resolver_canal_*) continuam apontando para esta
-- função; basta recriar a função acima. Sem mudança de trigger necessária.
