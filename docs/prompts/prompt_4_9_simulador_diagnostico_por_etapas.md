# Prompt 4.9 — Simulador do Realizado com diagnóstico por etapas

## Contexto
O Simulador do Realizado está instável: em alguns momentos simula, em outros dá timeout ou não retorna nada. Isso torna difícil saber onde a falha ocorre.

A necessidade agora é mudar a lógica de experiência e processamento para que a simulação seja feita por etapas, com confirmação visual de cada fase. O usuário precisa ter certeza de que:

1. a tabela/transportadora selecionada foi localizada;
2. a malha/tabela foi carregada corretamente;
3. os CT-es do realizado foram encontrados;
4. os CT-es foram cruzados com Tracking;
5. a base final que entra na simulação está correta;
6. somente depois disso o cálculo de frete/saving/aderência é executado.

## Objetivo
Criar um fluxo de simulação auditável, com mensagens de status e diagnóstico, em vez de simplesmente clicar em “Simular realizado” e aguardar até dar timeout.

## Regra principal
O Simulador do Realizado deve funcionar como um processo em etapas, exibindo uma linha de validação para cada etapa:

- ✅ OK
- ⚠️ Alerta
- ❌ Erro
- ⏳ Processando

A simulação não deve avançar para a próxima etapa se a etapa anterior não estiver validada.

## Etapas obrigatórias

### Etapa 1 — Validar seleção da tabela/transportadora
Ao clicar em “Simular realizado”, antes de buscar CT-es:

- validar se existe transportadora/tabela selecionada;
- identificar se é tabela oficial ou tabela em negociação;
- buscar a tabela/malha correspondente;
- confirmar o canal da tabela;
- mostrar mensagem na tela:

> Tabela localizada: [transportadora/tabela] — Canal: [canal] — Origens: X — Rotas/Cotações: Y

Se não encontrar a tabela, parar e exibir:

> Não foi possível localizar a tabela/malha selecionada. Verifique se a transportadora pertence ao canal selecionado ou se a tabela está ativa.

### Etapa 2 — Validar filtros da base realizada
Antes de buscar CT-es, mostrar os filtros que serão usados:

- canal;
- período inicial/final;
- origem;
- destino;
- UF origem;
- UF destino;
- modo: somente Tracking ou todos CT-es;
- limite de CT-es;
- se CPS LOG está incluído ou excluído;
- se negociações estão incluídas ou excluídas.

Mensagem esperada:

> Filtros aplicados: Canal B2C, emissão 01/04/2026 a 30/04/2026, origem todas, destino todos, base somente CT-es com Tracking.

### Etapa 3 — Buscar CT-es em lotes
A busca dos CT-es deve ser paginada/loteada e mostrar progresso:

- Página 1: X CT-es encontrados;
- Página 2: X CT-es encontrados;
- Total acumulado: Y CT-es.

Não deixar a tela parada sem retorno.

Se não encontrar CT-es, mostrar diagnóstico:

- total encontrado = 0;
- quais filtros foram usados;
- sugerir testar sem filtro de origem/destino/UF;
- mostrar se o problema está no canal ou no período.

### Etapa 4 — Validar Tracking
Depois de buscar CT-es:

- cruzar com Tracking;
- mostrar:
  - CT-es brutos;
  - CT-es com Tracking;
  - CT-es sem Tracking;
  - percentual de vínculo;
  - primeiros exemplos sem vínculo.

Se o modo selecionado for “Somente CT-es com Tracking”, a base simulada deve conter apenas CT-es vinculados.

Se o modo for “Todos os CT-es”, manter todos, mas separar claramente com/sem Tracking.

### Etapa 5 — Validar base simulável
Antes de calcular frete, mostrar:

- CT-es na base final;
- CT-es com valor NF;
- CT-es com peso/cubagem;
- CT-es com origem/destino válidos;
- CT-es com tabela encontrada;
- CT-es sem tabela.

Se a base simulável for zero, parar antes do cálculo e mostrar o motivo.

### Etapa 6 — Executar cálculo
Somente após todas as validações, executar o cálculo de frete e saving.

Ao finalizar, mostrar:

- CT-es buscados;
- CT-es analisados;
- CT-es simulados;
- CT-es sem tabela;
- aderência;
- saving;
- faturamento projetado;
- percentual de frete sobre NF.

## Regras de estabilidade

1. A tabela selecionada não deve filtrar CT-es de forma invisível.
2. Os CT-es devem ser filtrados apenas pelos filtros visíveis da tela.
3. A tabela/malha deve ser usada para cálculo, não para esconder base realizada.
4. Negociações só devem entrar se o flag estiver ativado.
5. O canal selecionado deve filtrar corretamente a lista de transportadoras.
6. Se a base zerar, o sistema precisa mostrar em qual etapa zerou.
7. Não pode haver timeout sem status intermediário.

## Ajustes de interface

Criar um painel acima do resultado com o nome:

**Diagnóstico da Simulação**

Esse painel deve conter cards/linhas:

1. Tabela/malha selecionada
2. Filtros aplicados
3. CT-es encontrados
4. Vínculo com Tracking
5. Base simulável
6. Cálculo final

Cada card deve mostrar status e detalhes.

## Critério de aceite

1. Ao clicar em simular, a tela mostra imediatamente a etapa atual.
2. O sistema informa se localizou ou não a tabela.
3. O sistema informa quantos CT-es encontrou antes de cruzar com Tracking.
4. O sistema informa quantos CT-es ficaram com/sem Tracking.
5. Se não simular, mostra exatamente onde parou.
6. Não existe mais cenário de “clicar e esperar até dar timeout sem saber o motivo”.
7. A mesma transportadora/período/filtros deve retornar a mesma quantidade de CT-es.
8. A comparação entre propostas/rodadas só poderá ser retomada depois que esse diagnóstico estiver estável.
