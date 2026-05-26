# Prompt 4.10 — Separar o Simulador do Realizado em duas etapas: Pesquisar CT-es e depois Simular

## Contexto
O Simulador do Realizado está instável porque hoje ele tenta fazer tudo em um único clique:

1. localizar tabela/malha;
2. buscar CT-es;
3. cruzar Tracking;
4. aplicar filtros;
5. calcular frete;
6. gerar saving/aderência.

Quando algo falha, o usuário não sabe se o problema foi na tabela, na busca de CT-es, no Tracking, no canal, na malha ou no cálculo.

A nova lógica deve separar o fluxo em duas etapas visuais:

1. **Pesquisar CT-es**
2. **Simular / Calcular**

## Objetivo
Antes de qualquer cálculo de tabela, o sistema deve permitir pesquisar e validar a base real de CT-es que será simulada.

O usuário seleciona:

- canal;
- transportadora/tabela;
- período;
- origem/destino/UF quando quiser;
- base somente com Tracking ou todos os CT-es.

Depois clica em:

> Pesquisar CT-es

O sistema deve então localizar a tabela/malha, buscar os CT-es do período e trazer uma lista/resumo visual. Somente depois disso o botão **Simular / Calcular** fica disponível.

## Novo fluxo desejado

### Etapa 1 — Seleção
Na tela do Simulador do Realizado, manter os filtros atuais, mas alterar o fluxo principal para dois botões:

1. **Pesquisar CT-es**
2. **Simular / Calcular**

O botão **Simular / Calcular** deve iniciar desabilitado.

Ele só fica habilitado depois que a pesquisa de CT-es retornar uma base válida.

---

### Etapa 2 — Pesquisar CT-es
Ao clicar em **Pesquisar CT-es**, o sistema deve:

#### 2.1 Validar tabela/malha selecionada
Primeiro localizar a transportadora/tabela escolhida.

Mostrar mensagem visual:

> Tabela localizada: [nome] — Canal: [canal] — Origens: [qtd] — Rotas/Cotações: [qtd]

Se não encontrar tabela/malha, parar e mostrar:

> Tabela não localizada. Verifique se a transportadora pertence ao canal selecionado ou se a tabela está cadastrada/ativa.

#### 2.2 Buscar CT-es como uma consulta de CT-e
Depois de localizar a tabela, o sistema deve buscar CT-es do realizado como se fosse uma busca normal de CT-e, usando os filtros visíveis da tela.

A busca deve considerar:

- canal selecionado;
- período selecionado;
- transportadora selecionada quando fizer sentido para o realizado;
- origem/destino/UF se preenchidos;
- tomadores válidos;
- exclusão de CPS LOG por padrão;
- exclusão de registros não vinculados ao Tracking quando a opção “Somente CT-es com Tracking” estiver marcada.

A busca deve ser paginada/loteada, mostrando progresso:

> Buscando CT-es... 500 encontrados
> Buscando CT-es... 1.000 encontrados
> Buscando CT-es... 1.500 encontrados

#### 2.3 Cruzar com Tracking
Depois da busca dos CT-es, cruzar com Tracking e separar:

- CT-es encontrados no realizado;
- CT-es com Tracking;
- CT-es sem Tracking;
- percentual de vínculo.

Se o usuário estiver no modo **Somente CT-es com Tracking**, a lista final da pesquisa deve conter apenas CT-es vinculados.

Se estiver no modo **Todos os CT-es**, a lista pode manter todos, mas deve mostrar claramente quem está sem Tracking.

#### 2.4 Exibir resumo antes do cálculo
Após pesquisar, mostrar cards:

- CT-es encontrados;
- CT-es com Tracking;
- CT-es sem Tracking;
- Valor total CT-e;
- Valor total NF;
- Peso total;
- Cubagem total;
- Volumes;
- Transportadoras realizadas encontradas;
- Origens encontradas;
- UFs destino encontradas.

Também mostrar uma tabela de prévia com os primeiros registros:

- CT-e;
- NF;
- transportadora realizada;
- origem;
- destino;
- UF destino;
- valor CT-e;
- valor NF;
- peso;
- cubagem;
- status Tracking.

Somente após essa etapa o botão **Simular / Calcular** deve ser liberado.

---

### Etapa 3 — Simular / Calcular
Ao clicar em **Simular / Calcular**, o sistema NÃO deve buscar CT-es novamente.

Ele deve usar a base já carregada na etapa **Pesquisar CT-es**.

Isso é fundamental para garantir que:

- a mesma base validada pelo usuário é usada no cálculo;
- duas propostas/rodadas podem ser comparadas sobre a mesma base;
- o cálculo não muda silenciosamente porque buscou outra base;
- o usuário consegue ver antes o que será simulado.

O cálculo deve aplicar a tabela/malha selecionada sobre a base pesquisada e gerar:

- CT-es analisados;
- CT-es simulados;
- CT-es com tabela;
- CT-es sem tabela;
- aderência;
- saving;
- frete realizado;
- frete projetado;
- percentual de frete sobre NF;
- ranking/ganhador/perdedor.

---

## Regra importante de consistência
A base pesquisada deve ficar salva em estado temporário da tela, por exemplo:

- `baseRealizadoPesquisada`
- `resumoPesquisaRealizado`
- `diagnosticoPesquisaRealizado`

O botão **Simular / Calcular** deve usar essa base em memória.

Se o usuário alterar algum filtro depois da pesquisa, o sistema deve limpar a base pesquisada e desabilitar o botão de simulação, exibindo:

> Os filtros foram alterados. Pesquise os CT-es novamente antes de simular.

## Regra para comparação entre rodadas/propostas
A comparação entre rodadas só deve acontecer depois que essa separação estiver pronta.

A base de CT-es pesquisada deve ser exatamente a mesma para as duas simulações.

Assim, se a proposta A usa cubagem 250 e a proposta B usa cubagem 200, ambas devem calcular sobre os mesmos CT-es pesquisados.

## Benefício esperado
Com essa mudança, o usuário terá certeza de que:

1. a tabela foi localizada;
2. os CT-es foram encontrados;
3. o Tracking foi validado;
4. a base está correta;
5. somente depois disso o cálculo é feito.

Isso elimina o comportamento atual de clicar em simular e não saber se o problema está na busca, no Tracking ou no cálculo.

## Critério de aceite

1. A tela tem botão **Pesquisar CT-es** separado do botão **Simular / Calcular**.
2. O botão **Simular / Calcular** inicia desabilitado.
3. Ao pesquisar, o sistema mostra a tabela localizada.
4. Ao pesquisar, o sistema mostra quantos CT-es foram encontrados.
5. Ao pesquisar, o sistema mostra quantos CT-es estão com Tracking.
6. A lista/resumo dos CT-es aparece antes de qualquer cálculo.
7. Ao simular, o sistema usa a base já pesquisada, sem buscar novamente.
8. Se filtros mudarem, a base pesquisada é limpa e o usuário precisa pesquisar de novo.
9. A mesma base pesquisada pode ser usada para comparar propostas/rodadas.
10. Não pode mais acontecer timeout sem mostrar em qual etapa o processo está.
