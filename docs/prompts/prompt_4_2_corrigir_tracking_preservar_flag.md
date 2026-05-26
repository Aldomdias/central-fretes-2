# Prompt 4.2 — Corrigir vínculo CT-e x Tracking preservando o flag da tela

## Contexto
No Simulador do Realizado já existe um flag/opção de base, permitindo escolher entre:

1. **Somente CT-es com Tracking**
2. **Todos os CT-es**

Esse flag NÃO pode ser removido, escondido ou ter seu comportamento quebrado.

O problema atual é que, ao testar a simulação, o sistema não está encontrando vínculo com Tracking, mesmo existindo base de CT-es e Tracking para o mesmo período. Como temos aproximadamente 4 meses das duas bases, o esperado é encontrar vínculo em grande parte dos registros, algo em torno de 95% a 98%.

Se está retornando “Nenhum CT-e encontrou vínculo com o Tracking”, o problema provavelmente está no cruzamento, normalização, filtros, view ou campos utilizados.

---

## Regra principal

Preservar o flag existente:

- `com_tracking` / **Somente CT-es com Tracking**
- `todos` / **Todos os CT-es**

O ajuste deve corrigir a busca e o diagnóstico do Tracking sem remover essa opção.

---

## Comportamento esperado por modo

### 1. Modo “Somente CT-es com Tracking”

Nesse modo, a base efetivamente simulada deve conter apenas CT-es que encontraram vínculo com Tracking.

Regra:

- Buscar CT-es do realizado;
- Cruzar com Tracking;
- Simular apenas CT-es vinculados;
- CT-es sem vínculo devem ficar fora do cálculo;
- Exibir diagnóstico de quantos ficaram fora e por quê.

Se o percentual de vínculo ficar abaixo do esperado, por exemplo menor que 90%, exibir alerta forte:

> Atenção: o vínculo com Tracking ficou abaixo do esperado. Foram encontrados X vínculos em Y CT-es (Z%). Como a base de Tracking é obrigatória para validar volumes e cubagem, revise o diagnóstico antes de confiar na simulação.

Nesse modo, se não houver nenhum vínculo com Tracking, a simulação não deve seguir como se estivesse correta. Deve mostrar diagnóstico e lista de pendências.

---

### 2. Modo “Todos os CT-es”

Esse modo também deve continuar existindo.

A finalidade dele é permitir enxergar a base total de CT-es do realizado, inclusive os que ainda não cruzaram com Tracking.

Regra:

- Carregar todos os CT-es do realizado conforme filtros;
- Cruzar com Tracking quando possível;
- Manter na tela a separação entre:
  - CT-es com Tracking;
  - CT-es sem Tracking;
- Não remover CT-es silenciosamente;
- Marcar claramente os registros sem Tracking como pendentes de vínculo;
- Exibir alerta quando houver CT-es sem Tracking.

Nesse modo, se algum cálculo usar CT-es sem Tracking, a tela precisa deixar claro que esses registros podem estar sem cubagem/volume confiável.

O ideal é separar os indicadores:

- Base total de CT-es;
- CT-es com Tracking;
- CT-es sem Tracking;
- Percentual de vínculo;
- Base simulada com Tracking;
- Base exibida total.

---

## O que NÃO fazer

Não remover o flag da tela.
Não alterar o comportamento para sempre usar apenas uma opção.
Não mudar o padrão sem necessidade.
Não mascarar o erro simulando todos os CT-es sem mostrar que alguns estão sem Tracking.
Não transformar o modo “Todos os CT-es” em “Somente Tracking”.
Não transformar o modo “Somente Tracking” em fallback automático para todos.

---

## Problema a investigar

O sistema está carregando CT-es do realizado, mas não está encontrando vínculo no Tracking.

Investigar obrigatoriamente:

1. Se os filtros aplicados no realizado e no Tracking usam o mesmo período/campo de data.
2. Se o cruzamento tenta os campos corretos:
   - chave CT-e;
   - chave NF-e;
   - número da NF;
   - número do CT-e;
   - combinação transportadora + NF + data, se necessário.
3. Se a normalização está correta:
   - remover máscara;
   - remover espaços;
   - manter somente dígitos para chaves;
   - tratar zeros à esquerda;
   - tratar número de NF como string;
   - tratar CT-e com série, prefixo ou formatação diferente.
4. Se a view `vw_tracking_cte_agregado` existe e retorna dados.
5. Se a coluna `chave_cte_limpa` existe e está preenchida.
6. Se o fallback em `tracking_rows` compara campo normalizado com campo não normalizado.
7. Se o Supabase está limitando ou truncando consulta `.in()` com muitos itens.
8. Se os CT-es do realizado possuem chave CT-e, chave NF-e ou apenas número.
9. Se o Tracking está salvo com nomes de campos diferentes dos esperados.

---

## Ajuste necessário

Criar diagnóstico antes de bloquear ou seguir com a simulação.

Após carregar os CT-es do realizado:

- total de CT-es carregados;
- quantidade com chave CT-e preenchida;
- quantidade com chave NF-e preenchida;
- quantidade com número NF preenchido;
- quantidade com número CT-e preenchido;
- exemplos de 10 chaves CT-e;
- exemplos de 10 chaves NF-e;
- exemplos de 10 números de NF;
- exemplos de 10 números de CT-e.

Após buscar Tracking:

- total encontrado por chave CT-e;
- total encontrado por chave NF-e;
- total encontrado por número NF;
- total encontrado por número CT-e;
- total sem vínculo;
- percentual de vínculo;
- primeiros 100 CT-es sem vínculo;
- campo usado para tentar vincular;
- motivo provável da falha.

---

## Ajuste técnico provável

No arquivo `src/pages/SimuladorPage.jsx`, revisar a função `buscarTrackingParaRealizado`.

Pontos críticos:

- Quando a view `vw_tracking_cte_agregado` falhar, o fallback em `tracking_rows` não pode comparar chaves já limpas com colunas que podem estar sujas.
- Se `tracking_rows.chave_cte` estiver com máscara/espaço, buscar por `.in('chave_cte', chavesLimpas)` pode retornar zero.
- Criar alternativa usando colunas limpas na tabela/view, ou ajustar a busca para normalizar os dados antes da comparação.
- Se não houver coluna limpa no banco, criar view ou RPC no Supabase que retorne as chaves normalizadas.
- Preservar a variável/estado existente `baseRealizadoTracking`.
- Preservar as opções da interface que alternam entre `com_tracking` e `todos`.

---

## Resultado esperado

Com a mesma base de CT-es e Tracking de 4 meses:

- o sistema deve encontrar vínculo para grande parte da base;
- o percentual de vínculo deve aparecer na tela;
- o modo “Somente CT-es com Tracking” deve simular apenas vinculados;
- o modo “Todos os CT-es” deve exibir todos, mas destacar pendências de Tracking;
- CT-es sem vínculo devem aparecer em lista/exportação;
- nenhum CT-e deve ser removido sem explicação;
- a comparação entre rodadas deve usar base rastreável e coerente.

---

## Critério de aceite

1. O flag “Somente CT-es com Tracking / Todos os CT-es” continua funcionando.
2. O simulador volta a encontrar Tracking para a maior parte da base.
3. O percentual de vínculo aparece na tela.
4. CT-es sem vínculo aparecem em lista/exportação.
5. Em “Somente CT-es com Tracking”, apenas vinculados entram na simulação.
6. Em “Todos os CT-es”, todos aparecem, mas sem vínculo fica marcado como pendência.
7. Se vínculo ficar abaixo de 90%, a tela alerta fortemente.
8. O resultado da simulação deixa claro:
   - CT-es brutos;
   - CT-es com Tracking;
   - CT-es sem Tracking;
   - percentual de vínculo;
   - base efetivamente simulada;
   - modo selecionado no flag.
