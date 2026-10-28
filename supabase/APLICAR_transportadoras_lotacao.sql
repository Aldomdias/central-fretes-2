-- Cadastro das transportadoras de LOTAÇÃO (planilha TRANSP_LOTAÇÃO.xlsx, 143 CNPJs).
--
-- Uma transportadora por NOME FANTASIA. Antes de criar, o script verifica o
-- que já existe no banco:
--   1. alguma raiz/CNPJ do grupo já está em transportadoras, transportadora_cnpjs
--      ou origens  -> reaproveita essa transportadora (não duplica a raiz);
--   2. senão, já existe transportadora com o mesmo nome -> reaproveita;
--   3. senão, cria a transportadora (CNPJ principal = matriz /0001 quando houver).
-- Os demais CNPJs do grupo entram como CNPJs adicionais (transportadora_cnpjs),
-- pulando os que já estão cadastrados ou cuja raiz pertence a outra transportadora.
--
-- Uso: rode primeiro com aplicar = false (só mostra o que seria feito).
-- Conferido o relatório, troque para aplicar = true e rode de novo.
-- Pode ser executado várias vezes: o que já existe é só reportado.

drop table if exists pg_temp.lotacao_carga;
drop table if exists pg_temp.lotacao_relatorio;

create temp table lotacao_carga (nome text, razao_social text, cnpj text, cnpj_raiz text);
create temp table lotacao_relatorio (
  ordem serial,
  transportadora text,
  cnpj text,
  acao text,
  detalhe text
);

insert into lotacao_carga (nome, razao_social, cnpj)
values
    ('5 ESTRADAS', '5 ESTRADAS LOGISTICAS E TRANSPORTES LTDA', '42549077000165'),
    ('5 ESTRADAS', '5 ESTRADAS LOGISTICAS E TRANSPORTES LTDA', '42549077000327'),
    ('ARK LOGISTICA', 'ARK LOGISTICA, ASSESSORIA E TREINAMENTOS EM COMEX LTDA', '30341404000100'),
    ('BBM', 'BBM LOGISTICA S.A.', '01107327002335'),
    ('BBM', 'BBM LOGISTICA S.A.', '01107327000987'),
    ('BBM', 'BBM LOGISTICA S.A.', '01107327000715'),
    ('BEN EXPRESS', 'BEN EXPRESS LTDA', '38341683000113'),
    ('BICAMPEAO', 'BICAMPEAO TRANSPORTE LTDA', '12678403000173'),
    ('BOMLOG', 'BOMLOG BRASIL TRANSPORTES LTDA - EPP', '97550973000306'),
    ('BOMLOG', 'BOMLOG BRASIL TRANSPORTES LTDA EPP', '97550973000136'),
    ('BRENEX', 'BRENEX - CONSULTORIA E ORGANIZACAO LOGIS', '21171115000623'),
    ('BRENEX', 'BRENEX - CONSULTORIA E ORGANIZACAO LOGIS', '21171115000704'),
    ('BRENEX', 'BRENEX - CONSULTORIA E ORGANIZACAO LOGIS', '21171115000208'),
    ('BRENEX', 'BRENEX CONSULTORIA E ORGANIZACAO LOGISTI', '21171115000119'),
    ('BUSSOLA', 'BUSSOLA LOGISTICA LTDA', '08185296000174'),
    ('BUSSOLA', 'BUSSOLA LOGISTICA LTDA', '08185296000255'),
    ('BUSSOLA', 'BUSSOLA LOGISTICA LTDA', '08185296000336'),
    ('BUSSOLA', 'BUSSOLA LOGISTICA LTDA', '08185296001065'),
    ('CKL TRANSPORTES', 'CKL TRANSPORTES LTDA', '01464000000105'),
    ('CLC', 'CLC MARASCHIN LTDA', '09527502000140'),
    ('COOTRAVALE', 'COOPERATIVA DOS TRANSPORTADORES DO', '00680933001491'),
    ('COOTRAVALE', 'COOPERATIVA DOS TRANSPORTADORES DO', '00680933000410'),
    ('COOTRAVALE', 'COOPERATIVA DOS TRANSPORTADORES DO', '00680933001904'),
    ('COOTRAVALE', 'COOPERATIVA DOS TRANSPORTADORES DO', '00680933002897'),
    ('COOTRAVALE', 'COOPERATIVA DOS TRANSPORTADORES DO', '00680933000339'),
    ('ELITE', 'ELITE EXPRESS LTDA', '03945518000196'),
    ('ELITE', 'ELITE EXPRESS LTDA SC', '03945518000358'),
    ('ELITE', 'ELITE EXPRESS LTDA SP', '03945518000277'),
    ('ELO SOLUCOES', 'ELO SOLUCOES LOGISTICAS INTEGRADAS', '31626973000164'),
    ('ELO SOLUCOES', 'ELO SOLUCOES LOGISTICAS INTEGRADAS', '31626973000326'),
    ('ELO SOLUCOES', 'ELO SOLUCOES LOGISTICAS INTEGRADAS', '31626973000598'),
    ('GAMA TRANSPORTES', 'GAMA TRANSPORTES LTDA', '54080187000100'),
    ('GISLENE DOS SANTOS', 'GISLEINE DOS SANTOS MACHADO AFONSO', '34349570000103'),
    ('GODI TRANSPORTES', 'GODI TRANSPORTES LTDA', '47227873000103'),
    ('GRUTZMANN TRANSPORTES', 'GRUTZMANN TRANSPORTES LTDA', '38458811000103'),
    ('ITA BRASIL', 'ITA BRASIL TRANSPORTES LTDA', '01982152000108'),
    ('JADIMO', 'JADIMO TRANSPORTES RODOVIARIOS DE CARGAS', '81724908000492'),
    ('JADIMO', 'JADIMO TRANSPORTES RODOVIARIOS DE CARGAS', '81724908000301'),
    ('JADIMO', 'JADIMO TRANSPORTES RODOVIARIOS DE CARGAS LTDA', '81724908000654'),
    ('JBS', 'JBS SA', '02916265037080'),
    ('JBS', 'JBS SA', '02916265028170'),
    ('JBS', 'JBS SA', '02916265009116'),
    ('JOIN TRANSPORTES', 'JOIN TRANSPORTES INTELIGENTES LTDA', '86906583000130'),
    ('LIBARDO', 'LIBARDO TRANSPORTES LTDA', '27736323000102'),
    ('LIBARDO', 'LIBARDO TRANSPORTES LTDA', '27736323000285'),
    ('LIBARDO', 'LIBARDO TRANSPORTES LTDA', '27736323000366'),
    ('LIBARDO', 'LIBARDO TRANSPORTES LTDA', '27736323000528'),
    ('LEMAR', 'LEMAR - MATRIZ', '04284184000110'),
    ('LEMAR', 'LEMAR LOGISTICA E TRANSPORTES LTDA', '04284184000462'),
    ('LEMAR', 'LEMAR LOGISTICA E TRANSPORTES LTDA', '04284184000705'),
    ('LOG20', 'LOG20 LOGISTICA SA', '13631347000184'),
    ('LOG20', 'LOG20 LOGISTICA SA', '13631347000508'),
    ('LOG20', 'LOG20 LOGISTICA SA', '13631347001237'),
    ('LOG20', 'LOG20 LOGISTICA SA - F14', '13631347001407'),
    ('LOG2X', 'LOG2X TRANSPORTES LOGISTICA E COMERCIO INTERNACIONAL LTDA', '32755722000142'),
    ('LOG2X', 'LOG2X TRANSPORTES LOGISTICA E COMERCIO INTERNACIONAL LTDA', '32755722000304'),
    ('LX PANTOS SOLUCOES', 'LX PANTOS SOLUCOES LOGISTICAS DO BRASIL LTDA', '16417780000614'),
    ('MANDIRA TRANSPORTES', 'MANDIRA TRANSPORTES E LOGISTICA LTDA', '47918176000190'),
    ('PAGIO', 'PAGIO TRANSPORTES LTDA', '29016974000145'),
    ('PRIME INOVE', 'PRIME INOVE TRANSPORTES E SERVICOS DE APOIO ADMINISTRATIVO LTDA', '40298840000105'),
    ('QUALILOG', 'QUALILOG TRANSPORTES EIRELI', '20822118000102'),
    ('RODO PC TRANSPORTES EXPRESS', 'RODO PC TRANSPORTES EXPRESS LTDA', '32289739000151'),
    ('RODOJJAN', 'RODOJJAN TRANSPORTES LTDA', '11931567000106'),
    ('SANTA HELENA TRANSPORTES', 'RODOTISTA TRANSPORTES LTDA', '02968651000286'),
    ('SANTA HELENA TRANSPORTES', 'RODOTISTA TRANSPORTES LTDA', '02968651000103'),
    ('TOMASI', 'RODRIGO TOMASI', '08295684000108'),
    ('SCAPINI', 'SCAPINI TRANSPORTE E LOGISTICA LTDA', '88078209003304'),
    ('SCAPINI', 'SCAPINI TRANSPORTE E LOGISTICA LTDA', '88078209000119'),
    ('SCAPINI', 'SCAPINI TRANSPORTE E LOGISTICA LTDA', '88078209002596'),
    ('SCAPINI', 'SCAPINI TRANSPORTE E LOGISTICA LTDA', '88078209001271'),
    ('TAC TRANSPORTES', 'TAC TRANSPORTES E ARMAZENS LTDA', '07639029000400'),
    ('TAC TRANSPORTES', 'TAC TRANSPORTES E ARMAZÉNS LTDA,', '07639029000167'),
    ('TAUSEN', 'TAUSEN LOG TRANSPORTE E LOGISTICA LTDA', '13387395000179'),
    ('TFP LOGISTICA E SERVICOS DE TRANSPORTES', 'TFP LOGISTICA E SERVICOS DE TRANSPORTES LTDA', '52167621000168'),
    ('TOMASI', 'TOMASI LOGISTICA - GO', '03279710000514'),
    ('TOMASI', 'TOMASI LOGISTICA - PERNAMBUCO', '03279710000948'),
    ('TOMASI', 'TOMASI LOGISTICA - SP', '03279710000271'),
    ('TOMASI', 'TOMASI LOGISTICA - UNIDADE PR', '03279710001324'),
    ('TOMASI', 'TOMASI LOGISTICA LTDA', '03279710000786'),
    ('TOMASI', 'TOMASI LOGISTICA LTDA', '03279710000433'),
    ('TOMASI', 'TOMASI LOGISTICA LTDA', '03279710000352'),
    ('TOMASI', 'TOMASI LOGISTICA LTDA', '03279710000603'),
    ('TOMASI', 'TOMASI LOGISTICA LTDA - SC', '03279710000867'),
    ('TOMASI', 'TOMASI LOGISTICA LTDA.', '03279710000190'),
    ('TORNADO', 'TORNADO OPERADOR LOGISTICO LTDA', '00165030000158'),
    ('TRANS KOTHE', 'TRANS KOTHE TRANSPORTES RODOVIARIOS SA', '03052564001480'),
    ('TRANSBOCAYUVA TRANSPORTES', 'TRANSBOCAYUVA TRANSPORTES LTDA', '15595943000181'),
    ('TRANSCCEMA', 'TRANSCCEMA TRANSPORTES RODOVIARIOS', '10413610000170'),
    ('TRANSCCEMA', 'TRANSCCEMA TRANSPORTES RODOVIARIOS LTDA', '10413610000332'),
    ('TRANSCCEMA', 'TRANSCCEMA TRANSPORTES RODOVIARIOS LTDA.', '10413610000413'),
    ('TRANSGP', 'TRANSGP TRANSPORTE RODOVIARIO DE CARGAS LTDA', '11048206000108'),
    ('TRANSGP', 'Transgp Transporte Rodoviario de Cargas Ltda', '11048206000965'),
    ('TRANSGP', 'Transgp Transporte Rodoviario de Cargas Ltda.', '11048206001007'),
    ('TRANSGP', 'TRANSGP TRANSPORTES RODOVIARIO DE CARGAS', '11048206000299'),
    ('TRANSGP', 'TRANSGP TRANSPORTES RODOVIARIO DE CARGAS', '11048206000531'),
    ('TRANSGP', 'TRANSGP TRANSPORTES RODOVIARIO DE CARGAS', '11048206000450'),
    ('TRANSGP', 'TRANSGP TRANSPORTES RODOVIARIO DE CARGAS', '11048206000370'),
    ('TRANSGP', 'TransGP Transportes Rodoviario de Cargas Ltda,', '11048206000612'),
    ('TRANSGP', 'TransGP Transportes Rodoviario de Cargas Ltda,', '11048206000701'),
    ('TRANSGP', 'TransGP Transportes Rodoviario de Cargas Ltda,', '11048206000884'),
    ('TRANSLUTE', 'TRANSLUTE TRANSPORTES RODOVIARIOS L', '57012098000114'),
    ('TRANSLUTE', 'TRANSLUTE TRANSPORTES RODOVIARIOS L', '57012098000386'),
    ('TRANSLUTE', 'TRANSLUTE TRANSPORTES RODOVIARIOS L', '57012098001609'),
    ('TRANSLUTE', 'TRANSLUTE TRANSPORTES RODOVIARIOS L', '57012098000548'),
    ('TRANSLUTE', 'TRANSLUTE TRANSPORTES RODOVIARIOS L', '57012098000467'),
    ('TRANSLUTE', 'TRANSLUTE TRANSPORTES RODOVIARIOS L', '57012098000629'),
    ('TRANSLUTE', 'TRANSLUTE TRANSPORTES RODOVIARIOS L', '57012098001510'),
    ('TRANSLUTE', 'TRANSLUTE TRANSPORTES RODOVIARIOS L', '57012098001943'),
    ('TRANSMAGNA', 'TRANSMAGNA TRANSPORTES LTDA', '79942140001291'),
    ('TRANSMAGNA', 'TRANSMAGNA TRANSPORTES LTDA', '79942140000996'),
    ('AJOFER', 'TRANSPORTADORA AJOFER LTDA', '44191880000287'),
    ('AJOFER', 'TRANSPORTADORA AJOFER LTDA', '44191880000104'),
    ('TRANSPORTADORA GOBOR', 'TRANSPORTADORA GOBOR LTDA', '77505550001592'),
    ('TRANSPORTADORA GOBOR', 'TRANSPORTADORA GOBOR LTDA', '77505550000278'),
    ('TRANSPORTADORA GOBOR', 'TRANSPORTADORA GOBOR LTDA', '77505550001401'),
    ('TRANSPORTADORA GOBOR', 'TRANSPORTADORA GOBOR LTDA', '77505550000944'),
    ('TRANSPORTADORA JOLIVAN', 'TRANSPORTADORA JOLIVAN LTDA', '32438772003898'),
    ('TRANSPORTADORA JOLIVAN', 'TRANSPORTADORA JOLIVAN LTDA', '32438772001763'),
    ('TRANSPORTADORA MACHADO', 'TRANSPORTADORA MACHADO LTDA', '22219246000191'),
    ('TRANSBRASILIANA', 'TRANSPORTADORA TRANSBRASILIANA LTDA', '82725425001366'),
    ('TRANSBRASILIANA', 'TRANSPORTADORA TRANSBRASILIANA LTDA', '82725425000122'),
    ('TRANSBRASILIANA', 'TRANSPORTADORA TRANSBRASILIANA LTDA', '82725425001013'),
    ('TRANSPORTE RODOVIARIO 1500', 'TRANSPORTE RODOVIARIO 1500 LTDA', '09576958001091'),
    ('TRANSPORTE RODOVIARIO 1500', 'TRANSPORTE RODOVIARIO 1500 LTDA - MS', '09576958000795'),
    ('TRANSPORTE RODOVIARIO 1500', 'TRANSPORTE RODOVIARIO 1500 LTDA - PE', '09576958001929'),
    ('TRANSPORTE RODOVIARIO 1500', 'TRANSPORTE RODOVIARIO 1500 LTDA - RS', '09576958001090'),
    ('TRANSPORTE RODOVIARIO 1500', 'TRANSPORTE RODOVIARIO 1500 LTDA - SC', '09576958001171'),
    ('TRANSPORTE RODOVIARIO 1500', 'TRANSPORTE RODOVIARIO 1500 LTDA - SP', '09576958000442'),
    ('TRANSPORTES SPOLIER', 'TRANSPORTES SPOLIER LTDA', '89626386000155'),
    ('TRANSPORTES SPOLIER', 'TRANSPORTES SPOLIER LTDA', '89626386000236'),
    ('VINHEDOS', 'VINHEDOS TRANSPORTES EIRELI', '93561108001025'),
    ('VINHEDOS', 'VINHEDOS TRANSPORTES EIRELI', '93561108000134'),
    ('VINHEDOS', 'VINHEDOS TRANSPORTES EIRELI', '93561108000215'),
    ('VINHEDOS', 'VINHEDOS TRANSPORTES LTDA', '93561108000487'),
    ('SCAPINI', 'SCAPINI TRANSPORTE E LOGISTICA LTDA', '88078209000704'),
    ('SCAPINI', 'SCAPINI TRANSPORTE E LOGISTICA LTDA', '88078209000542'),
    ('SCAPINI', 'SCAPINI TRANSPORTE E LOGISTICA LTDA', '88078209002839'),
    ('ITA BRASIL', 'ITA BRASIL TRANSPORTES LTDA', '01982152000361'),
    ('GRUPO ROTTA', 'ROTTA TRANSPORTES DE CARGAS LTDA', '31702515000167'),
    ('METTA TRANSPORTES', 'METTA TRANSPORTES CGS LTDA', '60054182000105'),
    ('RPM', 'RPM SERVICOS DE TRANSPORTES E LOGISTICA LTDA', '49183710000193'),
    ('LIBARDO', 'KJL TRANSPORTES LTDA', '27736323000447'),
    ('JOIN TRANSPORTES', 'JOIN TRANSPORTES INTELIGENTES LTDA', '86906583000482');

update lotacao_carga
set nome = upper(btrim(regexp_replace(nome, '\s+', ' ', 'g'))),
    razao_social = btrim(regexp_replace(razao_social, '\s+', ' ', 'g')),
    cnpj = lpad(regexp_replace(cnpj, '\D', '', 'g'), 14, '0');
update lotacao_carga set cnpj_raiz = left(cnpj, 8);

do $$
declare
  aplicar constant boolean := false;  -- << troque para true para gravar

  grupo record;
  item record;
  alvo_id uuid;
  alvo_nome text;
  alvo_cnpj text;
  origem_match text;
  principal record;
  dono text;
  candidatos int;
begin
  for grupo in select distinct nome from lotacao_carga order by nome loop
    alvo_id := null; alvo_nome := null; alvo_cnpj := null; origem_match := null;

    select * into principal
      from lotacao_carga
     where nome = grupo.nome
     order by (substr(cnpj, 9, 4) = '0001') desc, cnpj
     limit 1;

    -- 1) Já existe por raiz / CNPJ (prioriza nome igual e a raiz da matriz)
    with cand as (
      select t.id, t.nome, t.cnpj, t.cnpj_raiz, 1 as prioridade, 'raiz no cadastro' as via
        from public.transportadoras t
       where t.cnpj_raiz in (select cnpj_raiz from lotacao_carga where nome = grupo.nome)
          or t.cnpj in (select cnpj from lotacao_carga where nome = grupo.nome)
      union all
      select t.id, t.nome, t.cnpj, tc.cnpj_raiz, 2, 'CNPJ adicional já cadastrado'
        from public.transportadora_cnpjs tc
        join public.transportadoras t on t.id = tc.transportadora_id
       where tc.ativo and tc.cnpj_raiz in (select cnpj_raiz from lotacao_carga where nome = grupo.nome)
      union all
      select t.id, t.nome, t.cnpj, o.cnpj_raiz, 3, 'raiz em origem'
        from public.origens o
        join public.transportadoras t on t.id = o.transportadora_id
       where o.cnpj_raiz in (select cnpj_raiz from lotacao_carga where nome = grupo.nome)
    )
    select c.id, c.nome, c.cnpj, c.via,
           (select count(distinct id) from cand)
      into alvo_id, alvo_nome, alvo_cnpj, origem_match, candidatos
      from cand c
     order by (upper(btrim(c.nome)) = grupo.nome) desc, (c.cnpj_raiz = principal.cnpj_raiz) desc, c.prioridade, c.nome
     limit 1;

    -- 2) Já existe pelo nome
    if alvo_id is null then
      select t.id, t.nome, t.cnpj, 'mesmo nome', 1
        into alvo_id, alvo_nome, alvo_cnpj, origem_match, candidatos
        from public.transportadoras t
       where upper(btrim(regexp_replace(t.nome, '\s+', ' ', 'g'))) = grupo.nome
       limit 1;
    end if;

    if alvo_id is not null then
      insert into lotacao_relatorio (transportadora, cnpj, acao, detalhe)
      values (grupo.nome, null, 'JÁ EXISTE',
              format('Usando "%s" (%s)%s', alvo_nome, origem_match,
                     case when candidatos > 1 then format(' — atenção: %s transportadoras com essas raízes', candidatos) else '' end));

      -- Completa o CNPJ principal se a transportadora existente estiver sem
      if alvo_cnpj is null then
        if aplicar then
          update public.transportadoras
             set cnpj = principal.cnpj, cnpj_raiz = principal.cnpj_raiz
           where id = alvo_id and cnpj is null;
        end if;
        alvo_cnpj := principal.cnpj;
        insert into lotacao_relatorio (transportadora, cnpj, acao, detalhe)
        values (grupo.nome, principal.cnpj, case when aplicar then 'CNPJ PRINCIPAL PREENCHIDO' else 'PREENCHERÁ CNPJ PRINCIPAL' end, alvo_nome);
      end if;
    else
      alvo_nome := grupo.nome;
      alvo_cnpj := principal.cnpj;
      if aplicar then
        insert into public.transportadoras (id, nome, status, cnpj, cnpj_raiz)
        values (gen_random_uuid(), grupo.nome, 'Ativa', principal.cnpj, principal.cnpj_raiz)
        returning id into alvo_id;
      end if;
      insert into lotacao_relatorio (transportadora, cnpj, acao, detalhe)
      values (grupo.nome, principal.cnpj, case when aplicar then 'CRIADA' else 'SERÁ CRIADA' end,
              'CNPJ principal: ' || principal.razao_social);
    end if;

    -- 3) CNPJs adicionais
    for item in select * from lotacao_carga where nome = grupo.nome order by cnpj loop
      if item.cnpj = alvo_cnpj then
        continue;
      end if;

      select t.nome into dono
        from public.transportadora_cnpjs tc
        join public.transportadoras t on t.id = tc.transportadora_id
       where tc.cnpj = item.cnpj
       limit 1;
      if dono is not null then
        insert into lotacao_relatorio (transportadora, cnpj, acao, detalhe)
        values (grupo.nome, item.cnpj,
                case when upper(btrim(dono)) = upper(btrim(alvo_nome)) then 'CNPJ JÁ CADASTRADO' else 'CONFLITO' end,
                'Já está em ' || dono);
        continue;
      end if;

      -- Raiz pertencente a outra transportadora (mesma regra da tela)
      select n into dono from (
        select t.nome as n from public.transportadoras t
         where t.cnpj_raiz = item.cnpj_raiz and t.id is distinct from alvo_id
           and upper(btrim(t.nome)) <> upper(btrim(alvo_nome))
        union all
        select t.nome from public.transportadora_cnpjs tc
          join public.transportadoras t on t.id = tc.transportadora_id
         where tc.ativo and tc.cnpj_raiz = item.cnpj_raiz and tc.transportadora_id is distinct from alvo_id
           and upper(btrim(t.nome)) <> upper(btrim(alvo_nome))
        union all
        select t.nome from public.origens o
          join public.transportadoras t on t.id = o.transportadora_id
         where o.cnpj_raiz = item.cnpj_raiz and o.transportadora_id is distinct from alvo_id
           and upper(btrim(t.nome)) <> upper(btrim(alvo_nome))
      ) x limit 1;
      if dono is not null then
        insert into lotacao_relatorio (transportadora, cnpj, acao, detalhe)
        values (grupo.nome, item.cnpj, 'CONFLITO', format('Raiz %s pertence a %s — não adicionado', item.cnpj_raiz, dono));
        continue;
      end if;

      if aplicar then
        insert into public.transportadora_cnpjs (transportadora_id, cnpj, cnpj_raiz, descricao, ativo)
        values (alvo_id, item.cnpj, item.cnpj_raiz, item.razao_social, true)
        on conflict (cnpj) do nothing;
      end if;
      insert into lotacao_relatorio (transportadora, cnpj, acao, detalhe)
      values (grupo.nome, item.cnpj, case when aplicar then 'CNPJ ADICIONADO' else 'ADICIONARÁ CNPJ' end, item.razao_social);
    end loop;
  end loop;
end $$;

-- Resumo por ação e detalhe completo
select acao, count(*) as qtd from lotacao_relatorio group by acao order by acao;

select transportadora, cnpj, acao, detalhe from lotacao_relatorio order by ordem;
