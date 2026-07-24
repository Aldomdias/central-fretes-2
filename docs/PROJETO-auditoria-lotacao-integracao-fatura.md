# Projeto 1 — Auditoria Lotação integrada à Fatura

## Status
Especificação — discussão concluída, aguardando aprovação para virar plano de implementação. Nenhum código foi alterado a partir deste documento.

## Problema atual

A Auditoria Lotação hoje é uma tela isolada: o auditor entra nela, busca o CT-e (por chave, número ou DIST) e roda o cálculo ali dentro. Já existe uma tela de Auditoria por Fatura (fracionado/AMD), com visão de vencimento, valor, CT-es e divergência — mas ela não entende lotação. Faturas de transportadoras de lotação aparecem nessa lista com **divergência = 100% do valor**, porque a Verum não audita lotação e o valor de comparação vem zerado/errado. Resultado: toda fatura de lotação cai como "SEM AUDITOR DEFINIDO" sem triagem real, e não existe visão unificada de risco de vencimento entre fracionado e lotação.

Além disso, o casamento de dados hoje depende de nome de transportadora aproximado (normalização de texto + substring), tanto para achar a DIST quanto para achar a tabela — fonte de bugs recorrentes (ver histórico de correções em 2026-07-24: falsos positivos por substring, lista de vínculo sumida, valores inflados por reimportação, corte de resultados por limite de linhas).

## Objetivo

1. Transportadora vira cadastro central único, com **tipo** (Fracionado / Lotação / Portuária — Portuária reservada, sem engine própria por enquanto) e **CNPJ obrigatório**.
2. A tela de Auditoria por Fatura passa a reconhecer faturas de transportadoras tipo Lotação e rodar, para cada CT-e da fatura, a mesma engine de decisão hoje isolada na Auditoria Lotação — motor de cálculo compartilhado entre as duas telas, não duplicado.
3. Auditoria Lotação (tela atual) continua existindo, mas muda de papel: deixa de ser a porta de entrada e vira o painel de controle de pendências/questionamentos gerados pela engine.
4. Tabela Lotação (tela atual) continua existindo como visão de consulta em massa / comparação de reajuste, mas deixa de ser onde a tabela "mora" — a tabela passa a viver dentro do cadastro da transportadora, e o upload por Tabela Lotação exige selecionar a transportadora, propagando para lá.
5. Vínculos de Transportadora (tela separada de hoje) é descontinuado como tela própria. A necessidade que ele resolve (planilha de DIST não tem CNPJ, só nome em texto livre) continua existindo — mas o "apelido" (nome como aparece na planilha) passa a ser um campo dentro do cadastro da transportadora, não uma tabela à parte.

## Engine de decisão (núcleo do projeto)

Ordem de busca, sempre nessa sequência:

1. **Buscar a DIST/viagem** correspondente ao CT-e (transportadora + origem + destino, ou CT-e já listado na viagem). A DIST é sempre obrigatória — é ela que controla o **saldo** da viagem, necessário porque uma DIST pode ser paga por mais de um CT-e (valores parciais).
2. Se **não achar DIST** → questiona Operação (não há dado suficiente para auditar).
3. Se achar DIST, calcular o **saldo restante** da viagem (valor total da DIST menos o que já foi auditado por outros CT-es da mesma viagem — lógica já existente em `resumoViagem`).
4. Buscar a **tabela de negociação** aplicável (transportadora + rota).

### Tabela de decisão

| CT-e vs saldo da DIST | CT-e vs Tabela | Ação |
|---|---|---|
| cabe no saldo (igual) | bate (dentro da tolerância) | lança normal, sem observação — auditoria automática |
| cabe no saldo (igual) | acima da tolerância | **questiona Operação** — custo acima da tabela |
| saldo da DIST diverge da tabela | bate com a tabela | lança pelo valor da tabela + **corrige o registro da DIST** para o valor da tabela + observação para conferência posterior |
| cabe no saldo | sem tabela cadastrada | lança normal + marca para **cadastrar tabela depois** (fila de pendência de cadastro, não de auditoria) |
| **menor** que o saldo esperado | — | lança normal contra o saldo (uso parcial da DIST — outro CT-e pode completar depois) |
| **acima** do saldo, sem tabela cadastrada | — | **questiona Operação** — custo acima da DIST |
| CT-e acima da tabela E dados de DIST divergentes | — | questiona por "acima da tabela" (a tabela é a referência contratual e já basta para travar o pagamento automático, independente do que a DIST diz) |

### Tolerância
Configurável por acima/abaixo, seguindo o mesmo padrão já existente para fracionado (`auditoria_tolerancia_acima` / `auditoria_tolerancia_abaixo`, hoje definido por fatura em `CentralAuditoriaFretesPage.jsx:863-864`). Valor inicial: gatilho pronto na engine, número a definir depois pela operação — não deve ser hardcoded.

## Cadastro de Transportadora — mudanças

- Novo campo **tipo**: Fracionado / Lotação / Portuária (Portuária sem funcionalidade própria ainda, só reservada).
- Novo campo **CNPJ obrigatório** para qualquer cadastro novo a partir da implementação.
- **Migração do existente**: exportar lista atual de transportadoras cadastradas (nome + campos existentes) para planilha, preencher CNPJ manualmente, reimportar em massa. Sem isso, nem a identidade por CNPJ nem a integração de tabela funcionam.
- Transportadora tipo Lotação carrega, dentro do próprio cadastro, a **tabela de negociação** vigente (hoje solta em "Tabela Lotação").
- Novo campo **apelido(s) — nome como aparece na planilha de DIST**: a planilha de realizado/DIST não tem e não terá CNPJ (confirmado — não é uma mudança de processo viável agora), então o casamento com o texto livre da planilha continua sendo por nome. Esse apelido substitui a tela "Vínculos de Transportadora": cadastrado uma vez dentro da transportadora, resolve tanto o matching de DIST quanto (indiretamente) de tabela.
- Fluxo hoje quebrado (Negociações → aprovação → Transportadoras, desenhado só para fracionado) não muda por conta deste projeto — fica registrado como dívida técnica paralela. Enquanto não for corrigido, tabela de lotação segue entrando manualmente no cadastro da transportadora.

## Papel de cada tela depois do projeto

| Tela | Papel novo |
|---|---|
| Auditoria por Fatura (Central Auditoria Fretes) | Porta de entrada única — para fracionado (como já é) e agora também para lotação, roteado pelo tipo da transportadora. Roda a engine de decisão. |
| Auditoria Lotação | Painel de controle de pendências/questionamentos gerados pela engine (deixa de ser porta de entrada). |
| Tabela Lotação | Consulta em massa / comparação de reajuste. Upload passa a exigir vincular a uma transportadora, propagando a tabela para o cadastro dela. |
| Transportadoras | Cadastro central único — identidade (CNPJ), tipo, apelidos da planilha, tabela vigente (para tipo Lotação). |
| Vínculos de Transportadora | Descontinuado como tela própria; funcionalidade absorvida pelo campo de apelido em Transportadoras. |

## Fora do escopo deste projeto

- Ferramenta de auditoria Portuária (tipo já reservado, engine e tela a desenhar depois).
- Correção do fluxo Negociações → Transportadoras (dívida técnica paralela, não bloqueia este projeto).
- Projeto 2 (módulo de operação de lotação para reduzir dependência de planilha) — tratado em documento separado.
- Mudança no processo de preenchimento da planilha de DIST (CNPJ na planilha foi descartado).

## Em aberto / decisões pendentes antes de virar plano de implementação

- Valor numérico da tolerância acima/abaixo (fica configurável, mas o número inicial precisa ser definido pela operação).
- Nome/rótulo exato do campo "apelido" em Transportadoras e se aceita múltiplos apelidos por transportadora.
- Formato exato do arquivo de exportação/importação de CNPJs (colunas, template).
