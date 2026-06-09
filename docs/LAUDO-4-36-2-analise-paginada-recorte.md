# 4.36.2.6 — Avaliação de Prazos com análise paginada por recorte

## Objetivo

Corrigir a arquitetura da tela Avaliação de Prazos e Cobertura para permitir análises amplas, como:

- ATACADO Brasil inteiro;
- ATACADO região Sul;
- ATACADO Santa Catarina;
- transportadora específica;
- origem/destino específicos.

A tela não deve depender de uma única consulta agregada pesada. A análise passa a baixar o recorte em lotes de 500 registros, consolidando os cards no frontend, no mesmo conceito usado pelo Simulador.

## Alterações

### Serviço

Arquivo:

- `src/services/avaliacaoPrazosService.js`

Implementado:

- leitura direta da `mvw_avaliacao_prazos_cobertura`;
- aplicação dos filtros na consulta Supabase;
- paginação por `range(offset, offset + lote - 1)`;
- primeira página com contagem do total;
- demais páginas em lotes de 500;
- função `carregarAnalisePaginadaAvaliacao`;
- fallback de UF por código IBGE no frontend, para evitar dependência de `sigla_uf` preenchida na materialized view;
- filtro por UF destino e região destino usando prefixo IBGE quando `uf_destino_f` estiver vazio.

### Tela

Arquivo:

- `src/pages/AvaliacaoPrazosPage.jsx`

Implementado:

- botão **Buscar análise** executa análise paginada;
- progresso visual de linhas baixadas;
- opção de cancelar a consulta;
- cards consolidados após o recorte carregado;
- mapa por UF calculado a partir do recorte carregado;
- rotas críticas calculadas a partir do recorte carregado;
- relatório detalhado mostra inicialmente 300 linhas e permite mostrar mais;
- CSV exporta o recorte carregado;
- tela abre leve, sem carregar toda a base.

## Resultado esperado

A tela passa a suportar recortes grandes sem depender de RPCs agregadas que estouram timeout. Para recortes grandes, a carga pode demorar, mas ocorre em lotes controlados de 500 registros, com progresso visível e possibilidade de cancelamento.

## Validação

1. Abrir a tela sem erro.
2. Selecionar `Canal = ATACADO`.
3. Clicar em **Buscar análise**.
4. Ver progresso em lotes de 500.
5. Validar cards.
6. Testar `Região origem = SUL`.
7. Testar `UF origem = SC`.
8. Validar Mapa por UF.
9. Validar Rotas críticas.
10. Validar Relatório detalhado.
11. Exportar CSV do recorte carregado.
12. Rodar `npm.cmd run build`.
