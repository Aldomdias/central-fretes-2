-- O histórico de troca de carteira (auditoria_carteiras_historico) até agora
-- dependia de duas chamadas separadas do navegador (salvar auditoria_carteiras
-- + registrar o histórico) — se a segunda falhasse (rede, aba fechada, etc.),
-- ficava sem registro nenhum de quando a carteira daquela transportadora foi
-- atribuída, e futuras trocas de auditor não teriam como saber a partir de
-- quando o auditor anterior deixou de ser responsável. Foi o que aconteceu
-- com "TAM LINHAS AEREAS": tinha atribuição atual mas nenhum histórico.
--
-- Este gatilho grava o histórico automaticamente, dentro da mesma transação
-- do insert/update em auditoria_carteiras — não depende mais do navegador
-- fazer uma segunda chamada bem-sucedida.
create or replace function fn_log_auditoria_carteira_historico()
returns trigger as $$
begin
  if (tg_op = 'INSERT') or (new.auditor_nome is distinct from old.auditor_nome) then
    insert into auditoria_carteiras_historico (id, transportadora, auditor_nome, auditor_email, atribuido_por, atribuido_em)
    values (gen_random_uuid(), new.transportadora, new.auditor_nome, new.auditor_email, new.atribuido_por, coalesce(new.atribuido_em, now()));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_auditoria_carteiras_historico on auditoria_carteiras;

create trigger trg_auditoria_carteiras_historico
  after insert or update on auditoria_carteiras
  for each row execute function fn_log_auditoria_carteira_historico();

-- Backfill: transportadoras que já têm carteira atribuída mas nenhum registro
-- de histórico (caso do TAM) ganham um registro retroativo agora, usando a
-- própria data de atribuição atual como marco — sem isso, a próxima troca de
-- auditor não teria um "antes" pra comparar.
insert into auditoria_carteiras_historico (id, transportadora, auditor_nome, auditor_email, atribuido_por, atribuido_em)
select gen_random_uuid(), c.transportadora, c.auditor_nome, c.auditor_email, c.atribuido_por, c.atribuido_em
from auditoria_carteiras c
where c.ativo = true
  and c.auditor_nome is not null
  and c.auditor_nome <> ''
  and not exists (
    select 1 from auditoria_carteiras_historico h where h.transportadora = c.transportadora
  );
