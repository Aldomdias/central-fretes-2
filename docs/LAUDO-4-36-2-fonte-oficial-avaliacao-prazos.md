# Laudo Técnico — 4.36.2

## Demanda

**4.36.2 — Corrigir fonte de dados da Avaliação de Prazos e Cobertura**

## Problema identificado

A tela Avaliação de Prazos e Cobertura estava usando principalmente a base de Tabelas de Negociação, o que fazia a visão de cobertura parecer incompleta ou distorcida.

A visão correta deve partir das transportadoras/tabelas oficiais já cadastradas, pois elas representam a cobertura efetiva disponível para operação.

## Correção proposta

Ajustar a view `vw_avaliacao_prazos_cobertura` para unir duas fontes, com separação clara:

1. **OFICIAL** — rotas das transportadoras/tabelas cadastradas oficiais.
2. **NEGOCIACAO** — rotas de tabelas em negociação.
3. **REAJUSTE** — rotas de negociações do tipo reajuste.

## Regras aplicadas

- Fonte principal da tela: oficiais/cadastradas.
- Negociação e reajuste aparecem como complemento, não mascarando ausência de cobertura oficial.
- Dashboard e mapa passam a destacar cobertura oficial.
- Relatório detalhado passa a exibir a fonte da tabela.
- Filtro de fonte adicionado: oficiais/cadastradas, em negociação e reajustes.
- Mantida carga via view Supabase, sem voltar a carregar centenas de milhares de itens no navegador.

## Arquivos alterados

- `src/pages/AvaliacaoPrazosPage.jsx`
- `src/services/avaliacaoPrazosService.js`
- `supabase/migrations/20260609_002_avaliacao_prazos_fonte_oficial.sql`

## Validação esperada

1. Aplicar migration no Supabase.
2. Abrir Avaliação de Prazos.
3. Confirmar que o filtro inicial está em **Oficiais / cadastradas**.
4. Confirmar que o dashboard mostra cobertura oficial.
5. Usar “Ver todas as fontes” para conferir negociação/reajuste como complemento.
6. Confirmar que o relatório detalhado mostra a coluna **Fonte**.
7. Confirmar que rotas sem cobertura oficial não são mascaradas por tabelas em negociação.
8. Executar build:

```bash
npm.cmd run build
```
