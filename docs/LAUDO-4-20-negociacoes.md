# Laudo — Prompt 4.20

**Corrigir "Atualizar negociações" e carregamento leve no Simulador do Realizado**

Branch: `codex`

---

## 1. Motivo do problema

A tela ficava presa em **"atualizando negociações..."** por duas causas que se reforçavam:

### (a) Carregamento pesado e sequencial no serviço

`buscarTabelasNegociacaoParaSimulacao` (em `tabelasNegociacaoService.js`) buscava as capas e, num laço `for…of` **sequencial**, fazia para *cada* negociação:

- `listarTodosItensTabelaNegociacao` (paginado de 1000 em 1000), e
- `listarTodasTaxasDestinoTabela` (paginado de 1000 em 1000).

Com várias tabelas grandes, isso era `N × (itens + taxas)` chamadas encadeadas — demorava muito ou aparentava nunca terminar. O `loading` só desligava no `finally`, então o status ficava preso.

### (b) `useEffect` em loop

O efeito de auto-carga dependia de `[aba, negociacoesSimulador.length, carregandoNegociacoesSimulador]`. Quando a busca retornava **lista vazia** (zero negociações no canal), `negociacoesSimulador.length` continuava `0`, e o efeito disparava de novo a cada render:

`liga loading → busca → vazio → desliga loading → efeito reavalia → liga loading …`

Isso martelava o Supabase e mantinha o texto preso. Também havia a falha menor de o botão "Atualizar negociação" depender do retorno da função, que originalmente não devolvia nada (já tinha sido ajustado para `return dados`, mas o problema de fundo continuava sendo o item (a)).

---

## 2. Correção aplicada

A estratégia foi **carregamento leve + detalhe sob demanda**, sem tocar no motor de cálculo, no ranking, na aderência, no ICMS nem nas regras de ganhador.

### `src/services/tabelasNegociacaoService.js`

- **`listarCapasNegociacaoParaSimulacao(filtros)`** *(nova)* — uma única query que traz só as **capas** (id, transportadora, canal, origem, status, tipo, datas, `resumo_simulacao` etc.). Sem itens/rotas/taxas. Resolve rápido.
- **`carregarDetalhesNegociacaoParaSimulacao(tabela)`** *(nova)* — busca itens **e** taxas de **uma** negociação, em paralelo (`Promise.all`).
- **`buscarTabelasNegociacaoParaSimulacao(filtros)`** *(reescrita)* — agora usa as capas + hidrata em **paralelo com limite de concorrência (4)** via helper `executarComConcorrencia`. Continua existindo para o fluxo de comparar contra várias negociações, mas sem o laço sequencial que travava.

### `src/utils/tabelasNegociacaoSimuladorAdapter.js`

- **`nomesTabelasNegociacaoSimulador(tabelas, { canal })`** *(nova)* — monta a lista de seleção a partir **apenas das capas** (usa `labelTabelaNegociacaoSimulador` e o mesmo filtro de canal do conversor). Assim a lista aparece **antes** de os itens carregarem. O conversor pesado `converterTabelasNegociacaoParaSimulador` ficou intacto.

### `src/pages/SimuladorPage.jsx`

- `carregarNegociacoesSimulador` agora carrega **só a lista leve** (capas), preservando detalhes já hidratados ao recarregar, e **sempre finaliza** o loading. Define etapa `'lista' → 'concluido' | 'erro'`.
- Auto-carga ao abrir trocada por **carga leve única**, guardada por `capasNegociacaoCarregadasRef` — **não entra mais em loop** quando não há negociações. Dependência reduzida a `[aba]`.
- **`hidratarNegociacaoSimulador(capa)`** — ao selecionar uma negociação, busca os detalhes **só dela** (idempotente via `negociacoesHidratadasRef`).
- **`hidratarNegociacoesCanalSimulador()`** — ao ativar "Incluir tabelas em negociação", hidrata só as negociações **do canal ativo** (respeita o item 5 do prompt).
- `onBuscarCtesRealizado` garante que a negociação selecionada está hidratada **antes** de montar a base (busca os detalhes dela sob demanda se faltar).
- `onAtualizarNegociacaoRealizado` (botão "🔄 Atualizar negociação") agora **força** o re-fetch dos detalhes da negociação selecionada (limpa do cache de hidratação e rebusca), refletindo edições feitas na tela de Negociações.
- **`nomesNegociacaoRealizado`** passou a vir da lista leve (`nomesTabelasNegociacaoSimulador`) — a lista de seleção aparece mesmo sem itens carregados.
- **Status por etapa** (`statusNegociacoesRealizado`): "carregando lista...", "carregando negociação selecionada (itens e taxas)...", "carregando negociações do canal...", "negociações atualizadas às HH:MM", "erro ao carregar...". **Nunca fica preso** em "atualizando negociações...".
- Novo botão **"↻ Atualizar negociações"** (recarrega a lista leve, limpa erro, mostra/encerra loading, não roda em loop).

---

## 3. Pontos de teste

1. **Abrir o Simulador do Realizado**: deve carregar **só a lista leve** rapidamente; status vai para "negociações atualizadas às HH:MM". Não fica preso.
2. **Canal sem negociações**: status mostra "aguardando/atualizadas" e **não** entra em loop (verificar no Network que não há requisições repetidas).
3. **Selecionar uma negociação**: status mostra "carregando negociação selecionada (itens e taxas)..." e conclui; a malha/rotas da negociação aparece.
4. **Botão "↻ Atualizar negociações"**: recarrega a lista, limpa erro, encerra o loading.
5. **Botão "🔄 Atualizar negociação"**: rebusca os detalhes da negociação selecionada (testar editando a tabela em Negociações e depois clicando aqui).
6. **Buscar CT-es** com negociação selecionada: continua funcionando, mesmo clicando logo após selecionar (hidratação sob demanda garante a base).
7. **Simular**: resultado igual ao anterior para a mesma negociação (motor de cálculo intacto).
8. **Filtros BI pós-busca**: inalterados.
9. **Comparar concorrentes + Incluir negociações**: hidrata só o canal ativo; comparação funciona.
10. **Build/lint passam.**

> Validação local feita aqui: os 3 arquivos passam em checagem de sintaxe/JSX e o `SimuladorPage.jsx` faz **bundle completo** sem erros de resolução (esbuild). O `npm run build` completo precisa do repositório inteiro — rode os comandos abaixo no seu projeto.

---

## 4. Comandos

```bash
npm run build
npm run dev
```

---

## 5. Arquivos alterados

- `src/services/tabelasNegociacaoService.js`
- `src/utils/tabelasNegociacaoSimuladorAdapter.js`
- `src/pages/SimuladorPage.jsx`

Patch unificado: `prompt-4-20-negociacoes.patch` (aplicável da raiz do repo com `git apply prompt-4-20-negociacoes.patch`).
