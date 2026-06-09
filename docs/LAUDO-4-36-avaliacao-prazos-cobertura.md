# 4.36 — Módulo Avaliação de Prazos e Cobertura por Transportadora

Status: entrega local inicial pronta para validação
Tipo: novo módulo / dashboard / relatório operacional
Área: Transportadoras / Tabelas de Negociação / Avaliação de Prazos

## Objetivo

Criar um módulo próprio para avaliar quais transportadoras existem em tabela por origem x destino e qual o prazo de entrega de cada uma, permitindo análise gerencial de cobertura logística, alternativas por rota e comparação de prazos.

## Escopo implementado

- Novo módulo no menu: **Avaliação de Prazos**.
- Nova página: `src/pages/AvaliacaoPrazosPage.jsx`.
- Novo serviço isolado: `src/services/avaliacaoPrazosService.js`.
- Integração com `App.jsx`, `Sidebar.jsx` e permissões em `authLocal.js`.
- Leitura baseada nas tabelas já existentes:
  - `tabelas_negociacao`;
  - `tabelas_negociacao_itens`.
- Filtros por:
  - canal;
  - transportadora;
  - região de origem;
  - região de destino;
  - UF de origem;
  - UF de destino;
  - modalidade;
  - tipo de tabela;
  - status;
  - com prazo / sem prazo;
  - busca geral por cidade, UF, transportadora, tabela e observação.
- Dashboard com indicadores:
  - rotas filtradas;
  - linhas de tabela;
  - quantidade de transportadoras;
  - menor prazo;
  - prazo médio;
  - rotas com baixa cobertura;
  - UFs sem cobertura dentro do filtro atual.
- Visão de melhores prazos por rota.
- Visão de rotas com pouca cobertura.
- Mapa visual por UF destino, sem dependência externa de biblioteca de mapa.
- Relatório consolidado por rota.
- Relatório detalhado por origem x destino x transportadora.
- Exportação CSV.

## O que não foi alterado

- Não altera 4.35 / Laudo de Reajuste.
- Não altera motor de cálculo.
- Não altera Simulador do Realizado.
- Não altera Tabelas de Negociação existentes.
- Não altera CT-es.
- Não altera Auditoria Lotação.
- Não altera Lotação Operação.
- Não altera laudos comerciais atuais.

## Observações técnicas

O módulo trabalha inicialmente com os campos disponíveis em `tabelas_negociacao_itens`, usando fallback em `dados_originais` para identificar prazo, origem, destino, modalidade e demais informações vindas das planilhas. Como os modelos de importação podem variar, o serviço procura os principais nomes de campo possíveis para prazo, como `prazo`, `prazo_entrega`, `prazo_dias`, `lead_time`, `leadtime`, `dias_entrega` e equivalentes.

O mapa visual por UF é uma primeira versão operacional, feita em cards de UF para evitar dependência nova no projeto. Em uma evolução futura, pode ser substituído por mapa real do Brasil em SVG ou biblioteca de mapa, se fizer sentido.

## Testes recomendados

1. Rodar `npm.cmd run build`.
2. Abrir o sistema local.
3. Entrar com perfil Gestão.
4. Acessar **Avaliação de Prazos** no menu.
5. Conferir se carrega a base sem erro.
6. Testar filtros por canal, UF destino, região destino e transportadora.
7. Conferir se o relatório traz origem, destino, transportadora e prazo.
8. Validar se o mapa por UF mostra cobertura coerente.
9. Exportar CSV e abrir no Excel.
10. Garantir que a 4.35/Reajustes continua abrindo sem alteração.
