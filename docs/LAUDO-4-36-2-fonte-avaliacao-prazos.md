# Laudo Técnico — 4.36.2

## Corrigir fonte de dados da Avaliação de Prazos e eliminar timeout

**Demanda:** 4.36.2
**Tela:** Avaliação de Prazos e Cobertura
**Projeto:** Central Fretes / `central-fretes-2`
**Data:** 2026-06-09

---

## 1. Sintoma

Ao abrir a tela, retorno `canceling statement due to statement timeout` e todos os indicadores zerados (Cobertura oficial 0, Linhas filtradas 0, Transportadoras 0, Menor prazo N/I, Fonte atual sem registros). A view `vw_avaliacao_prazos_cobertura` já estava conceitualmente correta (separando OFICIAL: 490.024, NEGOCIACAO: 35.991, REAJUSTE: 4.984), mas a tela não conseguia consumir esse volume.

## 2. Diagnóstico (causa-raiz)

Três fatores combinados, em ordem de gravidade:

1. **`count: 'exact'` na primeira consulta (gatilho imediato).** Em `avaliacaoPrazosService.js`, `listarRotasAvaliacaoPrazos()` abre com `.select(campos, { count: 'exact' })` sobre a view. Para devolver a contagem exata, o PostgreSQL precisa materializar as ~531 mil linhas inteiras da `UNION ALL` (rotas+origens+transportadoras+2 joins IBGE; itens+tabelas+IBGE; extração JSONB; `amd_parse_numeric` por linha). Isso estoura o `statement_timeout` antes de qualquer dado retornar — daí a tela zerar tudo de uma vez.

2. **Carregamento integral no navegador.** Após o count, o serviço paginava toda a view (`PAGE_SIZE = 1000`, `CONCORRENCIA = 6`) e acumulava ~531k linhas em memória. A `AvaliacaoPrazosPage` então executava **todas** as agregações no cliente (`filtrarLinhasAvaliacao`, `consolidarRotas`, `consolidarUfDestino`, KPIs, opções de filtro) por cima desse array. Nenhum filtro era aplicado no servidor — nem o `fonteTabela: 'OFICIAL'`, que já era o padrão da tela.

3. **View comum recalculada a cada chamada.** Por não ser materializada, a view não tem índice próprio; qualquer agregação varre as 531k linhas com joins. Gargalo estrutural.

Conclusão: remover apenas o `count: 'exact'` interrompe o timeout do count, mas a tela continuaria puxando 490k linhas oficiais. **A agregação tinha de sair do navegador e a base tinha de ser materializada e indexada.**

## 3. Solução implementada

Arquitetura em três camadas, preservando a regra de negócio (OFICIAL principal; NEGOCIACAO/REAJUSTE complementares, sem contar como cobertura oficial).

### 3.1 Banco — `supabase/migrations/20260609_004_avaliacao_prazos_mv_rpc_4362.sql`

- **Materialized view `mvw_avaliacao_prazos_cobertura`** com o mesmo SELECT da view 4.36.2 + colunas auxiliares pré-calculadas no banco que **espelham a normalização do frontend**: `canal_f`, `tipo_tabela_f`, `status_f`, `uf_origem_f`, `uf_destino_f`, `regiao_origem`, `regiao_destino`, `transportadora_norm`, `modalidade_norm`, `rota_label`, `rota_key`, `busca_norm` e `mv_key` (chave estável para refresh concurrent).
- **Funções imutáveis** `amd_normalizar(text)` (replica `normalizar()` do JS: upper → remove acentos via `translate` → não-alfanumérico vira espaço → trim) e `amd_regiao_uf(text)` (replica `obterRegiaoPorUf`). Garantem que os números do servidor batam com os que a tela calculava no cliente.
- **Índices**: único em `mv_key`; b-tree em `fonte_tabela`, `(fonte_tabela, uf_destino_f)`, `(fonte_tabela, uf_origem_f)`, `canal_f`, `transportadora_norm`, `modalidade_norm`, `rota_key`, `regiao_destino`; GIN trigram (`pg_trgm`) em `busca_norm`.
- **View de compatibilidade**: `vw_avaliacao_prazos_cobertura` recriada como `select ... from mvw_...`, mantendo o contrato para outros consumidores e o SQL de validação por fonte.
- **RPCs filtradas server-side** (padrão `p_fonte = 'OFICIAL'`):
  - `amd_ap_filtrado(...)` — função base de filtro reaproveitada pelas demais.
  - `rpc_avaliacao_prazos_kpis(...)` — indicadores agregados.
  - `rpc_avaliacao_prazos_uf(...)` — cobertura por UF destino.
  - `rpc_avaliacao_prazos_rotas(...)` — rotas consolidadas (ordem COBERTURA/PRAZO, `p_max_oficiais`, paginação).
  - `rpc_avaliacao_prazos_linhas(...)` — detalhe paginado (300 por página) com total.
  - `rpc_avaliacao_prazos_opcoes()` — opções de filtro + resumo global por fonte (uma chamada).
  - `rpc_avaliacao_prazos_refresh()` — `refresh materialized view concurrently` (botão "Atualizar base").
- Grants de `select`/`execute` para `anon`/`authenticated`.

### 3.2 Serviço — `src/services/avaliacaoPrazosService.js`

- `montarLinhaCobertura` passou a ser exportada (a tela reaproveita o mesmo mapeamento para o detalhe vindo da RPC).
- Adicionadas: `carregarOpcoesAvaliacao`, `carregarKpisAvaliacao`, `carregarMapaUfAvaliacao`, `carregarRotasAvaliacao`, `carregarLinhasAvaliacao`, `buscarLinhasParaExport` (lotes, teto de 50k), `refreshBaseAvaliacao`, além do mapeador `montarParametrosRpc` e tratamento de erro (timeout e migration ausente).
- As funções antigas (`carregarAvaliacaoPrazosCobertura`, `filtrarLinhasAvaliacao`, `consolidarRotas`, `consolidarUfDestino`, `resumirFontes`) foram **mantidas** para compatibilidade e testes; não estão mais no caminho quente.

### 3.3 Tela — `src/pages/AvaliacaoPrazosPage.jsx`

- Removido o carregamento integral + agregações em `useMemo`. A tela agora consulta por filtro via RPC, com **debounce de 350 ms**:
  - efeito de opções (uma vez por sessão / após refresh);
  - efeito de agregados sempre visíveis (KPIs, mapa, dashboard) em `Promise.all`;
  - efeito por aba (rotas / relatório) com paginação "Carregar mais".
- `fonteTabela: 'OFICIAL'` como padrão; "Ver todas as fontes" limpa a fonte. Negociação/reajuste seguem complementares.
- Exportação CSV via servidor em lotes, respeitando filtros, com aviso quando atinge o teto.
- "Atualizar base" chama o refresh da MV e recarrega.
- Proteção contra respostas obsoletas (tokens de requisição) para evitar corrida ao trocar filtros rápido.

## 4. Pontos de atenção

- **RLS:** a materialized view **não honra RLS por chamador** (é populada pelo dono), diferente da view com `security_invoker`. Para esta ferramenta interna de tabelas de frete é aceitável; registrado aqui para ciência.
- **Refresh:** estratégia escolhida é refresh periódico/sob demanda (botão e/ou agendamento). O dado pode ficar alguns minutos atrás do cadastro até o próximo refresh — trade-off assumido em troca da performance.
- **Validação:** o JS/JSX foi validado com esbuild parsecheck. O SQL foi revisado manualmente (não há PostgreSQL no ambiente de análise). `npm run build` e os testes na máquina do Aldo são obrigatórios.

## 5. Testes obrigatórios

1. Aplicar a migration `20260609_004` e confirmar que `refresh materialized view` conclui sem erro.
2. Abrir a tela sem timeout, com indicadores preenchidos.
3. Confirmar carregamento padrão somente `OFICIAL`.
4. Acionar "Ver todas as fontes" e ver negociação/reajuste entrarem como complementares.
5. Filtrar por transportadora, UF origem/destino, região origem/destino, canal, modalidade, status, prazo e busca geral.
6. Conferir que negociação/reajuste não contam como cobertura oficial nos KPIs e no mapa.
7. Validar dashboard (melhores prazos / rotas críticas), mapa por UF, aba rotas e relatório detalhado com "Carregar mais".
8. Exportar CSV respeitando os filtros e verificar o aviso de teto.
9. Acionar "Atualizar base" e confirmar recarga.
10. `npm run build`.


## 4.36.2.4 — Revisão estrutural por recorte

Após os testes locais, foi identificado que a tela ainda tentava calcular opções, indicadores, mapa e rotas em cima de um volume muito alto de registros oficiais. A estratégia de remendos pontuais foi substituída por uma arquitetura por recorte:

- abertura da tela com opções leves e resumo global;
- lista global de transportadoras não é mais carregada na abertura;
- transportadoras e opções dependentes são carregadas somente após seleção de canal/região/UF/transportadora/modalidade/busca;
- indicadores e cards detalhados só rodam depois do botão **Buscar análise**;
- mapa por UF e relatório detalhado continuam sob demanda;
- exportação da base inteira permanece bloqueada por segurança;
- botão **Recarregar tela** não reconstrói a materialized view.

Essa revisão trata a Avaliação de Prazos como ferramenta de análise por recorte, evitando tentar puxar Brasil inteiro de uma vez.
