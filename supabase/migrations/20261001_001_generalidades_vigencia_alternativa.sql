-- Vigência por tabela alternativa (reajuste com data de início).
--
-- Uma tabela alternativa com vigência passa a valer só para CT-es emitidos dentro
-- da janela [vigencia_inicio, vigencia_fim] — é assim que um reajuste entra "daqui
-- pra frente" sem perder a auditoria dos CT-es antigos pela tabela anterior.
-- Sem vigência preenchida, a alternativa se comporta como antes (OTR, rodas etc.).
--
-- A vigência fica na linha de `generalidades` do grupo (já existe uma linha por
-- origem + grupo_tabela_alternativa, ver 20260922_002). Quando o grupo não tem
-- generalidade própria, o app cria uma linha só para guardar a vigência
-- (observacoes = '__somente_vigencia__'), que a leitura não trata como
-- generalidade do grupo.

alter table if exists public.generalidades
  add column if not exists vigencia_inicio date null;

alter table if exists public.generalidades
  add column if not exists vigencia_fim date null;

comment on column public.generalidades.vigencia_inicio is
  'Início da vigência da tabela alternativa deste grupo (data de emissão do CT-e >= início). Nulo = sem limite inicial.';
comment on column public.generalidades.vigencia_fim is
  'Fim da vigência da tabela alternativa deste grupo (data de emissão do CT-e <= fim). Nulo = em aberto.';
